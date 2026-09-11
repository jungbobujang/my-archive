// scripts/check-space.mjs 가 esbuild 로 묶어 실행한다. 직접 node 로 돌리면 JSX 때문에 실패한다.
//
// 이 점검의 요점은 하나다: **공간은 화면이 아니라 조회가 가른다.**
// 카드가 안 보이는 것만으로는 증거가 되지 않는다 — 화면에서만 걸렀다면 데이터는 이미
// 브라우저에 와 있는 것이고, 그건 서랍이 아니라 커튼이다. 그래서 DOM 과 함께
// **나간 조회에 space 조건이 실렸는지**(store.calls.query)를 같이 본다.
import { JSDOM, VirtualConsole } from 'jsdom'
import { formatBytes } from '../src/supabase.js'
import { DEFAULT_SPACE, MAX_SPACES, newSpaceKey, spaceOf, spaceLabel } from '../src/spaces.js'
import { store, resetStore } from './fake-supabase.mjs'

const vc = new VirtualConsole()
vc.on('jsdomError', () => {})

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc
})
const { window } = dom
for (const k of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'Node', 'File', 'Blob', 'FileList',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'sessionStorage', 'localStorage']) {
  try { globalThis[k] = window[k] } catch { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }) }
}
globalThis.window = window
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const NO_MATCH = (qq) => ({ matches: false, media: String(qq),
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
if (!window.matchMedia) window.matchMedia = NO_MATCH
process.on('unhandledRejection', () => {})
globalThis.fetch = async () => { throw new Error('점검 중에는 바깥으로 나가지 않는다') }

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const act = React.act ?? (await import('react-dom/test-utils')).act
const ItemModal = (await import('../src/components/ItemModal.jsx')).default
const Settings = (await import('../src/components/Settings.jsx')).default
const Trash = (await import('../src/components/Trash.jsx')).default
const { ToastProvider } = await import('../src/components/Toast.jsx')
const Archive = (await import('../src/components/Archive.jsx')).default

let confirmAnswer = true
window.confirm = () => confirmAnswer

const checks = []
const check = (name, cond, extra) => checks.push({ name, ok: !!cond, extra })

const q = (host, sel) => host.querySelector(sel)
const qa = (host, sel) => [...host.querySelectorAll(sel)]
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
const text = (host, sel) => qa(host, sel).map((el) => el.textContent.trim())

function setValue(el, v) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}

function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, root }
}

// 비동기 조회가 여러 겹이라(열 확인 → 공간 목록 → 목록/개수) 몇 번 흘려 준다
const flush = async (n = 6) => {
  for (let i = 0; i < n; i += 1) await act(async () => {})
}

const SPACES = [
  { key: 'personal', name: '개인', icon: '🏠', position: 1 },
  { key: 'class', name: '수업', icon: '🏫', position: 2 }
]

function seedSpaces(rows = SPACES) {
  store.rows.spaces.push(...rows.map((s) => ({ ...s, user_id: 'u1' })))
}

let n = 0
function mkItem(space, title, extra = {}) {
  n += 1
  return {
    id: `i${n}`, user_id: 'u1', title, content: '', tags: [], link_url: null, image_url: null,
    files: [], status: 'none', deleted_at: null, space,
    created_at: new Date(2026, 0, 1).toISOString(), updated_at: new Date(2026, 0, 1).toISOString(),
    ...extra
  }
}

function mkCat(space, id, name) {
  return { id, user_id: 'u1', name, icon: '📁', color: 'gray', parent_id: null, position: 1, space }
}

function freshWorld() {
  resetStore()
  window.localStorage.clear()
  window.sessionStorage.clear()
  n = 0
  seedSpaces()
}

const archiveEl = () => React.createElement(ToastProvider, null,
  React.createElement(Archive, {
    session: { user: { id: 'u1', email: 'a@b.c' } }, onNavigate: () => {}
  }))

// 조회 기록에서 '이 표를 space=키 로 걸러 물었다' 를 찾는다
const askedWithSpace = (table, key) => store.calls.query.some((c) =>
  c.table === table && c.op === 'select' &&
  c.filters.some(([kind, col, val]) => kind === 'eq' && col === 'space' && val === key))

// ── 1. 순수 함수 ────────────────────────────────────────────
{
  check('기본 공간은 personal', DEFAULT_SPACE === 'personal')
  check('최대 5개', MAX_SPACES === 5)
  check('space 가 없는 옛 행은 개인으로 본다', spaceOf({ id: 'x' }) === 'personal')
  check('빈 문자열도 개인으로 본다', spaceOf({ space: '' }) === 'personal')
  check('새 열쇠는 겹치지 않는다', newSpaceKey(SPACES) === 'space-3', newSpaceKey(SPACES))
  check('열쇠가 밀려 있어도 빈자리를 찾는다',
    newSpaceKey([...SPACES, { key: 'space-3' }]) === 'space-4',
    newSpaceKey([...SPACES, { key: 'space-3' }]))
  check('이름표는 아이콘과 이름', spaceLabel(SPACES, 'class') === '🏫 수업', spaceLabel(SPACES, 'class'))
  check('모르는 열쇠도 빈칸으로 두지 않는다',
    spaceLabel(SPACES, 'space-9').includes('space-9'), spaceLabel(SPACES, 'space-9'))
}

// ── 2. 목록·카테고리·태그가 공간마다 갈린다 ─────────────────
//    🔴 A 에서 만든 것이 B 에 '안 보이는' 정도가 아니라, B 를 볼 때 **조회가 A 를
//       애초에 물어보지 않는지** 까지 본다.
{
  freshWorld()
  window.localStorage.setItem('archive-tab', 'archive')
  store.rows.items.push(
    mkItem('personal', '개인 메모 하나', { tags: ['개인태그'] }),
    mkItem('personal', '개인 메모 둘'),
    mkItem('class', '수업 자료 하나', { tags: ['수업태그'] })
  )
  store.rows.categories.push(mkCat('personal', 'c-p', '개인분류'), mkCat('class', 'c-c', '수업분류'))
  store.rows.item_categories.push(
    { item_id: 'i1', category_id: 'c-p', user_id: 'u1' },
    { item_id: 'i3', category_id: 'c-c', user_id: 'u1' }
  )

  const m = mount(archiveEl())
  await flush()

  const titles = () => text(m.host, '.card-title')
  check('개인: 자기 항목만 보인다', titles().length === 2, titles().join(' | '))
  check('개인: 다른 서랍의 항목은 없다', !titles().some((t) => t.includes('수업 자료')), titles().join(' | '))
  check('개인: 조회에 space 조건이 실려 나간다', askedWithSpace('items', 'personal'))
  check('개인: 카테고리도 자기 것만', text(m.host, '.cat-label').join() === '개인분류', text(m.host, '.cat-label').join())
  check('개인: 태그칩도 자기 것만',
    text(m.host, '.tag-row .chip').join() === '#개인태그', text(m.host, '.tag-row .chip').join())
  check('전환기가 지금 서랍을 적는다',
    q(m.host, '.space-name')?.textContent.trim() === '개인', q(m.host, '.space-name')?.textContent)
  check('전체 개수도 공간 것만 센다',
    q(m.host, '.list-title')?.textContent.includes('2개'), q(m.host, '.list-title')?.textContent)

  // 서랍 바꾸기
  await act(async () => { click(q(m.host, '.space-current')) })
  const opts = qa(m.host, '.space-opt')
  check('메뉴에 공간 2개 + 관리', opts.length === 3, opts.length)
  await act(async () => { click(opts[1]) })
  await flush()

  check('수업: 자기 항목만 보인다', text(m.host, '.card-title').join() === '수업 자료 하나',
    text(m.host, '.card-title').join())
  check('수업: 조회에 space=class 가 실려 나간다', askedWithSpace('items', 'class'))
  check('수업: 카테고리가 바뀐다', text(m.host, '.cat-label').join() === '수업분류', text(m.host, '.cat-label').join())
  check('수업: 태그칩이 바뀐다',
    text(m.host, '.tag-row .chip').join() === '#수업태그', text(m.host, '.tag-row .chip').join())
  check('고른 서랍을 기기가 기억한다',
    window.localStorage.getItem('archive-space:u1') === 'class',
    window.localStorage.getItem('archive-space:u1'))

  // 빠른 저장은 지금 서랍에 들어간다
  await act(async () => { setValue(q(m.host, '.quick-row input'), '수업에서 적은 한 줄') })
  await act(async () => {
    q(m.host, '.quick-row').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
  const saved = store.rows.items.find((r) => r.title === '수업에서 적은 한 줄')
  check('빠른 저장이 지금 서랍에 들어간다', saved?.space === 'class', saved?.space)

  // 오늘 탭도 같은 서랍만 본다
  await act(async () => { click(qa(m.host, '.tab')[0]) })
  await flush()
  const todayTitles = text(m.host, '.today-title')
  check('오늘 탭: 다른 서랍의 항목이 섞이지 않는다',
    todayTitles.length > 0 && !todayTitles.some((t) => t.includes('개인 메모')),
    todayTitles.join(' | '))
  check('오늘 탭: 자기 서랍 것은 보인다', todayTitles.some((t) => t.includes('수업 자료')), todayTitles.join(' | '))

  act(() => { m.root.unmount() })
}

// ── 3. 검색도 공간 안에서만 ─────────────────────────────────
{
  freshWorld()
  window.localStorage.setItem('archive-tab', 'archive')
  window.localStorage.setItem('archive-space:u1', 'personal')
  store.rows.items.push(mkItem('personal', '같은 이름 메모'), mkItem('class', '같은 이름 메모'))

  const m = mount(archiveEl())
  await flush()
  await act(async () => { setValue(q(m.host, '.search-box input'), '같은 이름') })
  await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
  await flush()

  check('검색 결과가 공간 안에서만 나온다', text(m.host, '.card-title').length === 1,
    text(m.host, '.card-title').length)
  // 목록 조회(select('*'))만 본다 — 휴지통 개수는 일부러 공간을 가리지 않는다(통합)
  const listQ = store.calls.query.filter((c) => c.table === 'items' && c.op === 'select' && c.cols === '*')
  check('검색 조회에도 space 조건이 함께 간다',
    listQ.length > 0 && listQ.every((c) => c.filters.some(([kind, col]) => kind === 'eq' && col === 'space')),
    listQ.length)
  act(() => { m.root.unmount() })
}

// ── 4. 항목을 다른 공간으로 옮긴다 ──────────────────────────
//    소속(카테고리)은 따라가지 않는다 — 카테고리가 공간마다 따로이기 때문이다.
{
  freshWorld()
  const item = mkItem('personal', '옮겨질 항목')
  store.rows.items.push(item)
  store.rows.item_categories.push({ item_id: item.id, category_id: 'c-p', user_id: 'u1' })
  const cats = [mkCat('personal', 'c-p', '개인분류'), mkCat('class', 'c-c', '수업분류')]

  let savedCalled = 0
  const m = mount(React.createElement(ItemModal, {
    item, categories: cats, slots: [], spaces: SPACES, space: 'personal', userId: 'u1',
    onClose: () => {}, onSaved: () => { savedCalled += 1 }
  }))
  await flush(2)

  const chips = () => qa(m.host, '.field .cat-select .chip').map((el) => el.textContent.trim())
  check('모달에 공간 칩이 있다', chips().some((t) => t.includes('개인')) && chips().some((t) => t.includes('수업')),
    chips().join(' | '))
  check('처음에는 자기 공간의 카테고리만 보인다',
    chips().some((t) => t.includes('개인분류')) && !chips().some((t) => t.includes('수업분류')),
    chips().join(' | '))

  const spaceChip = (name) => qa(m.host, '.field .cat-select .chip').find((el) => el.textContent.trim().endsWith(name))
  await act(async () => { click(spaceChip('수업')) })
  check('옮긴다는 것을 미리 알린다', m.host.textContent.includes('공간으로 옮겨집니다'))
  check('옮기면 그 공간의 카테고리로 바뀐다',
    chips().some((t) => t.includes('수업분류')) && !chips().some((t) => t.includes('개인분류')),
    chips().join(' | '))

  await act(async () => { click(q(m.host, '.modal-foot .btn-primary') ?? qa(m.host, '.btn-primary').pop()) })
  await flush()

  const moved = store.rows.items.find((r) => r.id === item.id)
  check('저장하면 space 가 바뀐다', moved?.space === 'class', moved?.space)
  check('저장은 한 번에 끝난다', savedCalled === 1, savedCalled)
  check('옛 소속은 따라가지 않는다',
    store.rows.item_categories.filter((r) => r.item_id === item.id).length === 0,
    store.rows.item_categories.length)
  act(() => { m.root.unmount() })
}

// ── 5. 새 항목은 지금 서랍에 생긴다 ─────────────────────────
{
  freshWorld()
  const m = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], spaces: SPACES, space: 'class', userId: 'u1',
    onClose: () => {}, onSaved: () => {}
  }))
  await flush(2)
  await act(async () => { setValue(q(m.host, '.field input'), '새로 적은 것') })
  await act(async () => { click(qa(m.host, '.btn-primary').pop()) })
  await flush()
  check('새 항목이 지금 서랍에 들어간다', store.rows.items[0]?.space === 'class', store.rows.items[0]?.space)
  act(() => { m.root.unmount() })
}

// ── 6. 저장소 게이지: 공간별 합 = 전체 ──────────────────────
{
  freshWorld()
  const MB = 1024 * 1024
  store.rows.items.push(
    mkItem('personal', '개인 파일', { files: [{ path: 'a/1.pdf', name: '1.pdf', size: 3 * MB }] }),
    mkItem('class', '수업 파일', { files: [{ path: 'b/2.pdf', name: '2.pdf', size: 5 * MB }] })
  )
  store.buckets['archive-images'].set('u1/1-a.png', { size: 2 * MB })

  const m = mount(React.createElement(Settings, {
    email: 'a@b.c', userId: 'u1', themePref: 'system', onThemeChange: () => {},
    spaces: SPACES, space: 'personal', onSpacesChanged: () => {},
    onOpenPricing: () => {}, onClose: () => {}
  }))
  await flush()

  const value = q(m.host, '.set-value')?.textContent ?? ''
  check('게이지: 전체는 파일+이미지 합계', value.includes(`저장소 ${formatBytes(10 * MB)}`), value)
  const rows = text(m.host, '.space-usage li')
  check('게이지: 공간별로 한 줄씩', rows.length === 2, rows.join(' | '))
  check('게이지: 개인 파일 3MB', rows[0]?.includes(formatBytes(3 * MB)), rows[0])
  check('게이지: 수업 파일 5MB', rows[1]?.includes(formatBytes(5 * MB)), rows[1])
  check('게이지: 공간별 합이 파일 합계와 같다',
    value.includes(`파일 ${formatBytes(8 * MB)}`), value)
  check('게이지: 이미지는 공간별로 나눌 수 없다고 적는다',
    m.host.textContent.includes('공간별로는 첨부 파일만'))
  act(() => { m.root.unmount() })
}

// ── 7. 공간 만들기·이름 바꾸기 (설정) ───────────────────────
{
  freshWorld()
  let changed = 0
  const settings = (list) => React.createElement(Settings, {
    email: 'a@b.c', userId: 'u1', themePref: 'system', onThemeChange: () => {},
    spaces: list, space: 'personal', onSpacesChanged: () => { changed += 1 },
    onOpenPricing: () => {}, onClose: () => {}
  })

  let m = mount(settings(SPACES))
  await flush()
  const nameInput = q(m.host, 'input[aria-label="새 공간 이름"]')
  check('설정: 새 공간 칸이 있다', !!nameInput)
  await act(async () => { setValue(nameInput, '연구회') })
  await act(async () => {
    q(m.host, '.cm-add').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
  const made = store.rows.spaces.find((s) => s.name === '연구회')
  check('설정: 새 공간이 만들어진다', !!made && made.key === 'space-3', made?.key)
  check('설정: 만들면 바깥에 알린다', changed === 1, changed)

  // 이름 바꾸기
  const first = qa(m.host, '.cm-name')[0]
  await act(async () => { setValue(first, '내 서랍') })
  await act(async () => { first.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })) })
  await flush()
  check('설정: 이름을 바꾼다',
    store.rows.spaces.find((s) => s.key === 'personal')?.name === '내 서랍',
    store.rows.spaces.find((s) => s.key === 'personal')?.name)
  check('설정: 지우기 버튼은 두지 않았다', !m.host.textContent.includes('공간 삭제'))
  act(() => { m.root.unmount() })

  // 5개가 차면 더 만들 수 없다
  const five = Array.from({ length: MAX_SPACES }, (_, i) => ({
    key: `k${i}`, name: `공간${i}`, icon: '🗂', position: i + 1
  }))
  m = mount(settings(five))
  await flush()
  check('설정: 5개가 차면 입력칸이 잠긴다',
    q(m.host, 'input[aria-label="새 공간 이름"]')?.disabled === true)
  check('설정: 왜 잠겼는지 적는다',
    q(m.host, 'input[aria-label="새 공간 이름"]')?.placeholder.includes(`최대 ${MAX_SPACES}개`),
    q(m.host, 'input[aria-label="새 공간 이름"]')?.placeholder)
  act(() => { m.root.unmount() })
}

// ── 8. 휴지통은 전 공간 통합 ────────────────────────────────
{
  freshWorld()
  store.rows.items.push(
    mkItem('personal', '지운 개인 것', { deleted_at: new Date(2026, 0, 2).toISOString() }),
    mkItem('class', '지운 수업 것', { deleted_at: new Date(2026, 0, 3).toISOString() })
  )
  const m = mount(React.createElement(Trash, {
    spaces: SPACES, onClose: () => {}, onChanged: () => {}
  }))
  await flush()

  const titles = text(m.host, '.trash-title')
  check('휴지통: 두 서랍의 것이 함께 보인다', titles.length === 2, titles.join(' | '))
  const badges = text(m.host, '.trash-space')
  check('휴지통: 줄마다 어느 서랍인지 적는다',
    badges.length === 2 && badges.some((b) => b.includes('개인')) && badges.some((b) => b.includes('수업')),
    badges.join(' | '))
  check('휴지통: 모든 공간이라고 알린다', m.host.textContent.includes('모든 공간'))
  act(() => { m.root.unmount() })
}

// ── 9. space 열이 아직 없는 DB (SQL 미실행) ─────────────────
//    🔴 여기서 앱이 멈추면 안 된다. SQL 은 사람이 직접 실행하고, 그 사이에도
//       목록·검색·저장은 예전 그대로 돌아야 한다.
{
  freshWorld()
  store.rows.spaces.length = 0
  store.missingSpaceColumn = true
  window.localStorage.setItem('archive-tab', 'archive')
  store.rows.items.push(
    { ...mkItem('personal', '옛 항목 하나'), space: undefined },
    { ...mkItem('personal', '옛 항목 둘'), space: undefined }
  )

  const m = mount(archiveEl())
  await flush()

  check('열이 없으면 전환기를 숨긴다', q(m.host, '.space-switch') === null)
  check('열이 없으면 그 사실을 한 줄로 알린다',
    m.host.textContent.includes('supabase/setup.sql'), q(m.host, '.space-note')?.textContent)
  check('열이 없어도 목록은 그대로 나온다', text(m.host, '.card-title').length === 2,
    text(m.host, '.card-title').join(' | '))
  check('열이 없으면 space 조건을 붙이지 않는다',
    !store.calls.query.some((c) => c.table === 'items' && c.op === 'select' &&
      c.filters.some(([kind, col]) => kind === 'eq' && col === 'space')))

  await act(async () => { setValue(q(m.host, '.quick-row input'), '열 없이도 저장') })
  await act(async () => {
    q(m.host, '.quick-row').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
  const saved = store.rows.items.find((r) => r.title === '열 없이도 저장')
  check('열이 없어도 저장은 된다', !!saved)
  check('열이 없으면 space 를 보내지 않는다', saved && !('space' in saved))
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
