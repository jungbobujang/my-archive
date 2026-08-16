// 화면 아래에 잠깐 떴다 사라지는 알림.
// 모달 안에서는 인라인 문구(.form-error)를 쓰고, 모달 밖의 배경 작업 —
// 목록 불러오기, 별표/완료 토글, 빠른 저장, 백업 — 은 이 토스트로 알린다.
//
// 주의: useToast() 가 돌려주는 함수는 항상 같은 참조여야 한다.
// useCallback 의존성 배열에 들어가는 값이라, 매 렌더 새로 만들면 무한 재조회가 난다.
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext(null)

let seq = 0
const LIFETIME = { error: 5000, success: 2600, info: 3200 }

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])

  const dismiss = useCallback((id) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((message, tone) => {
    const id = ++seq
    setItems((prev) => [...prev.slice(-2), { id, message, tone }]) // 최대 3개까지만 쌓는다
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), LIFETIME[tone])
    return id
  }, [])

  const api = useMemo(() => ({
    error: (message) => push(message, 'error'),
    success: (message) => push(message, 'success'),
    info: (message) => push(message, 'info')
  }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.tone}`}
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <span className="toast-text">{t.message}</span>
            <button
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="알림 닫기"
            >✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 는 ToastProvider 안에서만 쓸 수 있어요')
  return ctx
}
