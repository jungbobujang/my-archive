// scripts/check-plan.mjs 가 esbuild 로 묶어 실행한다. 직접 node 로 돌리면 JSX 때문에 실패한다.
//
// 이 점검의 요점은 셋이다.
//   ① **빈 칸이 빈 칸으로 보이는가.** 격자를 목록 대신 쓰는 이유의 절반이 그것이라,
//      항목이 있는 칸만 그리면 기능이 반쯤 없는 것이다.
//   ② **상태와 시각이 함께 움직이는가.** plan_status 만 쓰고 plan_status_at 을 안 쓰면
//      주간 리뷰가 조용히 옛말을 한다 — 화면에는 아무 표시도 안 난다.
//   ③ **공간을 조회가 가르는가.** 화면에서만 걸렀다면 서랍이 아니라 커튼이다
//      (check-space.body.mjs 와 같은 기준).
import { JSDOM, VirtualConsole } from 'jsdom'
import {
  HORIZONS, MAX_DOMAINS, STALL_DAYS, UNSORTED_DOMAIN, BUILTIN_DOMAINS,
  buildGrid, domainOf, emptyCells, horizonOf, isDoneThisWeek, isPlan, isStalled,
  newDomainKey, nextStatuses, parseRelatedIds, planFields, planStatusAt, weekStart
} from '../src/plan.js'
import { store, resetStore } from './fake-supabase.mjs'

const vc = new VirtualConsole()
vc.on('jsdomError', () => {})

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc
})
const { window } = dom
for (const k of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
  'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'PointerEvent', 'Node', 'File', 'Blob',
  'FileList', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
  'sessionStorage', 'localStorage']) {
  try { globalThis[k] = window[k] } catch { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }) }
}
globalThis.window = window
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* matchMedia 를 여기서 손으로 쥔다. 격자는 폭에 따라 '표' 와 '영역별 아코디언' 중
   하나를 그리는데(src/hooks.js useNarrow), jsdom 에는 폭이 없기 때문이다.
   기본은 넓은 화면이고, 좁은 화면 점검에서만 참으로 바꾼다. */
let narrowNow = false
window.matchMedia = (qq) => ({
  matches: /max-width/.test(String(qq)) ? narrowNow : false,
  media: String(qq),
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
})

process.on('unhandledRejection', () => {})
globalThis.fetch = async () => { throw new Error('점검 중에는 바깥으로 나가지 않는다') }

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const act = React.act ?? (await import('react-dom/test-utils')).act
const ItemModal = (await import('../src/components/ItemModal.jsx')).default
const Settings = (await import('../src/components/Settings.jsx')).default
const Plan = (await import('../src/components/Plan.jsx')).default
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

const flush = async (n = 6) => {
  for (let i = 0; i < n; i += 1) await act(async () => {})
}

const DAY = 86400000
const DOMAINS = [
  { key: 'income', name: '수입', color: 'amber', position: 1 },
  { key: 'growth', name: '성장', color: 'purple', position: 2 },
  { key: 'health', name: '건강', color: 'green', position: 3 }
]
const SPACES = [
  { key: 'personal', name: '개인', icon: '🏠', position: 1 },
  { key: 'class', name: '수업', icon: '🏫', position: 2 }
]

let n = 0
function mkItem(extra = {}) {
  n += 1
  return {
    id: `i${n}`, user_id: 'u1', title: `항목 ${n}`, content: '', tags: [],
    link_url: null, image_url: null, files: [], status: 'none', deleted_at: null,
    space: 'personal', horizon: null, plan_status: null, domain: null,
    related_ids: [], plan_status_at: null,
    created_at: new Date(2026, 0, 1).toISOString(), updated_at: new Date(2026, 0, 1).toISOString(),
    ...extra
  }
}

// 계획 한 건. 상태 시각을 '며칠 전' 으로 바로 줄 수 있게 해 둔다.
function mkPlan(title, { horizon = 'short', domain = 'income', status = 'planned', daysAgo = 0, ...rest } = {}) {
  return mkItem({
    title,
    horizon,
    domain,
    plan_status: status,
    plan_status_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    ...rest
  })
}

function freshWorld() {
  resetStore()
  window.localStorage.clear()
  window.sessionStorage.clear()
  narrowNow = false
  n = 0
  store.rows.spaces.push(...SPACES.map((s) => ({ ...s, user_id: 'u1' })))
  store.rows.plan_domains.push(...DOMAINS.map((d) => ({ ...d, user_id: 'u1' })))
}

const archiveEl = () => React.createElement(ToastProvider, null,
  React.createElement(Archive, {
    session: { user: { id: 'u1', email: 'a@b.c' } }, onNavigate: () => {}
  }))

const planEl = (props = {}) => React.createElement(ToastProvider, null,
  React.createElement(Plan, {
    domains: DOMAINS, space: 'personal', userId: 'u1', refreshKey: 0,
    onOpen: () => {}, onChanged: () => {}, ...props
  }))

// ── 1. 순수 함수 ────────────────────────────────────────────
{
  check('지평은 셋', HORIZONS.length === 3 && HORIZONS[0].key === 'short', HORIZONS.map((h) => h.key).join())
  check('영역은 최대 8개', MAX_DOMAINS === 8)
  check('기본 영역 6종', BUILTIN_DOMAINS.length === 6, BUILTIN_DOMAINS.map((d) => d.name).join())
  check('기본 영역 이름이 요구대로다',
    BUILTIN_DOMAINS.map((d) => d.name).join() === '수입,성장,건강,창작,관계,생활',
    BUILTIN_DOMAINS.map((d) => d.name).join())
  check('정체 기준은 7일', STALL_DAYS === 7)

  check('plan_status 가 없으면 계획이 아니다', !isPlan(mkItem()))
  check('plan_status 가 있으면 계획이다', isPlan(mkPlan('ㄱ')))
  check('엉뚱한 상태는 계획으로 치지 않는다', !isPlan(mkItem({ plan_status: 'wat' })))
  // 🔴 지평이 비어도 격자에서 사라지면 안 된다 — 기본 자리를 준다
  check('지평이 없으면 단기로 본다', horizonOf(mkItem({ plan_status: 'planned' })) === 'short')
  check('모르는 지평도 단기로 본다', horizonOf(mkItem({ horizon: 'wat' })) === 'short')
  check('영역이 없으면 미지정', domainOf(mkItem(), DOMAINS) === UNSORTED_DOMAIN.key)
  check('목록에 없는 영역도 미지정',
    domainOf(mkItem({ domain: 'gone' }), DOMAINS) === UNSORTED_DOMAIN.key)
  check('새 영역 열쇠는 겹치지 않는다', newDomainKey(DOMAINS) === 'domain-4', newDomainKey(DOMAINS))

  const opts = nextStatuses('planned').map((s) => s.key)
  check('전환 메뉴에 지금 상태는 없다', !opts.includes('planned'), opts.join())
  check('전환 메뉴 첫 칸은 진행', opts[0] === 'doing', opts.join())
  check('접음은 어디서나 갈 수 있다', opts.includes('dropped'), opts.join())
  check('접은 것도 되살릴 길이 있다', nextStatuses('dropped').some((s) => s.key === 'planned'))

  check('관련 항목은 문자열 배열로 읽는다',
    parseRelatedIds(['a', 'b', 'a']).join() === 'a,b', parseRelatedIds(['a', 'b', 'a']).join())
  check('관련 항목이 문자열(JSON)로 와도 읽는다',
    parseRelatedIds('["a","b"]').join() === 'a,b')
  check('관련 항목이 쓰레기면 빈 배열', parseRelatedIds('nope').length === 0)

  // 🔴 계획을 내리면 열을 **비운다** (보내지 않는 것이 아니다)
  const off = planFields({ isPlanned: false })
  check('계획 아님은 열을 null 로 비운다',
    off.horizon === null && off.plan_status === null && off.domain === null,
    JSON.stringify(off))
  check('계획 아님은 관련 항목도 비운다', Array.isArray(off.related_ids) && off.related_ids.length === 0)

  const on = planFields({ isPlanned: true, horizon: 'mid', domain: 'growth', planStatus: 'doing', relatedIds: ['x'], statusChanged: true })
  check('계획은 지평·영역·상태를 담는다',
    on.horizon === 'mid' && on.domain === 'growth' && on.plan_status === 'doing', JSON.stringify(on))
  check('상태가 바뀌면 시각을 찍는다', typeof on.plan_status_at === 'string')
  const same = planFields({ isPlanned: true, horizon: 'mid', planStatus: 'doing', statusChanged: false })
  check('상태가 그대로면 시각을 건드리지 않는다', !('plan_status_at' in same), JSON.stringify(same))

  // 시간
  const ws = weekStart(new Date(2026, 8, 13)) // 2026-09-13 은 일요일
  check('이번 주는 월요일에 시작한다', ws.getDay() === 1, ws.toDateString())
  check('일요일도 그 주에 든다', ws.getDate() === 7, ws.getDate())
  check('진행 10일째는 정체', isStalled(mkPlan('ㄱ', { status: 'doing', daysAgo: 10 })))
  check('진행 3일째는 정체가 아니다', !isStalled(mkPlan('ㄱ', { status: 'doing', daysAgo: 3 })))
  check('계획(planned)은 오래돼도 정체가 아니다',
    !isStalled(mkPlan('ㄱ', { status: 'planned', daysAgo: 30 })))
  check('오늘 완료는 이번 주 완료', isDoneThisWeek(mkPlan('ㄱ', { status: 'done', daysAgo: 0 })))
  check('60일 전 완료는 이번 주가 아니다',
    !isDoneThisWeek(mkPlan('ㄱ', { status: 'done', daysAgo: 60 })))
  // 🔴 시각이 없는 옛 행은 만든 시각으로 본다 (0 으로도, 지금으로도 읽지 않는다)
  const old = mkItem({ plan_status: 'doing', plan_status_at: null })
  check('시각이 없으면 만든 시각으로 본다',
    planStatusAt(old) === Date.parse(old.created_at), planStatusAt(old))
}

// ── 2. 격자 만들기 (순수) ───────────────────────────────────
{
  const rows = [
    mkPlan('수입-단기', { domain: 'income', horizon: 'short' }),
    mkPlan('수입-단기2', { domain: 'income', horizon: 'short', status: 'doing' }),
    mkPlan('건강-장기', { domain: 'health', horizon: 'long' }),
    mkPlan('완료된 것', { domain: 'income', status: 'done' }),
    mkPlan('접은 것', { domain: 'income', status: 'dropped' }),
    mkPlan('영역없음', { domain: null }),
    mkItem({ title: '계획 아님' })
  ]
  const grid = buildGrid(rows, DOMAINS)

  check('줄은 영역 수 + 미지정', grid.rows.length === 4, grid.rows.length)
  check('줄 차례는 position 대로',
    grid.rows.map((r) => r.domain.key).join() === 'income,growth,health,__none__',
    grid.rows.map((r) => r.domain.key).join())
  check('모든 줄이 칸 3개를 갖는다', grid.rows.every((r) => r.cells.length === 3))
  // 🔴 빈 칸도 만들어 돌려준다. 이것이 없으면 편중이 화면에서 사라진다.
  check('빈 칸도 만들어 준다', grid.rows[1].cells.every((c) => c.items.length === 0))

  const income = grid.rows[0]
  check('수입-단기 칸에 2건', income.cells[0].items.length === 2, income.cells[0].items.length)
  check('수입 줄의 셈은 활성만', income.count === 2, income.count)
  check('완료는 칸에 없다', !income.cells[0].items.some((i) => i.title === '완료된 것'))
  check('접음도 칸에 없다', !income.cells[0].items.some((i) => i.title === '접은 것'))
  check('완료는 따로 모인다', grid.done.map((i) => i.title).join() === '완료된 것',
    grid.done.map((i) => i.title).join())
  check('접음도 따로 모인다', grid.dropped.map((i) => i.title).join() === '접은 것')
  check('계획 아닌 항목은 격자에 없다',
    !grid.rows.some((r) => r.cells.some((c) => c.items.some((i) => i.title === '계획 아님'))))
  check('영역 없는 것은 미지정 줄로',
    grid.rows[3].cells[0].items.map((i) => i.title).join() === '영역없음',
    grid.rows[3].cells[0].items.map((i) => i.title).join())
  check('건강-장기는 셋째 칸',
    grid.rows[2].cells[2].items.map((i) => i.title).join() === '건강-장기',
    grid.rows[2].cells.map((c) => c.items.length).join())

  const empties = emptyCells(grid)
  // 9칸(3영역 × 3지평) 중 찬 것은 수입-단기와 건강-장기 둘뿐이다.
  // '영역없음' 은 미지정 줄이라 이 셈에 들어가지 않는다.
  check('빈 칸 수가 맞는다 (9칸 중 2칸이 찼다)', empties.length === 7, empties.length)
  // 🔴 미지정은 가짜 줄이라 '비어 있다' 로 세지 않는다 — 늘 있는 줄이 아니기 때문이다
  check('미지정 줄은 빈 칸으로 세지 않는다',
    !empties.some((e) => e.domain.key === UNSORTED_DOMAIN.key))

  // 계획이 하나도 없으면? 줄은 다 있고 전부 비어 있어야 한다
  const blank = buildGrid([], DOMAINS)
  check('계획이 없어도 줄은 다 그린다', blank.rows.length === 3, blank.rows.length)
  check('계획이 없으면 미지정 줄은 없다',
    !blank.rows.some((r) => r.domain.key === UNSORTED_DOMAIN.key))
  check('계획이 없으면 빈 칸 9개', emptyCells(blank).length === 9, emptyCells(blank).length)
}

// ── 3. 격자 화면 ────────────────────────────────────────────
{
  freshWorld()
  store.rows.items.push(
    mkPlan('돈 되는 일', { domain: 'income', horizon: 'short', status: 'doing' }),
    mkPlan('책 쓰기', { domain: 'growth', horizon: 'long' }),
    mkPlan('끝낸 일', { domain: 'income', status: 'done', daysAgo: 0 }),
    mkPlan('접은 일', { domain: 'health', status: 'dropped' })
  )

  const m = mount(planEl())
  await flush()

  check('가로축이 단기·중기·장기',
    text(m.host, '.plan-col-head').join(' | ').replace(/\s+/g, ' ') ===
      '단기 이번 달 | 중기 올해 | 장기 수년',
    text(m.host, '.plan-col-head').join(' | ').replace(/\s+/g, ' '))
  check('세로축이 영역 3줄', qa(m.host, '.plan-row').length === 3, qa(m.host, '.plan-row').length)
  check('세로축 이름이 순서대로',
    text(m.host, '.plan-row-name').join() === '수입,성장,건강',
    text(m.host, '.plan-row-name').join())
  check('칸은 3 × 3 = 9개', qa(m.host, '.plan-cell').length === 9, qa(m.host, '.plan-cell').length)

  const cardTitles = text(m.host, '.plan-card-title')
  check('활성 계획만 칸에 있다', cardTitles.join() === '돈 되는 일,책 쓰기', cardTitles.join())
  check('완료는 칸에 없다', !cardTitles.includes('끝낸 일'))
  check('접음은 화면 어디에도 없다', !m.host.textContent.includes('접은 일'))

  // 🔴 빈 칸이 빈 칸으로 보이는가 — 이 점검의 첫째 요점
  check('빈 칸이 7개', qa(m.host, '.plan-cell-empty').length === 7, qa(m.host, '.plan-cell-empty').length)
  check('빈 칸은 "비어 있음" 이라고 적는다',
    text(m.host, '.plan-cell-none').every((t) => t === '비어 있음'),
    text(m.host, '.plan-cell-none')[0])
  check('칸 머리에 개수가 있다',
    text(m.host, '.plan-cell-count').join() === '1,0,0,0,0,1,0,0,0',
    text(m.host, '.plan-cell-count').join())
  check('줄 머리에 개수가 있다',
    text(m.host, '.plan-row-count').slice(0, 3).join() === '1,1,0',
    text(m.host, '.plan-row-count').join())

  check('진행 중인 카드는 굵은 띠를 받는다',
    !!q(m.host, '.plan-card-doing') && q(m.host, '.plan-card-doing').textContent.includes('돈 되는 일'),
    q(m.host, '.plan-card-doing')?.textContent)
  check('영역 색이 카드 띠에 실린다', !!q(m.host, '.plan-card-amber'))
  check('맨 위 요약이 진행·완료를 적는다',
    q(m.host, '.plan-sum')?.textContent.includes('진행 중 1') &&
    q(m.host, '.plan-sum')?.textContent.includes('이번 주 완료 1'),
    q(m.host, '.plan-sum')?.textContent)

  // 완료는 접힌 채로 시작한다
  check('완료 목록이 접혀 있다', q(m.host, '.plan-done-list') === null)
  check('완료 개수는 접힌 채로도 보인다',
    q(m.host, '.plan-done-toggle')?.textContent.includes('1'),
    q(m.host, '.plan-done-toggle')?.textContent)
  await act(async () => { click(q(m.host, '.plan-done-toggle')) })
  check('펴면 완료가 보인다',
    text(m.host, '.plan-done-row .today-title').join() === '끝낸 일',
    text(m.host, '.plan-done-row .today-title').join())
  check('이번 주에 끝낸 것은 표시가 붙는다', m.host.textContent.includes('이번 주'))

  act(() => { m.root.unmount() })
}

// ── 4. 상태 전환 ────────────────────────────────────────────
//    🔴 plan_status 만이 아니라 plan_status_at 도 함께 써야 한다.
{
  freshWorld()
  const it = mkPlan('전환될 계획', { domain: 'income', status: 'planned', daysAgo: 30 })
  store.rows.items.push(it)
  let changed = 0
  let opened = null

  const m = mount(planEl({ onChanged: () => { changed += 1 }, onOpen: (x) => { opened = x } }))
  await flush()

  check('메뉴는 닫힌 채로 시작한다', q(m.host, '.plan-menu') === null)
  await act(async () => { click(q(m.host, '.plan-card')) })
  check('누르면 상태 메뉴가 열린다', !!q(m.host, '.plan-menu'))
  const menu = text(m.host, '.plan-menu-item').map((t) => t.replace(/^[^가-힣✎]+/, '').trim())
  check('메뉴에 진행·완료·접음·자세히', menu.join() === '진행,완료,접음,✎ 자세히', menu.join())

  const before = Date.now()
  await act(async () => {
    click(qa(m.host, '.plan-menu-item')[0]) // 진행
  })
  await flush()

  const saved = store.rows.items.find((r) => r.id === it.id)
  check('상태가 진행으로 바뀐다', saved?.plan_status === 'doing', saved?.plan_status)
  check('상태 시각도 함께 찍힌다',
    Date.parse(saved?.plan_status_at ?? '') >= before,
    saved?.plan_status_at)
  check('정체였던 것이 정체에서 풀린다', !isStalled(saved))
  check('바깥에 알린다 (오늘 탭 한 줄이 따라온다)', changed === 1, changed)
  check('바꾸고 나면 메뉴가 닫힌다', q(m.host, '.plan-menu') === null)
  check('바뀐 상태가 화면에 바로 보인다', !!q(m.host, '.plan-card-doing'))

  // 메뉴의 '자세히' 는 항목 모달로 간다 (길게 누르기 말고도 닿을 길이 있어야 한다)
  await act(async () => { click(q(m.host, '.plan-card')) })
  await act(async () => { click(q(m.host, '.plan-menu-open')) })
  check('자세히는 항목을 연다', opened?.id === it.id, opened?.id)

  act(() => { m.root.unmount() })
}

// ── 5. 상태 저장이 실패하면 되돌린다 ────────────────────────
{
  freshWorld()
  store.rows.items.push(mkPlan('되돌아올 계획', { status: 'planned' }))
  store.itemsError = { code: '42501', message: 'row-level security' }

  const m = mount(planEl())
  await flush()
  await act(async () => { click(q(m.host, '.plan-card')) })
  await act(async () => { click(qa(m.host, '.plan-menu-item')[0]) })
  await flush()

  check('저장이 실패하면 화면이 되돌아온다', q(m.host, '.plan-card-doing') === null)
  check('실패를 말해 준다', m.host.textContent.includes('저장하지 못했어요'),
    q(m.host, '.toast')?.textContent)
  act(() => { m.root.unmount() })
}

// ── 6. 주간 리뷰 ────────────────────────────────────────────
{
  freshWorld()
  store.rows.items.push(
    mkPlan('이번 주에 끝낸 것', { status: 'done', daysAgo: 0 }),
    mkPlan('예전에 끝낸 것', { status: 'done', daysAgo: 90 }),
    mkPlan('멈춘 진행', { domain: 'growth', status: 'doing', daysAgo: 12 }),
    mkPlan('막 시작한 진행', { domain: 'health', status: 'doing', daysAgo: 1 })
  )

  const m = mount(planEl())
  await flush()
  await act(async () => { click(q(m.host, '.plan-review-btn')) })

  const heads = text(m.host, '.modal .set-head')
  check('리뷰에 세 묶음', heads.length === 3, heads.join(' | '))
  check('리뷰: 이번 주 완료 1건', heads[0].includes('1'), heads[0])
  check('리뷰: 정체 1건', heads[1].includes('1'), heads[1])

  const lists = qa(m.host, '.modal .today-list')
  check('리뷰: 이번 주 완료 목록이 맞다',
    text(lists[0], '.today-title').join() === '이번 주에 끝낸 것',
    text(lists[0], '.today-title').join())
  check('리뷰: 예전 완료는 빠진다', !lists[0].textContent.includes('예전에 끝낸 것'))
  check('리뷰: 정체 목록이 맞다',
    text(lists[1], '.today-title').join() === '멈춘 진행',
    text(lists[1], '.today-title').join())
  check('리뷰: 막 시작한 것은 정체가 아니다', !lists[1].textContent.includes('막 시작한'))
  check('리뷰: 며칠째인지 적는다', text(lists[1], '.today-when').join() === '12일째',
    text(lists[1], '.today-when').join())

  // 빈 칸: 성장-단기(멈춘 진행)와 건강-단기(막 시작)가 찼으니 9 - 2 = 7
  check('리뷰: 빈 칸 목록이 있다', qa(m.host, '.plan-empty-list li').length === 7,
    qa(m.host, '.plan-empty-list li').length)
  check('리뷰: 빈 칸에 영역·지평을 적는다',
    q(m.host, '.plan-empty-list li')?.textContent.includes('수입') &&
    q(m.host, '.plan-empty-list li')?.textContent.includes('단기'),
    q(m.host, '.plan-empty-list li')?.textContent)

  await act(async () => { click(q(m.host, '.modal-head .btn-ghost')) })
  check('리뷰를 닫을 수 있다', q(m.host, '.modal') === null)
  act(() => { m.root.unmount() })
}

// ── 7. 좁은 화면: 영역별 아코디언 ───────────────────────────
//    🔴 세로축이 섹션이 되고, 그 안에서 지평 셋은 **가로로 남는다**.
{
  freshWorld()
  narrowNow = true
  store.rows.items.push(
    mkPlan('단기 계획', { domain: 'income', horizon: 'short' }),
    mkPlan('장기 계획', { domain: 'income', horizon: 'long' })
  )

  const m = mount(planEl())
  await flush()

  check('좁은 화면: 격자에 narrow 표시가 붙는다', !!q(m.host, '.plan-grid-narrow'))
  check('좁은 화면: 가로축 머리를 접는다', q(m.host, '.plan-grid-head') === null)
  check('좁은 화면: 줄 머리가 누를 수 있는 버튼이다',
    qa(m.host, '.plan-row-toggle').length === 3, qa(m.host, '.plan-row-toggle').length)
  check('좁은 화면: 지평 3칸이 줄 안에 가로로 남는다',
    qa(m.host, '.plan-row')[0].querySelectorAll('.plan-cell').length === 3,
    qa(m.host, '.plan-row')[0].querySelectorAll('.plan-cell').length)
  check('좁은 화면: 칸마다 지평 이름을 적는다',
    text(m.host, '.plan-cell-when').slice(0, 3).join() === '단기,중기,장기',
    text(m.host, '.plan-cell-when').slice(0, 3).join())

  // 접기
  const first = qa(m.host, '.plan-row-toggle')[0]
  check('좁은 화면: 처음에는 펴져 있다', first.getAttribute('aria-expanded') === 'true')
  await act(async () => { click(first) })
  check('좁은 화면: 누르면 접힌다',
    qa(m.host, '.plan-row-toggle')[0].getAttribute('aria-expanded') === 'false')
  check('좁은 화면: 접으면 칸이 사라진다',
    qa(m.host, '.plan-row')[0].querySelectorAll('.plan-cell').length === 0)
  check('좁은 화면: 접어도 개수는 남는다',
    qa(m.host, '.plan-row')[0].querySelector('.plan-row-count')?.textContent === '2',
    qa(m.host, '.plan-row')[0].querySelector('.plan-row-count')?.textContent)
  await act(async () => { click(qa(m.host, '.plan-row-toggle')[0]) })
  check('좁은 화면: 다시 누르면 펴진다',
    qa(m.host, '.plan-row')[0].querySelectorAll('.plan-cell').length === 3)

  act(() => { m.root.unmount() })
  narrowNow = false
}

// ── 8. 공간별 분리 (조회가 가른다) ──────────────────────────
{
  freshWorld()
  window.localStorage.setItem('archive-tab', 'plan')
  window.localStorage.setItem('archive-space:u1', 'personal')
  store.rows.items.push(
    mkPlan('개인 계획', { space: 'personal', domain: 'income' }),
    mkPlan('수업 계획', { space: 'class', domain: 'income' })
  )

  const m = mount(archiveEl())
  await flush(8)

  check('계획 탭이 있다', text(m.host, '.tab').some((t) => t.includes('계획')), text(m.host, '.tab').join(' | '))
  check('계획 탭이 열려 있다',
    qa(m.host, '.tab').find((el) => el.textContent.includes('계획'))?.getAttribute('aria-selected') === 'true')
  check('격자에 이 서랍의 계획만 있다',
    text(m.host, '.plan-card-title').join() === '개인 계획',
    text(m.host, '.plan-card-title').join())

  // 🔴 화면에서 거른 것이 아니라 **조회가** 걸렀는지 본다
  const planQ = store.calls.query.filter((c) => c.table === 'items' && c.op === 'select' &&
    c.filters.some(([kind, col]) => kind === 'not' && col === 'plan_status'))
  check('계획 조회가 따로 나간다', planQ.length > 0, planQ.length)
  check('계획 조회에 space 조건이 실려 나간다',
    planQ.every((c) => c.filters.some(([kind, col, val]) => kind === 'eq' && col === 'space' && val === 'personal')),
    JSON.stringify(planQ[0]?.filters))
  check('계획 조회가 계획만 물어본다 (전부 받아 와서 거르지 않는다)',
    planQ.every((c) => c.filters.some(([kind, col, a, b]) =>
      kind === 'not' && col === 'plan_status' && a === 'is' && b === null)))

  // 서랍을 바꾸면 격자도 바뀐다
  await act(async () => { click(q(m.host, '.space-current')) })
  await act(async () => { click(qa(m.host, '.space-opt')[1]) })
  await flush(8)
  check('서랍을 바꾸면 격자가 바뀐다',
    text(m.host, '.plan-card-title').join() === '수업 계획',
    text(m.host, '.plan-card-title').join())

  act(() => { m.root.unmount() })
}

// ── 9. 오늘 탭의 계획 한 줄 ─────────────────────────────────
{
  freshWorld()
  window.localStorage.setItem('archive-tab', 'today')
  window.localStorage.setItem('archive-space:u1', 'personal')
  store.rows.items.push(
    mkPlan('진행 하나', { status: 'doing', daysAgo: 1 }),
    mkPlan('진행 둘', { status: 'doing', daysAgo: 20 }),
    mkPlan('이번 주 완료', { status: 'done', daysAgo: 0 }),
    mkPlan('다른 서랍 진행', { space: 'class', status: 'doing' })
  )

  const m = mount(archiveEl())
  await flush(8)

  const strip = q(m.host, '.plan-strip')
  check('오늘 탭 맨 위에 계획 한 줄이 있다', !!strip, strip?.textContent)
  check('한 줄이 진행 중 개수를 적는다', strip?.textContent.includes('진행 중 2'), strip?.textContent)
  check('한 줄이 이번 주 완료 개수를 적는다', strip?.textContent.includes('이번 주 완료 1'), strip?.textContent)
  check('한 줄도 이 서랍만 센다', !strip?.textContent.includes('진행 중 3'), strip?.textContent)
  check('멈춘 것이 있으면 함께 적는다', strip?.textContent.includes('멈춘 것 1'), strip?.textContent)

  await act(async () => { click(strip) })
  await flush(6)
  check('누르면 계획 탭으로 간다', !!q(m.host, '.plan-grid'),
    qa(m.host, '.tab').find((el) => el.getAttribute('aria-selected') === 'true')?.textContent)

  act(() => { m.root.unmount() })
}

// 계획이 하나도 없으면 한 줄을 두지 않는다 (0 · 0 은 알려 주는 것이 없다)
{
  freshWorld()
  window.localStorage.setItem('archive-tab', 'today')
  store.rows.items.push(mkItem({ title: '그냥 메모' }))
  const m = mount(archiveEl())
  await flush(8)
  check('계획이 없으면 한 줄도 없다', q(m.host, '.plan-strip') === null)
  act(() => { m.root.unmount() })
}

// ── 10. 항목 모달: 계획으로 올리고 내리기 ───────────────────
{
  freshWorld()
  const m = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], spaces: SPACES, space: 'personal',
    domains: DOMAINS, userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  await flush(2)

  const toggle = q(m.host, 'input[aria-label="계획으로"]')
  check('모달에 계획 토글이 있다', !!toggle)
  // 🔴 기본은 계획 아님 (요구사항 5)
  check('기본은 계획 아님', toggle?.checked === false)
  check('꺼져 있으면 지평·영역 칸이 없다', q(m.host, '.plan-fields') === null)

  // 체크박스는 click 하나로 충분하다 — jsdom 이 checked 를 뒤집고 change 까지 내보낸다
  await act(async () => { click(toggle) })
  check('켜면 지평·영역 칸이 나온다', !!q(m.host, '.plan-fields'))
  const labels = text(m.host, '.plan-field-label').map((t) => t.split(' ')[0])
  check('지평·영역·상태·관련 항목 네 칸', labels.join() === '지평,영역,상태,관련', labels.join())

  const pick = (label) => qa(m.host, '.plan-field')
    .find((f) => f.querySelector('.plan-field-label')?.textContent.startsWith(label))
    ?.querySelectorAll('.chip')
  await act(async () => { click([...pick('지평')].find((b) => b.textContent.includes('중기'))) })
  await act(async () => { click([...pick('영역')].find((b) => b.textContent.includes('성장'))) })
  await act(async () => { setValue(q(m.host, '.field input'), '계획이 된 메모') })
  await act(async () => { click(q(m.host, '.modal-foot .btn-primary')) })
  await flush()

  const saved = store.rows.items.find((r) => r.title === '계획이 된 메모')
  check('저장하면 지평이 담긴다', saved?.horizon === 'mid', saved?.horizon)
  check('저장하면 영역이 담긴다', saved?.domain === 'growth', saved?.domain)
  check('상태는 계획으로 시작한다', saved?.plan_status === 'planned', saved?.plan_status)
  check('상태 시각이 찍힌다', typeof saved?.plan_status_at === 'string', saved?.plan_status_at)
  act(() => { m.root.unmount() })
}

{
  // 격자에서 내리기 — 열을 **비워야** 한다 (안 보내면 그대로 남는다)
  freshWorld()
  const it = mkPlan('내려올 계획', { domain: 'income', horizon: 'mid', status: 'doing' })
  store.rows.items.push(it)

  const m = mount(React.createElement(ItemModal, {
    item: it, categories: [], slots: [], spaces: SPACES, space: 'personal',
    domains: DOMAINS, userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  await flush(2)

  const toggle = q(m.host, 'input[aria-label="계획으로"]')
  check('이미 계획이면 토글이 켜져 있다', toggle?.checked === true)
  check('지금 지평이 골라져 있다',
    !!qa(m.host, '.plan-field .chip-on').find((b) => b.textContent.includes('중기')),
    text(m.host, '.plan-field .chip-on').join(' | '))
  check('지금 상태가 골라져 있다',
    !!qa(m.host, '.plan-field .chip-on').find((b) => b.textContent.includes('진행')))

  await act(async () => { click(toggle) })
  check('끄면 지평·영역 칸이 사라진다', q(m.host, '.plan-fields') === null)
  await act(async () => { click(q(m.host, '.modal-foot .btn-primary')) })
  await flush()

  const after = store.rows.items.find((r) => r.id === it.id)
  check('내리면 상태가 비워진다', after?.plan_status === null, after?.plan_status)
  check('내리면 지평도 비워진다', after?.horizon === null, after?.horizon)
  check('내리면 영역도 비워진다', after?.domain === null, after?.domain)
  check('내려도 항목 자체는 남는다', after?.title === '내려올 계획', after?.title)
  act(() => { m.root.unmount() })
}

// ── 11. 관련 항목 검색·연결 ─────────────────────────────────
{
  freshWorld()
  const self = mkPlan('이 계획 자신', { domain: 'income' })
  const a = mkItem({ title: '유튜브 대본 아이디어' })
  const b = mkItem({ title: '유튜브 채널 기획' })
  const c = mkItem({ title: '전혀 다른 메모' })
  const d = mkItem({ title: '유튜브 다른 서랍', space: 'class' })
  self.title = '유튜브 계획 자신'
  self.related_ids = [a.id]
  store.rows.items.push(self, a, b, c, d)

  const m = mount(React.createElement(ItemModal, {
    item: self, categories: [], slots: [], spaces: SPACES, space: 'personal',
    domains: DOMAINS, userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  await flush(3)

  check('이미 걸린 관련 항목의 제목이 보인다',
    q(m.host, '.plan-rel-name')?.textContent.includes('유튜브 대본 아이디어'),
    q(m.host, '.plan-rel-name')?.textContent)

  await act(async () => { setValue(q(m.host, '.plan-rel-search'), '유튜브') })
  await act(async () => { await new Promise((r) => setTimeout(r, 700)) })
  await flush()

  const hits = text(m.host, '.plan-rel-hit').map((t) => t.replace(/^\+\s*/, ''))
  check('검색이 제목으로 좁힌다', hits.includes('유튜브 채널 기획'), hits.join(' | '))
  check('검색이 자기 자신을 뺀다', !hits.includes('유튜브 계획 자신'), hits.join(' | '))
  check('검색이 이미 걸린 것을 뺀다', !hits.includes('유튜브 대본 아이디어'), hits.join(' | '))
  check('검색이 맞지 않는 것을 뺀다', !hits.includes('전혀 다른 메모'), hits.join(' | '))
  check('검색도 이 서랍 안에서만', !hits.includes('유튜브 다른 서랍'), hits.join(' | '))

  await act(async () => { click(qa(m.host, '.plan-rel-hit')[0]) })
  check('고르면 목록에 붙는다', qa(m.host, '.plan-rel-name').length === 2,
    text(m.host, '.plan-rel-name').join(' | '))

  await act(async () => { click(q(m.host, '.modal-foot .btn-primary')) })
  await flush()
  const saved = store.rows.items.find((r) => r.id === self.id)
  check('저장하면 관련 항목이 담긴다', parseRelatedIds(saved?.related_ids).length === 2,
    JSON.stringify(saved?.related_ids))
  act(() => { m.root.unmount() })
}

// 카드에 🔗N 이 뜬다
{
  freshWorld()
  store.rows.items.push(mkPlan('연결된 계획', { domain: 'income', related_ids: ['x', 'y'] }))
  const m = mount(planEl())
  await flush()
  check('격자 카드에 🔗 개수가 뜬다',
    q(m.host, '.plan-card-rel')?.textContent === '🔗2', q(m.host, '.plan-card-rel')?.textContent)
  act(() => { m.root.unmount() })
}

// ── 12. 아카이브 카드에서 바로 올리기 ───────────────────────
{
  freshWorld()
  window.localStorage.setItem('archive-tab', 'archive')
  window.localStorage.setItem('archive-space:u1', 'personal')
  store.rows.items.push(mkItem({ title: '올려질 메모' }))

  const m = mount(archiveEl())
  await flush(8)

  const addBtn = q(m.host, '.plan-add')
  check('아카이브 카드에 계획 버튼이 있다', !!addBtn, addBtn?.textContent)
  await act(async () => { click(addBtn) })
  check('누르면 작은 창이 뜬다', !!q(m.host, '.plan-quick'))

  const chips = qa(m.host, '.plan-quick .chip')
  await act(async () => { click(chips.find((b) => b.textContent.trim() === '장기')) })
  await act(async () => { click(chips.find((b) => b.textContent.includes('건강'))) })
  await act(async () => { click(q(m.host, '.plan-quick-foot .btn-primary')) })
  await flush()

  const saved = store.rows.items.find((r) => r.title === '올려질 메모')
  check('격자에 올라간다', saved?.plan_status === 'planned', saved?.plan_status)
  check('고른 지평이 담긴다', saved?.horizon === 'long', saved?.horizon)
  check('고른 영역이 담긴다', saved?.domain === 'health', saved?.domain)
  check('상태 시각도 찍힌다', typeof saved?.plan_status_at === 'string', saved?.plan_status_at)
  check('올리고 나면 작은 창이 닫힌다', q(m.host, '.plan-quick') === null)
  check('이미 올라간 카드에는 올리기 버튼 대신 자리를 적는다',
    !!q(m.host, '.plan-mini') && q(m.host, '.plan-add') === null,
    q(m.host, '.plan-mini')?.textContent)
  check('카드가 어디에 올라갔는지 적는다',
    q(m.host, '.plan-mini')?.textContent.includes('건강') &&
    q(m.host, '.plan-mini')?.textContent.includes('장기'),
    q(m.host, '.plan-mini')?.textContent)

  act(() => { m.root.unmount() })
}

// ── 13. 설정: 영역 이름·색·순서·최대 8개 ────────────────────
{
  freshWorld()
  let changed = 0
  const settings = (list) => React.createElement(Settings, {
    email: 'a@b.c', userId: 'u1', themePref: 'system', onThemeChange: () => {},
    spaces: SPACES, space: 'personal', onSpacesChanged: () => {},
    domains: list, onDomainsChanged: () => { changed += 1 },
    onOpenPricing: () => {}, onClose: () => {}
  })

  let m = mount(settings(DOMAINS))
  await flush()

  check('설정에 계획 영역 칸이 있다', text(m.host, '.set-head').includes('계획 영역'),
    text(m.host, '.set-head').join(' | '))
  const nameInput = q(m.host, 'input[aria-label="새 영역 이름"]')
  check('설정: 새 영역 칸이 있다', !!nameInput)

  await act(async () => { setValue(nameInput, '봉사') })
  await act(async () => {
    qa(m.host, '.cm-add').pop().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
  const made = store.rows.plan_domains.find((d) => d.name === '봉사')
  check('설정: 새 영역이 만들어진다', !!made && made.key === 'domain-4', made?.key)
  check('설정: 만들면 바깥에 알린다', changed === 1, changed)

  // 이름 바꾸기 (계획 영역 칸의 첫 줄 — 공간 칸이 위에 있으므로 뒤쪽에서 센다)
  const domainSection = qa(m.host, '.set-section')
    .find((s) => s.querySelector('.set-head')?.textContent === '계획 영역')
  const first = domainSection.querySelectorAll('.cm-name')[0]
  await act(async () => { setValue(first, '돈') })
  await act(async () => { first.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })) })
  await flush()
  check('설정: 영역 이름을 바꾼다',
    store.rows.plan_domains.find((d) => d.key === 'income')?.name === '돈',
    store.rows.plan_domains.find((d) => d.key === 'income')?.name)

  // 순서 바꾸기 — position 이 맞바뀐다
  const down = domainSection.querySelectorAll('.file-move-btn')[1] // 첫 줄의 ▼
  await act(async () => { click(down) })
  await flush()
  const income = store.rows.plan_domains.find((d) => d.key === 'income')
  const growth = store.rows.plan_domains.find((d) => d.key === 'growth')
  check('설정: 순서를 내리면 자리가 맞바뀐다',
    income.position === 2 && growth.position === 1, `${income.position}/${growth.position}`)

  check('설정: 영역 지우기 버튼은 두지 않았다', !m.host.textContent.includes('영역 삭제'))
  check('설정: 영역이 계정 단위임을 적는다', m.host.textContent.includes('공간(서랍)을 바꿔도 같은 축'))
  act(() => { m.root.unmount() })

  // 8개가 차면 더 만들 수 없다
  const eight = Array.from({ length: MAX_DOMAINS }, (_, i) => ({
    key: `k${i}`, name: `영역${i}`, color: 'gray', position: i + 1
  }))
  m = mount(settings(eight))
  await flush()
  check('설정: 8개가 차면 입력칸이 잠긴다',
    q(m.host, 'input[aria-label="새 영역 이름"]')?.disabled === true)
  check('설정: 왜 잠겼는지 적는다',
    q(m.host, 'input[aria-label="새 영역 이름"]')?.placeholder.includes(`최대 ${MAX_DOMAINS}개`),
    q(m.host, 'input[aria-label="새 영역 이름"]')?.placeholder)
  act(() => { m.root.unmount() })

  // 표가 없는 DB 에서는 칸을 통째로 숨긴다 (빈 목록은 '없다' 로 잘못 읽힌다)
  m = mount(settings(null))
  await flush()
  check('설정: 계획 열이 없으면 영역 칸을 숨긴다',
    !text(m.host, '.set-head').includes('계획 영역'), text(m.host, '.set-head').join(' | '))
  act(() => { m.root.unmount() })
}

// ── 14. 계획 열이 아직 없는 DB (SQL 미실행) ─────────────────
//    🔴 여기서 앱이 멈추면 안 된다. 계획만 접히고 목록·검색·저장은 예전 그대로여야 한다.
{
  freshWorld()
  store.rows.plan_domains.length = 0
  store.missingPlanColumn = true
  window.localStorage.setItem('archive-tab', 'plan')   // 계획 탭을 마지막으로 보던 기기
  store.rows.items.push(mkItem({ title: '옛 항목 하나' }), mkItem({ title: '옛 항목 둘' }))

  const m = mount(archiveEl())
  await flush(8)

  check('열이 없으면 계획 탭을 숨긴다',
    !text(m.host, '.tab').some((t) => t.includes('계획')), text(m.host, '.tab').join(' | '))
  check('열이 없으면 그 사실을 한 줄로 알린다',
    m.host.textContent.includes('supabase/setup.sql'), q(m.host, '.space-note')?.textContent)
  // 기억해 둔 탭이 열 수 없는 탭이면 빈 화면 대신 오늘로 간다
  check('기억해 둔 계획 탭 대신 오늘이 열린다', !!q(m.host, '.today'),
    text(m.host, '.tab').join(' | '))
  check('열이 없어도 다른 탭은 그대로 돈다',
    qa(m.host, '.tab').find((el) => el.textContent.includes('아카이브'))?.getAttribute('aria-selected') === 'false')

  // 목록·저장이 예전 그대로
  await act(async () => { click(qa(m.host, '.tab').find((el) => el.textContent.includes('아카이브'))) })
  await flush(6)
  check('열이 없어도 목록은 그대로 나온다', text(m.host, '.card-title').length === 2,
    text(m.host, '.card-title').join(' | '))
  check('열이 없으면 카드의 계획 버튼도 없다', q(m.host, '.plan-add') === null)

  await act(async () => { setValue(q(m.host, '.quick-row input'), '열 없이도 저장') })
  await act(async () => {
    q(m.host, '.quick-row').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
  const saved = store.rows.items.find((r) => r.title === '열 없이도 저장')
  check('열이 없어도 저장은 된다', !!saved)
  check('열이 없으면 계획 열을 보내지 않는다',
    saved && !('horizon' in saved) && !('plan_status' in saved) && !('related_ids' in saved),
    saved && Object.keys(saved).join())

  act(() => { m.root.unmount() })
}

// 계획 열이 없는 DB 의 항목 모달도 계획 칸을 접는다
{
  freshWorld()
  store.missingPlanColumn = true
  const m = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], spaces: SPACES, space: 'personal',
    domains: null, userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  await flush(2)
  check('열이 없으면 모달의 계획 칸도 숨는다',
    q(m.host, 'input[aria-label="계획으로"]') === null)

  await act(async () => { setValue(q(m.host, '.field input'), '계획 칸 없이 저장') })
  await act(async () => { click(q(m.host, '.modal-foot .btn-primary')) })
  await flush()
  const saved = store.rows.items.find((r) => r.title === '계획 칸 없이 저장')
  check('열이 없어도 모달 저장은 된다', !!saved)
  check('모달도 계획 열을 보내지 않는다', saved && !('horizon' in saved), saved && Object.keys(saved).join())
  act(() => { m.root.unmount() })
}

// ── 15. 백업에 계획 영역이 들어간다 ─────────────────────────
//    🔴 이 저장소는 예전에 time_slots 를 백업에서 빠뜨린 적이 있다(bf13b2b).
//       영역 표가 빠지면 복원한 뒤 '건강' 이 'health' 라는 이름 없는 줄이 된다.
{
  /* 🔴 파일을 직접 읽는다. 백업 만들기는 브라우저에서 <a download> 로 끝나는 일이라
     jsdom 에서 결과를 잡을 수 없다 — 그래서 '무엇을 담기로 적혀 있는가' 를 본다.
     경로는 cwd 기준이다: 이 파일은 node_modules/.cache 로 묶여 나가므로
     import.meta.url 로 잡으면 엉뚱한 곳을 가리킨다. */
  const fsMod = await import('node:fs')
  const pathMod = await import('node:path')
  const body = fsMod.readFileSync(pathMod.resolve('src/components/Archive.jsx'), 'utf8')
  check('백업에 plan_domains 를 담는다', /plan_domains:\s*allDomains/.test(body))
  check('복원이 plan_domains 를 되돌린다', /upsertChunked\(\s*\n?\s*'plan_domains'/.test(body))
  check('복원 단계 수가 맞다', /const IMPORT_STEPS = 6/.test(body))
}

// ── 요약 ────────────────────────────────────────────────────
let bad = 0
for (const c of checks) {
  if (!c.ok) bad++
  console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.extra !== undefined ? '  (' + c.extra + ')' : ''))
}
console.log(bad === 0 ? 'ALL PASS (' + checks.length + ')' : bad + ' FAILED of ' + checks.length)
process.exit(bad === 0 ? 0 : 1)
