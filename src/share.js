// 항목 단위 열람 전용 공유 링크.
//
// ── 왜 이렇게 만들었는가 (가짜 만료를 만들지 않기 위해) ──────────────────
//
// 이 앱은 서버가 없다. 브라우저가 anon 키로 Supabase 에 직접 붙는다. 그래서 "만료를
// 확인한다" 를 프론트에서 하면 그것은 검사가 아니라 **장식**이다 — 받은 사람이
// 개발자 도구를 열어 화면만 지워도 내용이 그대로 보이고, 애초에 데이터는 이미
// 브라우저까지 와 있다. 그래서 이 기능은 다음 한 줄로 요약된다:
//
//   **공유 항목은 items 를 직접 읽어서는 절대 나오지 않는다.**
//
// items 의 RLS 는 예전 그대로 `auth.uid() = user_id` 다. 로그인하지 않은 사람이
// items 를 어떤 방식으로 조회해도 0행이다. 공유 항목을 꺼내는 길은 딱 하나,
// `share_view(token)` 이라는 security definer 함수뿐이고, 그 함수 안에서
// **DB 가** 토큰의 존재·회수 여부·만료 시각을 본다. 만료된 토큰에는 항목 내용이
// 애초에 응답에 실리지 않는다 (화면을 가리는 것이 아니다).
//
// shares 표 자체도 anon 에게는 잠겨 있다. 토큰을 알아도 `from('shares').select()`
// 로는 한 줄도 못 읽는다 — expires_at 을 읽어 와서 프론트가 비교하는 구조를
// 원천적으로 막기 위해서다. 만료 시각은 share_view 가 '유효할 때만' 알려 준다.
//
// ── 첨부 파일 (요구사항 6: 만료와 같은 수명의 서명 주소) ─────────────────
//
// archive-files 는 비공개 버킷이라 anon 은 열 수 없다. 그렇다고 anon 에게 스토리지를
// 열어 줄 수도 없다(storage 정책에는 우리 토큰을 넘길 자리가 없다 — 커스텀 헤더는
// storage-api 를 통해 Postgres 까지 전달되지 않는다). 그래서 **링크를 만드는 순간
// 소유자가** 각 파일의 서명 주소를 만들고, 그 수명을 유효기간과 정확히 같게 준다
// (1일 링크 → 86400초 서명). 그 주소를 shares 행에 넣어 두고, share_view 가
// '아직 유효할 때만' 함께 돌려준다. 만료 뒤에는 주소를 얻을 길도 없고, 설령 먼저
// 받아 둔 주소가 있어도 스토리지가 같은 시각에 서명을 거부한다.
//
// 대신 이 구조에는 대가가 하나 있다: 링크를 만든 뒤에 항목에 파일을 더 붙이면 그
// 파일은 이미 만들어진 링크에 나타나지 않는다. 그때는 링크를 다시 만들면 된다.
// (본문·제목·이미지는 items 에서 그때그때 읽으므로 언제나 최신이다.)
//
// 이미지는 예전부터 공개 버킷(archive-images)에 있다. 공유 때문에 그 버킷을
// 비공개로 바꾸면 카드 썸네일·오늘 탭·마인드맵·이미 저장된 모든 image_url 이
// 한꺼번에 깨진다. 이번 작업의 범위를 넘으므로 건드리지 않았다 — REPORT-SHARE.md
// 에 남겨 두었다.
import { supabase, parseFiles, FILE_BUCKET } from './supabase.js'

// 고를 수 있는 유효기간. 화면의 칩과 검증이 같은 값을 본다.
export const SHARE_DAYS = [1, 7, 30]
export const SHARE_DAY_LABEL = { 1: '1일', 7: '7일', 30: '30일' }
export const DAY_MS = 24 * 60 * 60 * 1000

export const VIEW_ONLY_NOTE = '열람 전용 링크입니다'

// 주소는 /s/{토큰}. 토큰은 uuid(122비트 난수)라 찍어서 맞힐 수 없다.
export const SHARE_PATH_PREFIX = '/s/'
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 주소가 공유 링크 자리인지. 토큰이 망가져 있어도 참이다 —
// 그래야 '/s/아무거나' 가 로그인 화면이 아니라 "찾을 수 없는 링크" 로 간다.
export function isSharePath(pathname) {
  return String(pathname ?? '').startsWith(SHARE_PATH_PREFIX)
}

export function tokenFromPath(pathname) {
  const raw = String(pathname ?? '')
  if (!raw.startsWith(SHARE_PATH_PREFIX)) return null
  const token = decodeURIComponent(raw.slice(SHARE_PATH_PREFIX.length).replace(/\/+$/, ''))
  return TOKEN_RE.test(token) ? token : null
}

export function shareUrlFor(token, origin) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}${SHARE_PATH_PREFIX}${token}`
}

export function expiresAtFor(days, now = Date.now()) {
  return new Date(now + days * DAY_MS).toISOString()
}

// 서명 주소의 수명(초). 유효기간과 같게 준다 — 1초라도 더 살면 그만큼 가짜 만료다.
export function signSecondsFor(expiresAt, now = Date.now()) {
  return Math.max(60, Math.round((Date.parse(expiresAt) - now) / 1000))
}

// "2026-09-13 14:20" — 목록과 대화상자가 같은 표기를 쓴다.
export function formatWhen(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 남은 시간을 사람 말로. 소유자 목록에서 "언제까지인지" 를 한눈에 보여 준다.
// (이 값으로 무엇을 막지는 않는다 — 막는 것은 DB 다.)
export function remainingLabel(iso, now = Date.now()) {
  const left = Date.parse(iso) - now
  if (!Number.isFinite(left) || left <= 0) return '만료됨'
  const days = Math.floor(left / DAY_MS)
  if (days >= 1) return `${days}일 남음`
  const hours = Math.floor(left / (60 * 60 * 1000))
  if (hours >= 1) return `${hours}시간 남음`
  return `${Math.max(1, Math.round(left / 60000))}분 남음`
}

// setup.sql 을 아직 실행하지 않아 shares 표(또는 share_view 함수)가 없는 DB 인지.
// PostgREST 는 없는 표에 PGRST205/42P01, 없는 함수에 PGRST202 를 준다.
export function isMissingShareSchema(err) {
  const code = String(err?.code ?? '')
  if (['42P01', 'PGRST205', 'PGRST202', '42883'].includes(code)) return true
  return /shares|share_view/i.test(String(err?.message ?? '')) &&
    /does not exist|not find|schema cache/i.test(String(err?.message ?? ''))
}

export const SHARE_SETUP_MESSAGE = '공유 링크 표가 아직 없어요 — supabase/setup.sql 을 실행해 주세요'

// ── 소유자 쪽 ────────────────────────────────────────────────

// 링크 만들기. 파일이 있으면 유효기간과 같은 수명의 서명 주소를 함께 굳혀 둔다.
export async function createShare({ item, userId, days, now = Date.now() }) {
  const expiresAt = expiresAtFor(days, now)
  const seconds = signSecondsFor(expiresAt, now)

  const files = []
  for (const f of parseFiles(item?.files)) {
    const { data, error } = await supabase.storage
      .from(FILE_BUCKET)
      .createSignedUrl(f.path, seconds, { download: f.name })
    // 파일 하나를 못 서명했다고 링크 전체를 포기하지는 않는다 — 글은 나눠야 하고,
    // 빠진 파일은 목록에서 그냥 보이지 않는다(만들 때 알린다).
    if (error) {
      console.warn('[공유] 파일 서명 실패:', f.path, error)
      continue
    }
    files.push({ name: f.name, size: f.size, url: data.signedUrl })
  }

  const { data, error } = await supabase
    .from('shares')
    .insert({ item_id: item.id, user_id: userId, expires_at: expiresAt, files })
    .select('id, item_id, expires_at, revoked, created_at')
    .single()
  if (error) throw error
  return { ...data, signedCount: files.length }
}

// 소유자의 링크 목록. 회수됐거나 만료된 것은 보여 주지 않는다 — '공유 중인 링크' 이므로.
// 항목 제목은 items 에서 따로 받아 붙인다(RLS 로 본인 것만 온다).
export async function listShares() {
  const { data, error } = await supabase
    .from('shares')
    .select('id, item_id, expires_at, revoked, created_at')
    .eq('revoked', false)
    .order('created_at', { ascending: false })
  if (error) throw error

  const rows = (data ?? []).filter((r) => Date.parse(r.expires_at) > Date.now())
  const ids = [...new Set(rows.map((r) => r.item_id))]
  if (ids.length === 0) return []

  const { data: items, error: itemErr } = await supabase
    .from('items').select('id, title').in('id', ids)
  if (itemErr) throw itemErr
  const titleOf = new Map((items ?? []).map((i) => [i.id, i.title]))

  return rows.map((r) => ({ ...r, title: titleOf.get(r.item_id) ?? '(지워진 항목)' }))
}

// 회수. 행을 지우지 않고 revoked 를 세우는 이유는, 지우면 "이 링크가 왜 안 되는지"
// 를 되받는 사람에게 설명할 근거도 함께 사라지기 때문이다(없는 토큰과 구분이 안 된다).
export async function revokeShare(id) {
  const { error } = await supabase.from('shares').update({ revoked: true }).eq('id', id)
  if (error) throw error
}

// ── 받는 사람 쪽 ─────────────────────────────────────────────

// 열람. 유효성 판정은 전부 DB 안(share_view)에서 끝난다.
// 돌려주는 것: { ok: true, expires_at, item, files } 또는 { ok: false, reason }
export async function fetchShare(token) {
  const { data, error } = await supabase.rpc('share_view', { p_token: token })
  if (error) throw error
  return data ?? { ok: false, reason: 'not_found' }
}

export const SHARE_DEAD_TEXT = {
  expired: { title: '만료된 링크입니다', sub: '유효기간이 지나 더 이상 볼 수 없어요.' },
  revoked: { title: '회수된 링크입니다', sub: '보낸 사람이 이 링크를 거두었어요.' },
  not_found: { title: '찾을 수 없는 링크입니다', sub: '주소가 잘못되었거나 항목이 지워졌어요.' }
}

export function deadTextFor(reason) {
  return SHARE_DEAD_TEXT[reason] ?? SHARE_DEAD_TEXT.not_found
}

// ── 클립보드 ─────────────────────────────────────────────────
// navigator.clipboard 는 보안 컨텍스트에서만 있다. 없으면 옛 방식으로 물러선다 —
// 링크를 만들어 놓고 복사할 방법이 없으면 기능이 반쪽이 된다.
export async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // execCommand 로 한 번 더 해 본다
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand?.('copy') ?? false
    ta.remove()
    return !!ok
  } catch {
    return false
  }
}
