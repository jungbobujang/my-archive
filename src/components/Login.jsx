import { useState } from 'react'
import { supabase } from '../supabase.js'

export default function Login() {
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
        <div className="login-mark">A</div>
        <h1>나의 아카이브</h1>
        <p className="login-sub">아이디어, 대본, 이미지를 한곳에</p>
        <label>
          이메일
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError('') }}
            placeholder="name@example.com"
            autoComplete="email"
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
          계정은 Supabase 대시보드의 Authentication에서 직접 만들어 주세요.
        </p>
      </form>
    </div>
  )
}
