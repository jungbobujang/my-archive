// 자리비움 잠금 — 기기 단위 설정과 PIN 보관.
//
// 왜 계정이 아니라 기기(localStorage) 단위인가:
// 자리를 뜨는 상황은 기기마다 다르다. 교무실 공용 컴퓨터에서는 켜고 싶고 집 노트북에서는
// 성가시다. 계정에 걸면 한쪽 사정이 다른 쪽까지 따라간다. 그래서 켜고 끄는 것도, 유예시간도
// 기기마다 고른다. 덕분에 DB 스키마 변경이 없다 — 이번 작업은 setup.sql 을 건드리지 않는다.
//
// PIN 보관에 대하여 (솔직히 적어 둔다):
// 평문으로 두지 않는다. 다만 4자리 숫자는 경우의 수가 1만 개뿐이라, 해시만으로는
// 기기를 손에 넣은 사람을 오래 막지 못한다. 그래서 SHA-256 한 번이 아니라 PBKDF2 를
// 20만 번 돌린다 — 한 번 맞춰 보는 데 0.1초쯤 걸리게 만들어, 1만 개를 전부 훑으면
// 20분 남짓이 되도록 한 것이다. 이 기능이 막으려는 것은 '잠깐 자리를 비운 사이 지나가던
// 사람이 화면을 보는 것' 이지, 기기를 가져가 분석하는 사람이 아니다.
// 진짜 비밀은 이 잠금이 아니라 Supabase 로그인이 지킨다.

export const PIN_LENGTH = 4
export const IDLE_CHOICES = [5, 15, 30]   // 분
export const IDLE_DEFAULT_MIN = 15
export const MAX_FAILS = 10
export const GRACE_MS = 2 * 60 * 60 * 1000   // 풀고 나서 2시간은 유휴여도 다시 안 잠근다
export const IDLE_TICK_MS = 10_000           // 유휴 판정을 들여다보는 간격
export const PBKDF2_ITERATIONS = 200_000

const keyOf = (uid, name) => `ma:lock:${name}:${uid}`

// 시크릿 모드·용량 초과에서도 앱이 멈추지 않아야 한다. 못 읽으면 '설정 없음' 과 같게 다룬다.
function readRaw(uid, name) {
  try {
    return localStorage.getItem(keyOf(uid, name))
  } catch {
    return null
  }
}

function writeRaw(uid, name, value) {
  try {
    if (value === null) localStorage.removeItem(keyOf(uid, name))
    else localStorage.setItem(keyOf(uid, name), value)
  } catch (err) {
    // 저장이 안 되면 잠금 설정이 이번 세션에만 남는다. 조용히 삼키지는 않는다.
    console.warn('[잠금] 설정을 저장하지 못했습니다:', err)
  }
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex) => new Uint8Array((String(hex).match(/../g) ?? []).map((h) => parseInt(h, 16)))

// crypto.subtle 은 보안 컨텍스트(https · localhost)에서만 있다.
// 없으면 PIN 을 안전하게 둘 방법이 없으므로 기능 자체를 열지 않는다 — 평문으로 물러서지 않는다.
export function cryptoReady() {
  return typeof crypto !== 'undefined' && !!(crypto && crypto.subtle)
}

export function isValidPin(pin) {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(String(pin ?? ''))
}

async function derive(pin, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, 256
  )
  return toHex(new Uint8Array(bits))
}

// 길이가 달라도 일찍 빠져나가지 않는다. 로컬 비교라 큰 의미는 없지만, 비교는 비교답게 둔다.
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── PIN ──────────────────────────────────────────────────────
export function readPinRecord(uid) {
  const raw = readRaw(uid, 'pin')
  if (!raw) return null
  try {
    const rec = JSON.parse(raw)
    // 값이 깨졌으면 없는 것으로 본다. 깨진 기록으로 잠기면 풀 방법이 없다.
    if (!rec || !rec.salt || !rec.hash || !rec.iterations) return null
    return rec
  } catch {
    return null
  }
}

export function isPinSet(uid) {
  return readPinRecord(uid) !== null
}

export async function savePin(uid, pin) {
  if (!isValidPin(pin)) throw new Error(`PIN 은 숫자 ${PIN_LENGTH}자리여야 해요`)
  if (!cryptoReady()) throw new Error('이 브라우저에서는 PIN 을 안전하게 저장할 수 없어요')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS)
  writeRaw(uid, 'pin', JSON.stringify({
    v: 1, salt: toHex(salt), iterations: PBKDF2_ITERATIONS, hash
  }))
  resetFails(uid)
}

export async function verifyPin(uid, pin) {
  const rec = readPinRecord(uid)
  if (!rec || !cryptoReady() || !isValidPin(pin)) return false
  const hash = await derive(pin, fromHex(rec.salt), rec.iterations)
  return sameSecret(hash, rec.hash)
}

// PIN 을 지우면 잠금 기능이 통째로 꺼진다 — 켜 둔 스위치·실패 횟수·유예도 같이 치운다.
// 남겨 두면 나중에 PIN 을 다시 걸었을 때 예전 상태가 되살아나 놀라게 된다.
export function clearPin(uid) {
  for (const name of ['pin', 'enabled', 'fails', 'grace']) writeRaw(uid, name, null)
}

// ── 기기 설정 ────────────────────────────────────────────────
export function readEnabled(uid) {
  return readRaw(uid, 'enabled') === '1'   // 기본값 꺼짐
}

export function writeEnabled(uid, on) {
  writeRaw(uid, 'enabled', on ? '1' : null)
}

export function readIdleMinutes(uid) {
  const n = Number(readRaw(uid, 'minutes'))
  return IDLE_CHOICES.includes(n) ? n : IDLE_DEFAULT_MIN
}

export function writeIdleMinutes(uid, minutes) {
  writeRaw(uid, 'minutes', IDLE_CHOICES.includes(minutes) ? String(minutes) : null)
}

// 화면이 잠금을 어떻게 다뤄야 하는지 한 번에 알려 주는 묶음.
export function readLockConfig(uid) {
  const pinSet = isPinSet(uid)
  return {
    pinSet,
    // PIN 이 없으면 켜져 있어도 켜진 것이 아니다 — 풀 방법이 없는 잠금은 걸지 않는다.
    enabled: pinSet && readEnabled(uid),
    minutes: readIdleMinutes(uid)
  }
}

// ── 실패 횟수 ────────────────────────────────────────────────
// 새로고침으로 초기화되면 세는 의미가 없어서 localStorage 에 둔다.
export function readFails(uid) {
  const n = Number(readRaw(uid, 'fails'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function bumpFail(uid) {
  const n = readFails(uid) + 1
  writeRaw(uid, 'fails', String(n))
  return n
}

export function resetFails(uid) {
  writeRaw(uid, 'fails', null)
}

// ── 해제 뒤 유예 ─────────────────────────────────────────────
// "방금 풀었는데 또" 를 막는다. 자리에 앉아 생각만 하고 있어도 유휴로 세기 때문에,
// 유예가 없으면 잠금을 푼 직후 다시 잠기는 일이 반복된다.
export function startGrace(uid, now = Date.now()) {
  writeRaw(uid, 'grace', String(now + GRACE_MS))
}

export function graceUntil(uid) {
  const n = Number(readRaw(uid, 'grace'))
  return Number.isFinite(n) ? n : 0
}

export function inGrace(uid, now = Date.now()) {
  return now < graceUntil(uid)
}

// 수동 잠금은 유예를 무시한다 — 사람이 직접 누른 것이 유예보다 우선이다.
// 그래서 잠글 때 유예를 걷어낸다. 안 그러면 풀자마자 2시간 동안 자동 잠금이 죽는다.
export function endGrace(uid) {
  writeRaw(uid, 'grace', null)
}
