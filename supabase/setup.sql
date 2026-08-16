-- ============================================
-- 나의 아카이브 : Supabase 초기 설정 SQL
-- Supabase 대시보드 > SQL Editor 에 전체 붙여넣고 Run
-- ============================================

-- 1) 아이템 테이블
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text default '',
  category text not null default 'memo',   -- idea | script | image | memo
  tags text[] default '{}',
  starred boolean default false,
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 검색/필터 속도용 인덱스
create index if not exists items_user_created_idx on public.items (user_id, created_at desc);
create index if not exists items_category_idx on public.items (user_id, category);
create index if not exists items_tags_idx on public.items using gin (tags);

-- 2) RLS: 본인 데이터만 접근 가능
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

-- 3) 이미지 스토리지 버킷 (공개 읽기, 업로드는 로그인 사용자만)
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

-- 4) updated_at 자동 갱신
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
