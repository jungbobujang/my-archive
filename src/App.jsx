// 인증 게이트 + 아주 작은 라우터.
// 화면이 셋(앱 / 요금제 / 공유 링크)뿐이라 라우팅 라이브러리 없이 History API 로 처리한다.
// /pricing · /s/{토큰} 을 주소창에 바로 쳐도 열려야 하므로, 정적 호스팅에서는 SPA 폴백이
// 필요하다 (vite preview 는 기본으로 해 준다. 서비스워커도 문서 요청은 index.html 로 폴백한다).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import Login from './components/Login.jsx'
import Archive from './components/Archive.jsx'
import Pricing from './components/Pricing.jsx'
import SharePage from './components/SharePage.jsx'
import { isSharePath, tokenFromPath } from './share.js'
import { useToast } from './components/Toast.jsx'
import { useVisualViewport } from './hooks.js'

export default function App() {
  const toast = useToast()
  useVisualViewport()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    function onPop() { setPath(window.location.pathname) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to) => {
    if (to === window.location.pathname) return
    window.history.pushState({}, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }, [])

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

  // 요금제는 로그인 없이도 볼 수 있어야 한다
  if (path === '/pricing') return <Pricing onBack={() => navigate('/')} />

  const isShare = isSharePath(path)

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

  // 공유 링크는 로그인과 무관하다. 세션 조회가 끝나기를 기다리지도 않고,
  // 로그인돼 있어도 이 주소는 공유 화면을 보여 준다 — 보낸 사람이 '받는 사람에게
  // 무엇이 보이는지' 를 그대로 확인할 수 있어야 한다.
  // Archive 를 그리지 않으므로 자리비움 잠금(PIN)도 이 화면에는 붙지 않는다.
  if (isShare) return <SharePage token={tokenFromPath(path)} />

  if (loading) return <div className="center-page"><div className="spinner" aria-label="불러오는 중" /></div>

  return session
    ? <Archive session={session} onNavigate={navigate} />
    : <Login />
}
