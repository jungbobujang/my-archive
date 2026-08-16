// 인증 게이트. 세션이 있으면 아카이브, 없으면 로그인 화면을 보여준다.
import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import Login from './components/Login.jsx'
import Archive from './components/Archive.jsx'
import { useToast } from './components/Toast.jsx'

export default function App() {
  const toast = useToast()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) toast.error('로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요')
      setSession(data?.session ?? null)
      setLoading(false)
    }).catch(() => {
      toast.error('서버에 연결하지 못했어요. 연결 상태를 확인해 주세요')
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [toast])

  if (!supabase) {
    return (
      <div className="center-page">
        <div className="setup-notice">
          <h1>환경변수 설정이 필요해요</h1>
          <p>
            프로젝트 루트에 <code>.env</code> 파일을 만들고
            <code>.env.example</code>을 참고해 Supabase URL과 anon key를 넣은 뒤
            다시 실행해 주세요.
          </p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="center-page"><div className="spinner" aria-label="불러오는 중" /></div>

  return session ? <Archive session={session} /> : <Login />
}
