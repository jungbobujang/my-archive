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

const VERSION = 'v1'
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
  '/icons/favicon-32.png'
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
