-- ============================================================
-- 나의 아카이브 : Supabase 설치 스크립트 (단일 파일)
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요.
-- 새 프로젝트라면 이 파일 하나로 앱이 완전히 동작합니다.
--
-- 몇 번을 다시 실행해도 안전합니다:
--   - 테이블/인덱스는 if not exists
--   - 정책은 drop policy if exists 후 재생성
--   - 기본 카테고리/시간대 시드는 "그 사용자에게 이미 있으면 건너뛰기"
--
-- 만드는 것
--   1) categories     계층 카테고리
--   2) time_slots     '오늘' 탭의 시간대
--  2-b) spaces        공간(서랍). 한 계정 안에서 아카이브를 나눈다
--  2-c) plan_domains  계획 격자의 세로축(영역). 수입·성장·건강…
--   3) items          본문(아이디어/대본/링크/할 일/계획)
--   4) item_categories  항목 <-> 카테고리 다대다
--   5) RLS 정책 (본인 데이터만)
--   6) 이미지 스토리지 버킷 archive-images
--   7) 파일 스토리지 버킷 archive-files (비공개)
--   8) updated_at 자동 갱신
--   9) 신규 가입자 기본 카테고리 4종 + 시간대 5종 + 공간 2종 + 계획 영역 6종 자동 생성
--  10) 항목 공유 링크 shares + 열람 함수 share_view (로그인 없이 한 항목만 보기)
-- ============================================================


-- ============================================================
-- 1) 카테고리 (계층 구조)
-- ============================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text default '📁',
  -- src/supabase.js 의 COLOR_KEYS 와 같은 값이어야 한다
  -- purple | coral | teal | gray | blue | amber | pink | green
  color text default 'gray',
  -- 상위를 지우면 하위는 최상위로 올라온다 (함께 지우려면 cascade 로)
  parent_id uuid references public.categories(id) on delete set null,
  position int default 0,
  -- 카테고리도 공간별로 나뉜다 (요구사항 4). 항목과 같은 규칙으로,
  -- 이 열이 생기는 순간 기존 카테고리는 전부 '개인'으로 편입된다.
  space text not null default 'personal',
  created_at timestamptz default now()
);

-- 이미 카테고리 표가 있는 프로젝트를 위한 따라잡기
alter table public.categories add column if not exists space text not null default 'personal';

create index if not exists categories_user_pos_idx
  on public.categories (user_id, position);
create index if not exists categories_user_space_idx
  on public.categories (user_id, space, position);
create index if not exists categories_parent_idx
  on public.categories (parent_id);

alter table public.categories enable row level security;

drop policy if exists "own categories all" on public.categories;
create policy "own categories all" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ============================================================
-- 2) 시간대 슬롯 ('오늘' 탭에서 할 일을 묶는 단위)
-- ============================================================
create table if not exists public.time_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text default '🕐',
  position int default 0,
  created_at timestamptz default now()
);

create index if not exists time_slots_user_pos_idx
  on public.time_slots (user_id, position);

alter table public.time_slots enable row level security;

drop policy if exists "own time_slots all" on public.time_slots;
create policy "own time_slots all" on public.time_slots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ============================================================
-- 2-b) 공간 (서랍) — 한 계정 안에서 아카이브를 나눈다
--
--    항목·카테고리가 들고 다니는 것은 **열쇠(key) 문자열 하나**뿐이다.
--    이 표는 그 열쇠에 붙는 이름·아이콘만 담는다 — 이름을 바꿔도 항목은
--    한 줄도 건드리지 않는다.
--
--    🔴 items.space 를 이 표로 **외래키로 묶지 않았다.** 묶으면 기존 행을
--       옮기는 마이그레이션이 필요해지고(그 전에는 열을 추가할 수도 없다),
--       백업 복원 순서도 한 겹 더 늘어난다. 지금은 열 하나에 기본값을 주는
--       것만으로 기존 자료가 전부 '개인'으로 편입된다. 목록에 없는 열쇠가
--       들어와도 화면은 그 열쇠를 그대로 보여 준다(src/spaces.js spaceLabel).
-- ============================================================
create table if not exists public.spaces (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- src/spaces.js 의 DEFAULT_SPACE · BUILTIN_SPACES 와 같은 값이어야 한다
  key text not null,
  name text not null,
  icon text default '🗂',
  position int default 0,
  created_at timestamptz default now(),
  primary key (user_id, key)
);

create index if not exists spaces_user_pos_idx
  on public.spaces (user_id, position);

alter table public.spaces enable row level security;

drop policy if exists "own spaces all" on public.spaces;
create policy "own spaces all" on public.spaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ============================================================
-- 2-c) 계획 영역 — 계획 격자의 세로축
--
--    격자는 지평(가로: 단기·중기·장기) × 영역(세로)이다. 가로축은 셋으로 고정이라
--    코드 상수지만(src/plan.js HORIZONS), 세로축은 사람마다 다르므로 표로 둔다.
--
--    🔴 items.domain 을 이 표로 **외래키로 묶지 않았다.** spaces 와 같은 이유다:
--       묶으면 열을 추가하는 것부터 마이그레이션이 되고 백업 복원 순서가 한 겹 는다.
--       목록에 없는 열쇠가 들어와도 격자는 '미지정' 줄에 모아 보여 준다
--       (src/plan.js domainOf) — 계획이 화면에서 사라지지 않는다.
--    🔴 공간(space)별로 나누지 않았다. 서랍을 바꾼다고 '건강' 이 건강이 아니게 되지는
--       않는다. 계획이 공간별로 갈리는 것은 items.space 가 하는 일이다.
--       (자세한 판단 근거는 src/plan.js 머리말과 REPORT-PLAN.md 2절)
-- ============================================================
create table if not exists public.plan_domains (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- src/plan.js 의 BUILTIN_DOMAINS 와 같은 값이어야 한다
  key text not null,
  name text not null,
  -- src/supabase.js 의 COLOR_KEYS 와 같은 값이어야 한다
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


-- ============================================================
-- 3) 항목
-- ============================================================
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text default '',

  -- v1.0 의 고정 카테고리 문자열. 코드는 더 이상 읽지 않지만,
  -- 옛 백업 JSON 을 복원할 때 이 열이 없으면 실패하므로 남겨 둔다.
  category text default 'memo',

  -- 하위호환용 단일 소속. 실제 소속은 item_categories 가 정본이다.
  category_id uuid references public.categories(id) on delete set null,

  tags text[] default '{}',
  starred boolean default false,

  -- none | todo | done
  status text default 'none',
  due_date date,
  slot_id uuid references public.time_slots(id) on delete set null,

  -- 링크가 여러 개면 줄바꿈으로 구분해 한 열에 담는다
  link_url text,
  image_url text,

  -- 일반 파일 첨부의 메타만 담는다: [{ "path": "...", "name": "...", "size": 0 }]
  -- 파일 실체는 storage 의 archive-files 버킷에 있다. 표를 나누지 않은 이유는
  -- src/supabase.js 의 '일반 파일 첨부' 주석에 적어 두었다.
  files jsonb not null default '[]'::jsonb,

  -- 어느 공간(서랍)에 있는가. 기본값이 곧 마이그레이션이다 —
  -- 이 열이 생기는 순간 기존 항목은 전부 '개인'(personal)으로 편입된다.
  space text not null default 'personal',

  -- ── 계획 격자 ────────────────────────────────────────────────
  -- 🔴 기본값이 전부 null 이다. **기존 항목은 하나도 계획이 되지 않는다** — 적어 둔 것과
  --    계획하는 것은 다른 일이라, 열이 생겼다고 아카이브 전체가 격자에 쏟아지면 안 된다.
  -- 지평. null | short(이번 달) | mid(올해) | long(수년)
  horizon text,
  -- 계획 상태. null(계획 아님) | planned | doing | done | dropped
  -- 🔴 위 status(none/todo/done)와 **다른 열**이다. 저쪽은 '오늘 할 일인가',
  --    이쪽은 '이 계획이 어디까지 왔나' 를 잰다 (src/plan.js 머리말).
  plan_status text,
  -- 영역. plan_domains.key 를 가리키지만 외래키로 묶지 않는다(2-c 절 참고).
  domain text,
  -- 관련 항목 id 목록: ["uuid", …]. '어느 아이디어에서 나온 계획인가' 를 적는다.
  related_ids jsonb not null default '[]'::jsonb,
  -- plan_status 가 마지막으로 바뀐 시각.
  -- 🔴 updated_at 으로 대신할 수 없다. 저쪽은 제목만 고쳐도 갱신되므로, 그것으로 재면
  --    7일째 멈춰 있던 계획이 오타 한 번 고친 것만으로 '움직인 것' 이 된다 —
  --    주간 리뷰의 정체 목록이 조용히 비어 간다.
  plan_status_at timestamptz,

  -- 휴지통(soft delete). null 이면 살아 있는 항목.
  deleted_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 이미 v1.0 스키마가 깔린 프로젝트를 위한 따라잡기.
-- 새 프로젝트에서는 위 create 로 이미 다 있으므로 아무 일도 하지 않는다.
alter table public.items add column if not exists category_id uuid
  references public.categories(id) on delete set null;
alter table public.items add column if not exists status text default 'none';
alter table public.items add column if not exists due_date date;
alter table public.items add column if not exists slot_id uuid
  references public.time_slots(id) on delete set null;
alter table public.items add column if not exists link_url text;
alter table public.items add column if not exists deleted_at timestamptz;
alter table public.items add column if not exists files jsonb not null default '[]'::jsonb;
alter table public.items add column if not exists space text not null default 'personal';
-- 계획 격자 4열 + 상태 변경 시각. 전부 null 로 들어가므로 기존 항목은 그대로다.
alter table public.items add column if not exists horizon text;
alter table public.items add column if not exists plan_status text;
alter table public.items add column if not exists domain text;
alter table public.items add column if not exists related_ids jsonb not null default '[]'::jsonb;
alter table public.items add column if not exists plan_status_at timestamptz;

-- v1.0 에서 category 가 not null 이었다. 코드가 값을 넣지 않으므로 제약을 푼다.
alter table public.items alter column category drop not null;

/* 값 검사. 🔴 열을 문자열로 둔 채 아무 값이나 받으면, 오타 하나가 격자에서 통째로
   사라지는 계획이 된다(모르는 지평은 어느 칸에도 안 들어간다). 화면은 이미 세 값
   중에서만 고르게 되어 있지만, 백업 복원·SQL 편집처럼 화면을 거치지 않는 길이 있다.
   drop 후 add 라 몇 번을 실행해도 안전하다. */
alter table public.items drop constraint if exists items_horizon_check;
alter table public.items add constraint items_horizon_check
  check (horizon is null or horizon in ('short', 'mid', 'long'));

alter table public.items drop constraint if exists items_plan_status_check;
alter table public.items add constraint items_plan_status_check
  check (plan_status is null or plan_status in ('planned', 'doing', 'done', 'dropped'));

create index if not exists items_user_created_idx
  on public.items (user_id, created_at desc);
-- 목록은 언제나 '한 공간 안에서 최근 순' 이다 — 그 조회가 이 인덱스 하나로 끝난다
create index if not exists items_user_space_created_idx
  on public.items (user_id, space, created_at desc) where deleted_at is null;
create index if not exists items_tags_idx
  on public.items using gin (tags);
-- '오늘' 탭: 할 일만 골라 본다
create index if not exists items_user_status_idx
  on public.items (user_id, status) where deleted_at is null;
-- 휴지통
create index if not exists items_user_deleted_idx
  on public.items (user_id, deleted_at);
-- 예정 목록 (기한 순)
create index if not exists items_user_due_idx
  on public.items (user_id, due_date) where status = 'todo';
/* 계획 탭: '이 서랍의 계획만' 을 한 번에 긁는다. 부분 인덱스라 계획이 아닌 항목
   (거의 전부다)은 인덱스에 들어가지도 않는다 — 아카이브가 수천 개여도 이 인덱스는
   계획 수만큼만 크다. */
create index if not exists items_user_plan_idx
  on public.items (user_id, space, plan_status)
  where plan_status is not null and deleted_at is null;

alter table public.items enable row level security;

drop policy if exists "own items select" on public.items;
create policy "own items select" on public.items
  for select using (auth.uid() = user_id);

drop policy if exists "own items insert" on public.items;
create policy "own items insert" on public.items
  for insert with check (auth.uid() = user_id);

drop policy if exists "own items update" on public.items;
create policy "own items update" on public.items
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own items delete" on public.items;
create policy "own items delete" on public.items
  for delete using (auth.uid() = user_id);


-- ============================================================
-- 4) 항목 <-> 카테고리 (다대다)
--    (item_id, category_id) 유일 제약이 반드시 있어야 한다 —
--    백업 복원이 onConflict: 'item_id,category_id' 로 upsert 한다.
-- ============================================================
create table if not exists public.item_categories (
  item_id uuid not null references public.items(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (item_id, category_id)
);

create index if not exists item_categories_category_idx
  on public.item_categories (category_id);
create index if not exists item_categories_user_idx
  on public.item_categories (user_id);

alter table public.item_categories enable row level security;

drop policy if exists "own item_categories all" on public.item_categories;
create policy "own item_categories all" on public.item_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ============================================================
-- 5) 이미지 스토리지 (공개 읽기, 업로드는 로그인 사용자만)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('archive-images', 'archive-images', true)
on conflict (id) do nothing;

drop policy if exists "archive images read" on storage.objects;
create policy "archive images read" on storage.objects
  for select using (bucket_id = 'archive-images');

drop policy if exists "archive images upload" on storage.objects;
create policy "archive images upload" on storage.objects
  for insert with check (
    bucket_id = 'archive-images' and auth.role() = 'authenticated'
  );

drop policy if exists "archive images delete" on storage.objects;
create policy "archive images delete" on storage.objects
  for delete using (
    bucket_id = 'archive-images' and auth.uid() = owner
  );


-- ============================================================
-- 6) 파일 스토리지 (비공개 — 올린 사람만 읽고 지운다)
--
--    이미지 버킷과 달리 public 이 아니다. 앱은 받을 때마다
--    createSignedUrl 로 짧은 주소를 만들어 쓴다(src/supabase.js signedFileUrl).
--    경로는 {항목id}/{타임스탬프}_{원본명} 이라 사용자 id 가 들어가지 않는다.
--    그래서 소유자(owner) 기준으로 막는다.
--
--    🔴 file_size_limit 은 src/supabase.js 의 FILE_MAX_BYTES 와 **같은 값**이어야 한다
--       (25MB = 26214400). 브라우저 검사와 서버 검사가 어긋나면, 앱이 통과시킨 파일이
--       업로드에서 말없이 튕긴다 — 사람은 왜 안 되는지 알 길이 없다.
--    🔴 on conflict do nothing 이라 **이미 만들어진 버킷에는 이 값이 적용되지 않는다.**
--       상한을 올릴 때는 아래 update 를 따로 실행해야 한다(TODO-SQL.md 에도 적어 두었다).
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('archive-files', 'archive-files', false, 26214400)
on conflict (id) do nothing;

-- 이미 있는 버킷의 상한 따라잡기. 새 프로젝트에서는 위 insert 로 이미 맞다.
update storage.buckets set file_size_limit = 26214400
where id = 'archive-files' and file_size_limit is distinct from 26214400;

drop policy if exists "archive files read" on storage.objects;
create policy "archive files read" on storage.objects
  for select using (
    bucket_id = 'archive-files' and auth.uid() = owner
  );

drop policy if exists "archive files upload" on storage.objects;
create policy "archive files upload" on storage.objects
  for insert with check (
    bucket_id = 'archive-files' and auth.role() = 'authenticated'
  );

drop policy if exists "archive files delete" on storage.objects;
create policy "archive files delete" on storage.objects
  for delete using (
    bucket_id = 'archive-files' and auth.uid() = owner
  );


-- ============================================================
-- 7) updated_at 자동 갱신
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();


-- ============================================================
-- 8) 기본 카테고리 4종 + 시간대 5종 + 공간 2종
--
--    security definer 라 RLS 를 우회한다. 시드를 넣는 시점에는
--    auth.uid() 가 비어 있기 때문이다(SQL Editor 실행, 가입 트리거 모두).
--    "이미 하나라도 있으면 통째로 건너뛴다" 규칙이라
--    사용자가 기본 카테고리를 지웠어도 다시 살아나지 않는다.
-- ============================================================
create or replace function public.seed_defaults(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.categories where user_id = uid) then
    insert into public.categories (user_id, name, icon, color, position) values
      (uid, '아이디어',    '💡', 'purple', 1),
      (uid, '유튜브 대본', '🎬', 'coral',  2),
      (uid, '이미지',      '🖼️', 'teal',   3),
      (uid, '기타 메모',   '📝', 'gray',   4);
  end if;

  if not exists (select 1 from public.time_slots where user_id = uid) then
    insert into public.time_slots (user_id, name, icon, position) values
      (uid, '아침', '🌅', 1),
      (uid, '오전', '☀️', 2),
      (uid, '오후', '🌤', 3),
      (uid, '저녁', '🌇', 4),
      (uid, '밤',   '🌙', 5);
  end if;

  -- 공간 2종. 열쇠는 src/spaces.js 의 BUILTIN_SPACES 와 같아야 한다.
  -- 이름을 바꾼 사람에게 기본 이름이 되살아나지 않도록 '하나라도 있으면 건너뛴다'.
  if not exists (select 1 from public.spaces where user_id = uid) then
    insert into public.spaces (user_id, key, name, icon, position) values
      (uid, 'personal', '개인', '🏠', 1),
      (uid, 'class',    '수업', '🏫', 2);
  end if;

  -- 계획 영역 6종. 열쇠·색은 src/plan.js 의 BUILTIN_DOMAINS 와 같아야 한다.
  -- 이름을 바꾼 사람에게 기본 이름이 되살아나지 않도록 '하나라도 있으면 건너뛴다'.
  if not exists (select 1 from public.plan_domains where user_id = uid) then
    insert into public.plan_domains (user_id, key, name, color, position) values
      (uid, 'income',   '수입', 'amber',  1),
      (uid, 'growth',   '성장', 'purple', 2),
      (uid, 'health',   '건강', 'green',  3),
      (uid, 'create',   '창작', 'coral',  4),
      (uid, 'relation', '관계', 'pink',   5),
      (uid, 'life',     '생활', 'teal',   6);
  end if;
end;
$$;

-- 새로 가입하는 사용자에게 자동 적용
create or replace function public.seed_defaults_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists seed_defaults_after_user on auth.users;
create trigger seed_defaults_after_user
  after insert on auth.users
  for each row execute function public.seed_defaults_on_signup();

-- 이미 만들어 둔 계정에도 채워 넣는다 (있으면 건너뜀).
-- README 순서대로라면 계정을 나중에 만들 것이므로 보통 0명이고, 그때는 위 트리거가 처리한다.
do $$
declare u record;
begin
  for u in select id from auth.users loop
    perform public.seed_defaults(u.id);
  end loop;
end;
$$;


-- ============================================================
-- 9) 항목 공유 링크 (열람 전용)
--
--    이 앱에는 서버가 없다. 브라우저가 anon 키로 직접 붙으므로, 만료 검사를
--    프론트에서 하면 그것은 검사가 아니라 장식이다(데이터는 이미 브라우저에
--    와 있고, 화면만 지우면 보인다). 그래서 판정을 전부 DB 안으로 옮긴다.
--
--    · items 의 RLS 는 그대로 auth.uid() = user_id 다. 비로그인 조회는 언제나 0행.
--    · shares 도 소유자만 읽는다. **토큰을 알아도** anon 은 이 표에서 한 줄도 못 읽는다
--      — expires_at 을 받아 와서 프론트가 비교하는 구조를 원천적으로 막기 위해서다.
--    · 공유 항목을 꺼내는 유일한 길은 share_view(token) 하나뿐이고, 그 안에서
--      DB 가 회수·만료를 본다. 만료된 토큰에는 항목 내용이 응답에 실리지 않는다.
--
--    files 열에는 '만들 때 굳혀 둔 서명 주소' 가 들어간다. archive-files 는 비공개
--    버킷이라 anon 이 열 수 없고, storage 정책에는 우리 토큰을 넘길 자리가 없다
--    (커스텀 헤더는 storage-api 를 거쳐 Postgres 까지 오지 않는다). 그래서 링크를
--    만드는 순간 소유자가 유효기간과 **같은 수명**으로 서명한 주소를 여기 담아 둔다.
--    share_view 는 그것을 '아직 유효할 때만' 함께 돌려준다.
-- ============================================================
create table if not exists public.shares (
  -- id 가 곧 토큰이다. uuid v4 는 122비트 난수라 찍어서 맞힐 수 없다.
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  -- 회수. 행을 지우지 않는 이유는, 지우면 '없는 토큰' 과 구분이 안 되기 때문이다.
  revoked boolean not null default false,
  -- [{ "name": "...", "size": 0, "url": "서명 주소" }]
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

create index if not exists shares_user_created_idx
  on public.shares (user_id, created_at desc);
create index if not exists shares_item_idx
  on public.shares (item_id);

alter table public.shares enable row level security;

-- 소유자만. anon 정책은 **일부러 두지 않는다** (아래 함수가 유일한 통로다).
drop policy if exists "own shares all" on public.shares;
create policy "own shares all" on public.shares
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- 열람 함수. security definer 라 RLS 를 넘어서 items 를 읽지만,
-- 넘겨주는 열을 여기서 하나씩 적어 둔다 — user_id 나 휴지통 상태 같은 것은 나가지 않는다.
create or replace function public.share_view(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.shares%rowtype;
  it public.items%rowtype;
begin
  select * into s from public.shares where id = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if s.revoked then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;

  -- 만료 판정은 **서버 시각**으로 한다. 받는 사람 시계를 되돌려도 소용없다.
  if s.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- 휴지통으로 보낸 항목은 공유도 끊긴다 (지운 글이 링크로 계속 보이면 안 된다).
  select * into it from public.items where id = s.item_id and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'expires_at', s.expires_at,
    'files', s.files,
    'item', jsonb_build_object(
      'title', it.title,
      'content', it.content,
      'tags', to_jsonb(coalesce(it.tags, '{}'::text[])),
      'link_url', it.link_url,
      'image_url', it.image_url,
      'created_at', it.created_at,
      'updated_at', it.updated_at
    )
  );
end;
$$;

revoke all on function public.share_view(uuid) from public;
grant execute on function public.share_view(uuid) to anon, authenticated;


-- ============================================================
-- 확인용 (선택) — 주석을 풀고 실행하면 결과를 볼 수 있습니다.
-- ============================================================
-- select 'categories' as t, count(*) from public.categories
-- union all select 'time_slots', count(*) from public.time_slots
-- union all select 'items', count(*) from public.items
-- union all select 'item_categories', count(*) from public.item_categories;
