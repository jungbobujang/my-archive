// 잠금 화면. 뒤에 아무것도 비치지 않는 불투명 가림막 + PIN 입력만.
//
// 이 화면이 떠 있는 동안 Archive 는 본문을 아예 그리지 않는다(Archive.jsx 의 이른 return).
// 반투명으로 덮거나 display:none 으로 숨기는 방법도 있었지만, 그러면 글자가 DOM 에 남는다.
// 개발자 도구·읽어 주기 기능·화면 캡처로 그대로 읽히므로 '가렸다' 고 할 수 없다.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase.js'
import {
  PIN_LENGTH, MAX_FAILS, verifyPin, readFails, bumpFail, resetFails, startGrace
} from '../lock.js'

export default function LockScreen({ userId, onUnlock }) {
  const [pin, setPin] = useState('')
  const [fails, setFails] = useState(() => readFails(userId))
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const inputRef = useRef(null)

  // 잠긴 화면에서 할 수 있는 일이 이것뿐이므로 커서를 미리 놓아 둔다.
  useEffect(() => { inputRef.current?.focus() }, [])

  // 뒤 페이지를 굴리지 못하게 막는다. 가림막은 position: fixed 라 '보이는 만큼' 만 덮는데,
  // 뒤가 굴러가면 덮이지 않은 자리가 드러난다. 화면 캡처(전체 페이지)도 마찬가지다.
  useEffect(() => {
    const el = document.documentElement
    const before = el.style.overflow
    el.style.overflow = 'hidden'
    return () => { el.style.overflow = before }
  }, [])

  async function submit(value) {
    if (busy) return
    setBusy(true)
    setWrong(false)

    const ok = await verifyPin(userId, value)
    if (ok) {
      resetFails(userId)
      startGrace(userId)   // 방금 풀었으니 한동안은 유휴여도 다시 잠그지 않는다
      onUnlock()
      return
    }

    const n = bumpFail(userId)
    setFails(n)
    setPin('')
    setWrong(true)
    setBusy(false)
    inputRef.current?.focus()

    // 열 번을 틀리면 PIN 으로는 더 물어보지 않고 로그인부터 다시 받는다.
    // 세션이 끊기면 App 이 알아서 로그인 화면으로 되돌린다.
    if (n >= MAX_FAILS) {
      resetFails(userId)   // 다시 로그인한 사람에게 남은 횟수 0 을 물려주지 않는다
      try {
        await supabase?.auth.signOut()
      } catch (err) {
        console.warn('[잠금] 로그아웃하지 못했습니다:', err)
      }
    }
  }

  function onChange(e) {
    // 숫자만, 정해진 자릿수까지. 붙여넣기로 긴 값이 들어와도 여기서 잘린다.
    const next = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH)
    setPin(next)
    if (wrong) setWrong(false)
    if (next.length === PIN_LENGTH) submit(next)   // 자리를 채우면 바로 확인한다 (확인 버튼 없음)
  }

  const left = Math.max(0, MAX_FAILS - fails)

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="화면 잠금">
      <div className="lock-box">
        <div className="lock-mark" aria-hidden="true">🔒</div>
        <h1 className="lock-title">잠겨 있어요</h1>
        <p className="lock-sub">PIN {PIN_LENGTH}자리를 넣으면 이어서 볼 수 있어요.</p>

        {/* 값은 password 로 가린다. 어깨너머로 보이는 것까지 막는 것이 이 화면의 일이다. */}
        <input
          ref={inputRef}
          className={`lock-pin ${wrong ? 'lock-pin-wrong' : ''}`}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={PIN_LENGTH}
          value={pin}
          onChange={onChange}
          disabled={busy}
          aria-label="PIN 입력"
          aria-invalid={wrong}
        />

        <p className="lock-msg" role="status">
          {wrong
            ? `PIN 이 맞지 않아요 · ${left}번 더 틀리면 다시 로그인해야 해요`
            : busy ? '확인 중...' : ' '}
        </p>

        <p className="lock-hint">
          PIN 이 기억나지 않으면 아래에서 로그아웃한 뒤 다시 로그인하세요.
        </p>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={async () => {
            resetFails(userId)
            try {
              await supabase?.auth.signOut()
            } catch (err) {
              console.warn('[잠금] 로그아웃하지 못했습니다:', err)
            }
          }}
        >로그아웃</button>
      </div>
    </div>
  )
}
