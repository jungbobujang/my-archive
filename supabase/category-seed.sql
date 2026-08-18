-- ============================================================
-- 카테고리 확장 시드 (2계층)
--
-- 실행: Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run
--       (SQL Editor 는 RLS 를 우회하므로 auth.uid() 없이 user_id 를 직접 넣는다)
--
-- 성질
--   · 여러 번 실행해도 안전하다 — 이름이 겹치면 건너뛴다.
--   · 기존 '유튜브 대본' 은 새로 만들지 않고 '대본 작업' 으로 개명해서
--     📺 유튜브 아래로 옮긴다 (그 카테고리에 달린 항목이 그대로 따라온다).
--   · 기존 '아이디어' 는 건드리지 않는다.
--
-- 만드는 구조
--   📺 유튜브 (coral, 1)      ├ 🎬 대본 작업 · 💡 주제 후보 · ✍️ 글귀·소재
--                              └ 📊 채널 전략 · 🌍 해외 광맥
--   🏫 학교·수업 (teal, 2)    └ 📚 수업 아이디어 · 🗂 업무 메모
--   ⚙️ 개발 (blue, 3)          └ ✅ 프로젝트 할 일 · 🔧 개발 노하우
--   🧠 자기계발 (purple, 4)   └ 💎 배움·통찰
--
-- 색: src/supabase.js 의 COLOR_KEYS 와 일치해야 한다
--     purple | coral | teal | gray | blue | amber | pink | green
--     → 여기서 쓰는 coral·teal·blue·purple 은 모두 유효한 값이다.
--     하위 카테고리는 상위의 색을 물려받게 했다(한 덩어리로 읽히도록).
--     색은 카테고리마다 따로 저장되므로 나중에 화면에서 개별 변경할 수 있다.
--
-- 아이콘: categories.icon 은 자유 문자열이라 무엇이든 저장된다.
--     다만 화면의 아이콘 고르개(src/supabase.js 의 ICON_CHOICES)에는
--     💡 🎬 🖼️ 📝 📚 🏋️ ✍️ 🔬 🎨 📌 열 개만 들어 있다.
--     여기서 쓰는 📺 🏫 ⚙️ 🧠 📊 🌍 🗂 ✅ 🔧 💎 는 저장·표시는 되지만
--     고르개 목록에는 없다. 화면에서 바꾸려면 ICON_CHOICES 에 추가해야 한다.
-- ============================================================

do $$
declare
  uid        uuid;
  n_users    int;
  rec        record;
  v_parent   uuid;
  v_id       uuid;
  n_made     int := 0;
  n_skipped  int := 0;
begin
  -- ── 0) 대상 사용자 ─────────────────────────────────────────
  -- 계정이 하나뿐이라는 전제다. 둘 이상이면 어느 쪽인지 알 수 없으므로
  -- 조용히 엉뚱한 계정에 넣는 대신 멈춘다.
  select count(*) into n_users from auth.users;

  if n_users = 0 then
    raise exception '가입된 사용자가 없습니다. 앱에서 계정을 먼저 만들고 다시 실행하세요.';
  elsif n_users > 1 then
    raise exception '사용자가 %명입니다. 대상을 특정할 수 없어 멈춥니다. 아래 uid 대입 줄을 select ''붙여넣은-uuid''::uuid 로 바꿔서 실행하세요.', n_users;
  end if;

  select id into uid from auth.users limit 1;
  raise notice '대상 사용자: %', uid;

  -- ── 1) 상위 4개 ────────────────────────────────────────────
  -- 별칭을 nm/ic/col/pos 로 둔다. position 은 SQL 키워드라 별칭 목록에서 쓰면
  -- 파서가 걸릴 수 있다 (컬럼 이름으로는 괜찮지만 굳이 시험하지 않는다).
  for rec in
    select * from (values
      ('유튜브',    '📺', 'coral',  1),
      ('학교·수업', '🏫', 'teal',   2),
      ('개발',      '⚙️', 'blue',   3),
      ('자기계발',  '🧠', 'purple', 4)
    ) as t(nm, ic, col, pos)
  loop
    if exists (
      select 1 from public.categories where user_id = uid and name = rec.nm
    ) then
      n_skipped := n_skipped + 1;
      raise notice '  건너뜀 (이미 있음): %', rec.nm;
    else
      insert into public.categories (user_id, name, icon, color, parent_id, position)
      values (uid, rec.nm, rec.ic, rec.col, null, rec.pos);
      n_made := n_made + 1;
      raise notice '  만듦: % %', rec.ic, rec.nm;
    end if;
  end loop;

  -- ── 2) 기존 '유튜브 대본' → '대본 작업' 으로 개명 + 📺 유튜브 아래로 ──
  -- 새로 만들지 않고 옮기는 이유: 그 카테고리에 이미 달린 항목(item_categories)이
  -- 끊기지 않고 그대로 따라오게 하려는 것이다.
  select id into v_parent
    from public.categories
   where user_id = uid and name = '유튜브' and parent_id is null
   limit 1;

  select id into v_id
    from public.categories
   where user_id = uid and name = '유튜브 대본'
   limit 1;

  if v_parent is null then
    -- 1단계에서 '유튜브' 를 못 만들었다는 뜻(같은 이름이 하위에 이미 있는 경우 등).
    -- 이대로 옮기면 parent_id 가 비어 최상위에 남으므로 손대지 않는다.
    raise notice '  최상위 ''유튜브'' 를 찾지 못해 ''유튜브 대본'' 은 그대로 둡니다.';
  elsif v_id is null then
    raise notice '  ''유튜브 대본'' 이 없습니다 — 아래에서 ''대본 작업'' 을 새로 만듭니다.';
  elsif exists (
    select 1 from public.categories where user_id = uid and name = '대본 작업'
  ) then
    -- 둘 다 있는 상태. 개명하면 같은 이름이 둘이 되므로 손대지 않는다.
    raise notice '  ''대본 작업'' 이 이미 따로 있어 ''유튜브 대본'' 은 그대로 둡니다 (직접 정리하세요).';
  else
    update public.categories
       set name      = '대본 작업',
           icon      = '🎬',
           color     = 'coral',
           parent_id = v_parent,
           position  = 1
     where id = v_id;
    raise notice '  옮김: ''유튜브 대본'' → 📺 유튜브 / 🎬 대본 작업 (항목 유지)';
  end if;

  -- ── 3) 하위 카테고리 ───────────────────────────────────────
  for rec in
    select * from (values
      ('유튜브',    '대본 작업',      '🎬', 'coral',  1),
      ('유튜브',    '주제 후보',      '💡', 'coral',  2),
      ('유튜브',    '글귀·소재',      '✍️', 'coral',  3),
      ('유튜브',    '채널 전략',      '📊', 'coral',  4),
      ('유튜브',    '해외 광맥',      '🌍', 'coral',  5),
      ('학교·수업', '수업 아이디어',  '📚', 'teal',   1),
      ('학교·수업', '업무 메모',      '🗂', 'teal',   2),
      ('개발',      '프로젝트 할 일', '✅', 'blue',   1),
      ('개발',      '개발 노하우',    '🔧', 'blue',   2),
      ('자기계발',  '배움·통찰',      '💎', 'purple', 1)
    ) as t(pnm, nm, ic, col, pos)
  loop
    if exists (
      select 1 from public.categories where user_id = uid and name = rec.nm
    ) then
      n_skipped := n_skipped + 1;
      raise notice '  건너뜀 (이미 있음): %', rec.nm;
    else
      select id into v_parent
        from public.categories
       where user_id = uid and name = rec.pnm and parent_id is null
       limit 1;

      if v_parent is null then
        raise notice '  건너뜀 (상위 ''%'' 를 찾지 못함): %', rec.pnm, rec.nm;
        n_skipped := n_skipped + 1;
      else
        insert into public.categories (user_id, name, icon, color, parent_id, position)
        values (uid, rec.nm, rec.ic, rec.col, v_parent, rec.pos);
        n_made := n_made + 1;
        raise notice '  만듦: % % (상위 %)', rec.ic, rec.nm, rec.pnm;
      end if;
    end if;
  end loop;

  raise notice '완료 — 만든 것 %개 · 건너뛴 것 %개', n_made, n_skipped;

  -- ── 4) 최상위 순서 겹침 알림 ───────────────────────────────
  -- 화면은 position 만으로 줄을 세운다(2차 정렬 기준이 없다). 같은 번호가 둘이면
  -- 그 둘의 앞뒤가 그때그때 달라진다. 기존 '아이디어'(1)·'이미지'(3)·'기타 메모'(4)가
  -- 새 상위와 번호를 나눠 갖게 되므로, 정리 전까지는 순서가 섞여 보일 수 있다.
  for rec in
    select position as pos, count(*) as n, string_agg(name, ', ' order by name) as names
      from public.categories
     where user_id = uid and parent_id is null
     group by position
    having count(*) > 1
  loop
    raise notice '  ⚠ 최상위 순서 % 번이 겹칩니다 (%개): %', rec.pos, rec.n, rec.names;
  end loop;
end;
$$;


-- ============================================================
-- 확인 — 만들어진 트리를 눈으로 본다
-- ============================================================
select
  case when c.parent_id is null then '■ 최상위' else '   └ ' || p.icon || ' ' || p.name end as "상위",
  c.icon || ' ' || c.name as "카테고리",
  c.color                 as "색",
  c.position              as "순서"
from public.categories c
left join public.categories p on p.id = c.parent_id
where c.user_id = (select id from auth.users limit 1)
order by
  coalesce(p.position, c.position),   -- 상위 묶음끼리 모으고
  (c.parent_id is not null),          -- 상위를 먼저
  c.position,
  c.name;


-- ============================================================
-- (선택) 기존 최상위를 뒤로 밀어 순서 겹침을 없애기
--
-- 위 ⚠ 알림이 떴을 때만 쓰세요. '아이디어' 를 포함해 예전 최상위 카테고리를
-- 90번대로 밀어 새 4개(1~4) 뒤에 서게 합니다. 지우는 것이 아니라 순서만 바꿉니다.
-- 필요하면 아래 주석을 풀고 실행하세요.
-- ============================================================
-- update public.categories
--    set position = 90 + position
--  where user_id = (select id from auth.users limit 1)
--    and parent_id is null
--    and name in ('아이디어', '이미지', '기타 메모');


-- ============================================================
-- 되돌리려면 — 이 시드로 만든 것만 지웁니다.
-- '대본 작업' 은 원래 '유튜브 대본' 이라 지우면 거기 달린 항목의 연결이 끊깁니다.
-- 지우는 대신 이름과 위치만 되돌립니다.
-- ============================================================
-- update public.categories
--    set name = '유튜브 대본', icon = '🎬', color = 'coral', parent_id = null, position = 2
--  where user_id = (select id from auth.users limit 1) and name = '대본 작업';
--
-- delete from public.categories
--  where user_id = (select id from auth.users limit 1)
--    and name in ('유튜브', '학교·수업', '개발', '자기계발',
--                 '주제 후보', '글귀·소재', '채널 전략', '해외 광맥',
--                 '수업 아이디어', '업무 메모', '프로젝트 할 일', '개발 노하우', '배움·통찰');
