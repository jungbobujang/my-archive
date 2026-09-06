# REPORT-SHARE — 항목 단위 열람 전용 공유 링크

브랜치 `share-link` (main 에서 분기) → **main 에 머지·push 완료.**
아래 SQL 은 **아직 실행하지 않았습니다** — 검토 후 직접 Run 해 주세요.
서비스워커 캐시는 `v2 → v3` 으로 올렸습니다 (셸 번들이 바뀌었고, 옛 셸이 오프라인에서
되살아나지 않게 하기 위해서입니다. 문서 요청은 원래 네트워크 우선입니다).

---

## 1. 무엇이 생겼나

| 자리 | 내용 |
| --- | --- |
| 항목 모달 | 왼쪽 아래 **[🔗 공유 링크]** (수정 중일 때만) |
| 공유 창 | 유효기간 **1일 / 7일 / 30일** → [링크 만들기] → 주소 표시 + 자동 복사 + [복사] [회수]. 만들기 전에 한계 두 줄을 작은 회색 글씨로 미리 알림 |
| 받는 사람 | `/s/{토큰}` — 제목·태그·이미지·본문·링크·첨부 내려받기. 아래에 **"열람 전용 링크입니다"** |
| 만료·회수 | 전용 화면 — "만료된 링크입니다" / "회수된 링크입니다" / "찾을 수 없는 링크입니다" |
| 설정 | **공유 중인 링크** — 항목명 · 만료일(남은 시간) · [복사] [회수] |

새 파일: `src/share.js`, `src/components/SharePage.jsx`, `src/components/ShareDialog.jsx`,
`scripts/check-share.mjs` + `scripts/check-share.body.mjs`.

---

## 2. 가짜 만료를 만들지 않기 위해 한 것

이 앱에는 서버가 없습니다. 브라우저가 anon 키로 Supabase 에 직접 붙습니다.
그래서 **프론트에서 `expires_at` 을 비교해 가리는 방식은 검사가 아니라 장식**입니다 —
데이터는 이미 브라우저까지 와 있고, 화면만 지우면 보입니다. 판정을 전부 DB 로 옮겼습니다.

- `items` 의 RLS 는 **손대지 않았습니다** (`auth.uid() = user_id`).
  비로그인 상태에서 `items` 를 어떻게 조회해도 0행입니다.
- `shares` 표도 소유자만 읽습니다. **토큰을 알아도** anon 은 이 표에서 한 줄도 못 읽습니다 —
  `expires_at` 을 받아 와서 프론트가 비교하는 구조를 원천적으로 막기 위해서입니다.
  만료 시각은 "아직 유효할 때만" 알려 줍니다.
- 공유 항목을 꺼내는 길은 **`share_view(token)` 함수 하나뿐**입니다(security definer).
  회수·만료 판정이 그 안에서 끝나고, **만료된 토큰에는 항목 내용이 응답에 실리지 않습니다.**
  만료는 **서버 시각(`now()`)** 으로 봅니다 — 받는 사람이 시계를 되돌려도 소용없습니다.
- 함수가 돌려주는 열은 하나씩 적어 두었습니다. `user_id`·`deleted_at` 같은 것은 나가지 않습니다.
- 휴지통으로 보낸 항목은 링크가 살아 있어도 열리지 않습니다.

**Edge Function 을 쓰지 않은 이유**: 이 저장소의 배포 관행은 "SQL Editor 에 setup.sql 붙여넣기"
하나입니다. Edge Function 은 Deno 런타임과 `supabase functions deploy` 가 따로 필요해
설치 단계가 두 갈래로 갈립니다. 요구사항이 허용한 두 길(RLS 계열 / Edge Function) 중
**서버측 판정을 SQL 하나로 끝낼 수 있는 쪽**을 골랐습니다. 판정의 강도는 같습니다 —
어느 쪽이든 판정하는 주체는 서버(Postgres)입니다.

### 첨부 파일 — 만료와 같은 수명의 서명 주소

`archive-files` 는 비공개 버킷이라 anon 이 열 수 없습니다. 그렇다고 anon 에게 스토리지를
열어 줄 수도 없습니다: **storage 정책에는 우리 토큰을 넘길 자리가 없습니다.**
storage-api 는 JWT 클레임만 Postgres 로 넘기고 커스텀 헤더(`x-share-token` 따위)는
전달하지 않으므로, "유효한 share 토큰이면 이 폴더를 읽게 하라" 는 정책을 storage.objects 에
쓸 수 없습니다(REST 쪽에서만 되는 기법입니다).

그래서 **링크를 만드는 순간 소유자가** 각 파일의 서명 주소를 만들고, 수명을 유효기간과
**정확히 같게** 줍니다(1일 링크 → 86400초). 그 주소를 `shares.files` 에 담아 두고
`share_view` 가 "아직 유효할 때만" 함께 돌려줍니다. 영구 공개 주소는 나가지 않습니다.

- 만료 뒤에는 주소를 **얻을 길이 없고**, 먼저 받아 둔 주소가 있어도 같은 시각에 스토리지가
  서명을 거부합니다.
- 회수는 "새로 얻는 것" 을 끊습니다. 이미 페이지를 열어 둔 사람이 그 순간 손에 쥔 주소까지
  무효로 만들지는 못합니다 — 다만 그 사람은 **이미 파일을 내려받을 수 있었던 사람**이므로,
  회수로 되돌릴 수 있는 것은 처음부터 없습니다.

---

## 3. 검증

### 유효 / 만료 / 회수 — "응답 자체가 거부되는가"

`npm run check:share` 가 세 경우를 **두 겹**으로 봅니다.
① 비로그인 상태에서 `share_view` 응답에 항목이 실리는가 ② 화면이 무엇을 그리는가.
프론트에서 가리는 구현이었다면 ②는 통과하고 ①이 실패합니다.

본문에만 넣어 둔 낱말(`살구단추7391`)이 응답 JSON 과 화면 어디에도 없어야 통과입니다.

| 경우 | 응답 | 화면 |
| --- | --- | --- |
| 유효 | `ok:true` + 항목·첨부 주소 | 제목·본문·태그·이미지·링크·파일 |
| 만료 | `ok:false, reason:'expired'` — **item 없음, files 없음** | "만료된 링크입니다" |
| 회수 | `ok:false, reason:'revoked'` — **item 없음** | "회수된 링크입니다" |
| 없는 토큰 | `ok:false, reason:'not_found'` | "찾을 수 없는 링크입니다" |
| 휴지통 항목 | `ok:false, reason:'not_found'` | 같음 |

같은 스크립트가 비로그인 상태에서 **`items` 직접 조회 0행**, **토큰을 알아도 `shares` 조회 0행**,
**쓰기 42501** 도 확인합니다.

### 그 밖에 확인한 것

- 서명 수명이 유효기간과 같다 (1/7/30일 → 86400 / 604800 / 2592000초)
- 서명 주소에 원본 한글 파일명이 실린다 / `shares.files` 에 `/object/public/` 주소가 없다
- **자리비움 잠금과 무관하다** — PIN 을 걸어 둔 브라우저에서 `/s/{토큰}` 을 열어도
  공유 화면이 그대로 뜨고 PIN 입력칸·로그인 칸이 없다
- 망가진 토큰(`/s/이건토큰이아니다`)은 로그인 화면이 아니라 "찾을 수 없는 링크"
- 열람 전용 — 공유 화면에 입력칸·저장/삭제 버튼이 없다
- 설정 목록에 살아 있는 링크만 뜬다(만료·회수분 제외), [회수] 를 누르면 목록에서 사라지고
  **받는 사람 쪽이 곧바로 끊긴다**, 행은 지우지 않고 `revoked` 만 세운다
- 새 항목(저장 전)에는 공유 버튼이 없다
- 만들기 전 안내 두 줄(이미지 주소 만료 없음 · 나중에 붙인 첨부는 새 링크)이 화면에 있다

### 회귀 (요구하신 check 3종 + 이번 1종)

```
npm run check          ALL PASS (105)   모달 동작
npm run check:files    ALL PASS (318)   파일 첨부
npm run check:mobile   ALL PASS (45)    375px 실측
npm run check:share    ALL PASS (93)    공유 링크  ← 새로 추가
npm run build          ✓ built in 1.9s
```

`scripts/fake-supabase.mjs` 에 이번에 더한 것: `.in()` 필터, `rpc()`(share_view 흉내),
`store.anon`(비로그인 = 조회 0행·쓰기 42501), `store.now`(서버 시각), `shares` 표와 그 기본값,
`auth.onAuthStateChange`. 기존 점검 3종은 그대로 통과합니다.

---

## 4. ⚠ 실행해야 하는 SQL

> `supabase/setup.sql` 전체를 SQL Editor 에 붙여넣고 **Run** 하면 됩니다(여러 번 안전).
> 아래는 이번에 늘어난 9절만 떼어 낸 것입니다. **아직 실행하지 않았습니다.**

```sql
-- ============================================================
-- 9) 항목 공유 링크 (열람 전용)
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
```

**실행 전에도 앱은 그대로 돕니다.** 링크를 만들려고 하면
`공유 링크 표가 아직 없어요 — supabase/setup.sql 을 실행해 주세요` 라고 알리고,
설정의 '공유 중인 링크' 칸은 숨습니다.

---

## 5. 건너뛴 것 · 한계 (기록만)

1. **이미지는 여전히 공개 버킷 주소입니다.** 요구사항 6 은 "이미지·파일 모두 서명 주소" 였지만,
   `archive-images` 는 처음부터 공개 버킷이고 **이미 저장된 모든 `image_url` 이 그 공개 주소**입니다.
   비공개로 바꾸면 카드 썸네일·오늘 탭·마인드맵·백업 복원까지 한꺼번에 깨지고, 기존 데이터
   마이그레이션도 필요합니다. 이번 작업 범위를 넘어서 **덜 파괴적인 쪽(현행 유지)** 으로 두었습니다.
   → 공유 화면의 이미지는 만료 뒤에도 그 URL 을 아는 사람에게는 열립니다(공유 전에도 그랬습니다).
   닫으려면 별도 작업이 필요합니다: 버킷 비공개 전환 + `image_url` 을 경로로 바꾸기 +
   모든 화면에서 서명 주소 발급. 필요하시면 다음 작업으로 잡겠습니다.
   **지금은 링크를 만들기 전에 화면에 적어 둡니다** —
   `※ 이미지가 포함된 항목은 이미지 주소에 만료가 적용되지 않습니다`.
   보내고 나서 알면 늦는 사실이라, 문서에만 두지 않고 만드는 자리로 끌어올렸습니다.

2. **링크를 만든 뒤 추가한 첨부는 그 링크에 나타나지 않습니다.** 서명 주소를 만들 때
   굳히기 때문입니다(위 2절). 그때는 링크를 다시 만들면 됩니다. 제목·본문·이미지·링크·태그는
   볼 때마다 최신 값을 읽습니다. 이것도 만들기 전에 화면에 적어 둡니다 —
   `※ 링크 생성 후 추가한 첨부는 새 링크를 만들어야 표시됩니다`.

3. **만료 응답은 HTTP 200 + `{ ok:false }`** 입니다. HTTP 오류(4xx)로 튕기게 할 수도 있지만,
   그러면 "만료됨 / 회수됨 / 없는 토큰" 을 구분해 안내하기가 어려워집니다.
   **응답에 항목 내용이 하나도 실리지 않는다**는 점은 같고, 점검이 그것을 봅니다.

4. **`check:mobile`(375px 실측)에 공유 화면은 넣지 않았습니다.** 그 점검은
   `scripts/mobile-harness/` 에 화면별 단독 하네스를 따로 만드는 구조라, 화면 하나를 더하려면
   하네스와 계측 항목을 함께 늘려야 합니다. 공유 화면은 CSS 를 기존 토큰·클래스로만 짜고
   520px 이하 규칙을 넣어 두었습니다. 실측이 필요하면 별도로 잡겠습니다.

5. **오래된 shares 행을 치우는 청소는 없습니다.** 만료된 행은 남아 있어도 열리지 않고,
   설정 목록에도 뜨지 않습니다. 신경 쓰이면 아래를 가끔 돌리면 됩니다(선택).

   ```sql
   delete from public.shares where expires_at < now() - interval '30 days';
   ```

6. **공유 화면에는 소유자 정보를 전혀 싣지 않았습니다**(이메일·계정명 없음).
   받는 사람은 링크를 준 사람이 누구인지 이미 알고 있고, 앱이 굳이 더 말할 이유가 없습니다.
