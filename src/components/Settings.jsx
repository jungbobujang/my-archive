// 설정 모달. 지금 담긴 것은 화면 테마, 저장소 사용량, 플랜 표시(자리만)다.
// 플랜은 하드코딩된 '무료' — 구독 상태를 읽어 오는 곳이 아직 없다.
import { useEffect, useState } from 'react'
import { THEME_ICON, THEME_LABEL, THEME_ORDER } from '../theme.js'
import { useEscapeKey } from '../hooks.js'
import {
  supabase, fetchAllRows, totalFileBytes, formatBytes,
  STORAGE_QUOTA_BYTES, STORAGE_WARN_RATIO
} from '../supabase.js'
import {
  PIN_LENGTH, IDLE_CHOICES, cryptoReady, isValidPin,
  savePin, clearPin, readLockConfig, writeEnabled, writeIdleMinutes
} from '../lock.js'

export default function Settings({
  email, userId, themePref, onThemeChange, onOpenPricing, onLockChanged, onClose
}) {
  useEscapeKey(onClose)

  // 첨부 파일이 차지한 용량. items.files 의 size 를 더한다 —
  // 스토리지를 직접 훑으면(list) 폴더마다 요청이 붙고, 지워진 항목의 고아까지 세게 된다.
  // 우리가 세고 싶은 것은 '지금 항목에 붙어 있는 파일' 이다.
  const [used, setUsed] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let alive = true
    ;(async () => {
      try {
        const rows = await fetchAllRows('items', 'files')
        if (alive) setUsed(totalFileBytes(rows))
      } catch (err) {
        // files 열이 아직 없는 DB(setup.sql 미실행)면 여기로 온다. 게이지만 숨긴다.
        console.warn('[설정] 저장소 사용량을 읽지 못했습니다:', err)
      }
    })()
    return () => { alive = false }
  }, [])

  const ratio = used === null ? 0 : Math.min(1, used / STORAGE_QUOTA_BYTES)
  const warn = ratio > STORAGE_WARN_RATIO

  return (
    // 배경을 눌러도 닫지 않는다. 닫는 길은 ✕ · Esc 뿐이다 (모달 공통 규칙).
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="설정">
        <div className="modal-head">
          <h2>설정</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <section className="set-section">
          <h3 className="set-head">화면 테마</h3>
          <div className="cat-select" role="group" aria-label="화면 테마">
            {THEME_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                className={`chip ${themePref === key ? 'chip-on' : ''}`}
                onClick={() => onThemeChange(key)}
                aria-pressed={themePref === key}
              >{THEME_ICON[key]} {THEME_LABEL[key]}</button>
            ))}
          </div>
          <p className="set-hint">
            시스템으로 두면 폰이나 컴퓨터의 밝게/어둡게 설정을 그대로 따라갑니다.
          </p>
        </section>

        {used !== null && (
          <section className="set-section">
            <h3 className="set-head">저장소</h3>
            <div
              className="gauge"
              role="meter"
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="첨부 파일 저장소 사용량"
            >
              {/* 0 이어도 눈에 보이게 최소 폭을 준다 — 빈 막대는 '아직 못 읽었다' 로도 읽힌다 */}
              <span
                className={`gauge-fill ${warn ? 'gauge-warn' : ''}`}
                style={{ width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
              />
            </div>
            <p className="set-value">
              파일 {formatBytes(used)} / 1GB
              {warn && <span className="gauge-note"> · 80% 를 넘었어요</span>}
            </p>
            <p className="set-hint">
              항목에 붙어 있는 첨부 파일의 합계입니다. 이미지는 세지 않습니다.
            </p>
          </section>
        )}

        <LockSettings userId={userId} onChanged={onLockChanged} />

        <section className="set-section">
          <h3 className="set-head">플랜</h3>
          <div className="set-row">
            <span className="set-plan">
              <span className="badge badge-teal">무료</span>
              <span className="set-plan-note">모든 기능을 쓰고 있어요</span>
            </span>
            <button className="btn-ghost btn-sm" onClick={onOpenPricing}>요금제 보기</button>
          </div>
          {/* 구독 상태를 읽어 오는 곳이 아직 없다. 유료화할 때 이 자리를 채우면 된다. */}
        </section>

        <section className="set-section">
          <h3 className="set-head">계정</h3>
          <p className="set-value">{email}</p>
          <p className="set-hint">
            계정 정보 변경은 Supabase 대시보드의 Authentication 에서 합니다.
          </p>
        </section>
      </div>
    </div>
  )
}

// 자리비움 잠금 설정.
//
// PIN 은 이 기기에만 저장된다(계정이 아니라). 그래서 폰에서 건 PIN 이 컴퓨터에는 없고,
// 기기마다 따로 걸어야 한다 — 잠금을 쓰고 싶은 기기가 보통 하나뿐이라 이 편이 낫다.
// 자세한 이유는 src/lock.js 머리말에 적어 두었다.
function LockSettings({ userId, onChanged }) {
  const [cfg, setCfg] = useState(() => readLockConfig(userId))
  const [mode, setMode] = useState('idle')   // idle | new (등록·변경 입력 중)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 설정을 바꾸면 화면(잠금 감시)도 같이 다시 읽어야 한다.
  function sync() {
    setCfg(readLockConfig(userId))
    onChanged?.()
  }

  function reset() {
    setMode('idle'); setPin(''); setPin2(''); setError('')
  }

  const digits = (v) => v.replace(/\D/g, '').slice(0, PIN_LENGTH)

  async function register(e) {
    e.preventDefault()
    if (busy) return
    if (!isValidPin(pin)) { setError(`PIN 은 숫자 ${PIN_LENGTH}자리여야 해요`); return }
    if (pin !== pin2) { setError('두 번 넣은 PIN 이 서로 달라요'); return }
    setBusy(true)
    try {
      await savePin(userId, pin)
      reset()
      sync()
    } catch (err) {
      setError(err.message || 'PIN 을 저장하지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  // 보안 컨텍스트가 아니면 PIN 을 안전하게 둘 수가 없다. 반쪽으로 열어 두지 않는다.
  if (!cryptoReady()) {
    return (
      <section className="set-section">
        <h3 className="set-head">자리비움 잠금</h3>
        <p className="set-hint">
          이 브라우저에서는 PIN 을 안전하게 저장할 수 없어 잠금을 쓸 수 없어요
          (https 로 열면 됩니다).
        </p>
      </section>
    )
  }

  return (
    <section className="set-section">
      <h3 className="set-head">자리비움 잠금</h3>

      {!cfg.pinSet && mode === 'idle' && (
        <>
          <p className="set-hint">
            PIN 을 걸어 두면 자리를 뜬 사이 화면을 가릴 수 있어요. 걸기 전에는 꺼져 있습니다.
          </p>
          <button className="btn-ghost btn-sm" onClick={() => setMode('new')}>PIN 등록</button>
        </>
      )}

      {mode === 'new' && (
        <form className="lock-form" onSubmit={register}>
          <label className="lock-field">
            <span>새 PIN ({PIN_LENGTH}자리)</span>
            <input
              type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
              maxLength={PIN_LENGTH} value={pin}
              onChange={(e) => { setPin(digits(e.target.value)); setError('') }}
              aria-label="새 PIN"
            />
          </label>
          <label className="lock-field">
            <span>한 번 더</span>
            <input
              type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
              maxLength={PIN_LENGTH} value={pin2}
              onChange={(e) => { setPin2(digits(e.target.value)); setError('') }}
              aria-label="새 PIN 확인"
            />
          </label>
          {error && <p className="set-error">{error}</p>}
          <div className="lock-form-actions">
            <button type="submit" className="btn-primary btn-sm" disabled={busy}>
              {busy ? '저장 중...' : '저장'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={reset}>취소</button>
          </div>
        </form>
      )}

      {cfg.pinSet && mode === 'idle' && (
        <>
          <label className="set-row lock-toggle">
            <span>
              이 기기에서 자리비움 잠금 사용
              <span className="set-plan-note">기기마다 따로 켭니다</span>
            </span>
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => { writeEnabled(userId, e.target.checked); sync() }}
              aria-label="이 기기에서 자리비움 잠금 사용"
            />
          </label>

          <div className="cat-select" role="group" aria-label="잠기기까지 기다리는 시간">
            {IDLE_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${cfg.minutes === m ? 'chip-on' : ''}`}
                onClick={() => { writeIdleMinutes(userId, m); sync() }}
                aria-pressed={cfg.minutes === m}
                disabled={!cfg.enabled}
              >{m}분</button>
            ))}
          </div>
          <p className="set-hint">
            이만큼 아무 입력이 없으면 잠깁니다. 한 번 풀면 2시간 동안은 다시 잠기지 않아요.
            스위치를 꺼 두어도 헤더의 🔒 버튼(Ctrl+Shift+L)은 언제나 씁니다.
          </p>

          <div className="lock-form-actions">
            <button className="btn-ghost btn-sm" onClick={() => setMode('new')}>PIN 변경</button>
            <button
              className="btn-ghost btn-sm cm-del"
              onClick={() => {
                if (!window.confirm('PIN 을 지우면 자리비움 잠금이 꺼집니다. 지울까요?')) return
                clearPin(userId)
                sync()
              }}
            >PIN 지우기</button>
          </div>
        </>
      )}
    </section>
  )
}
