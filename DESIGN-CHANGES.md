# DESIGN-CHANGES

디자인 폴리싱 작업의 변경 기록입니다. **전면 재디자인은 하지 않았습니다** —
기존 색 팔레트, 레이아웃, 화면 구조는 그대로 두고 어긋난 값만 맞추고 상태 표현을 보탰습니다.

전 화면의 `font-size` / `border-radius` / `padding` / `gap` 값을 스크립트로 전부 뽑아
빈도를 세고, 사실상의 표준에서 벗어난 것만 손봤습니다.

---

## 8. 일관성 감사

### 모서리 반경 — 11가지 → 토큰 4개로

기존에 `--radius(10px)` / `--radius-lg(14px)` 토큰이 있었는데도 하드코딩 값이 섞여 있었습니다.

- 토큰 추가: `--radius-sm: 6px` (작은 컨트롤), `--radius-xl: 18px` (모달·로그인 카드 같은 큰 표면)
- `.login-card` 18px → `--radius-xl` (값 동일, 토큰화)
- `.modal` 18px → `--radius-xl` (값 동일, 토큰화)
- `.modal` 모바일 16px → `--radius-xl` — 같은 모달이 화면 폭에 따라 반경이 달랐습니다
- `.setup-notice` 16px → `--radius-xl`
- `.setup-notice code` 5px → `--radius-sm`
- `.check` 6px → `--radius-sm`
- `.brand-mark` 9px → `--radius` (10px)
- `.view-toggle` 8px → `--radius` (10px)
- 그대로 둔 것: `.chip`/`.badge`/`.today-count` 의 `999px`(알약), `.spinner`/`.cm-dot` 의 `50%`(원),
  `.login-mark` 의 12px (44px 정사각형이라 비율상 10px 보다 12px 이 맞음)

### 버튼 여백

- `.btn-ghost`, `.btn-danger` 의 `9px 14px` → `9px 16px`
  — `.btn-primary` 만 16px 이라 한 줄에 나란히 설 때 좌우 여백이 미묘하게 어긋났습니다
- `.btn-ghost`, `.btn-danger` 에 없던 `:disabled` 스타일 추가 (primary 에만 있었음)

### 글자 크기 — 15가지 → 12가지

- `13.5px` → `13px` (`.login-sub`, `.toast`) — 13px 이 18곳으로 사실상의 표준
- `12px` → `12.5px` (`.cat-count`, `.login-hint`, `.cm-parent label`, `.slot-head`, `.today-when`)
  — 보조 문구 크기가 12 와 12.5 로 갈려 있었습니다. 12.5px 쪽으로 통일
- SVG 안 글자(`.mm-label` 12.5, `.mm-count` 10.5)는 CSS px 이 아니라 viewBox 단위라 제외했습니다

### 간격

- `.login-card label` gap 5px → 6px
- `.slot-move` gap 2px → 4px
- `.setup-notice` padding 28px → 22px (`.modal` 과 동일)

### 포커스 링 (접근성)

- `select`, `a` 가 `:focus-visible` 규칙에서 빠져 있었습니다 → 추가
- 더 중요한 문제: `.field input:focus { outline: none }` 류의 규칙이 특이도에서 이겨,
  **키보드로 입력칸에 들어가면 포커스 링이 아예 보이지 않았습니다.**
  테두리 색만 바뀌는 건 색각 이상 사용자에게 충분한 신호가 아닙니다.
  → 해당 입력칸들에 `:focus-visible` 규칙을 뒤에서 다시 걸어 링을 살렸습니다.

---

## 9. 마이크로 디테일

### 전환

- 색이 바뀌는 컨트롤에만 `0.15s ease` (background / border / color / box-shadow / transform)
- 레이아웃에 영향을 주는 속성(width, height 등)에는 전환을 걸지 않았습니다
- `prefers-reduced-motion: reduce` 에서 전부 끕니다

### 호버 / 액티브

- `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.chip` 에 `:active { transform: translateY(1px) }`
  — 눌렀다는 감각만 주는 정도
- 없던 호버 상태 추가: `.cat-card`, `.card`, `.cm-dot`, `.cm-icon`,
  `.view-toggle button`(선택되지 않은 것만)
- `.chip-on:hover` 추가 — 선택된 칩만 호버 반응이 없었습니다
- `.cat-on` 에 `inset box-shadow` 를 더해 "선택됨"과 "호버 중"이 구분되게 했습니다
  (둘 다 테두리만 바꿔서 헷갈렸습니다)

### 로딩 스켈레톤

스피너 하나를 돌리는 대신, 곧 나타날 목록의 모양을 미리 그립니다. 화면이 갑자기 튀지 않습니다.

- `components/Skeleton.jsx` — `SkeletonCards`(갤러리/리스트), `SkeletonRows`(오늘 탭·휴지통)
- 적용: 아카이브 목록 첫 로딩, 오늘 탭 첫 로딩, 휴지통
- 좌우로 한 번 훑고 지나가는 형태. `prefers-reduced-motion` 에서는 정지
- 앱 최초 진입(세션 확인)은 그릴 내용을 아직 모르므로 기존 스피너를 유지했습니다

### 빈 상태

큰 빈 화면(`.empty`)에 아이콘 + 제목 + 보조 문구 구조를 세웠습니다. 섹션 안 한 줄짜리 문구는
역할이 다르므로 아이콘 없이 그대로 뒀습니다.

- 아카이브(검색 결과 없음): 🔍 "조건에 맞는 항목이 없어요" + "검색어를 줄이거나 필터를 지워 보세요"
  \+ **필터 초기화 버튼** — 기존에는 안내만 있고 빠져나갈 방법이 없었습니다
- 아카이브(항목 없음): 🗂 "아직 저장한 것이 없어요" + 무엇을 넣으면 되는지 한 줄
- 마인드맵: 🗺️ "아직 카테고리가 없어요" + 안내
- 문구 다듬기: 오늘 할 것 / 미분류 / 최근 저장 / 휴지통 / 카테고리 관리

---

## 10. 로그인 화면

(아래 "10. 첫인상" 절 참고 — 같은 파일 하단에 이어서 기록)

## 11. 요금제 화면

(아래 "11. 요금제" 절 참고)
