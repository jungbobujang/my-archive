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
--   3) items          본문(아이디어/대본/링크/할 일)
--   4) item_categories  항목 <-> 카테고리 다대다
--   5) RLS 정책 (본인 데이터만)
--   6) 이미지 스토리지 버킷 archive-images
--   7) updated_at 자동 갱신
--   8) 신규 가입자 기본 카테고리 4종 + 시간대 5종 자동 생성
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
  created_at timestamptz default now()
);

create index if not exists categories_user_pos_idx
  on public.categories (user_id, position);
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

-- v1.0 에서 category 가 not null 이었다. 코드가 값을 넣지 않으므로 제약을 푼다.
alter table public.items alter column category drop not null;

create index if not exists items_user_created_idx
  on public.items (user_id, created_at desc);
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
-- 6) updated_at 자동 갱신
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
-- 7) 기본 카테고리 4종 + 시간대 5종
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
-- 확인용 (선택) — 주석을 풀고 실행하면 결과를 볼 수 있습니다.
-- ============================================================
-- select 'categories' as t, count(*) from public.categories
-- union all select 'time_slots', count(*) from public.time_slots
-- union all select 'items', count(*) from public.items
-- union all select 'item_categories', count(*) from public.item_categories;
