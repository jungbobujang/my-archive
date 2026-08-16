// 이메일/비밀번호 로그인. 계정 생성은 Supabase 대시보드에서만 한다(가입 차단).
// 앱을 처음 보는 화면이라, 무엇을 하는 서비스인지 한 줄로 알 수 있게 해 둔다.
import { useState } from 'react'
import { supabase } from '../supabase.js'
import { useTheme, THEME_ICON, THEME_LABEL } from '../theme.js'

// 로그인 화면에서만 보여 주는 요약. 앱 안에 실제로 있는 기능만 적는다.
const HIGHLIGHTS = [
  { icon: '☀️', label: '오늘 할 것' },
  { icon: '🗂', label: '카테고리 · 태그' },
  { icon: '🗺️', label: '마인드맵' }
]

export default function Login() {
  const { pref: themePref, cycle: cycleTheme } = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력해 주세요')
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError('로그인 실패: 이메일 또는 비밀번호를 확인해 주세요')
    setBusy(false)
  }

  return (
    <div className="center-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <button
          type="button"
          className="login-theme"
          onClick={cycleTheme}
          title={`화면 테마: ${THEME_LABEL[themePref]} (눌러서 변경)`}
          aria-label={`화면 테마 ${THEME_LABEL[themePref]}, 눌러서 변경`}
        >{THEME_ICON[themePref]}</button>

        <div className="login-mark" aria-hidden="true">A</div>
        <h1>나의 아카이브</h1>
        <p className="login-sub">
          아이디어 · 대본 · 링크 · 할 일을 한곳에 모아 두는 나만의 아카이브
        </p>

        <ul className="login-highlights">
          {HIGHLIGHTS.map((h) => (
            <li key={h.label}>
              <span aria-hidden="true">{h.icon}</span> {h.label}
            </li>
          ))}
        </ul>

        <label>
          이메일
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError('') }}
            placeholder="name@example.com"
            autoComplete="email"
            autoFocus
          />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError('') }}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? '확인 중...' : '들어가기'}
        </button>
        <p className="login-hint">
          혼자 쓰는 아카이브라 가입 절차가 없습니다.
          계정은 Supabase 대시보드의 Authentication 에서 직접 만들어 주세요.
        </p>
      </form>
    </div>
  )
}
