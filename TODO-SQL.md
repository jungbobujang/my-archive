# TODO-SQL

여기 모인 SQL 은 **아직 실행하지 않았습니다.** 사람이 직접 Supabase 대시보드
→ SQL Editor 에 붙여넣고 실행해 주세요. (`supabase/setup.sql` 은 수정 금지라 손대지 않았습니다.)

---

## 1. setup.sql 이 현재 앱보다 뒤처져 있음 ⚠️ (밤샘 작업 중 발견)

**작업 지시로 나온 항목이 아니라, README 를 현재 기능 기준으로 갱신하다가 발견한 문제입니다.**

`supabase/setup.sql` 은 v1.0 시점 그대로여서 `items` 테이블 하나만 만듭니다.
그 뒤에 들어간 기능들이 쓰는 테이블·컬럼이 전부 빠져 있습니다.

- 없는 테이블: `categories`, `item_categories`, `time_slots`
- `items` 에 없는 컬럼: `category_id`, `status`, `due_date`, `slot_id`, `link_url`, `deleted_at`

지금 쓰고 있는 Supabase 프로젝트에는 이 스키마가 이미 손으로 들어가 있을 것입니다
(그래서 앱이 도는 것입니다). 문제는 **새 환경에 setup.sql 만 실행하면 앱이 깨진다**는 점입니다.
백업 복원(가져오기)도 `categories` 테이블이 없으면 첫 단계에서 실패합니다.

아래는 코드가 실제로 참조하는 컬럼을 역으로 정리한 "따라잡기" 마이그레이션입니다.
`if not exists` / `add column if not exists` 로 감쌌으므로 **이미 있는 환경에서 실행해도 안전**합니다.
다만 실제 운영 DB 의 컬럼 타입이 아래와 다를 수 있으니, 붙여넣기 전에 한 번 눈으로 대조해 주세요.

```sql
-- ============================================
-- 나의 아카이브 : v1.0 -> 현재 스키마 따라잡기
-- 실행 전 확인 필요. 이미 있는 항목은 건너뜁니다.
-- ============================================

-- 1) 카테고리 (계층 구조)
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text default '📁',
  color text default 'gray',           -- src/supabase.js 의 COLOR_KEYS 와 같은 값
  parent_id uuid references public.categories(id) on delete set null,
  position int default 0,
  created_at timestamptz default now()
);
create index if not exists categories_user_pos_idx on public.categories (user_id, position);

alter table public.categories enable row level security;
drop policy if exists "own categories all" on public.categories;
create policy "own categories all" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) 항목 <-> 카테고리 다대다
--    (item_id, category_id) 유일 제약이 반드시 있어야 합니다 —
--     백업 복원이 onConflict: 'item_id,category_id' 로 upsert 합니다.
create table if not exists public.item_categories (
  item_id uuid not null references public.items(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (item_id, category_id)
);
create index if not exists item_categories_category_idx on public.item_categories (category_id);

alter table public.item_categories enable row level security;
drop policy if exists "own item_categories all" on public.item_categories;
create policy "own item_categories all" on public.item_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) 시간대 슬롯 (오늘 탭)
create table if not exists public.time_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text default '🕐',
  position int default 0,
  created_at timestamptz default now()
);
create index if not exists time_slots_user_pos_idx on public.time_slots (user_id, position);

alter table public.time_slots enable row level security;
drop policy if exists "own time_slots all" on public.time_slots;
create policy "own time_slots all" on public.time_slots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4) items 에 추가된 컬럼들
alter table public.items add column if not exists category_id uuid
  references public.categories(id) on delete set null;   -- 하위호환용 단일 소속
alter table public.items add column if not exists status text default 'none';  -- none | todo | done
alter table public.items add column if not exists due_date date;
alter table public.items add column if not exists slot_id uuid
  references public.time_slots(id) on delete set null;
alter table public.items add column if not exists link_url text;               -- 여러 개면 줄바꿈 구분
alter table public.items add column if not exists deleted_at timestamptz;      -- 휴지통(soft delete)

-- 5) 새 화면들이 쓰는 인덱스
create index if not exists items_user_status_idx  on public.items (user_id, status)
  where deleted_at is null;
create index if not exists items_user_deleted_idx on public.items (user_id, deleted_at);
create index if not exists items_user_due_idx     on public.items (user_id, due_date)
  where status = 'todo';
```

### 같이 검토해 주면 좋을 것

- `items.category` (text, `not null default 'memo'`) 는 이제 코드에서 아무도 읽지 않습니다.
  기본값이 있어 당장 문제는 없지만, 정리하려면 백업 후
  `alter table public.items alter column category drop not null;` 정도만 먼저 해 두는 편이 안전합니다.
  **컬럼 삭제는 백업 JSON 을 먼저 받아 둔 뒤에** 하세요.
- `categories.parent_id` 를 `on delete set null` 로 뒀습니다.
  상위 카테고리를 지우면 하위가 최상위로 올라옵니다. 함께 지우길 원하면 `cascade` 로 바꾸세요.

---

## 2. 그 밖에 필요한 DB 변경

밤샘 작업(PWA · 모바일 · 다크 모드 · 에러 처리 · 성능 · 코드 정리 · 디자인 폴리싱 · 요금제 초안)에서
**추가로 필요한 스키마 변경은 없습니다.** 테마 설정은 `localStorage('archive-theme')` 에,
보기·탭 선택은 기존대로 `localStorage` 에 저장합니다.

요금제 화면은 정적 초안이라 결제·구독 테이블을 만들지 않았습니다.
실제 유료화를 진행할 때 `subscriptions` 같은 테이블이 필요해지면 그때 이 파일에 이어서 적습니다.
