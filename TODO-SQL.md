# TODO-SQL

Supabase 에서 사람이 직접 실행해야 하는 SQL 을 모아 두는 파일입니다.

---

## ✅ 1. setup.sql 따라잡기 — 처리 완료

**상태: 검토·실행 완료 (사용자 확인), 이후 `supabase/setup.sql` 자체를 최신화했습니다.**

`supabase/setup.sql` 이 v1.0 시점 그대로여서 `categories` · `item_categories` · `time_slots`
테이블과 `items` 의 컬럼 6개가 빠져 있던 문제였습니다.

지금은 **`supabase/setup.sql` 하나만 실행하면 새 프로젝트가 완전히 동작**합니다.
따로 붙여넣을 따라잡기 SQL 은 더 이상 없습니다. 여기에 있던 마이그레이션 본문은
setup.sql 안으로 흡수했으므로 중복을 피하려고 삭제했습니다.

setup.sql 이 하는 일:

- 테이블 4개 (categories / time_slots / items / item_categories)
- RLS 정책 (본인 데이터만), 인덱스, 이미지 버킷 `archive-images`
- `updated_at` 자동 갱신 트리거
- **기본 카테고리 4종 + 시간대 5종 시드** — 가입 트리거로 새 계정에 자동 적용,
  기존 계정에는 실행 시 채워 넣음. 그 사용자에게 이미 있으면 통째로 건너뜁니다.
- 여러 번 다시 실행해도 안전 (`if not exists` / `drop policy if exists` / 시드 존재 검사)

### 남아 있는 선택 사항

- `items.category` (v1.0 의 고정 카테고리 문자열)는 코드가 더 이상 읽지 않습니다.
  setup.sql 이 `not null` 제약은 풀어 두었지만 **열 자체는 남겨 두었습니다** —
  옛 백업 JSON 을 복원할 때 이 열이 없으면 실패하기 때문입니다.
  옛 백업을 더 쓸 일이 없다고 판단되면 그때 지우세요.

  ```sql
  -- 백업 JSON 을 먼저 받아 둔 뒤에 실행하세요. 되돌릴 수 없습니다.
  alter table public.items drop column if exists category;
  drop index if exists public.items_category_idx;   -- v1.0 이 만들던 인덱스
  ```

---

## 2. 아직 필요한 DB 변경

### 🔴 파일 첨부 (file-attach) — **실행 필요**

`supabase/setup.sql` 전체를 SQL Editor 에 다시 붙여넣고 Run 하세요.
여러 번 실행해도 안전하게 만들어 두었으므로, 따로 떼어낸 조각을 실행하지 않아도 됩니다.
이번에 늘어난 것은 두 가지입니다.

```sql
-- ① items 에 첨부 파일 메타 열 (실체는 스토리지에, 여기에는 이름·경로·용량만)
alter table public.items add column if not exists files jsonb not null default '[]'::jsonb;

-- ② 비공개 파일 버킷 + 정책 3개 (읽기·업로드·삭제)
insert into storage.buckets (id, name, public, file_size_limit)
values ('archive-files', 'archive-files', false, 10485760)
on conflict (id) do nothing;
-- 정책 본문은 setup.sql 의 '6) 파일 스토리지' 절에 있습니다.
```

**실행 전에는** 파일 첨부가 든 항목을 저장할 때 `files` 열을 찾지 못합니다.
앱은 그 오류를 알아보고 `files` 없이 한 번 더 저장한 뒤,
"첨부 파일 기능을 쓰려면 supabase/setup.sql 을 실행해 주세요" 라고 알립니다.
즉 **기존 저장 기능이 멈추지는 않지만, 첨부한 파일은 항목에 붙지 않습니다.**

버킷을 비공개로 둔 이유는 `supabase/setup.sql` 의 6) 절 주석에 적어 두었습니다.

---

### 🟡 확장자 정책 변경 (블랙리스트) — **버킷 MIME 제한이 걸려 있을 때만 실행**

앱은 이제 모든 확장자를 받습니다(실행 파일 11종만 차단). 그런데 스토리지 버킷에
`allowed_mime_types` 가 걸려 있으면 브라우저 검사를 통과한 파일이 **업로드에서** 막힙니다.

`supabase/setup.sql` 은 이 버킷을 만들 때 `allowed_mime_types` 를 준 적이 없습니다
(= NULL = 제한 없음). 그래서 저장소 정의대로라면 **할 일이 없습니다.**
다만 대시보드에서 손으로 버킷을 만들었거나 나중에 제한을 걸었을 수 있으니, 먼저 확인하세요.

```sql
-- ① 확인 — allowed_mime_types 가 null 이면 제한 없음(할 일 없음)
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('archive-files', 'archive-images');

-- ② 위에서 allowed_mime_types 가 null 이 아닐 때만 실행 — MIME 제한 해제
--    (file_size_limit 은 그대로 둡니다. 용량 상한은 두 겹으로 유지 —
--     지금 값은 26214400 이어야 합니다. 아래 '개당 상한 10MB → 25MB' 절 참고)
update storage.buckets
set allowed_mime_types = null
where id = 'archive-files';
```

> 앱의 anon 키로는 `storage.buckets` 를 읽을 수 없어(정책상 가려집니다) 코드 쪽에서
> 라이브 상태를 확인할 방법이 없습니다. SQL 에디터나 대시보드에서 ①을 한 번 보세요.

---

### 🔴 항목 공유 링크 (share-link) — **실행 필요**

`supabase/setup.sql` 전체를 SQL Editor 에 다시 붙여넣고 Run 하세요 (9절이 새로 생겼습니다).
여러 번 실행해도 안전합니다. 이번에 늘어난 것은 표 하나와 함수 하나입니다.

```sql
-- ① 공유 토큰 표. id 가 곧 토큰이다(uuid = 122비트 난수).
create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  files jsonb not null default '[]'::jsonb,   -- 만들 때 굳혀 둔 서명 주소
  created_at timestamptz default now()
);

create index if not exists shares_user_created_idx on public.shares (user_id, created_at desc);
create index if not exists shares_item_idx on public.shares (item_id);

alter table public.shares enable row level security;

-- 소유자만. anon 정책은 **일부러 두지 않는다** — 토큰을 알아도 이 표는 못 읽는다.
drop policy if exists "own shares all" on public.shares;
create policy "own shares all" on public.shares
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ② 열람 함수. 공유 항목을 꺼내는 **유일한 길**이고, 만료·회수 판정이 여기서 끝난다.
--    본문은 setup.sql 의 9) 절에 있습니다 (여기서는 뼈대만).
create or replace function public.share_view(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$ ... $$;

revoke all on function public.share_view(uuid) from public;
grant execute on function public.share_view(uuid) to anon, authenticated;
```

**실행 전에는** 공유 링크만 동작하지 않습니다. 링크를 만들려고 하면
`공유 링크 표가 아직 없어요 — supabase/setup.sql 을 실행해 주세요` 라고 알리고,
설정의 '공유 중인 링크' 칸은 통째로 숨습니다. **나머지 기능은 그대로 돕니다.**

`items` 의 RLS 는 손대지 않았습니다 — 비로그인 조회는 예전처럼 0행입니다.
공유는 RLS 를 여는 방식이 아니라, security definer 함수 하나를 여는 방식입니다.

---

### 🔴 공간 / 서랍 (space) — **실행 필요**

`supabase/setup.sql` 전체를 SQL Editor 에 다시 붙여넣고 Run 하세요 (2-b 절이 새로 생겼고,
1·3·8 절이 조금 늘었습니다). 여러 번 실행해도 안전합니다.

```sql
-- ① 공간 표. 항목이 들고 다니는 것은 '열쇠' 문자열 하나뿐이고, 이 표는 이름·아이콘만 담는다.
create table if not exists public.spaces (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  name text not null,
  icon text default '🗂',
  position int default 0,
  created_at timestamptz default now(),
  primary key (user_id, key)
);
create index if not exists spaces_user_pos_idx on public.spaces (user_id, position);
alter table public.spaces enable row level security;
drop policy if exists "own spaces all" on public.spaces;
create policy "own spaces all" on public.spaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ② 항목·카테고리에 space 열.
--    🔴 **이 기본값이 곧 마이그레이션이다** — 열이 생기는 순간 기존 행은 전부 '개인'이 된다.
--       따로 돌릴 update 문이 없다. 되돌리려면 열을 지우면 된다(자료는 그대로다).
alter table public.items      add column if not exists space text not null default 'personal';
alter table public.categories add column if not exists space text not null default 'personal';

create index if not exists items_user_space_created_idx
  on public.items (user_id, space, created_at desc) where deleted_at is null;
create index if not exists categories_user_space_idx
  on public.categories (user_id, space, position);

-- ③ 기본 공간 2종 시드. seed_defaults() 안에 들어가 있어 새 계정에는 가입 트리거가,
--    기존 계정에는 setup.sql 끝의 do 블록이 넣어 준다. 이미 있으면 건너뛴다.
insert into public.spaces (user_id, key, name, icon, position)
select u.id, v.key, v.name, v.icon, v.position
from auth.users u
cross join (values ('personal', '개인', '🏠', 1), ('class', '수업', '🏫', 2))
          as v(key, name, icon, position)
where not exists (select 1 from public.spaces s where s.user_id = u.id);
```

**실행 전에는** 공간 기능만 접힙니다. 헤더의 전환기가 숨고 화면에
`공간 기능을 쓰려면 supabase/setup.sql 을 실행해 주세요` 한 줄이 뜨며,
목록·검색·저장·휴지통은 **예전 그대로** 돕니다 (앱이 `items.space` 가 있는지 한 번 물어보고
없으면 조회에도 저장에도 그 열을 쓰지 않습니다 — `src/spaces.js` 의 `probeSpaceColumn`).

되돌리기: `alter table public.items drop column if exists space;` (카테고리도 같게).
열만 사라지고 항목·카테고리는 그대로 남습니다.

---

### 🔴 첨부 파일 개당 상한 10MB → 25MB — **실행 필요**

앱은 이제 개당 **25MB** 까지 받습니다(`src/supabase.js` 의 `FILE_MAX_BYTES = 26214400`).
그런데 `archive-files` 버킷의 `file_size_limit` 은 **10MB(10485760) 로 만들어져 있습니다.**

`supabase/setup.sql` 의 버킷 생성문은 `on conflict (id) do nothing` 이라
**이미 있는 버킷에는 새 값이 적용되지 않습니다.** 그래서 update 한 줄이 따로 필요합니다
(setup.sql 6절에도 같은 문장을 넣어 두었으니 전체를 다시 Run 해도 됩니다).

```sql
-- ① 지금 값 확인 (10485760 이면 아래 ②가 필요합니다)
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'archive-files';

-- ② 25MB 로 올리기
update storage.buckets
set file_size_limit = 26214400          -- 25 * 1024 * 1024
where id = 'archive-files';
```

**실행 전에는** 10MB 를 넘는 파일이 브라우저 검사는 통과하고 **업로드에서 튕깁니다.**
앱은 `파일 N개를 올리지 못했어요 — …` 로 알리지만, 그 원인이 서버 상한이라는 것까지는
말해 주지 못합니다. 즉 **두 검사가 어긋난 동안이 가장 나쁜 상태**이므로 함께 올려야 합니다.

되돌리기: 위 update 의 값을 `10485760` 으로 두고, `FILE_MAX_BYTES` 도 같이 되돌리세요.
**한쪽만 되돌리면 안 됩니다** — 어긋난 상태가 곧 위의 그 나쁜 상태입니다.

---

### 🔴 계획 격자 (plan) — **실행 필요**

`supabase/setup.sql` 전체를 SQL Editor 에 다시 붙여넣고 Run 하세요.
여러 번 실행해도 안전합니다. 이번에 늘어난 것은 **표 하나 + items 열 다섯 + 제약 둘 + 인덱스 하나**입니다.

```sql
-- ① 계획 격자의 세로축(영역). 가로축(단기·중기·장기)은 코드 상수라 표가 없습니다.
create table if not exists public.plan_domains (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  name text not null,
  color text default 'gray',
  position int default 0,
  created_at timestamptz default now(),
  primary key (user_id, key)
);

create index if not exists plan_domains_user_pos_idx
  on public.plan_domains (user_id, position);

alter table public.plan_domains enable row level security;

drop policy if exists "own plan_domains all" on public.plan_domains;
create policy "own plan_domains all" on public.plan_domains
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ② items 의 계획 열 다섯. 전부 null 로 들어갑니다 —
--    이 열이 생겨도 **기존 항목은 하나도 계획이 되지 않습니다.**
alter table public.items add column if not exists horizon text;         -- short | mid | long
alter table public.items add column if not exists plan_status text;     -- planned | doing | done | dropped
alter table public.items add column if not exists domain text;          -- plan_domains.key
alter table public.items add column if not exists related_ids jsonb not null default '[]'::jsonb;
alter table public.items add column if not exists plan_status_at timestamptz;

-- ③ 값 검사. 화면은 이미 정해진 값만 고르게 하지만, 백업 복원·SQL 편집은 화면을 안 거칩니다.
--    오타 하나가 '격자 어디에도 안 보이는 계획' 이 되는 것을 막습니다.
alter table public.items drop constraint if exists items_horizon_check;
alter table public.items add constraint items_horizon_check
  check (horizon is null or horizon in ('short', 'mid', 'long'));

alter table public.items drop constraint if exists items_plan_status_check;
alter table public.items add constraint items_plan_status_check
  check (plan_status is null or plan_status in ('planned', 'doing', 'done', 'dropped'));

-- ④ 계획 탭 조회용 부분 인덱스. 계획이 아닌 항목은 인덱스에 들어가지도 않습니다.
create index if not exists items_user_plan_idx
  on public.items (user_id, space, plan_status)
  where plan_status is not null and deleted_at is null;

-- ⑤ 기본 영역 6종 시드 — setup.sql 의 seed_defaults 안에 들어 있습니다.
--    '그 사용자에게 이미 하나라도 있으면 통째로 건너뛰기' 라, 이름을 바꾼 뒤
--    다시 실행해도 기본 이름이 되살아나지 않습니다.
--    (수입 · 성장 · 건강 · 창작 · 관계 · 생활)
```

**실행 전에는** 앱이 `items.horizon` 을 한 번 물어보고 없으면 **계획 기능만 접습니다.**
계획 탭이 사라지고, 항목 모달의 '계획으로' 칸과 카드의 `🧭 계획으로` 버튼도 숨습니다.
그 대신 상단에 `계획 기능을 쓰려면 supabase/setup.sql 을 실행해 주세요` 한 줄이 뜹니다.
**목록·검색·저장·오늘 탭·공유는 예전 그대로 돕니다** (공간 열에서 쓴 방법과 같습니다).

`plan_status_at` 을 따로 둔 이유: `updated_at` 은 제목만 고쳐도 갱신되므로,
그것으로 '7일째 멈춘 계획' 을 재면 오타 한 번 고친 것이 '움직인 것' 이 됩니다.
주간 리뷰의 정체 목록이 조용히 비어 가는데 화면에는 아무 표시도 안 납니다.

되돌리기 (계획을 통째로 버릴 때):

```sql
-- 🔴 계획으로 적어 둔 것이 전부 사라집니다. 백업 JSON 을 먼저 받아 두세요.
alter table public.items drop constraint if exists items_horizon_check;
alter table public.items drop constraint if exists items_plan_status_check;
drop index if exists public.items_user_plan_idx;
alter table public.items drop column if exists horizon;
alter table public.items drop column if exists plan_status;
alter table public.items drop column if exists domain;
alter table public.items drop column if exists related_ids;
alter table public.items drop column if exists plan_status_at;
drop table if exists public.plan_domains;
```

---

### 그 밖

**없습니다.**

밤샘 작업(PWA · 모바일 · 다크 모드 · 에러 처리 · 성능 · 코드 정리 · 디자인 폴리싱 ·
요금제 초안)과 이후 모바일 재점검에서 추가로 필요한 스키마 변경은 나오지 않았습니다.
테마 설정은 `localStorage('archive-theme')` 에, 보기·탭 선택도 기존대로 `localStorage` 에 둡니다.

요금제 화면은 정적 초안이라 결제·구독 테이블을 만들지 않았습니다.
실제 유료화를 진행할 때 `subscriptions` 같은 테이블이 필요해지면 여기에 이어서 적습니다.

---

## 참고: 코드에서 발견했지만 DB 변경은 아닌 것

- ~~백업에 `time_slots` 가 빠져 있습니다.~~ **처리 완료.**
  내보내기에 `time_slots` 를 추가하고, 가져오기도
  카테고리 → **시간대** → 항목 → 카테고리 소속 순서로 복원합니다
  (`items.slot_id` 가 `time_slots` 를 참조하므로 항목보다 먼저 들어가야 합니다).
  시간대가 없는 옛 백업 파일도 그대로 복원됩니다.
