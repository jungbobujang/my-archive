# 나의 아카이브

아이디어, 유튜브 대본, 링크, 이미지, 할 일을 카테고리와 태그로 정리하는 개인 아카이브입니다.
자료가 수천 개 쌓여도 필요한 것만 페이지 단위로 불러오기 때문에 첫 화면 속도는 그대로입니다.

폰 홈 화면에 설치하면 주소창 없이 앱처럼 뜨고, 네트워크가 끊겨도 화면은 열립니다.

기술 스택: Vite + React 18 + Supabase (DB / Storage / Auth)

공통 표준: [dev-standards.md](../dev-standards.md) 참조

---

## 기능

### 오늘 탭

- **오늘의 할 것** — 기한이 없거나 오늘까지인 할 일. 지난 기한은 🔴 로 표시
- **시간대(슬롯)별 묶음** — 아침·저녁 같은 시간대를 직접 만들어 할 일을 나눠 담고, 순서도 바꿀 수 있음
- **예정** — 내일 이후 기한이 있는 할 일 5개
- **미분류** — 어느 카테고리에도 안 들어간 항목 (전체 개수 + 최근 10개)
- **최근 저장** — 마지막에 넣은 5개

### 아카이브 탭

- **통합 검색** — 제목 + 내용, 300ms 디바운스, 서버 측 검색
- **계층 카테고리** — 상위/하위 구조. 상위 카드의 개수는 자손까지 합산
- **다중 소속** — 한 항목이 여러 카테고리에 동시에 속할 수 있음
- **태그 필터** — 항목당 최대 10개, 칩 클릭으로 필터
- **중요(★) / 할 것(⚡) 필터**
- **세 가지 보기** — 갤러리 ▦ / 리스트 ☰ / 마인드맵 🗺️ (선택은 기억됨)
- **마인드맵** — 카테고리 계층을 방사형으로. 노드의 + 버튼으로 하위 카테고리를 그 자리에서 추가
- **페이지네이션** — 24개씩 로드 후 "더 보기"

### 저장

- **빠른 저장** — 한 줄 입력 후 엔터. `!` 로 시작하면 할 일로 저장
- **새 항목** — 제목·링크(여러 개)·내용·태그·이미지·실행 상태·기한·시간대
- **여러 링크 한 번에** — 링크를 통째로 붙여넣으면 하나씩 제목을 자동으로 가져와 저장
- **유튜브 썸네일 자동** — 유튜브 링크면 썸네일을 알아서 붙임
- **이미지 업로드** — Supabase Storage
- **내용에서 링크 자동 추출** — 본문에 URL 을 쓰면 링크 칸에 자동으로 모임

### 관리

- **휴지통** — 삭제는 soft delete. 복원 / 영구 삭제 / 전부 비우기
- **백업 내보내기·가져오기** — 항목·카테고리·시간대·소속 전체를 JSON 으로.
  가져오기는 덮어쓰기(upsert)라 기존 데이터가 지워지지 않음.
  시간대가 없는 옛 백업 파일도 그대로 복원됩니다
- **카테고리 관리** — 이름·아이콘·색(8색)·상위 카테고리 변경, 순환 참조 방지
- **시간대 관리** — 이름·아이콘·순서

### 화면

- **설정** — 상단 ⋯ → 설정. 화면 테마(시스템 / 라이트 / 다크), 플랜 표시, 로그인 계정
- **다크 모드** — 시스템 설정 자동 + 수동 전환. 카테고리 8색 모두 다크 버전이 있고 대비는 라이트와 동일 수준
- **요금제 안내(`/pricing`)** — 무료 / 프로 2단 비교. **정적 초안이며 결제 연동은 없습니다.**
  표의 한도는 자리표시 숫자로, 앱 어디에서도 강제되지 않습니다
- **PWA** — 홈 화면 설치, 오프라인에서도 앱 셸이 열림
- **모바일 최적화** — 380px 기준으로 레이아웃·터치 영역 정리
- **실패 안내** — 저장·조회 실패는 토스트로, 모달 안 오류는 인라인으로

---

## 1. Supabase 설정 (약 5분)

1. [supabase.com](https://supabase.com) 에서 새 프로젝트를 만듭니다.
2. 왼쪽 메뉴 **SQL Editor** → `supabase/setup.sql` 내용 전체를 붙여넣고 **Run**.
   - 테이블 4개(categories / time_slots / items / item_categories), RLS 정책,
     인덱스, 이미지 버킷(archive-images)이 한 번에 만들어집니다.
   - 이 파일 하나면 됩니다. 여러 번 다시 실행해도 안전합니다.
3. **Authentication → Users → Add user** 에서 본인 계정(이메일/비밀번호)을 직접 만듭니다.
   - 계정을 만드는 순간 기본 카테고리 4종(아이디어 / 유튜브 대본 / 이미지 / 기타 메모)과
     시간대 5종(아침 / 오전 / 오후 / 저녁 / 밤)이 자동으로 생깁니다. 마음대로 고치거나 지우면 됩니다.
   - 다른 사람의 가입을 막으려면 **Authentication → Sign In / Up** 에서 Sign-ups 를 꺼 두세요.
4. **Project Settings → API** 에서 두 값을 복사해 둡니다: Project URL, anon public key

## 2. 로컬 실행

```bash
npm install
cp .env.example .env      # 복사한 URL 과 anon key 를 .env 에 입력
npm run dev
```

`http://localhost:5173` 접속 → 3번에서 만든 계정으로 로그인.

> 서비스워커는 운영 빌드에서만 등록됩니다. 개발 중 캐시 때문에 방금 고친 코드가 안 보이는 일을 막기 위해서입니다.
> 오프라인 동작을 직접 확인하려면 `npm run build && npm run preview` 로 띄우세요.

## 3. 배포

### Railway

1. 이 폴더를 GitHub 저장소에 push.
2. Railway → **New Project → Deploy from GitHub repo**.
3. **Variables** 에 환경변수 2개 추가: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
4. Build/Start 명령은 package.json 에 이미 정의돼 있습니다 (`build` → `start`).
5. **Settings → Networking → Generate Domain** 으로 주소 생성.

### Vercel (대안)

Import repo → Framework: Vite → 환경변수 2개 추가 → Deploy.

> `/pricing` 처럼 앱 안에서만 존재하는 주소가 있으므로, 정적 호스팅에는 **SPA 폴백**
> (알 수 없는 경로 → `index.html`)이 필요합니다. `vite preview`(Railway) 와 Vercel 은 기본으로 해 줍니다.

> anon key 는 브라우저에 노출돼도 되는 공개 키입니다. 실제 데이터 보호는 RLS 정책(본인 user_id 만 접근)이 담당합니다.
> `service_role` 키는 절대 프론트엔드에 넣지 마세요.

## 4. 폰에 설치하기

배포된 주소를 폰 브라우저로 연 뒤,

- **Android (Chrome)**: 메뉴 → "앱 설치" 또는 "홈 화면에 추가"
- **iOS (Safari)**: 공유 → "홈 화면에 추가"

설치하면 주소창 없이 전체 화면으로 뜨고, 오프라인에서도 앱 화면은 열립니다.
(다만 목록·저장은 Supabase 연결이 필요하므로 온라인일 때만 동작합니다.)

---

## 폴더 구조

```
my-archive/
├── index.html             # 테마 부트스트랩 스크립트 + PWA 메타
├── vite.config.js         # react/supabase 벤더 청크 분리
├── scripts/
│   └── generate-icons.mjs # 의존성 없이 PNG 아이콘 생성 (node scripts/generate-icons.mjs)
├── public/
│   ├── manifest.webmanifest
│   ├── sw.js              # 오프라인 셸 서비스워커
│   └── icons/             # 위 스크립트로 생성된 아이콘 6종
├── supabase/
│   └── setup.sql          # 테이블 / RLS / 버킷
└── src/
    ├── main.jsx
    ├── App.jsx            # 인증 게이트
    ├── supabase.js        # 클라이언트 + 공용 순수 함수
    ├── theme.js           # 라이트/다크 테마
    ├── hooks.js           # useEscapeKey
    ├── registerSW.js
    ├── styles.css         # 색 토큰(라이트/다크) + 전체 스타일
    └── components/
        ├── Login.jsx
        ├── Pricing.jsx        # /pricing 요금제 초안 (결제 연동 없음)
        ├── Settings.jsx       # 테마 / 플랜 / 계정
        ├── Skeleton.jsx       # 로딩 자리 표시자
        ├── Archive.jsx        # 메인 화면 (탭·검색·필터·목록)
        ├── Today.jsx          # 오늘 대시보드
        ├── ItemCard.jsx       # 목록 카드 (memo)
        ├── ItemModal.jsx      # 생성/수정/삭제
        ├── BulkAdd.jsx        # 여러 링크 한 번에
        ├── CategoryManager.jsx
        ├── SlotManager.jsx    # 시간대
        ├── MindMap.jsx
        ├── Trash.jsx
        └── Toast.jsx          # 실패/성공 알림
```

## 커스터마이징

- **색 팔레트**: `src/styles.css` 맨 위의 `:root` (라이트) 와 `:root[data-theme='dark']` (다크).
  카테고리 색 키는 `src/supabase.js` 의 `COLOR_KEYS` 와 이름이 맞아야 합니다.
- **카테고리 아이콘 후보**: `src/supabase.js` 의 `ICON_CHOICES`
- **페이지 크기**: `src/supabase.js` 의 `PAGE_SIZE`
- **앱 아이콘**: `scripts/generate-icons.mjs` 의 색·글리프를 고치고 다시 실행
- **서비스워커 캐시**: `public/sw.js` 의 `VERSION` 을 올리면 옛 캐시가 정리됩니다

## 개발 메모

- 번들(gzip): 앱 코드 약 17 kB / react 45 kB / supabase-js 57 kB / CSS 5 kB.
  가장 큰 조각은 `@supabase/supabase-js` 이고, 이 앱이 쓰지 않는 realtime 이 함께 들어 있습니다.
  더 줄이려면 postgrest-js / auth-js / storage-js 를 직접 쓰는 방법이 있습니다.
- `item_categories` 에는 `deleted_at` 이 없습니다. 카테고리별 개수를 셀 때
  살아 있는 항목 id 를 먼저 모아 걸러내는 이유입니다.
