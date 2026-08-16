# 나의 아카이브

아이디어, 유튜브 대본, 이미지, 메모를 카테고리와 태그로 정리하는 개인 아카이브 사이트입니다. 자료가 수천 개 쌓여도 필요한 것만 페이지 단위로 불러오기 때문에 속도가 느려지지 않습니다.

기술 스택: Vite + React + Supabase (DB / Storage / Auth)

---

## 1. Supabase 설정 (약 5분)

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. 왼쪽 메뉴 **SQL Editor** → `supabase/setup.sql` 파일 내용 전체를 붙여넣고 **Run**.
   - items 테이블, RLS 정책, 이미지 버킷(archive-images), 인덱스가 한 번에 생성됩니다.
3. **Authentication → Users → Add user**에서 본인 계정(이메일/비밀번호)을 직접 만듭니다.
   - 다른 사람의 가입을 막으려면 **Authentication → Sign In / Up**에서 Sign-ups를 꺼 두세요.
4. **Project Settings → API**에서 두 값을 복사해 둡니다.
   - Project URL
   - anon public key

## 2. 로컬 실행

```bash
npm install
cp .env.example .env      # 복사한 URL과 anon key를 .env에 입력
npm run dev
```

`http://localhost:5173` 접속 → 3번에서 만든 계정으로 로그인.

## 3. 배포

### Railway

1. 이 폴더를 GitHub 저장소에 push.
2. Railway → **New Project → Deploy from GitHub repo** 선택.
3. **Variables**에 환경변수 2개 추가:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Build/Start 명령은 package.json에 이미 정의되어 있습니다 (`build` → `start`).
5. **Settings → Networking → Generate Domain**으로 주소 생성 → 폰에서도 접속 가능.

### Vercel (대안)

Import repo → Framework: Vite → 환경변수 2개 추가 → Deploy. 끝.

> anon key는 브라우저에 노출되어도 되는 공개 키입니다. 실제 데이터 보호는 RLS 정책(본인 user_id만 접근)이 담당합니다. `service_role` 키는 절대 프론트엔드에 넣지 마세요.

---

## 기능

- 통합 검색 (제목 + 내용, 300ms 디바운스, 서버 측 검색)
- 카테고리 4종: 아이디어 / 유튜브 대본 / 이미지 / 기타 메모 (카드 클릭으로 필터)
- 태그 필터 (항목당 최대 10개, 클릭으로 필터)
- 중요(★) 표시 및 중요 항목만 보기
- 갤러리 ↔ 리스트 보기 전환 (선택 기억)
- 이미지 업로드 (Supabase Storage, 카드 썸네일 표시)
- 페이지네이션: 24개씩 로드 → "더 보기" (수천 개 쌓여도 첫 화면 속도 동일)
- 모바일 반응형

## 폴더 구조

```
my-archive/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── supabase/
│   └── setup.sql          # Supabase 초기 설정 (테이블/RLS/버킷)
└── src/
    ├── main.jsx
    ├── supabase.js         # 클라이언트 + 카테고리 정의
    ├── styles.css
    ├── App.jsx             # 인증 게이트
    └── components/
        ├── Login.jsx
        ├── Archive.jsx     # 메인 화면 (검색/필터/목록)
        ├── ItemCard.jsx
        └── ItemModal.jsx   # 생성/수정/삭제 + 이미지 업로드
```

## 커스터마이징

- **카테고리 변경**: `src/supabase.js`의 `CATEGORIES` 수정 (색상은 `styles.css`의 `--c-*` 변수)
- **페이지 크기**: `src/supabase.js`의 `PAGE_SIZE`
- **추후 업데이트 아이디어**: 정렬 옵션, 휴지통(soft delete), 백업 내보내기(JSON), 다크 모드, 마크다운 렌더링
