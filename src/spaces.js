// 공간(space) — 한 계정 안에서 아카이브를 여러 서랍으로 나눈다.
//
// ── 왜 열 하나인가 ──────────────────────────────────────────────
//
// 항목·카테고리에 `space text` 한 열을 더하는 방식이다. 표를 나누거나(items_personal,
// items_class) 계정을 나누는 방식은 쓰지 않았다.
//   · 옮길 데이터가 없다. 기존 행은 열의 기본값(default 'personal')으로 전부 '개인'에
//     들어간다 — 마이그레이션이 `alter table ... add column` 한 줄이다.
//   · 조회가 그대로다. Archive 는 items 를 24개씩 select 하는데, 거기에 조건 하나가
//     붙을 뿐이다. 표를 나누면 목록·오늘·휴지통·마인드맵·백업이 전부 두 벌이 된다.
//   · 휴지통과 백업이 자연스럽게 '전 공간 통합' 이 된다 (요구사항 5).
//
// 공간의 이름·아이콘은 따로 `spaces` 표에 담는다. 항목이 들고 다니는 것은 **열쇠(key)**
// 뿐이라, 이름을 바꿔도 항목은 한 줄도 건드리지 않는다.
//
// ── 열이 없는 DB 에서도 앱은 돌아간다 ──────────────────────────
//
// SQL 은 사람이 직접 실행한다. 그 사이에도 앱이 멈추면 안 되므로, Archive 는 뜰 때
// 한 번 `items.space` 가 있는지 물어보고(probeSpaceColumn), 없으면 공간 기능만 접는다 —
// 전환기를 숨기고, 조회에 space 조건을 붙이지 않고, 저장할 때 space 를 보내지 않는다.
// 목록·검색·저장은 예전 그대로 돈다.
import { supabase } from './supabase.js'

export const DEFAULT_SPACE = 'personal'
export const MAX_SPACES = 5
export const SPACE_ICON_FALLBACK = '🗂'

// 기본 공간 2개. setup.sql 의 seed_defaults 와 **같은 값**이어야 한다 —
// 표가 아직 없는 DB 에서 화면이 보여 주는 목록도 이것이다.
export const BUILTIN_SPACES = [
  { key: 'personal', name: '개인', icon: '🏠', position: 1 },
  { key: 'class', name: '수업', icon: '🏫', position: 2 }
]

export const SPACE_SETUP_MESSAGE = '공간 표가 아직 없어요 — supabase/setup.sql 을 실행해 주세요'
export const SPACE_COLUMN_MESSAGE =
  '공간 기능을 쓰려면 supabase/setup.sql 을 실행해 주세요 — 지금은 모든 항목이 한 서랍에 있습니다'

// 이름·아이콘을 기기에 기억하는 키. 공간 선택은 '이 기기에서 지금 보고 있는 서랍' 이라
// 계정이 아니라 기기에 둔다 (보기 방식·탭과 같은 규칙).
export function spaceStorageKey(userId) {
  return `archive-space:${userId ?? 'anon'}`
}

export function readSpacePref(userId) {
  try {
    return localStorage.getItem(spaceStorageKey(userId)) || DEFAULT_SPACE
  } catch {
    return DEFAULT_SPACE
  }
}

export function writeSpacePref(userId, key) {
  try {
    localStorage.setItem(spaceStorageKey(userId), key)
  } catch { /* 시크릿 모드 등. 이번 세션만 기억되지 않을 뿐이다 */ }
}

// 행이 들고 있는 공간. 열이 없거나 비어 있으면 '개인' 이다 —
// 기존 자료는 전부 여기로 편입된다(열의 default 와 같은 규칙).
export function spaceOf(row) {
  const key = row?.space
  return typeof key === 'string' && key ? key : DEFAULT_SPACE
}

export function findSpace(spaces, key) {
  return (spaces ?? []).find((s) => s.key === key) ?? null
}

// "🏫 수업" — 모르는 열쇠도 빈칸으로 두지 않는다. 공간을 지운 적이 없어도
// 백업을 남의 계정에서 가져오면 목록에 없는 열쇠가 들어올 수 있다.
export function spaceLabel(spaces, key) {
  const one = findSpace(spaces, key)
  if (one) return `${one.icon ?? SPACE_ICON_FALLBACK} ${one.name}`
  return `${SPACE_ICON_FALLBACK} ${key ?? DEFAULT_SPACE}`
}

// 새 공간의 열쇠. 사람이 보는 이름과 따로 두는 이유는, 이름을 바꿔도 항목이
// 가리키는 곳이 바뀌면 안 되기 때문이다. 겹치면 뒷번호로 밀린다.
export function newSpaceKey(spaces) {
  const used = new Set((spaces ?? []).map((s) => s.key))
  for (let n = (spaces?.length ?? 0) + 1; ; n += 1) {
    const key = `space-${n}`
    if (!used.has(key)) return key
  }
}

// setup.sql 을 아직 실행하지 않아 space 열(또는 spaces 표)이 없는 DB 인지.
// PostgREST 는 없는 열에 PGRST204/42703, 없는 표에 PGRST205/42P01 을 준다.
export function isMissingSpaceSchema(err) {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '')
  // 없는 표: 이 함수는 공간 관련 조회에서만 불리므로 표 이름이 안 적혀 있어도 참으로 본다.
  if (['42P01', 'PGRST205'].includes(code)) return true
  // 없는 열: 'files' 같은 다른 열의 오류를 공간 문제로 오해하면 안 된다.
  if (['PGRST204', '42703'].includes(code)) return /space/i.test(msg)
  return false
}

// items.space 가 있는지 한 번만 물어본다. 조회가 성공하면 있는 것이다.
// 🔴 '모르면 없다' 로 답한다 — 없는데 있다고 답하면 목록 조회가 통째로 실패한다.
export async function probeSpaceColumn() {
  if (!supabase) return false
  const { error } = await supabase.from('items').select('space').range(0, 0)
  return !error
}

// 공간 목록. 표가 없으면 기본 2개를 그대로 돌려준다(읽기 전용으로 보인다).
// 표는 있는데 행이 없으면(가입 트리거보다 먼저 만든 계정) 기본 2개를 그 자리에서 넣는다.
export async function loadSpaces(userId) {
  if (!supabase) return { spaces: BUILTIN_SPACES, ready: false }
  const { data, error } = await supabase
    .from('spaces')
    .select('key, name, icon, position')
    .order('position', { ascending: true })
  if (error) return { spaces: BUILTIN_SPACES, ready: false }

  const rows = data ?? []
  if (rows.length > 0) return { spaces: rows, ready: true }

  const seed = BUILTIN_SPACES.map((s) => ({ ...s, user_id: userId }))
  const { error: seedErr } = await supabase.from('spaces').insert(seed)
  if (seedErr) return { spaces: BUILTIN_SPACES, ready: false }
  return { spaces: BUILTIN_SPACES, ready: true }
}

export async function createSpace({ userId, spaces, name, icon }) {
  const clean = String(name ?? '').trim()
  if (!clean) throw new Error('이름을 적어 주세요')
  if ((spaces?.length ?? 0) >= MAX_SPACES) throw new Error(`공간은 최대 ${MAX_SPACES}개까지예요`)
  const position = (spaces ?? []).reduce((max, s) => Math.max(max, s.position ?? 0), 0) + 1
  const row = {
    user_id: userId,
    key: newSpaceKey(spaces),
    name: clean,
    icon: icon || SPACE_ICON_FALLBACK,
    position
  }
  const { error } = await supabase.from('spaces').insert(row)
  if (error) throw error
  return row
}

export async function updateSpace(key, fields) {
  const { error } = await supabase.from('spaces').update(fields).eq('key', key)
  if (error) throw error
}
