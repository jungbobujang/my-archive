// scripts/check-modals.mjs 가 esbuild 로 묶어 실행한다. 직접 node 로 돌리면 JSX 때문에 실패한다.
import { JSDOM } from 'jsdom'
import { parseLinks, DRAFT_DEBOUNCE_MS } from '../src/supabase.js'

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
// 초안은 '입력이 멈춘 뒤' 에 쓴다(디바운스). 그래서 여기서 한 박자 기다린다 —
// 링크가 늘면 효과가 한 번 더 도므로 넉넉히 두 박자를 준다.
await act(async () => { await new Promise((r) => setTimeout(r, DRAFT_DEBOUNCE_MS * 2 + 200)) })
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

// ── 자리비움 잠금 ────────────────────────────────────────────
{
const lock = await import('../src/lock.js')
const LockScreen = (await import('../src/components/LockScreen.jsx')).default
const U = 'lock-test-user'

function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, root }
}
function setValue(el, v) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, v)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

// PBKDF2 는 일부러 느리게 만든 계산이라 상태가 곧바로 바뀌지 않는다.
// 정해진 시간을 기다리는 대신, 바라는 상태가 될 때까지 짧게 되물어본다.
async function settle(pred, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if (pred()) return true
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  }
  return pred()
}

for (const name of ['pin', 'enabled', 'fails', 'grace', 'minutes']) {
  localStorage.removeItem(`ma:lock:${name}:${U}`)
}

// ── PIN 규칙과 보관 ──────────────────────────────────────────
check('PIN: 4자리 숫자만 통과',
  lock.isValidPin('1234') && !lock.isValidPin('123') &&
  !lock.isValidPin('12345') && !lock.isValidPin('12a4') && !lock.isValidPin(''))

const base = lock.readLockConfig(U)
check('잠금 기본값: PIN 없음 · 꺼짐', base.pinSet === false && base.enabled === false)
check('유예시간 기본 15분', base.minutes === 15, base.minutes)

await lock.savePin(U, '2468')
const raw = localStorage.getItem(`ma:lock:pin:${U}`)
check('PIN 을 평문으로 두지 않는다', !!raw && !raw.includes('2468'))
check('PBKDF2 를 20만 번 돌린 기록이 남는다',
  JSON.parse(raw).iterations === lock.PBKDF2_ITERATIONS, JSON.parse(raw).iterations)

// 같은 PIN 이라도 소금이 다르면 저장된 값이 달라야 한다 (같으면 미리 계산한 표로 뚫린다)
const firstHash = JSON.parse(raw).hash
await lock.savePin(U, '2468')
const second = JSON.parse(localStorage.getItem(`ma:lock:pin:${U}`))
check('소금이 매번 새로 뽑힌다', second.hash !== firstHash && second.salt.length === 32)

check('맞는 PIN 은 통과', (await lock.verifyPin(U, '2468')) === true)
check('틀린 PIN 은 거절', (await lock.verifyPin(U, '1357')) === false)
check('자릿수가 모자라면 거절', (await lock.verifyPin(U, '246')) === false)

// ── 기기 스위치 ──────────────────────────────────────────────
check('PIN 을 걸어도 자동 잠금은 여전히 꺼져 있다', lock.readLockConfig(U).enabled === false)
lock.writeEnabled(U, true)
check('기기에서 켜면 켜진다', lock.readLockConfig(U).enabled === true)
lock.writeIdleMinutes(U, 30)
check('유예시간 30분을 고를 수 있다', lock.readLockConfig(U).minutes === 30)
lock.writeIdleMinutes(U, 7)
check('없는 값은 기본 15분으로 돌아간다', lock.readLockConfig(U).minutes === 15)
lock.writeIdleMinutes(U, 5)

// ── 해제 뒤 유예 ─────────────────────────────────────────────
lock.endGrace(U)
check('처음에는 유예가 없다', lock.inGrace(U) === false)
lock.startGrace(U)
check('풀고 나면 유예가 걸린다', lock.inGrace(U) === true)
check('유예는 2시간짜리', Math.abs(lock.graceUntil(U) - Date.now() - lock.GRACE_MS) < 5000)
check('2시간 뒤에는 풀린다', lock.inGrace(U, Date.now() + lock.GRACE_MS + 1000) === false)
lock.endGrace(U)
check('수동 잠금은 유예를 걷어낸다', lock.inGrace(U) === false)

// ── 실패 횟수 ────────────────────────────────────────────────
lock.resetFails(U)
check('실패 횟수는 0 에서 시작', lock.readFails(U) === 0)
check('한 번 틀리면 1', lock.bumpFail(U) === 1)
check('열 번째에 상한', (() => { let n = 1; while (n < lock.MAX_FAILS) n = lock.bumpFail(U); return n })() === 10)
lock.resetFails(U)

// PIN 을 지우면 켜 둔 것도 실패 횟수도 같이 사라져야 한다
lock.writeEnabled(U, true)
lock.bumpFail(U)
lock.clearPin(U)
const cleared = lock.readLockConfig(U)
check('PIN 을 지우면 기능이 통째로 꺼진다',
  cleared.pinSet === false && cleared.enabled === false && lock.readFails(U) === 0)

// ── 잠금 화면 ────────────────────────────────────────────────
await lock.savePin(U, '1111')
lock.resetFails(U)
lock.endGrace(U)
{
  let unlocked = 0
  const { host, root } = mount(React.createElement(LockScreen, {
    userId: U, onUnlock: () => { unlocked++ }
  }))
  const pinInput = () => host.querySelector('.lock-pin')

  check('잠금 화면: PIN 칸이 있다', !!pinInput())
  check('잠금 화면: 값이 가려진다', pinInput().type === 'password')
  check('잠금 화면: 폰 숫자판이 올라온다', pinInput().getAttribute('inputmode') === 'numeric')
  check('잠금 화면: 본문이 함께 그려지지 않는다',
    host.querySelectorAll('.item-card, .archive, .topbar').length === 0)

  // 숫자가 아닌 것은 애초에 들어가지 않는다
  act(() => { setValue(pinInput(), 'ab12') })
  check('잠금 화면: 숫자만 받는다', pinInput().value === '12', pinInput().value)

  // 틀린 PIN — 자리를 채우면 알아서 확인하고, 틀리면 비우고 남은 횟수를 알린다
  act(() => { setValue(pinInput(), '9999') })
  await settle(() => host.textContent.includes('맞지 않아요'))
  check('잠금 화면: 틀리면 알려 준다', host.textContent.includes('맞지 않아요'))
  check('잠금 화면: 틀린 뒤 칸이 비워진다', pinInput().value === '')
  check('잠금 화면: 남은 횟수를 센다', host.textContent.includes('9번 더'), host.textContent.trim().slice(0, 80))
  check('잠금 화면: 실패가 기록된다', lock.readFails(U) === 1, lock.readFails(U))
  check('잠금 화면: 틀려도 열리지 않는다', unlocked === 0)

  // 맞는 PIN
  act(() => { setValue(pinInput(), '1111') })
  await settle(() => unlocked > 0)
  check('잠금 화면: 맞으면 열린다', unlocked === 1, unlocked)
  check('잠금 화면: 열리면 실패 횟수가 0 으로', lock.readFails(U) === 0)
  check('잠금 화면: 열리면 유예가 걸린다', lock.inGrace(U) === true)

  act(() => { root.unmount() })
}

// 열 번 틀리면 PIN 을 그만 묻고 로그인부터 다시 받는다
{
  lock.resetFails(U)
  lock.endGrace(U)
  // MAX_FAILS 직전까지는 이미 틀린 것으로 해 두고, 마지막 한 번만 화면에서 틀려 본다
  while (lock.readFails(U) < lock.MAX_FAILS - 1) lock.bumpFail(U)

  const { host, root } = mount(React.createElement(LockScreen, {
    userId: U, onUnlock: () => {}
  }))
  act(() => { setValue(host.querySelector('.lock-pin'), '9999') })
  await settle(() => lock.readFails(U) === 0)
  // signOut 은 supabase 가 null 이라 실제로 불리지 않는다. 여기서 보는 것은
  // '상한에 닿으면 횟수를 0 으로 돌려 다음 사람에게 물려주지 않는다' 는 것.
  check('열 번 틀리면 셈을 0 으로 돌린다', lock.readFails(U) === 0, lock.readFails(U))
  act(() => { root.unmount() })
}

// ── 설정 화면의 잠금 칸 ──────────────────────────────────────
{
  lock.clearPin(U)
  const { host, root } = mount(React.createElement(Settings, {
    email: 'a@b.c', userId: U, themePref: 'system',
    onThemeChange: () => {}, onOpenPricing: () => {}, onLockChanged: () => {}, onClose: () => {}
  }))
  const labels = () => [...host.querySelectorAll('button')].map((b) => b.textContent.trim())

  check('설정: PIN 이 없으면 등록 버튼만', labels().includes('PIN 등록'))
  check('설정: PIN 이 없으면 기기 스위치가 없다', !host.querySelector('.lock-toggle'))

  act(() => { click([...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'PIN 등록')) })
  const fields = host.querySelectorAll('.lock-field input')
  check('설정: 등록은 두 번 넣게 한다', fields.length === 2, fields.length)

  // 두 번 넣은 값이 다르면 저장하지 않는다
  act(() => { setValue(fields[0], '1234') })
  act(() => { setValue(fields[1], '5678') })
  act(() => { click([...host.querySelectorAll('button')].find((b) => b.textContent.trim() === '저장')) })
  await settle(() => host.textContent.includes('서로 달라요'))
  check('설정: 두 번 넣은 PIN 이 다르면 막는다',
    host.textContent.includes('서로 달라요') && lock.isPinSet(U) === false)

  act(() => { setValue(host.querySelectorAll('.lock-field input')[1], '1234') })
  act(() => { click([...host.querySelectorAll('button')].find((b) => b.textContent.trim() === '저장')) })
  await settle(() => lock.isPinSet(U))
  check('설정: 같으면 저장된다', lock.isPinSet(U) === true)
  await settle(() => !!host.querySelector('.lock-toggle'))
  check('설정: 저장 뒤 기기 스위치가 나온다', !!host.querySelector('.lock-toggle'))
  check('설정: 스위치는 꺼진 채로 나온다', host.querySelector('.lock-toggle input').checked === false)

  act(() => { click(host.querySelector('.lock-toggle input')) })
  check('설정: 켜면 이 기기에 켜진다', lock.readLockConfig(U).enabled === true)

  const chips = [...host.querySelectorAll('[aria-label="잠기기까지 기다리는 시간"] .chip')]
  check('설정: 5·15·30분 세 가지', chips.map((c) => c.textContent.trim()).join(' ') === '5분 15분 30분',
    chips.map((c) => c.textContent.trim()).join(' '))
  act(() => { click(chips[2]) })
  check('설정: 고른 시간이 저장된다', lock.readLockConfig(U).minutes === 30)

  act(() => { root.unmount() })
  lock.clearPin(U)
}

// ── 잠겼을 때 본문을 '가리는' 것이 아니라 '안 그리는' 것 ──────
// 이 규칙이 무너지면 반투명으로 덮기만 해도 점검이 통과해 버린다.
// 실제 화면은 스크린샷으로 한 번 더 봐야 한다 (REPORT-LOCK.md 에 적어 두었다).
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'Archive.jsx'), 'utf8')
  const early = src.indexOf('if (locked) {')
  const body = src.indexOf('<div className="archive">')
  check('Archive: 잠기면 본문보다 먼저 빠져나간다', early > 0 && body > 0 && early < body, `${early} < ${body}`)
  check('Archive: 내보내기가 잠금을 확인한다', src.includes('if (lockedRef.current) return'))

  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'styles.css'), 'utf8')
  const rule = css.slice(css.indexOf('.lock-screen {'), css.indexOf('.lock-box {'))
  check('가림막이 반투명(scrim)이 아니다', rule.includes('background: var(--bg)') && !rule.includes('--scrim'))
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
