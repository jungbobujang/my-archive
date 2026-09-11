/* 나의 아카이브 — 오프라인 셸 서비스워커
 *
 * 전략
 *  - 문서(navigate) : 네트워크 우선 → 실패하면 캐시된 index.html (오프라인에서도 앱이 뜬다)
 *  - /assets/*      : 캐시 우선. Vite 가 파일명에 해시를 붙이므로 내용이 바뀌면 이름이 바뀐다
 *  - 그 밖의 정적 파일 / 폰트 CDN : stale-while-revalidate
 *  - Supabase(API·인증·스토리지) : 절대 가로채지 않는다. 항상 네트워크
 *
 * 버전을 올리면 옛 캐시는 activate 에서 통째로 지워진다.
 */

// v11 — 첨부 파일 개당 상한 10MB → 25MB.
//       🔴 옛 번들은 25MB 짜리를 **브라우저에서 먼저 막는다** — 버킷 상한을 올려 두어도
//          "10MB 이하만 첨부할 수 있습니다" 를 계속 만난다. 서버는 받아 줄 준비가 됐는데
//          화면이 거절하는 상태라, 사람은 상한이 안 올라간 줄로 안다.
// v10 — v9 와 **같은 것**(공간)을 담은 머지본이다. 기능이 더 바뀌지는 않았다.
//       한 번 더 올리는 이유: v9 는 space 브랜치에 있던 번호라, 그 브랜치를 미리 띄워
//       받아 간 브라우저가 있을 수 있다. 그런 캐시는 번호가 같으면 갈아 끼워지지 않는다
//       (sw.js 는 KEEP 목록에 없는 캐시만 지운다). main 에서 배포하는 것이 정본이므로
//       번호를 한 칸 띄워 그 캐시까지 확실히 비운다.
// v9 — 공간(서랍). 항목·카테고리가 space 열로 갈리고 헤더에 전환기가 생겼다.
//      🔴 옛 번들이 남으면 전환기가 없는 화면을 계속 보게 되는데, 그 화면은 **저장할 때
//         space 를 보내지 않는다** — 수업 서랍을 보고 있다고 생각하며 적은 것이
//         전부 '개인' 으로 들어간다. 낡은 화면이 아니라 틀린 곳에 넣는 화면이다.
// v8 — 모션 1차(카드 등장·hover·저장 강조·FLIP 재배치·빠른 저장 피드백).
//      🔴 옛 번들이 남으면 화면이 예전처럼 뚝뚝 끊겨서, 새로 넣은 피드백이 없는 채로
//         남는다 — 특히 저장한 카드가 어디로 들어갔는지 알려 주는 그 표시가 안 뜬다.
// v7 — 순서 바꾸기 조작을 **전 기기 클릭 방식으로 통일**했다 (PC 도 클릭해서 고르고
//      버튼으로 옮긴다). 🔴 옛 번들이 남으면 PC 에서 클릭이 여전히 '크게 보기' 로 동작해
//         고를 수가 없고, 폰과 조작이 갈린 그 상태로 남는다.
// v6 — 두 가지가 바뀌었다.
//      ㄱ. 폰에서 이미지 순서 바꾸기가 **끌기 → 탭 선택** 으로 교체됐다.
//         🔴 옛 번들이 남으면 폰에서 '꾹 눌러 끌기' 를 계속 만나게 되는데, 그건 조작
//            불가 판정이 난 그 방식이다. 새 방식이 있는 줄도 모르고 넘어간다.
//      ㄴ. 첨부를 받을 때 파일 이름이 깨지던 것을 고쳤다(blob 으로 저장).
//         🔴 옛 번들은 계속 '%EC%96%91....hwp' 로 저장한다.
// v5 — 설정의 저장소 게이지가 이미지 버킷까지 합산하면서 셸 번들이 바뀌었다.
//      🔴 옛 번들이 캐시에 남으면 '파일 ○○ / 1GB' 라고만 적힌 옛 게이지를 계속 보게 되는데,
//         그건 단순히 낡은 화면이 아니라 **실제보다 적은 사용량**을 말하는 화면이다.
//      🔴 v4 는 다른 작업(순서 바꾸기)이 이미 쓰고 올라갔다. 같은 번호를 두 번 쓰면
//         그 배포를 받은 사람의 캐시가 갱신되지 않는다 — 번호는 겹치면 안 된다.
// v4 — 항목 모달의 이미지·파일 순서 바꾸기(reorder.js)가 들어오면서 셸 번들이 바뀌었다.
// v3 — 공유 링크(/s/{토큰}) 화면이 들어오면서 셸 번들이 바뀌었다.
// 문서 요청은 원래 네트워크 우선이라 온라인이면 새 index.html 을 받지만,
// 버전을 올려 두면 옛 셸·옛 청크가 캐시에 남아 있다가 오프라인에서 되살아나는 일이 없다.
const VERSION = 'v11'
const SHELL_CACHE = `archive-shell-${VERSION}`
const RUNTIME_CACHE = `archive-runtime-${VERSION}`
const KEEP = [SHELL_CACHE, RUNTIME_CACHE]

// 설치 시 미리 받아두는 앱 셸. 해시가 붙는 번들은 여기 넣을 수 없어 런타임에 캐시된다.
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/favicon.svg'
]

const FONT_CDN = 'https://cdn.jsdelivr.net/'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // 하나라도 실패하면 설치 전체가 막히므로 개별로 담는다
      .then((cache) => Promise.all(
        SHELL_URLS.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// 페이지에서 즉시 업데이트를 요청할 때 쓴다
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

function isSupabase(url) {
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')
}

async function networkFirstDocument(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const fresh = await fetch(request)
    cache.put('/index.html', fresh.clone())
    return fresh
  } catch {
    return (await cache.match('/index.html'))
      || (await cache.match('/'))
      || Response.error()
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const fresh = await fetch(request)
  if (fresh.ok || fresh.type === 'opaque') cache.put(request, fresh.clone())
  return fresh
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const network = fetch(request)
    .then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone())
      return res
    })
    .catch(() => null)
  return hit || (await network) || Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // 데이터/인증/이미지 업로드는 언제나 실시간이어야 한다
  if (isSupabase(url)) return
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(request))
    return
  }

  const sameOrigin = url.origin === self.location.origin

  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE))
    return
  }

  if (sameOrigin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE))
    return
  }

  // 웹폰트(Pretendard)는 오프라인에서도 글꼴이 깨지지 않게 담아둔다
  if (request.url.startsWith(FONT_CDN)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE))
  }
})
