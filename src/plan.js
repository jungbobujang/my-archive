// 계획 격자 — 지평(가로) × 영역(세로).
//
// ── 왜 새 표가 아니라 items 의 열인가 ───────────────────────────
//
// 계획은 **항목의 한 상태**이지 다른 종류의 자료가 아니다. 적어 둔 아이디어가 어느 날
// 계획이 되고, 끝나면 다시 기록으로 남는다. 표를 나누면 그 순간마다 행을 옮겨야 하고,
// 옮기는 동안 첨부·링크·소속·공유 링크가 전부 따라가야 한다 — 그 모든 것이 items.id 를
// 가리키고 있기 때문이다. 열 넷을 더하면 옮길 것이 없다.
//   · 목록 조회가 그대로다 (Archive 는 select('*') 로 받는다).
//   · 백업 내보내기/가져오기가 그대로다 (표가 늘면 양쪽을 다 고쳐야 한다 — 이 저장소는
//     예전에 time_slots 를 백업에서 빠뜨린 적이 있다).
//   · 휴지통·공유·검색이 계획 항목에도 그대로 걸린다.
// 이것은 space·files 열에서 이미 두 번 같은 판단을 한 자리다(src/spaces.js 머리말).
//
// ── 영역(domain)은 왜 계정 단위인가 ────────────────────────────
//
// 격자의 세로축은 '수입·성장·건강…' 처럼 **사람의 삶의 갈래**다. 서랍(공간)을 바꾼다고
// 건강이 건강이 아니게 되지는 않는다. 그래서 영역 표는 time_slots 와 같이 계정에 하나만
// 둔다. 계획이 공간별로 갈리는 것은 **항목이 space 를 들고 있기 때문**이고(요구사항 9),
// 격자는 지금 서랍의 항목만 담는다 — 축은 같고 내용이 갈린다.
// (공간마다 축을 따로 두는 길도 있었다. 그러면 영역 6개 × 공간 5개 = 30줄을 사람이
//  관리해야 하고, '최대 8개' 라는 약속이 무엇의 8개인지 흐려진다. REPORT-PLAN.md 2절.)
//
// ── 열이 없는 DB 에서도 앱은 돌아간다 ──────────────────────────
//
// SQL 은 사람이 직접 실행한다. 그 사이에도 앱이 멈추면 안 되므로, Archive 는 뜰 때 한 번
// items.horizon 이 있는지 물어보고(probePlanColumns), 없으면 계획 기능만 접는다 —
// 탭을 숨기고, 조회에 계획 조건을 붙이지 않고, 저장할 때 계획 열을 보내지 않는다.
// space 열에서 쓴 방법과 같다.
import { supabase } from './supabase.js'

// ── 지평 (격자의 가로축) ───────────────────────────────────────
// 순서가 곧 화면의 왼→오른쪽이다. 짧은 것이 왼쪽에 온다.
export const HORIZONS = [
  { key: 'short', name: '단기', sub: '이번 달' },
  { key: 'mid', name: '중기', sub: '올해' },
  { key: 'long', name: '장기', sub: '수년' }
]
export const HORIZON_KEYS = HORIZONS.map((h) => h.key)
export const DEFAULT_HORIZON = 'short'

export function horizonLabel(key) {
  const one = HORIZONS.find((h) => h.key === key)
  return one ? one.name : (key ?? '')
}

// ── 상태 ───────────────────────────────────────────────────────
//
// 🔴 items.status(none/todo/done)와 **다른 열**이다. 저쪽은 '오늘 할 일인가' 를 재고
//    이쪽은 '이 계획이 어디까지 왔나' 를 잰다. 한 열에 합치면 오늘 탭의 체크 하나가
//    계획의 진행 상태를 바꾸게 된다 — 서로 다른 두 질문에 한 번만 답하게 되는 셈이다.
export const PLAN_STATUSES = [
  { key: 'planned', name: '계획', icon: '○' },
  { key: 'doing', name: '진행', icon: '◐' },
  { key: 'done', name: '완료', icon: '●' },
  { key: 'dropped', name: '접음', icon: '✕' }
]
export const PLAN_STATUS_KEYS = PLAN_STATUSES.map((s) => s.key)
export const DEFAULT_PLAN_STATUS = 'planned'
// 격자 칸에 놓이는 것은 이 둘뿐이다. 완료는 격자 아래 접힌 목록, 접음은 아예 안 보인다.
export const ACTIVE_PLAN_STATUSES = ['planned', 'doing']

export function planStatusLabel(key) {
  const one = PLAN_STATUSES.find((s) => s.key === key)
  return one ? one.name : (key ?? '')
}

// 상태 전환 메뉴에 올릴 것들. 지금 상태는 빼고 준다 — 같은 곳으로 가는 버튼은
// 눌러도 아무 일이 없어서, 눌러 본 사람은 기능이 고장 났다고 읽는다.
//
// 차례는 planned → doing → done 이고 '접음' 은 언제나 끝에 붙는다(요구사항 4).
// 되돌리는 길도 함께 둔다 — 잘못 누른 것을 고칠 방법이 없으면 누르기가 무서워진다.
const STATUS_FLOW = {
  planned: ['doing', 'done', 'dropped'],
  doing: ['done', 'planned', 'dropped'],
  done: ['doing', 'planned', 'dropped'],
  dropped: ['planned', 'doing']
}

export function nextStatuses(cur) {
  return (STATUS_FLOW[cur] ?? STATUS_FLOW.planned).map((key) => ({
    key, name: planStatusLabel(key), icon: PLAN_STATUSES.find((s) => s.key === key)?.icon ?? ''
  }))
}

// ── 영역 (격자의 세로축) ───────────────────────────────────────
export const MAX_DOMAINS = 8
export const DOMAIN_COLOR_FALLBACK = 'gray'
// 영역을 고르지 않은 계획이 놓이는 자리. 표에 없는 가짜 열쇠다 —
// 🔴 빈칸으로 두면 격자 어디에도 그려지지 않아, 사람은 저장한 계획이 사라졌다고 본다.
//    (같은 이유로 supabase.js 의 treeOrder 는 부모 없는 카테고리도 반드시 한 번 내보낸다)
export const UNSORTED_DOMAIN = { key: '__none__', name: '미지정', color: 'gray', position: 999 }

// 기본 영역 6개. setup.sql 의 seed_defaults 와 **같은 값**이어야 한다 —
// 표가 아직 없는 DB 에서 화면이 보여 주는 목록도 이것이다.
export const BUILTIN_DOMAINS = [
  { key: 'income', name: '수입', color: 'amber', position: 1 },
  { key: 'growth', name: '성장', color: 'purple', position: 2 },
  { key: 'health', name: '건강', color: 'green', position: 3 },
  { key: 'create', name: '창작', color: 'coral', position: 4 },
  { key: 'relation', name: '관계', color: 'pink', position: 5 },
  { key: 'life', name: '생활', color: 'teal', position: 6 }
]

export const PLAN_COLUMN_MESSAGE =
  '계획 기능을 쓰려면 supabase/setup.sql 을 실행해 주세요 — 지금은 계획 탭을 열 수 없습니다'

// 정체 판정 기준. '진행' 으로 둔 채 이만큼 상태가 안 바뀌면 주간 리뷰에 올라온다.
export const STALL_DAYS = 7
const DAY_MS = 86400000

// ── 행이 들고 있는 값 ──────────────────────────────────────────

// 계획인가. 🔴 기준은 plan_status 하나다. 지평이 비어 있어도 계획은 계획이고,
//    그때는 아래 horizonOf 가 기본 자리(단기)를 준다 — 어느 쪽이든 격자에서 사라지지 않는다.
export function isPlan(row) {
  return PLAN_STATUS_KEYS.includes(row?.plan_status)
}

export function horizonOf(row) {
  const key = row?.horizon
  return HORIZON_KEYS.includes(key) ? key : DEFAULT_HORIZON
}

export function planStatusOf(row) {
  return isPlan(row) ? row.plan_status : null
}

// 영역 열쇠. 없거나 목록에 없는 열쇠면 '미지정' 으로 본다 —
// 영역을 지운 뒤에도 그 영역에 있던 계획이 화면에서 사라지면 안 된다.
export function domainOf(row, domains) {
  const key = row?.domain
  if (typeof key !== 'string' || !key) return UNSORTED_DOMAIN.key
  if (domains && !domains.some((d) => d.key === key)) return UNSORTED_DOMAIN.key
  return key
}

export function findDomain(domains, key) {
  if (key === UNSORTED_DOMAIN.key) return UNSORTED_DOMAIN
  return (domains ?? []).find((d) => d.key === key) ?? null
}

export function domainLabel(domains, key) {
  return findDomain(domains, key)?.name ?? key ?? UNSORTED_DOMAIN.name
}

export function domainColor(domains, key) {
  return findDomain(domains, key)?.color ?? DOMAIN_COLOR_FALLBACK
}

// ── 관련 항목 (related_ids) ────────────────────────────────────
//
// jsonb 배열에 항목 id 만 담는다. 표(plan_links)를 두지 않은 이유는 items.files 와 같다 —
// 담을 것이 id 하나뿐이라 부가 정보가 없고, 표를 나누면 목록·백업·복원이 한 겹씩 는다.
// 방향도 두지 않는다: '이 계획이 어느 기록에서 나왔나' 한 방향만 적으면 충분하고,
// 양방향으로 만들면 한쪽을 지울 때 반대쪽을 함께 고쳐야 한다.
export const MAX_RELATED = 20

export function parseRelatedIds(value) {
  let rows = value
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows) } catch { return [] }
  }
  if (!Array.isArray(rows)) return []
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const id = typeof r === 'string' ? r : r?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.slice(0, MAX_RELATED)
}

export function joinRelatedIds(list) {
  return parseRelatedIds(list ?? [])
}

// ── 시간 ───────────────────────────────────────────────────────

// 상태가 마지막으로 바뀐 시각. 없으면(마이그레이션 전에 만들어진 행) 만든 시각으로 본다 —
// 🔴 null 을 '아주 오래됐다' 로 읽으면 옛 계획이 전부 정체 목록에 쏟아지고,
//    '방금' 으로 읽으면 진짜 정체가 영영 안 잡힌다. 만든 시각이 둘 중 사실에 가깝다.
export function planStatusAt(row) {
  const raw = row?.plan_status_at ?? row?.created_at
  const t = Date.parse(raw ?? '')
  return Number.isNaN(t) ? null : t
}

// 진행으로 둔 채 STALL_DAYS 넘게 상태가 안 바뀐 계획인가.
export function isStalled(row, now = Date.now()) {
  if (planStatusOf(row) !== 'doing') return false
  const at = planStatusAt(row)
  if (at === null) return false
  return now - at >= STALL_DAYS * DAY_MS
}

export function stalledDays(row, now = Date.now()) {
  const at = planStatusAt(row)
  if (at === null) return 0
  return Math.floor((now - at) / DAY_MS)
}

// 이번 주의 시작(월요일 0시). 한국에서 '이번 주' 는 월요일부터다 —
// 일요일 시작으로 잡으면 일요일에 끝낸 일이 다음 주 몫으로 넘어간다.
export function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const shift = (d.getDay() + 6) % 7   // 월 0, 화 1 … 일 6
  d.setDate(d.getDate() - shift)
  return d
}

export function isDoneThisWeek(row, now = new Date()) {
  if (planStatusOf(row) !== 'done') return false
  const at = planStatusAt(row)
  if (at === null) return false
  return at >= weekStart(now).getTime()
}

// ── 격자 만들기 ────────────────────────────────────────────────
//
// 🔴 빈 칸도 **반드시 만들어 돌려준다.** 이 격자를 보는 이유의 절반은 '어디가 비었나' 다
//    (요구사항 3). 항목이 있는 칸만 만들어 그리면 편중이 화면에서 사라진다.
// 🔴 영역 줄도 전부 만든다. 다만 '미지정' 줄만은 들어 있을 때에만 붙인다 —
//    늘 비어 있는 가짜 줄이 격자 아래에 하나 더 있으면 그것도 편중처럼 읽힌다.
export function buildGrid(items, domains) {
  const list = (items ?? []).filter(isPlan)
  const axis = [...(domains ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  const make = (domain) => ({
    domain,
    cells: HORIZON_KEYS.map((h) => ({ horizon: h, items: [] })),
    count: 0
  })
  const rows = axis.map(make)
  const byKey = new Map(rows.map((r) => [r.domain.key, r]))

  let unsorted = null
  const done = []
  const dropped = []

  for (const it of list) {
    const st = planStatusOf(it)
    if (st === 'done') { done.push(it); continue }
    if (st === 'dropped') { dropped.push(it); continue }

    const dk = domainOf(it, axis)
    let row = byKey.get(dk)
    if (!row) {
      // 미지정 줄은 처음 필요해질 때 만든다
      unsorted ??= make(UNSORTED_DOMAIN)
      row = unsorted
    }
    const cell = row.cells.find((c) => c.horizon === horizonOf(it))
    cell.items.push(it)
    row.count += 1
  }

  if (unsorted) rows.push(unsorted)

  // 완료는 최근에 끝낸 것부터. '이번 주에 뭘 했나' 를 보는 목록이라 그 순서가 맞는다.
  done.sort((a, b) => (planStatusAt(b) ?? 0) - (planStatusAt(a) ?? 0))

  return { rows, done, dropped }
}

// 빈 칸 목록 — 주간 리뷰가 '어디가 비었나' 를 적을 때 쓴다(요구사항 8).
export function emptyCells(grid) {
  const out = []
  for (const row of grid.rows) {
    if (row.domain.key === UNSORTED_DOMAIN.key) continue  // 가짜 줄은 세지 않는다
    for (const cell of row.cells) {
      if (cell.items.length === 0) out.push({ domain: row.domain, horizon: cell.horizon })
    }
  }
  return out
}

// ── 저장에 실을 값 ─────────────────────────────────────────────
//
// 🔴 '계획 아님' 은 열을 **비우는 것**이지 보내지 않는 것이 아니다. 격자에서 내린 계획의
//    payload 에서 열을 빼 버리면 update 가 그 열을 건드리지 않아, 내린 줄 알았던 계획이
//    다음에 열 때 그대로 있다. null 을 명시해서 보낸다.
export function planFields({ isPlanned, horizon, domain, planStatus, relatedIds, statusChanged }) {
  if (!isPlanned) {
    return {
      horizon: null,
      plan_status: null,
      domain: null,
      related_ids: [],
      plan_status_at: null
    }
  }
  return {
    horizon: HORIZON_KEYS.includes(horizon) ? horizon : DEFAULT_HORIZON,
    plan_status: PLAN_STATUS_KEYS.includes(planStatus) ? planStatus : DEFAULT_PLAN_STATUS,
    domain: domain || null,
    related_ids: joinRelatedIds(relatedIds),
    // 상태가 바뀐 때에만 시각을 새로 찍는다. 제목만 고쳤는데 시각이 갱신되면
    // 7일째 멈춰 있던 계획이 '방금 움직인 것' 이 되어 정체 목록에서 빠져나간다.
    ...(statusChanged ? { plan_status_at: new Date().toISOString() } : {})
  }
}

// ── 스키마가 아직 없는 DB ──────────────────────────────────────

// setup.sql 을 아직 실행하지 않아 계획 열(또는 plan_domains 표)이 없는 DB 인지.
// PostgREST 는 없는 열에 PGRST204/42703, 없는 표에 PGRST205/42P01 을 준다.
const PLAN_WORDS = /horizon|plan_status|plan_domains|related_ids|\bdomain\b/i

export function isMissingPlanSchema(err) {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '')
  if (['42P01', 'PGRST205'].includes(code)) return /plan_domains/i.test(msg) || msg === ''
  if (['PGRST204', '42703'].includes(code)) return PLAN_WORDS.test(msg)
  return false
}

// items.horizon 이 있는지 한 번만 물어본다. 조회가 성공하면 있는 것이다.
// 🔴 '모르면 없다' 로 답한다 — 없는데 있다고 답하면 목록 조회가 통째로 실패한다.
export async function probePlanColumns() {
  if (!supabase) return false
  const { error } = await supabase.from('items').select('horizon').range(0, 0)
  return !error
}

// 영역 목록. 표가 없으면 기본 6개를 그대로 돌려준다(읽기 전용으로 보인다).
// 표는 있는데 행이 없으면(가입 트리거보다 먼저 만든 계정) 기본 6개를 그 자리에서 넣는다.
// spaces.js 의 loadSpaces 와 같은 규칙이다.
export async function loadDomains(userId) {
  if (!supabase) return { domains: BUILTIN_DOMAINS, ready: false }
  const { data, error } = await supabase
    .from('plan_domains')
    .select('key, name, color, position')
    .order('position', { ascending: true })
  if (error) return { domains: BUILTIN_DOMAINS, ready: false }

  const rows = data ?? []
  if (rows.length > 0) return { domains: rows, ready: true }

  const seed = BUILTIN_DOMAINS.map((d) => ({ ...d, user_id: userId }))
  const { error: seedErr } = await supabase.from('plan_domains').insert(seed)
  if (seedErr) return { domains: BUILTIN_DOMAINS, ready: false }
  return { domains: BUILTIN_DOMAINS, ready: true }
}

// 새 영역의 열쇠. 사람이 보는 이름과 따로 두는 이유는, 이름을 바꿔도 계획이
// 가리키는 곳이 바뀌면 안 되기 때문이다 (spaces.js 의 newSpaceKey 와 같다).
export function newDomainKey(domains) {
  const used = new Set((domains ?? []).map((d) => d.key))
  for (let n = (domains?.length ?? 0) + 1; ; n += 1) {
    const key = `domain-${n}`
    if (!used.has(key)) return key
  }
}

export async function createDomain({ userId, domains, name, color }) {
  const clean = String(name ?? '').trim()
  if (!clean) throw new Error('이름을 적어 주세요')
  if ((domains?.length ?? 0) >= MAX_DOMAINS) throw new Error(`영역은 최대 ${MAX_DOMAINS}개까지예요`)
  const position = (domains ?? []).reduce((max, d) => Math.max(max, d.position ?? 0), 0) + 1
  const row = {
    user_id: userId,
    key: newDomainKey(domains),
    name: clean,
    color: color || DOMAIN_COLOR_FALLBACK,
    position
  }
  const { error } = await supabase.from('plan_domains').insert(row)
  if (error) throw error
  return row
}

export async function updateDomain(key, fields) {
  const { error } = await supabase.from('plan_domains').update(fields).eq('key', key)
  if (error) throw error
}

// 순서 바꾸기 — 두 줄의 position 을 맞바꾼다.
// 🔴 격자의 세로 차례가 곧 이 값이라, 바꾸면 화면이 그대로 따라온다.
export async function swapDomainPosition(a, b) {
  await updateDomain(a.key, { position: b.position ?? 0 })
  await updateDomain(b.key, { position: a.position ?? 0 })
}
