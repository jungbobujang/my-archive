// scripts/check-modals.mjs 가 esbuild 로 묶어 실행한다. 직접 node 로 돌리면 JSX 때문에 실패한다.
import { JSDOM } from 'jsdom'
import { parseLinks } from '../src/supabase.js'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
const { window } = dom
for (const k of ['document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent','KeyboardEvent','FocusEvent','Node','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','sessionStorage','localStorage']) {
  try { globalThis[k] = window[k] } catch { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }) }
}
globalThis.window = window
globalThis.IS_REACT_ACT_ENVIRONMENT = true
process.on('unhandledRejection', () => {}) // 휴지통은 마운트할 때 supabase 를 부른다 (여기선 null)

// react-dom 은 이 아래에서 불러야 한다 — 먼저 부르면 DOM 이 없는 환경으로 굳는다
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const act = React.act ?? (await import('react-dom/test-utils')).act
const ItemModal = (await import('../src/components/ItemModal.jsx')).default
const Settings = (await import('../src/components/Settings.jsx')).default
const CategoryManager = (await import('../src/components/CategoryManager.jsx')).default
const SlotManager = (await import('../src/components/SlotManager.jsx')).default
const Trash = (await import('../src/components/Trash.jsx')).default

let confirmAnswer = true
let confirmCount = 0
window.confirm = () => { confirmCount++; return confirmAnswer }

const checks = []
const check = (name, cond, extra) => checks.push({ name, ok: !!cond, extra })

// ── 링크 파싱 ────────────────────────────────────────────────
for (const [input, want] of [
  ['https://youtu.be/abc  https://x.com/y', 2],
  ['youtu.be/abc', 1],
  ['youtube.com/watch?v=1, naver.com', 2],
  ['그냥 글자 입니다.', 0],
  ['https://a.com https://a.com', 1],
  ['안녕하세요. 반갑습니다', 0]
]) {
  const got = parseLinks(input)
  check('parseLinks: ' + JSON.stringify(input), got.length === want, got.length)
}

// ── 새 항목 모달: 링크 담기·빼기, 임시본, 닫힘 방지 ──────────
{
const container = document.getElementById('root')
const root = createRoot(container)
let closed = 0

act(() => {
  root.render(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => { closed++ }, onSaved: () => {}
  }))
})

const q = (sel) => container.querySelector(sel)
const qa = (sel) => [...container.querySelectorAll(sel)]
const linkInput = () => q('input[aria-label="링크 추가"]')
const rows = () => qa('.link-row')

function setValue(el, v) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, v)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}
const press = (el, key) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
const blur = (el) => el.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))

// ① 스킴 없는 링크를 Enter 로 담기
act(() => { setValue(linkInput(), 'youtu.be/aaa') })
act(() => { press(linkInput(), 'Enter') })
check('Enter 로 링크 1개 담김', rows().length === 1, rows().length)
check('스킴을 붙여 저장', rows()[0] && rows()[0].querySelector('a').href.startsWith('https://youtu.be/aaa'))
check('담은 뒤 입력칸이 비었다', linkInput().value === '')

// ② 여러 개를 한 번에 붙여넣고 '추가' 버튼으로 담기
act(() => { setValue(linkInput(), 'https://a.com/1 https://b.com/2, naver.com/x') })
const addBtn = qa('.link-add button')[0]
act(() => { click(addBtn) })
check('한 번에 3개 더 담김 (총 4개)', rows().length === 4, rows().length)

// ③ 중복은 담기지 않는다
act(() => { setValue(linkInput(), 'https://a.com/1') })
act(() => { press(linkInput(), 'Enter') })
check('중복 링크는 늘지 않는다', rows().length === 4, rows().length)

// ④ ✕ 로 한 개 빼기
const before = rows().map((r) => r.querySelector('a').href)
act(() => { click(rows()[1].querySelector('.link-x')) })
check('✕ 로 1개 빠짐', rows().length === 3, rows().length)
check('빠진 것은 누른 그 줄', !rows().map((r) => r.querySelector('a').href).includes(before[1]))

// ⑤ 포커스가 빠져도 쳐 둔 링크는 목록으로
act(() => { setValue(linkInput(), 'https://later.com/z') })
check('아직 목록에는 없다', rows().length === 3)
check('입력 중 안내가 뜬다', container.textContent.includes('입력 중인 링크 1개'))
act(() => { blur(linkInput()) })
check('포커스가 빠지면 목록으로 들어간다', rows().length === 4, rows().length)

// ⑥ 임시본이 sessionStorage 에 쌓인다
const draft = JSON.parse(window.sessionStorage.getItem('ma:draft:new') || 'null')
check('임시본 저장됨', !!draft)
check('임시본에 링크 4개', draft && draft.links.length === 4, draft && draft.links.length)

// ⑦ 배경을 눌러도 닫히지 않는다
const backdrop = container.querySelector('.modal-backdrop')
act(() => { backdrop.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
act(() => { click(backdrop) })
check('배경 클릭으로 닫히지 않는다', closed === 0, closed)

// ⑧ 다른 창에 갔다 와도 그대로
act(() => {
  window.dispatchEvent(new window.Event('blur'))
  document.dispatchEvent(new window.Event('visibilitychange'))
  window.dispatchEvent(new window.Event('focus'))
})
check('창을 옮겨도 모달이 그대로', !!container.querySelector('.modal') && closed === 0)
check('창을 옮겨도 링크 4개 그대로', rows().length === 4, rows().length)

// ⑨ Esc — 내용이 있으면 한 번 묻고, 아니라고 하면 안 닫힌다
confirmAnswer = false
act(() => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })) })
check('Esc: 한 번 물어본다', confirmCount === 1, confirmCount)
check('Esc: 취소하면 안 닫힌다', closed === 0, closed)
confirmAnswer = true
act(() => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })) })
check('Esc: 그렇다고 하면 닫힌다', closed === 1, closed)
check('Esc: 물어본 것은 두 번뿐', confirmCount === 2, confirmCount)

// ⑩ 다시 열면(새로고침 흉내) 임시본이 되살아난다
closed = 0
act(() => { root.render(null) })
const root2 = createRoot(container.ownerDocument.getElementById('root'))
act(() => {
  root2.render(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => { closed++ }, onSaved: () => {}
  }))
})
check('다시 열면 링크가 되살아난다', rows().length === 4, rows().length)
check('되살렸다는 안내가 뜬다', container.textContent.includes('작성 중이던 내용을 되살렸어요'))

// ⑪ '새로 쓰기' 로 임시본 버리기
const discard = qa('.draft-note button')[0]
act(() => { click(discard) })
check('새로 쓰기: 링크가 비워진다', rows().length === 0, rows().length)
check('새로 쓰기: 임시본도 지워진다', window.sessionStorage.getItem('ma:draft:new') === null)

}

// ── 나머지 모달 4개: 배경 클릭·Esc ──────────────────────────
{
const cats = [{ id: 'c1', name: '테스트', icon: '📁', color: 'teal', parent_id: null, position: 0 }]
const slots = [{ id: 's1', name: '아침', icon: '🌅', position: 0 }]

function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, root }
}
const press = (target, key) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
function setValue(el, v) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, v)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}

// 배경 클릭으로 닫히지 않는지 — 모달 4개 전부
const cases = [
  ['설정', (onClose) => React.createElement(Settings, { email: 'a@b.c', themePref: 'system', onThemeChange: () => {}, onOpenPricing: () => {}, onClose })],
  ['카테고리 관리', (onClose) => React.createElement(CategoryManager, { categories: cats, userId: 'u', onClose, onChanged: () => {} })],
  ['시간대 관리', (onClose) => React.createElement(SlotManager, { slots, userId: 'u', onClose, onChanged: () => {} })],
  ['휴지통', (onClose) => React.createElement(Trash, { onClose, onChanged: () => {} })]
]

for (const [label, make] of cases) {
  let closed = 0
  const { host, root } = mount(make(() => { closed++ }))
  const backdrop = host.querySelector('.modal-backdrop')
  check(label + ': 배경 요소가 있다', !!backdrop)
  act(() => {
    backdrop.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
    click(backdrop)
  })
  check(label + ': 배경을 눌러도 안 닫힌다', closed === 0, closed)
  act(() => { window.dispatchEvent(new window.Event('blur')) })
  check(label + ': 다른 창에 갔다 와도 그대로', !!host.querySelector('.modal') && closed === 0)
  act(() => { press(window, 'Escape') })
  check(label + ': Esc 로는 닫힌다', closed === 1, closed)
  act(() => { root.unmount() })
}

// 카테고리·시간대: 쓰던 이름이 있으면 Esc 가 한 번 묻는다
for (const [label, make, inputLabel] of [
  ['카테고리 관리', (onClose) => React.createElement(CategoryManager, { categories: cats, userId: 'u', onClose, onChanged: () => {} }), '새 카테고리 이름'],
  ['시간대 관리', (onClose) => React.createElement(SlotManager, { slots, userId: 'u', onClose, onChanged: () => {} }), '새 시간대 이름']
]) {
  let closed = 0
  confirmCount = 0
  const { host, root } = mount(make(() => { closed++ }))
  const input = host.querySelector('input[aria-label="' + inputLabel + '"]')
  check(label + ': 새 이름 입력칸이 있다', !!input)
  if (input) {
    act(() => { setValue(input, '쓰던 이름') })
    confirmAnswer = false
    act(() => { press(window, 'Escape') })
    check(label + ': 쓰던 이름이 있으면 물어본다', confirmCount === 1, confirmCount)
    check(label + ': 취소하면 안 닫힌다', closed === 0, closed)
    confirmAnswer = true
    act(() => { press(window, 'Escape') })
    check(label + ': 그렇다고 하면 닫힌다', closed === 1, closed)
  }
  act(() => { root.unmount() })
}

// 아이콘 고르개가 열려 있으면 Esc 는 그것부터 닫는다
{
  let closed = 0
  confirmCount = 0
  const { host, root } = mount(React.createElement(CategoryManager, { categories: cats, userId: 'u', onClose: () => { closed++ }, onChanged: () => {} }))
  const iconBtn = host.querySelector('.cm-icon')
  act(() => { click(iconBtn) })
  check('카테고리: 아이콘 고르개가 열린다', !!host.querySelector('.cm-icons'))
  act(() => { press(window, 'Escape') })
  check('카테고리: Esc 가 고르개만 닫는다', !host.querySelector('.cm-icons') && closed === 0, closed)
  act(() => { press(window, 'Escape') })
  check('카테고리: 한 번 더 누르면 모달이 닫힌다', closed === 1, closed)
  act(() => { root.unmount() })
}

}

// ── 요약 ────────────────────────────────────────────────────
let bad = 0
for (const c of checks) {
  if (!c.ok) bad++
  console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.extra !== undefined ? '  (' + c.extra + ')' : ''))
}
console.log(bad === 0 ? 'ALL PASS (' + checks.length + ')' : bad + ' FAILED of ' + checks.length)
process.exit(bad === 0 ? 0 : 1)
