# 긴 본문 저장 실패 원인 조사 (2026-08-31)

조사만 했고 **코드는 한 줄도 바꾸지 않았습니다.** 재현은 스크래치패드의 임시 스크립트로만 했고
저장소에는 이 문서만 추가했습니다.

## 한 줄 결론

**길이 제한 때문에 저장이 막히는 지점은 코드·DB·네트워크 어디에도 없습니다.**
`content` 는 `text`(무제한), textarea 에 `maxLength` 없음, 클라이언트 유효성 검사 없음,
Supabase 는 30MB 본문까지 받아 줍니다. 실제로 확인된 문제는 두 가지인데 둘 다
**"저장 실패"가 아니라 "조용한 초안 유실"과 "타이핑 지연"** 입니다.

| # | 확인 대상 | 결과 | 판정 |
|---|---|---|---|
| 1 | `items.content` 컬럼 타입 | `content text default ''` (`supabase/setup.sql:82`). `varchar(n)` 아님 → Postgres 상한 1GB | ✅ 제한 없음 |
| 1 | 내용 textarea `maxLength` | 없음 (`src/components/ItemModal.jsx:681-696`). placeholder 도 "길이 제한 없이" | ✅ 제한 없음 |
| 1 | 클라이언트 유효성 검사 | 길이 검사 자체가 없음. `handleSave` 의 사전 검사는 ①업로드 중 ②`hasAnything` 둘뿐 (`ItemModal.jsx:347-359`) | ✅ 제한 없음 |
| 1 | 저장 시 잘림 | `payload.content = content` 원문 그대로 (`ItemModal.jsx:413`). `slice` 는 제목 자동생성(앞 20자)에만 (`:309`) | ✅ 잘림 없음 |
| 2 | `ma:draft:*` 쓰기 경로 | `writeDraft` 가 **`try/catch` 로 감싸져 있음** (`src/hooks.js:39-46`) → 예외가 밖으로 안 나감 | ✅ 저장 흐름 안 끊김 |
| 2 | QuotaExceededError 처리 | `console.warn('[draft] 임시 저장 실패:', err)` 한 줄. **화면에는 아무 표시 없음** | ⚠️ 조용한 유실 |
| 2 | 실제 한계선 (Chrome 실측) | JSON 직렬화 후 **약 10MiB(UTF-16)** = 본문 **약 520만 자**부터 QuotaExceededError | ⚠️ 아래 표 참고 |
| 3 | Supabase 요청 크기 제한 | 본문 30MB(1000만 자) 까지 **게이트웨이 통과 확인** (413 없음, 소켓 안 끊김) | ✅ 제한 아님 |
| 3 | 저장 실패의 사용자 표시 | 단건/수정 경로는 `catch` → `setError(...)` → `{error && <p className="form-error" role="alert">}` (`ItemModal.jsx:444-446`, `:837`) | ✅ 표시됨 |
| 3 | 예외: 링크 분리 저장 | 링크마다 개별 항목 모드에서 **개별 실패는 `console.error` 로만** 남고, 전부 실패해야 화면에 뜸 (`ItemModal.jsx:384-392`) | ⚠️ 부분 침묵 |
| 3 | 서비스워커 간섭 | `public/sw.js:97` `request.method !== 'GET'` 즉시 반환 + `:107` supabase 도메인 제외 → POST/PATCH 안 건드림 | ✅ 무관 |

## 4. 재현 결과

### (A) Supabase 요청 페이로드 — 한글 1자 = UTF-8 3바이트

RLS 가 켜져 있어(`setup.sql:141-158`) 익명 키 INSERT 는 정책에서 거부됩니다.
**행이 만들어지지 않는 안전한 프로브**이고, 우리가 보려던 것은 "본문이 PostgREST 까지 닿는가"입니다.
크기 제한이라면 42501(RLS) 이 아니라 413 이나 소켓 끊김이 나와야 합니다.

| 본문 길이 | 전송량 | 결과 | 소요 |
|---|---|---|---|
| 1만 자 | 0.03MB | HTTP 401 `42501 row-level security` | 1387ms |
| **10만 자** | 0.30MB | HTTP 401 `42501` — **크기 문제 아님** | 127ms |
| **50만 자** | 1.50MB | HTTP 401 `42501` — **크기 문제 아님** | 159ms |
| **200만 자** | 6.00MB | HTTP 401 `42501` — **크기 문제 아님** | 286ms |
| 500만 자 | 15.00MB | HTTP 401 `42501` | 1454ms |
| 1000만 자 | 30.00MB | HTTP 401 `42501` | 2550ms |

→ **어느 크기에서도 게이트웨이가 자르지 않습니다.** 전 구간에서 요청 본문이 끝까지 읽힌 뒤
정책 검사까지 도달했습니다. 30MB 도 2.5초에 올라갑니다.

### (B) 초안(sessionStorage) + 타이핑 비용 — Chrome 헤드리스 실측

`ItemModal` 이 초안에 넣는 객체 모양 그대로, `supabase.js` 의 `extractUrls` 정규식 그대로 돌렸습니다.

| 본문 길이 | 초안 JSON | 초안 저장 | 되읽기 | onChange 정규식 |
|---|---|---|---|---|
| 1만 자 | 0.01M자 | OK 0.4ms | 정상 | 0.3ms |
| **10만 자** | 0.10M자 | **OK** 0.4ms | 정상 | 0.1ms |
| **50만 자** | 0.50M자 | **OK** 2.6ms | 정상 | 0.4ms |
| **200만 자** | 2.00M자 (3.81MiB) | **OK** 10.3~12.4ms | 정상 | 1.1ms |
| 520만 자 | 5.20M자 (9.92MiB) | OK 26.0ms | 정상 | — |
| **540만 자** | 5.40M자 (10.30MiB) | **QuotaExceededError** | **null (유실)** | — |
| 600만 자 | 6.00M자 (11.44MiB) | QuotaExceededError | null (유실) | — |
| 800만 자 | 8.00M자 (15.26MiB) | QuotaExceededError | null (유실) | — |

**콘솔 에러**: 10만·50만·200만 자에서는 콘솔에 아무것도 안 뜹니다.
540만 자 이상에서만 `[draft] 임시 저장 실패: QuotaExceededError: Failed to execute 'setItem' on 'Storage'`
가 `console.warn` 으로 뜨고, **화면에는 여전히 아무 표시가 없습니다.**
(널리 알려진 5MB 가 아니라 Chrome 최신판 기준 약 10MiB 였습니다.)

## 남은 두 가지 — 진짜 증상은 이쪽입니다

1. **540만 자 넘는 초안은 조용히 사라집니다.** 저장 버튼은 정상 동작하지만, 모달이 닫히거나
   새로고침되면 쓰던 내용이 안 돌아옵니다. `writeDraft` 가 `console.warn` 만 하고 끝나서
   사용자는 초안이 남아 있다고 믿게 됩니다. (200만 자까지는 멀쩡합니다)
2. **200만 자쯤부터 타이핑이 눈에 띄게 밀립니다.** 글자 하나 칠 때마다
   `dirty` 문자열 비교 → `JSON.stringify` 12ms → `extractUrls` 로 본문 전체 스캔 2~3회가
   전부 동기로 돕니다. 한글 조합 중에 밀리면 글자가 씹히는 것처럼 느껴집니다.
   `writeDraft` 에 디바운스가 없습니다 (`ItemModal.jsx:112-117`).

## 질문 필요 — 확인 못 한 것 하나

**로그인 상태에서의 실제 DB 왕복 저장**은 재현하지 못했습니다.
`src/components/Login.jsx:1` 대로 가입이 막혀 있고 계정 비밀번호가 없습니다
(`SKIPPED.md:35`, `MOBILE-CHECK.md:8` 에도 같은 이유가 남아 있습니다).
임의로 계정을 만들면 운영 DB에 사용자가 생기므로 하지 않았습니다.

확인하시려면 로그인한 브라우저에서 콘솔에 붙여넣어 주세요 (항목 1건이 실제로 생성됩니다):

```js
const { data, error } = await window.supabase   // 노출 안 돼 있으면 앱에서 20만 자 붙여넣기로 대체
  .from('items').insert({ title: '길이 테스트', content: '가'.repeat(500000) }).select().single()
console.log(error ?? data.id, data?.content.length)
```

또는 더 간단히, 앱에서 새 항목에 **50만 자를 붙여넣고 저장 → 다시 열어 글자 수 확인**만 해도
왕복 손실 여부가 나옵니다. 그 결과를 알려 주시면 이 문서에 이어 붙이겠습니다.
