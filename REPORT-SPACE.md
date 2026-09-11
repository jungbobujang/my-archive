# REPORT — 공간(space)

브랜치 `space` (main 에서 분기). 커밋·푸시만 했고 **main 머지는 하지 않았습니다**.

한 계정 안에서 아카이브를 여러 서랍으로 나눕니다. 기본은 개인 🏠 / 수업 🏫 두 개,
설정에서 이름·아이콘을 고치거나 최대 5개까지 새로 만들 수 있습니다.

---

## 1. 요구사항별 결과

| # | 요구사항 | 결과 |
|---|---|---|
| 1 | `items.space` (text, default `personal`) · 기존 데이터 자동 편입 | ✅ SQL 은 **출력만** 했습니다 (아래 3절 · `TODO-SQL.md`). 열의 기본값이 곧 마이그레이션이라 따로 돌릴 `update` 문이 없습니다 |
| 2 | 기본 2개 · 이름/아이콘 수정 · 추가 생성(최대 5) | ✅ `spaces` 표 + 설정의 **공간** 칸. 지우기는 두지 않았습니다(→ 4절) |
| 3 | 헤더 전환기 · 현재 공간 항상 명시 | ✅ 드롭다운(`SpaceSwitcher.jsx`). 세그먼트를 쓰지 않은 이유는 4절 |
| 4 | 항목·카테고리·태그·검색·오늘 탭·게이지 분리 | ✅ 단, 게이지의 **공간별 내역은 첨부 파일만** 입니다 (→ 4절) |
| 5 | 계정·설정 공유 · 휴지통은 공간 표시와 함께 통합 | ✅ 테마·PIN·로그인은 계정 하나. 휴지통은 전 공간 통합 + 줄마다 서랍 배지 |
| 6 | 항목을 다른 공간으로 이동 | ✅ 모달의 **공간** 칸. 소속(카테고리)은 따라가지 않습니다 |
| 7 | 공유 링크·파일첨부·모션 회귀 | ✅ 기존 점검 4종 그대로 통과 (`share_view` 는 공간을 모릅니다 — 항목 id 로만 꺼냅니다) |
| 8 | 검증 (DB 쿼리 레벨 · 게이지 합산 · check 4종) | ✅ `npm run check:space` 56개 신규 + 기존 4종 613개 통과 (→ 5절) |

---

## 2. 설계 — 왜 이렇게 했는가

### 열 하나 (`space text`), 표를 나누지 않았다

`items_personal` / `items_class` 로 표를 나누거나 계정을 나누는 방식은 쓰지 않았습니다.

- **옮길 데이터가 없다.** 기존 행은 열의 기본값으로 전부 '개인'에 들어갑니다.
  마이그레이션이 `alter table … add column` 한 줄이고, 되돌리기도 `drop column` 한 줄입니다.
- **조회가 그대로다.** 목록은 24개씩 끊어 읽는 구조 그대로이고 조건 하나가 붙을 뿐입니다.
  표를 나누면 목록·오늘·휴지통·마인드맵·백업이 전부 두 벌이 됩니다.
- **휴지통과 백업이 자연히 통합된다** (요구사항 5).

이름·아이콘은 `spaces` 표에 따로 둡니다. 항목이 들고 다니는 것은 **열쇠(key)** 뿐이라
이름을 바꿔도 항목은 한 줄도 건드리지 않습니다. `items.space` 를 `spaces` 로
외래키 묶지 **않은** 것도 같은 이유입니다 — 묶으면 열을 추가하기 전에 옮기는 작업이
필요해지고, 백업 복원 순서도 한 겹 늘어납니다.

### SQL 을 아직 실행하지 않은 DB 에서도 앱은 돈다

SQL 은 사람이 직접 실행합니다. 그 사이에도 앱이 멈추면 안 되므로, 화면이 뜰 때
`items.space` 가 있는지 한 번 물어보고(`probeSpaceColumn`) 없으면 공간 기능만 접습니다.

- 전환기를 숨기고, 화면에 한 줄로 알립니다(조용히 접지 않습니다)
- 조회에 `space` 조건을 붙이지 않고, 저장할 때 `space` 를 **보내지 않습니다**
  (없는 열을 보내면 저장 자체가 튕깁니다)
- 목록·검색·저장·휴지통·공유는 예전 그대로입니다

첨부 파일(`files` 열)·공유 링크(`shares` 표)가 이미 쓰던 규칙과 같습니다.

### 전환 전에 목록을 부르지 않는다

열이 있는지 알기 전에 목록을 한 번 부르면, 그 한 번은 조건 없는 조회라
**전 공간의 항목이 잠깐 스쳐 지나갑니다.** 서랍을 나눠 놓고 "방금 저쪽 것이 보였는데"
를 남기면 나눈 의미가 없으므로, 확인이 끝날 때까지는 스켈레톤을 띄웁니다.
(이 문제는 점검을 쓰다가 실제로 잡혔습니다 — `검색 조회에도 space 조건이 함께 간다`)

---

## 3. 실행해야 할 SQL (출력만 · 실행하지 않았습니다)

`supabase/setup.sql` 전체를 SQL Editor 에 붙여넣고 Run 하면 끝입니다(여러 번 안전).
떼어낸 본문은 `TODO-SQL.md` 의 '공간 / 서랍 (space)' 절에 있습니다.

```sql
-- ① 공간 표
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

-- ② space 열 — 🔴 이 기본값이 곧 마이그레이션이다 (기존 행이 전부 '개인'이 된다)
alter table public.items      add column if not exists space text not null default 'personal';
alter table public.categories add column if not exists space text not null default 'personal';
create index if not exists items_user_space_created_idx
  on public.items (user_id, space, created_at desc) where deleted_at is null;
create index if not exists categories_user_space_idx
  on public.categories (user_id, space, position);

-- ③ 기본 공간 2종 (이미 있으면 건너뜀)
insert into public.spaces (user_id, key, name, icon, position)
select u.id, v.key, v.name, v.icon, v.position
from auth.users u
cross join (values ('personal', '개인', '🏠', 1), ('class', '수업', '🏫', 2))
          as v(key, name, icon, position)
where not exists (select 1 from public.spaces s where s.user_id = u.id);
```

---

## 4. 건너뛴 것 · 좁힌 것

### ① 공간 삭제 — 넣지 않았습니다

공간을 지우면 그 안의 항목이 갈 곳을 잃습니다. 함께 지우면 되돌릴 수 없는 대량 삭제가
버튼 하나가 되고, 남겨 두면 어느 목록에도 안 나오는 항목이 됩니다. 요구사항에 없기도 해서
**덜 파괴적인 쪽**으로 뺐습니다. 안 쓰는 서랍은 이름만 바꿔 두면 됩니다.
필요해지면 '항목을 옮긴 뒤에 지운다'(이동 대상 선택 → 옮기기 → 삭제)로 따로 설계해야 합니다.

### ② 저장소 게이지의 공간별 내역 — **첨부 파일만** 나눕니다

이미지는 `archive-images` 버킷에 `{userId}/…` 로 담깁니다. 계정 단위 폴더 하나라
**어느 서랍의 것인지 버킷이 알지 못합니다**(DB 에는 이미지 크기가 없습니다 — `image_url`
문자열만 있습니다). 모르는 것을 나눠 적는 대신, 공간별 줄에는 파일만 적고 바로 아래에
"공간별로는 첨부 파일만 나눌 수 있어요" 라고 써 두었습니다. 전체 합계는 예전처럼
파일 + 이미지입니다.

공간별 이미지 용량까지 세려면 키를 `{userId}/{space}/…` 로 바꾸고 기존 객체를 옮겨야
하는데, 그러면 이미 저장된 모든 `image_url` 이 깨집니다. 이번 범위를 넘습니다.

### ③ 시간대(time_slots)는 공간별로 나누지 않았습니다

요구사항 4의 목록에 없어서 **기존 관행(계정 단위)** 을 유지했습니다. 아침·오후 같은
시간대는 서랍마다 다를 이유가 적고, 나누면 '오늘' 탭의 묶음이 서랍마다 달라져
같은 하루가 두 벌로 보입니다. 필요하면 `time_slots` 에 같은 `space` 열을 더하면 됩니다.

### ④ 카테고리는 공간을 넘나들지 못합니다

카테고리에도 `space` 열이 붙어 공간마다 따로입니다(요구사항 4). 그래서 항목을 옮기면
**소속이 따라가지 않고 풀립니다** — 모달에서 옮기기 전에 그 사실을 한 줄로 알립니다.
"옮기면서 저쪽의 같은 이름 카테고리에 자동으로 붙인다" 는 규칙은 이름이 우연히 같을 때
엉뚱한 곳에 들어가므로 넣지 않았습니다.

---

## 5. 검증

```
npm run check         105개  통과  (모달 동작 · 잠금)
npm run check:files   400개  통과  (파일 첨부 · 게이지 · 모션 배선)
npm run check:share    99개  통과  (공유 링크 유효/만료/회수)
npm run check:mobile  109개  통과  (375px·1280px 실측, puppeteer)
npm run check:space    56개  통과  (새로 만든 것)
```

### 공간 분리는 **조회가** 가른다 (요구사항 8)

카드가 안 보이는 것만으로는 증거가 되지 않습니다 — 화면에서만 걸렀다면 데이터는 이미
브라우저에 와 있는 것이고, 그건 서랍이 아니라 커튼입니다. 그래서 가짜 Supabase 가
**나간 조회를 그대로 적어 두고**(`store.calls.query`), 점검이 그 기록을 봅니다.

- `개인: 조회에 space 조건이 실려 나간다` / `수업: 조회에 space=class 가 실려 나간다`
- `검색 조회에도 space 조건이 함께 간다` — 목록 조회 전부가 조건을 달고 나갑니다
- `열이 없으면 space 조건을 붙이지 않는다` — SQL 미실행 DB 에서는 반대로 확인

여기에 더해 DOM 으로도 봅니다: 목록·카테고리 카드·태그 칩·오늘 탭·검색 결과에
다른 서랍의 것이 한 줄도 섞이지 않습니다.

### 게이지 합산

파일 3MB(개인) + 5MB(수업) + 이미지 2MB → 전체 `10.0MB`, 내역 `파일 8.0MB · 이미지 2.0MB`,
공간별 줄 `개인 3.0MB` / `수업 5.0MB`. 공간별 합 = 파일 합계.

### 좁은 화면

헤더에 전환기가 끼면서 상단이 밀리는지 375px·1280px 에서 실측했습니다
(가장 긴 이름 + 공간 5개인 최악의 경우). 가로 스크롤 없음, 이름이 보임,
보조 버튼과 겹치지 않음, 펼친 메뉴가 화면 안. 스크린샷은
`node_modules/.cache/mobile-shots/space-switch-{375,1280}.png`.

---

## 6. 🔴 머지 전에 알아 두실 것

이 브랜치는 지시대로 **main 에서 분기**했습니다. 그래서 아직 머지되지 않은
`layout-v2` (커밋 `87438b2` — 칩 한 줄 · 통합 입력 · 메이슨리)의 변경이 들어 있지 않고,
**같은 파일을 양쪽이 고쳤습니다.**

| 파일 | 겹치는 곳 |
|---|---|
| `src/components/Archive.jsx` | layout-v2 는 검색 줄 + 빠른 저장 줄을 한 줄로 합쳤고, space 는 헤더에 전환기를 넣고 조회·저장에 조건을 붙였습니다 |
| `src/styles.css` | 양쪽 모두 상단/검색 영역에 규칙을 더했습니다 |
| `scripts/fake-supabase.mjs` · `scripts/check-mobile.mjs` · `scripts/mobile-harness/main.jsx` | 양쪽 모두 점검을 늘렸습니다 |

두 브랜치를 다 쓰실 거라면 **layout-v2 를 먼저 main 에 넣고, 그 위로 space 를 리베이스**
하는 쪽이 충돌이 적습니다(space 쪽 변경이 더 넓게 흩어져 있어 나중에 얹는 편이 낫습니다).

## 7. 이번에 만진 파일

```
새로 만든 것
  src/spaces.js                     공간 열쇠·기본값·목록 조회·열 확인
  src/components/SpaceSwitcher.jsx  헤더 전환기 (드롭다운)
  scripts/check-space.mjs           점검 실행기
  scripts/check-space.body.mjs      점검 본문 (56개)
  REPORT-SPACE.md

고친 것
  supabase/setup.sql                2-b) spaces 표 · items/categories 의 space 열 · 시드 2종
  src/components/Archive.jsx        전환기·공간 필터·백업에 spaces 포함(복원 5단계)
  src/components/ItemModal.jsx      공간 칸(옮기기) · 카테고리를 공간으로 거름
  src/components/Settings.jsx       공간 관리 칸 · 공간별 사용량 내역
  src/components/Today.jsx          네 묶음 모두 공간 안에서만
  src/components/Trash.jsx          전 공간 통합 + 서랍 배지
  src/components/CategoryManager.jsx 새 카테고리는 지금 서랍에 · 어느 서랍인지 표시
  src/styles.css                    전환기·메뉴·배지·공간별 사용량
  public/sw.js                      v9 (옛 번들은 space 를 안 보내 엉뚱한 서랍에 저장한다)
  scripts/fake-supabase.mjs         조회 기록 · count · space 열 없음 흉내
  scripts/check-mobile.mjs          헤더 전환기 실측 2해상도
  scripts/mobile-harness/main.jsx   mode=space 화면 · 모달에 공간 5개
  scripts/check-files.body.mjs      고정값에 space 추가 (DB 의 not null default 와 같게)
  package.json                      check:space
  README.md · TODO-SQL.md
```
