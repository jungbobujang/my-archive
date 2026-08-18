-- ============================================================
-- 카테고리 확장 시드 (최대 3계층) — 확장판
--
-- 실행: Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run
--       (SQL Editor 는 RLS 를 우회하므로 auth.uid() 없이 user_id 를 직접 넣는다)
--
-- 성질
--   · 여러 번 실행해도 안전하다 — 이름이 겹치면 새로 만들지 않는다.
--   · 이름이 겹칠 때는 '있는 것을 쓴다'. 최상위는 아이콘·색·순서를 목표 구조에 맞추고,
--     하위는 아직 어디에도 안 붙어 있으면(최상위에 떠 있으면) 제 상위로 붙인다.
--     이미 다른 상위에 붙어 있는 것은 건드리지 않는다.
--   · 기존 '자기계발' 은 '뇌지컬' 로 개명한다 (뇌지컬이 이미 있으면 그것을 쓰고 개명 안 함).
--   · 기존 '유튜브 대본' 은 '대본 작업' 으로 개명해 📺 유튜브 아래로 옮긴다.
--     새로 만들지 않는 이유는 거기 달린 항목(item_categories)을 그대로 데려오기 위해서다.
--   · 기존 '아이디어'·'이미지' 는 건드리지 않는다.
--
-- 만드는 구조
--   📺 유튜브   (coral,  1) — 🎬 대본 작업 · 💡 주제 후보 · ✍️ 글귀·소재 · 📊 채널 전략 · 🌍 해외 광맥
--   🏫 학교·수업 (teal,   2) — 📚 수업 아이디어 · 🗂 업무 메모
--   ⚙️ 개발     (blue,   3) — ✅ 프로젝트 할 일 · 🔧 개발 노하우 · 🤖 AI·도구
--   🧠 뇌지컬   (purple, 4) — 💎 배움·통찰 · 📖 공부법
--   💪 피지컬   (green,  5) — 🏋️ 운동 · ✨ 외모·피부 · 🥗 건강·식단
--   🍜 생활     (amber,  6) — 🍚 맛집·음식 · 🛒 쇼핑·꿀팁 · 🗺 가볼 곳
--                              └ 🍚 맛집·음식 아래 3단: 🏠 국내 · ✈️ 해외 · 📌 기타(레시피·식품류)
--   💰 재테크   (pink,   7) — 📈 돈 공부 · 💵 투자 메모
--   📝 기타 메모 (gray,   8) — 하위 없음. 분류 애매한 것 전부.
--
-- 색: src/supabase.js 의 COLOR_KEYS 와 일치해야 한다
--     purple | coral | teal | gray | blue | amber | pink | green  ← 8색을 전부 쓴다.
--     하위는 상위의 색을 물려받게 했다(한 덩어리로 읽히도록). 나중에 화면에서 개별 변경 가능.
--
-- 아이콘: 여기서 쓰는 아이콘은 전부 src/supabase.js 의 ICON_CHOICES 에도 넣어 두었다.
--     그래야 시드로 만든 카테고리도 화면 아이콘 고르개에서 다시 고를 수 있다.
-- ============================================================

do $$
declare
  uid        uuid;
  n_users    int;
  rec        record;
  v_parent   uuid;
  v_id       uuid;
  v_cur      record;
  v_gparent  uuid;
  n_made     int := 0;
  n_kept     int := 0;
  n_moved    int := 0;
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

  -- ── 1) 자기계발 → 뇌지컬 개명 ──────────────────────────────
  -- 최상위를 만들기 '전에' 해야 한다. 뒤에 하면 2단계가 뇌지컬을 새로 만들어 버리고
  -- 자기계발은 갈 곳 없이 남는다.
  if exists (select 1 from public.categories where user_id = uid and name = '뇌지컬') then
    raise notice '  ''뇌지컬'' 이 이미 있어 그대로 씁니다 (개명 안 함).';
  else
    select id into v_id from public.categories where user_id = uid and name = '자기계발' limit 1;
    if v_id is not null then
      update public.categories set name = '뇌지컬' where id = v_id;
      raise notice '  개명: ''자기계발'' → ''뇌지컬''';
    end if;
  end if;

  -- ── 2) 최상위 8개 ──────────────────────────────────────────
  -- 없으면 만들고, 있으면 아이콘·색·순서를 목표 구조에 맞춘다(이름은 건드리지 않는다).
  -- 별칭을 nm/ic/col/pos 로 둔다 — position 은 SQL 키워드라 별칭 목록에서 굳이 시험하지 않는다.
  for rec in
    select * from (values
      ('유튜브',    '📺', 'coral',  1),
      ('학교·수업', '🏫', 'teal',   2),
      ('개발',      '⚙️', 'blue',   3),
      ('뇌지컬',    '🧠', 'purple', 4),
      ('피지컬',    '💪', 'green',  5),
      ('생활',      '🍜', 'amber',  6),
      ('재테크',    '💰', 'pink',   7),
      ('기타 메모', '📝', 'gray',   8)
    ) as t(nm, ic, col, pos)
  loop
    select id, parent_id into v_cur
      from public.categories
     where user_id = uid and name = rec.nm
     limit 1;

    if v_cur.id is null then
      insert into public.categories (user_id, name, icon, color, parent_id, position)
      values (uid, rec.nm, rec.ic, rec.col, null, rec.pos);
      n_made := n_made + 1;
      raise notice '  만듦: % %', rec.ic, rec.nm;

    elsif v_cur.parent_id is not null then
      -- 같은 이름이 남의 하위로 들어가 있다. 끌어올리면 그 사람 구조가 무너지므로 둔다.
      raise notice '  건너뜀 (같은 이름이 하위에 있음): %', rec.nm;
      n_kept := n_kept + 1;

    else
      -- 이미 최상위에 있다 = 이것을 쓴다. 자리만 목표에 맞춘다.
      update public.categories
         set icon = rec.ic, color = rec.col, position = rec.pos
       where id = v_cur.id;
      n_kept := n_kept + 1;
      raise notice '  재활용: % % (아이콘·색·순서 %번으로 맞춤)', rec.ic, rec.nm, rec.pos;
    end if;
  end loop;

  -- ── 3) 유튜브 대본 → 대본 작업 + 📺 유튜브 아래로 ───────────
  select id into v_parent
    from public.categories
   where user_id = uid and name = '유튜브' and parent_id is null
   limit 1;

  select id into v_id
    from public.categories
   where user_id = uid and name = '유튜브 대본'
   limit 1;

  if v_parent is null then
    raise notice '  최상위 ''유튜브'' 를 찾지 못해 ''유튜브 대본'' 은 그대로 둡니다.';
  elsif v_id is null then
    null; -- 없으면 아래 4단계가 '대본 작업' 을 새로 만든다
  elsif exists (select 1 from public.categories where user_id = uid and name = '대본 작업') then
    raise notice '  ''대본 작업'' 이 이미 따로 있어 ''유튜브 대본'' 은 그대로 둡니다 (직접 정리하세요).';
  else
    update public.categories
       set name = '대본 작업', icon = '🎬', color = 'coral',
           parent_id = v_parent, position = 1
     where id = v_id;
    raise notice '  옮김: ''유튜브 대본'' → 📺 유튜브 / 🎬 대본 작업 (항목 유지)';
  end if;

  -- ── 4) 하위 카테고리 ───────────────────────────────────────
  -- 없으면 만들고, 최상위에 떠 있으면 제 상위로 붙인다(= '하위 연결만').
  -- 이미 다른 상위에 붙어 있으면 손대지 않는다.
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
      ('개발',      'AI·도구',        '🤖', 'blue',   3),
      ('뇌지컬',    '배움·통찰',      '💎', 'purple', 1),
      ('뇌지컬',    '공부법',         '📖', 'purple', 2),
      ('피지컬',    '운동',           '🏋️', 'green',  1),
      ('피지컬',    '외모·피부',      '✨', 'green',  2),
      ('피지컬',    '건강·식단',      '🥗', 'green',  3),
      ('생활',      '맛집·음식',      '🍚', 'amber',  1),
      ('생활',      '쇼핑·꿀팁',      '🛒', 'amber',  2),
      ('생활',      '가볼 곳',        '🗺', 'amber',  3),
      ('재테크',    '돈 공부',        '📈', 'pink',   1),
      ('재테크',    '투자 메모',      '💵', 'pink',   2)
    ) as t(pnm, nm, ic, col, pos)
  loop
    select id into v_parent
      from public.categories
     where user_id = uid and name = rec.pnm and parent_id is null
     limit 1;

    if v_parent is null then
      raise notice '  건너뜀 (상위 ''%'' 를 찾지 못함): %', rec.pnm, rec.nm;
      continue;
    end if;

    select id, parent_id into v_cur
      from public.categories
     where user_id = uid and name = rec.nm
     limit 1;

    if v_cur.id is null then
      insert into public.categories (user_id, name, icon, color, parent_id, position)
      values (uid, rec.nm, rec.ic, rec.col, v_parent, rec.pos);
      n_made := n_made + 1;
      raise notice '  만듦: % % (상위 %)', rec.ic, rec.nm, rec.pnm;

    elsif v_cur.parent_id is null then
      -- 최상위에 떠 있던 것을 제 상위로 붙인다 (기존 '피지컬' 같은 것을 살리는 길)
      update public.categories
         set parent_id = v_parent, icon = rec.ic, color = rec.col, position = rec.pos
       where id = v_cur.id;
      n_moved := n_moved + 1;
      raise notice '  연결: % % → 상위 %', rec.ic, rec.nm, rec.pnm;

    elsif v_cur.parent_id = v_parent then
      update public.categories
         set icon = rec.ic, color = rec.col, position = rec.pos
       where id = v_cur.id;
      n_kept := n_kept + 1;

    else
      raise notice '  건너뜀 (이미 다른 상위에 붙어 있음): %', rec.nm;
      n_kept := n_kept + 1;
    end if;
  end loop;

  -- ── 5) 3단계 (맛집·음식 아래) ──────────────────────────────
  -- 유일한 3단이다. 상위를 '이름' 이 아니라 '2단 노드의 id' 로 찾아야 한다 —
  -- 여기서 parent_id is null 로 찾으면 최상위 중에 없으니 못 찾는다.

  -- 먼저 옛 아이콘 정리: 국내를 🇰🇷 로 만들어 둔 적이 있다.
  -- Windows 는 국기 이모지 폰트가 없어 태극기가 아니라 'KR' 글자로 보인다 → 🏠 로 바꾼다.
  -- (아래 루프가 손대지 못하는 경우 — 이미 다른 상위에 붙어 있는 '국내' — 까지 덮는다)
  update public.categories
     set icon = '🏠'
   where user_id = uid and name = '국내' and icon = '🇰🇷';
  if found then
    raise notice '  아이콘 정리: 국내 🇰🇷 → 🏠 (Windows 에서 국기가 KR 글자로 보임)';
  end if;

  select id into v_gparent
    from public.categories
   where user_id = uid and name = '맛집·음식'
   limit 1;

  if v_gparent is null then
    raise notice '  건너뜀 (2단 ''맛집·음식'' 을 찾지 못해 3단을 만들지 않음)';
  else
    for rec in
      select * from (values
        ('국내',              '🏠', 'amber', 1),
        ('해외',              '✈️', 'amber', 2),
        ('기타(레시피·식품류)', '📌', 'amber', 3)
      ) as t(nm, ic, col, pos)
    loop
      select id, parent_id into v_cur
        from public.categories
       where user_id = uid and name = rec.nm
       limit 1;

      if v_cur.id is null then
        insert into public.categories (user_id, name, icon, color, parent_id, position)
        values (uid, rec.nm, rec.ic, rec.col, v_gparent, rec.pos);
        n_made := n_made + 1;
        raise notice '  만듦: % % (상위 맛집·음식)', rec.ic, rec.nm;

      elsif v_cur.parent_id is null then
        update public.categories
           set parent_id = v_gparent, icon = rec.ic, color = rec.col, position = rec.pos
         where id = v_cur.id;
        n_moved := n_moved + 1;
        raise notice '  연결: % % → 상위 맛집·음식', rec.ic, rec.nm;

      elsif v_cur.parent_id = v_gparent then
        update public.categories
           set icon = rec.ic, color = rec.col, position = rec.pos
         where id = v_cur.id;
        n_kept := n_kept + 1;

      else
        raise notice '  건너뜀 (이미 다른 상위에 붙어 있음): %', rec.nm;
        n_kept := n_kept + 1;
      end if;
    end loop;
  end if;

  raise notice '완료 — 새로 만듦 %개 · 재활용 %개 · 상위로 연결 %개', n_made, n_kept, n_moved;

  -- ── 5) 최상위 순서 겹침 알림 ───────────────────────────────
  -- 화면은 position 만으로 줄을 세운다(2차 정렬 기준이 없다). 같은 번호가 둘이면
  -- 그 둘의 앞뒤가 그때그때 달라진다. 이 시드가 쓰는 1~8 과 기존 '아이디어'(1)·'이미지'(3)이
  -- 겹치므로, 정리 전까지는 순서가 섞여 보일 수 있다. 맨 아래 선택 블록으로 밀어낼 수 있다.
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
-- 3단까지 있으므로 재귀로 훑는다. 예전의 1단 join 은 손자를 상위 없이 떨궈 놨다.
with recursive tree as (
  select c.id, c.name, c.icon, c.color, c.position, c.parent_id,
         0 as depth,
         lpad('', 0) || c.position::text as sort_path
    from public.categories c
   where c.user_id = (select id from auth.users limit 1)
     and c.parent_id is null
  union all
  select c.id, c.name, c.icon, c.color, c.position, c.parent_id,
         t.depth + 1,
         t.sort_path || '.' || lpad(c.position::text, 3, '0')
    from public.categories c
    join tree t on c.parent_id = t.id
   where c.user_id = (select id from auth.users limit 1)
)
select
  repeat('    ', depth) || case when depth = 0 then '■ ' else '└ ' end
    || icon || ' ' || name          as "카테고리",
  depth                             as "단계",
  color                             as "색",
  position                          as "순서"
from tree
order by sort_path, name;


-- ============================================================
-- (선택) 남은 옛 최상위를 뒤로 밀어 순서 겹침 없애기
--
-- 위 ⚠ 알림이 떴을 때만 쓰세요. '아이디어'·'이미지' 를 90번대로 밀어 새 8개(1~8) 뒤에
-- 세웁니다. 지우는 것이 아니라 순서만 바꿉니다. 필요하면 주석을 풀고 실행하세요.
-- ============================================================
-- update public.categories
--    set position = 90 + position
--  where user_id = (select id from auth.users limit 1)
--    and parent_id is null
--    and name in ('아이디어', '이미지');


-- ============================================================
-- 되돌리려면 — 이 시드로 만든 것만 지웁니다.
-- '대본 작업'(원래 '유튜브 대본')과 '뇌지컬'(원래 '자기계발')은 지우면 거기 달린 항목의
-- 연결이 끊깁니다. 지우는 대신 이름과 위치만 되돌립니다.
-- ============================================================
-- update public.categories
--    set name = '유튜브 대본', icon = '🎬', color = 'coral', parent_id = null, position = 2
--  where user_id = (select id from auth.users limit 1) and name = '대본 작업';
--
-- update public.categories
--    set name = '자기계발', icon = '🧠', color = 'purple', parent_id = null
--  where user_id = (select id from auth.users limit 1) and name = '뇌지컬';
--
-- delete from public.categories
--  where user_id = (select id from auth.users limit 1)
--    and name in ('유튜브', '학교·수업', '개발', '피지컬', '생활', '재테크',
--                 '주제 후보', '글귀·소재', '채널 전략', '해외 광맥',
--                 '수업 아이디어', '업무 메모', '프로젝트 할 일', '개발 노하우', 'AI·도구',
--                 '배움·통찰', '공부법', '운동', '외모·피부', '건강·식단',
--                 '맛집·음식', '쇼핑·꿀팁', '가볼 곳', '돈 공부', '투자 메모',
--                 '국내', '해외', '기타(레시피·식품류)');
