// scripts/check-share.mjs 가 esbuild 로 묶어 실행한다. 직접 node 로 돌리면 JSX 때문에 실패한다.
//
// 이 점검의 전제: **화면에 안 보이는 것은 증거가 아니다.** 만료·회수를 확인할 때는
// 화면 글자만 보지 않고, 비로그인 상태에서 Supabase 응답에 항목 내용이 실렸는지를
// 함께 본다(fetchShare 의 반환값에 item 이 있는가). 프론트에서 가리는 구현이었다면
// 화면 검사는 통과하고 이 검사는 실패한다.
import { JSDOM, VirtualConsole } from 'jsdom'
import {
  tokenFromPath, isSharePath, shareUrlFor, expiresAtFor, signSecondsFor,
  formatWhen, remainingLabel, deadTextFor, createShare, listShares, revokeShare,
  fetchShare, VIEW_ONLY_NOTE, SHARE_DAYS, DAY_MS, isMissingShareSchema
} from '../src/share.js'
import { supabase } from '../src/supabase.js'
import { store, resetStore } from './fake-supabase.mjs'

const vc = new VirtualConsole()
vc.on('jsdomError', () => {})

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc
})
const { window } = dom
for (const k of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent',
  'KeyboardEvent', 'FocusEvent', 'Node', 'File', 'Blob', 'FileList', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage', 'localStorage']) {
  try { globalThis[k] = window[k] } catch { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }) }
}
globalThis.window = window
globalThis.IS_REACT_ACT_ENVIRONMENT = true
process.on('unhandledRejection', () => {})
globalThis.fetch = async () => { throw new Error('점검 중에는 바깥으로 나가지 않는다') }
// 클립보드는 보안 컨텍스트에서만 있다. jsdom 에는 둘 다 없으므로 옛 방식만 열어 둔다.
window.document.execCommand = () => true

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const act = React.act ?? (await import('react-dom/test-utils')).act
const ItemModal = (await import('../src/components/ItemModal.jsx')).default
const SharePage = (await import('../src/components/SharePage.jsx')).default
const Settings = (await import('../src/components/Settings.jsx')).default
const App = (await import('../src/App.jsx')).default
const { ToastProvider } = await import('../src/components/Toast.jsx')

const checks = []
const check = (name, cond, extra) => checks.push({ name, ok: !!cond, extra })

const q = (host, sel) => host.querySelector(sel)
const qa = (host, sel) => [...host.querySelectorAll(sel)]
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, root }
}

let confirmAnswer = true
window.confirm = () => confirmAnswer

// 본문에만 있는 낱말. 화면 어디에도 이 낱말이 없어야 '가려진 것' 이 아니라 '오지 않은 것'이다.
const SECRET = '살구단추7391'

function seedItem(extra = {}) {
  const it = {
    id: 'item-1',
    user_id: 'u1',
    title: '학년부 회의록',
    content: `첫 줄\n${SECRET} 이 낱말이 본문에만 있다`,
    tags: ['회의', '2026'],
    link_url: null,
    image_url: null,
    files: [],
    deleted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...extra
  }
  store.rows.items.push(it)
  return it
}

function putFile(path, size = 1024) {
  store.buckets['archive-files'].set(path, { size, type: 'application/octet-stream' })
}

// ── 1. 주소·유효기간 계산 ───────────────────────────────────
{
  const uuid = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
  check('토큰을 주소에서 읽는다', tokenFromPath(`/s/${uuid}`) === uuid, tokenFromPath(`/s/${uuid}`))
  check('뒤에 / 가 붙어도 읽는다', tokenFromPath(`/s/${uuid}/`) === uuid)
  check('토큰 모양이 아니면 null', tokenFromPath('/s/abcd') === null)
  check('다른 주소는 null', tokenFromPath('/pricing') === null && tokenFromPath('/') === null)
  check('/s/ 로 시작하면 공유 자리로 본다', isSharePath('/s/abcd') === true)
  check('망가진 토큰도 공유 자리다(로그인 화면으로 보내지 않는다)', isSharePath('/s/') === true)
  check('앱 주소는 공유 자리가 아니다', isSharePath('/') === false && isSharePath('/pricing') === false)
  check('공유 주소 모양', shareUrlFor(uuid, 'https://a.b') === `https://a.b/s/${uuid}`)

  const t0 = Date.UTC(2026, 0, 1)
  check('유효기간 1일', Date.parse(expiresAtFor(1, t0)) - t0 === DAY_MS)
  check('유효기간 30일', Date.parse(expiresAtFor(30, t0)) - t0 === 30 * DAY_MS)
  check('고를 수 있는 기간 3종', SHARE_DAYS.join() === '1,7,30', SHARE_DAYS.join())

  // 서명 수명 = 유효기간. 하루짜리 링크의 파일 주소가 하루보다 오래 살면 그만큼 가짜 만료다.
  for (const d of SHARE_DAYS) {
    const seconds = signSecondsFor(expiresAtFor(d, t0), t0)
    check(`서명 수명이 유효기간과 같다: ${d}일`, seconds === d * 86400, seconds)
  }
  check('만료 표기', formatWhen('2026-09-13T14:20:00') === '2026-09-13 14:20', formatWhen('2026-09-13T14:20:00'))
  check('남은 시간: 2일', remainingLabel(new Date(t0 + 2.5 * DAY_MS).toISOString(), t0) === '2일 남음')
  check('남은 시간: 3시간', remainingLabel(new Date(t0 + 3 * 3600_000).toISOString(), t0) === '3시간 남음')
  check('남은 시간: 지난 것', remainingLabel(new Date(t0 - 1).toISOString(), t0) === '만료됨')
  check('만료 화면 문구', deadTextFor('expired').title === '만료된 링크입니다')
  check('회수 화면 문구', deadTextFor('revoked').title === '회수된 링크입니다')
  check('모르는 사유는 없는 링크로', deadTextFor(undefined).title === '찾을 수 없는 링크입니다')
}

// ── 2. 링크 만들기 — 파일은 유효기간과 같은 수명으로 서명한다 ─
{
  resetStore()
  putFile('item-1/1_aaaaaaaa.hwp')
  putFile('item-1/2_bbbbbbbb.pdf')
  const item = seedItem({
    files: [
      { path: 'item-1/1_aaaaaaaa.hwp', name: '2026 계획서.hwp', size: 2048 },
      { path: 'item-1/2_bbbbbbbb.pdf', name: '보고서.pdf', size: 4096 }
    ]
  })

  const t0 = Date.UTC(2026, 5, 1)
  const made = await createShare({ item, userId: 'u1', days: 1, now: t0 })

  check('shares 에 한 줄이 생긴다', store.rows.shares.length === 1, store.rows.shares.length)
  const row = store.rows.shares[0]
  check('토큰이 곧 행 id', made.id === row.id)
  check('만료 시각이 하루 뒤', Date.parse(row.expires_at) - t0 === DAY_MS)
  check('처음에는 회수되지 않은 상태', row.revoked !== true, row.revoked)
  check('항목·소유자가 붙는다', row.item_id === 'item-1' && row.user_id === 'u1')

  const signed = store.calls.signed.filter((c) => c.bucket === 'archive-files')
  check('파일마다 서명 주소를 만든다', signed.length === 2, signed.length)
  check('서명 수명이 유효기간과 같다(86400초)',
    signed.every((c) => c.expires === 86400), signed.map((c) => c.expires).join())
  check('서명에 원본 이름을 실어 준다(한글 파일명)',
    signed[0].download === '2026 계획서.hwp', signed[0].download)
  check('행에 서명 주소가 담긴다', row.files.length === 2 && row.files.every((f) => /^https?:/.test(f.url)),
    JSON.stringify(row.files[0] ?? null))
  check('행에 영구 공개 주소가 들어가지 않는다',
    !JSON.stringify(row.files).includes('/object/public/'), '')
}

// ── 3. 항목 모달의 [🔗 공유 링크] ───────────────────────────
{
  resetStore()
  const item = seedItem()

  // 새 항목에는 걸 대상이 없다 (저장돼야 id 가 생긴다)
  const fresh = mount(React.createElement(ToastProvider, null,
    React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
    })))
  await act(async () => {})
  check('새 항목에는 공유 버튼이 없다', q(fresh.host, '.btn-share') === null)
  act(() => { fresh.root.unmount() })
  window.sessionStorage.clear()

  const m = mount(React.createElement(ToastProvider, null,
    React.createElement(ItemModal, {
      item, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
    })))
  await act(async () => {})
  const btn = q(m.host, '.btn-share')
  check('수정 중인 항목에는 공유 버튼이 있다', !!btn, btn?.textContent)

  await act(async () => { click(btn) })
  check('누르면 공유 창이 뜬다', !!q(m.host, '.share-backdrop'))
  const chips = qa(m.host, '.share-backdrop .chip')
  check('유효기간 3종을 고른다', chips.map((c) => c.textContent).join() === '1일,7일,30일',
    chips.map((c) => c.textContent).join())
  check('기본값은 7일', chips[1].classList.contains('chip-on'))

  // 만들기 전에 미리 말해야 하는 두 줄. 링크를 보낸 뒤에 알면 늦다.
  const caveats = qa(m.host, '.share-caveats li').map((li) => li.textContent)
  check('안내: 이미지 주소에는 만료가 적용되지 않는다',
    caveats.includes('※ 이미지가 포함된 항목은 이미지 주소에 만료가 적용되지 않습니다'),
    caveats.join(' | '))
  check('안내: 나중에 붙인 첨부는 새 링크가 필요하다',
    caveats.includes('※ 링크 생성 후 추가한 첨부는 새 링크를 만들어야 표시됩니다'),
    caveats.join(' | '))

  await act(async () => { click(chips[0]) })    // 1일
  const makeBtn = qa(m.host, '.share-backdrop .btn-primary').at(-1)
  await act(async () => { click(makeBtn) })
  await act(async () => {})

  check('링크가 만들어진다', store.rows.shares.length === 1, store.rows.shares.length)
  const url = q(m.host, '.share-url')?.value ?? ''
  check('만든 주소를 보여 준다', url === shareUrlFor(store.rows.shares[0].id, 'http://localhost'), url)
  check('만들면 곧바로 복사된다', m.host.textContent.includes('복사됨'), '')
  check('1일을 골랐으면 하루짜리',
    Math.round((Date.parse(store.rows.shares[0].expires_at) - Date.now()) / DAY_MS) === 1)
  check('만료일을 적어 준다', m.host.textContent.includes('까지'), '')
  check('열람 전용이라고 적는다', m.host.textContent.includes(VIEW_ONLY_NOTE), '')

  act(() => { m.root.unmount() })
  window.sessionStorage.clear()
}

// ── 4. 받는 사람: 유효 / 만료 / 회수 ────────────────────────
//
// 판정은 두 겹으로 본다.
//   ① 응답 — 비로그인 상태에서 fetchShare 가 item 을 실어 주는가
//   ② 화면 — SharePage 가 무엇을 그리는가
// ①이 참인데 ②만 가리는 구현이라면 그것이 바로 '가짜 만료' 다.
{
  resetStore()
  putFile('item-1/1_aaaaaaaa.hwp')
  const item = seedItem({
    image_url: 'https://fake.local/storage/v1/object/public/archive-images/u1/1-ab.png',
    link_url: 'https://example.com/a',
    files: [{ path: 'item-1/1_aaaaaaaa.hwp', name: '계획서.hwp', size: 2048 }]
  })
  const t0 = Date.UTC(2026, 5, 1)
  store.now = () => t0
  const made = await createShare({ item, userId: 'u1', days: 1, now: t0 })

  // 여기서부터는 '받는 사람' 이다 — 로그인하지 않았다.
  store.anon = true

  // (a) 비로그인은 표를 직접 읽지 못한다
  const { data: itemRows } = await supabase.from('items').select('*')
  check('비로그인: items 를 직접 읽으면 0행', (itemRows ?? []).length === 0, (itemRows ?? []).length)
  const { data: shareRows } = await supabase.from('shares').select('*').eq('id', made.id)
  check('비로그인: 토큰을 알아도 shares 를 읽지 못한다', (shareRows ?? []).length === 0,
    (shareRows ?? []).length)
  const { error: writeErr } = await supabase.from('items').insert({ title: 'x' })
  check('비로그인: 쓰기는 42501 로 막힌다', writeErr?.code === '42501', writeErr?.code)

  // (b) 유효 링크 — 응답
  const okRes = await fetchShare(made.id)
  check('유효: 응답에 항목이 실린다', okRes.ok === true && okRes.item?.title === '학년부 회의록',
    JSON.stringify(okRes.item ?? null)?.slice(0, 40))
  check('유효: 첨부 주소도 함께 온다', (okRes.files ?? []).length === 1)
  check('유효: 소유자 id 는 새어 나가지 않는다',
    !JSON.stringify(okRes).includes('u1') || !('user_id' in (okRes.item ?? {})), '')

  // (b') 유효 링크 — 화면
  let m = mount(React.createElement(SharePage, { token: made.id }))
  await act(async () => {})
  check('유효: 제목이 보인다', m.host.textContent.includes('학년부 회의록'))
  check('유효: 본문이 보인다', m.host.textContent.includes(SECRET))
  check('유효: 태그가 보인다', m.host.textContent.includes('#회의'))
  check('유효: 이미지가 보인다', qa(m.host, '.share-image img').length === 1)
  check('유효: 링크가 보인다', qa(m.host, '.share-links a').length === 1)
  const fileLink = q(m.host, '.share-files .file-open')
  check('유효: 파일을 받을 수 있다', fileLink?.getAttribute('href') === store.rows.shares[0].files[0].url,
    fileLink?.getAttribute('href'))
  check('유효: 파일 이름이 원본 그대로', m.host.textContent.includes('계획서.hwp'))

  /* 🔴 받는 파일의 **저장 이름**을 잰다. 목록에 이름이 잘 보이는 것과, 받았을 때
     그 이름으로 저장되는 것은 다른 일이다 — 실제로 목록은 멀쩡한데 받은 파일만
     '%EC%96%91....hwp' 로 저장되는 버그가 있었다.
     서명 주소는 다른 출처라 <a download> 가 무시되고 서버의 Content-Disposition 이
     이름을 정하는데, Supabase 가 보내는 그 헤더는 괄호·공백이 든 한글 이름에서 깨진다
     (filename* 값이 RFC 5987 범위를 벗어나 브라우저가 앞의 filename= 을 글자 그대로 쓴다).
     그래서 받아서 blob 으로 만들어 저장한다 — blob: 은 같은 출처라 download 가 이긴다.
     여기서는 '무엇을 fetch 했고, 어떤 이름으로 a[download] 를 눌렀는가' 를 본다. */
  const HANGUL = '양식 (최종) 2026 계획서.hwp'
  // 🔴 globalThis.fetch 를 바꾼다. 번들 안의 코드가 부르는 fetch 는 node 의 전역이라,
  //    window.fetch 만 바꾸면 진짜로 fake.local 에 붙으러 나간다(그리고 실패한다).
  const realFetch = globalThis.fetch
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  let fetched = null
  let clicked = null
  globalThis.fetch = async (u) => {
    fetched = String(u)
    return { ok: true, status: 200, async blob() { return { size: 9, type: 'application/octet-stream' } } }
  }
  URL.createObjectURL = () => 'blob:fake/aaa'
  URL.revokeObjectURL = () => {}
  const realClick = window.HTMLAnchorElement.prototype.click
  window.HTMLAnchorElement.prototype.click = function fake() {
    clicked = { href: this.getAttribute('href'), download: this.getAttribute('download') }
  }

  // 한글·공백·괄호가 든 이름으로 다시 그린다 (링크가 굳혀 둔 파일 정보만 바꾼다)
  store.rows.shares[0].files = [{ name: HANGUL, size: 9,
    url: 'https://fake.local/sign/archive-files/it/1_a.hwp?token=T&download=' + encodeURIComponent(HANGUL) }]
  act(() => { m.root.unmount() })
  m = mount(React.createElement(SharePage, { token: made.id }))
  await act(async () => {})
  const dl = q(m.host, '.share-files .file-open')
  check('받기: 목록에는 한글 이름이 그대로', m.host.textContent.includes(HANGUL))
  await act(async () => { click(dl) })
  check('받기: 서명 주소를 직접 받아 온다', fetched === store.rows.shares[0].files[0].url, fetched)
  check('받기: blob 주소로 저장한다 (헤더에 안 기댄다)',
    clicked?.href === 'blob:fake/aaa', JSON.stringify(clicked))
  check('받기: 저장 이름이 한글 원본 그대로', clicked?.download === HANGUL, clicked?.download)
  check('받기: 퍼센트 인코딩이 이름에 새지 않는다',
    !/%[0-9A-F]{2}/i.test(clicked?.download ?? ''), clicked?.download)

  // 받다가 실패하면? 이름이 깨질지언정 파일은 손에 넣어야 한다 — 원래 주소로 연다
  fetched = null; clicked = null
  globalThis.fetch = async () => { throw new Error('offline') }
  await act(async () => { click(q(m.host, '.share-files .file-open')) })
  check('받기: 못 받으면 원래 주소로 열어 준다',
    clicked?.href === store.rows.shares[0].files[0].url, JSON.stringify(clicked))

  globalThis.fetch = realFetch
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
  window.HTMLAnchorElement.prototype.click = realClick
  check('유효: 열람 전용이라고 적혀 있다', m.host.textContent.includes(VIEW_ONLY_NOTE))
  check('열람 전용: 저장·삭제 버튼이 없다',
    !m.host.textContent.includes('삭제') && q(m.host, '.btn-primary') === null)
  check('열람 전용: 편집할 입력칸이 없다',
    q(m.host, 'textarea') === null && q(m.host, 'input') === null)
  act(() => { m.root.unmount() })

  // (c) 만료 — 서버 시각이 지나면
  store.now = () => t0 + DAY_MS + 1000
  const deadRes = await fetchShare(made.id)
  check('만료: 응답이 거부된다', deadRes.ok === false && deadRes.reason === 'expired',
    JSON.stringify(deadRes))
  check('만료: 응답에 항목이 없다', deadRes.item === undefined, JSON.stringify(deadRes))
  check('만료: 응답에 본문 낱말이 없다', !JSON.stringify(deadRes).includes(SECRET))
  check('만료: 첨부 주소도 오지 않는다', deadRes.files === undefined)

  m = mount(React.createElement(SharePage, { token: made.id }))
  await act(async () => {})
  check('만료: "만료된 링크입니다"', m.host.textContent.includes('만료된 링크입니다'))
  check('만료: 본문 낱말이 화면 어디에도 없다', !m.host.textContent.includes(SECRET))
  act(() => { m.root.unmount() })

  // (d) 회수 — 만료 전이라도
  store.now = () => t0
  store.rows.shares[0].revoked = true
  const revRes = await fetchShare(made.id)
  check('회수: 응답이 거부된다', revRes.ok === false && revRes.reason === 'revoked', JSON.stringify(revRes))
  check('회수: 응답에 항목이 없다', revRes.item === undefined)
  check('회수: 응답에 본문 낱말이 없다', !JSON.stringify(revRes).includes(SECRET))

  m = mount(React.createElement(SharePage, { token: made.id }))
  await act(async () => {})
  check('회수: "회수된 링크입니다"', m.host.textContent.includes('회수된 링크입니다'))
  check('회수: 본문 낱말이 화면 어디에도 없다', !m.host.textContent.includes(SECRET))
  act(() => { m.root.unmount() })

  // (e) 없는 토큰 · 휴지통으로 간 항목
  store.rows.shares[0].revoked = false
  const noneRes = await fetchShare('00000000-0000-4000-8000-000000000000')
  check('없는 토큰: 거부', noneRes.ok === false && noneRes.reason === 'not_found')
  store.rows.items[0].deleted_at = new Date(t0).toISOString()
  const trashedRes = await fetchShare(made.id)
  check('휴지통으로 보낸 항목은 링크가 살아 있어도 안 열린다',
    trashedRes.ok === false && trashedRes.reason === 'not_found', JSON.stringify(trashedRes))
  check('휴지통: 응답에 본문 낱말이 없다', !JSON.stringify(trashedRes).includes(SECRET))
  store.rows.items[0].deleted_at = null
  store.anon = false
}

// ── 5. 자리비움 잠금과 무관하게 열린다 ──────────────────────
//
// 받는 사람에게는 PIN 이 없다. 잠금은 Archive 안에 있고 공유 주소는 Archive 를
// 아예 그리지 않으므로, PIN 을 걸어 둔 브라우저에서도 공유 화면은 그대로 열려야 한다.
{
  resetStore()
  const item = seedItem()
  const t0 = Date.UTC(2026, 5, 1)
  store.now = () => t0
  const made = await createShare({ item, userId: 'u1', days: 7, now: t0 })
  store.anon = true

  // 이 브라우저에는 잠금이 걸려 있고, 잠금 유예도 없다
  window.localStorage.setItem('ma:lock:pin:u1', JSON.stringify({
    v: 1, salt: 'aa', iterations: 1000, hash: 'bb'
  }))
  window.localStorage.setItem('ma:lock:enabled:u1', '1')

  dom.reconfigure({ url: `http://localhost/s/${made.id}` })
  let m = mount(React.createElement(ToastProvider, null, React.createElement(App, null)))
  await act(async () => {})
  await act(async () => {})
  check('잠금이 걸린 브라우저에서도 공유 화면이 열린다', m.host.textContent.includes('학년부 회의록'),
    m.host.textContent.slice(0, 60))
  check('공유 화면에는 PIN 입력칸이 없다', q(m.host, '.lock-pin') === null)
  check('공유 화면에는 로그인 칸이 없다', !m.host.textContent.includes('로그인'))
  act(() => { m.root.unmount() })

  // 망가진 토큰은 로그인 화면이 아니라 '찾을 수 없는 링크' 로
  dom.reconfigure({ url: 'http://localhost/s/이건토큰이아니다' })
  m = mount(React.createElement(ToastProvider, null, React.createElement(App, null)))
  await act(async () => {})
  check('망가진 토큰: 찾을 수 없는 링크', m.host.textContent.includes('찾을 수 없는 링크입니다'),
    m.host.textContent.slice(0, 60))
  act(() => { m.root.unmount() })

  dom.reconfigure({ url: 'http://localhost/' })
  window.localStorage.clear()
  store.anon = false
}

// ── 6. 설정 › 공유 중인 링크 (목록·회수) ────────────────────
{
  resetStore()
  const item = seedItem()
  seedItem({ id: 'item-2', title: '지난 학기 자료' })
  const t0 = Date.now()
  const live = await createShare({ item, userId: 'u1', days: 7, now: t0 })
  // 이미 만료된 것과 회수된 것은 '공유 중' 이 아니다
  store.rows.shares.push({
    id: 'expired-token', item_id: 'item-2', user_id: 'u1',
    expires_at: new Date(t0 - 1000).toISOString(), revoked: false, files: [],
    created_at: new Date(t0 - DAY_MS).toISOString()
  })
  store.rows.shares.push({
    id: 'revoked-token', item_id: 'item-2', user_id: 'u1',
    expires_at: new Date(t0 + DAY_MS).toISOString(), revoked: true, files: [],
    created_at: new Date(t0 - DAY_MS).toISOString()
  })

  const rows = await listShares()
  check('목록에는 살아 있는 것만', rows.length === 1 && rows[0].id === live.id, rows.length)
  check('목록에 항목 제목이 붙는다', rows[0].title === '학년부 회의록', rows[0].title)

  const m = mount(React.createElement(Settings, {
    email: 'a@b.c', userId: 'u1', themePref: 'system',
    onThemeChange: () => {}, onOpenPricing: () => {}, onClose: () => {}
  }))
  await act(async () => {})
  check('설정에 공유 중인 링크 칸이 있다', m.host.textContent.includes('공유 중인 링크'))
  check('설정 목록에 항목명이 뜬다', q(m.host, '.share-row-title')?.textContent === '학년부 회의록',
    q(m.host, '.share-row-title')?.textContent)
  check('설정 목록에 만료일이 뜬다', q(m.host, '.share-row-when')?.textContent.includes('까지'),
    q(m.host, '.share-row-when')?.textContent)
  check('만료·회수된 것은 목록에 없다', qa(m.host, '.share-row').length === 1,
    qa(m.host, '.share-row').length)

  confirmAnswer = true
  const revokeBtn = qa(m.host, '.share-row .btn-sm').at(-1)
  check('회수 버튼이 있다', revokeBtn?.textContent === '회수', revokeBtn?.textContent)
  await act(async () => { click(revokeBtn) })
  await act(async () => {})
  check('회수하면 목록에서 사라진다', qa(m.host, '.share-row').length === 0,
    qa(m.host, '.share-row').length)
  check('회수는 행을 지우지 않고 표시만 세운다',
    store.rows.shares.find((r) => r.id === live.id)?.revoked === true)
  act(() => { m.root.unmount() })

  // 회수 뒤에는 받는 사람 쪽에서도 곧바로 끊긴다
  store.anon = true
  const after = await fetchShare(live.id)
  check('회수 뒤: 응답이 거부된다', after.ok === false && after.reason === 'revoked', JSON.stringify(after))
  check('회수 뒤: 응답에 본문 낱말이 없다', !JSON.stringify(after).includes(SECRET))
  store.anon = false
}

// ── 7. 표가 없는 DB (setup.sql 미실행) ──────────────────────
{
  check('없는 함수 오류를 알아본다',
    isMissingShareSchema({ code: 'PGRST202', message: 'Could not find the function public.share_view' }))
  check('없는 표 오류를 알아본다', isMissingShareSchema({ code: '42P01', message: 'relation "shares"' }))
  check('보통 오류는 아니다', isMissingShareSchema({ code: '23505', message: 'duplicate key' }) === false)

  // 설정의 목록은 표가 없으면 통째로 숨는다 (빈 목록으로 보이면 '공유한 적 없음' 으로 읽힌다)
  resetStore()
  const m = mount(React.createElement(Settings, {
    email: 'a@b.c', userId: 'u2', themePref: 'system',
    onThemeChange: () => {}, onOpenPricing: () => {}, onClose: () => {}
  }))
  await act(async () => {})
  check('표가 있으면 빈 목록 안내가 뜬다', m.host.textContent.includes('공유 중인 링크가 없어요'))
  act(() => { m.root.unmount() })
}

// ── 요약 ────────────────────────────────────────────────────
let bad = 0
for (const c of checks) {
  if (!c.ok) bad++
  console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.extra !== undefined ? '  (' + c.extra + ')' : ''))
}
console.log(bad === 0 ? 'ALL PASS (' + checks.length + ')' : bad + ' FAILED of ' + checks.length)
process.exit(bad === 0 ? 0 : 1)
