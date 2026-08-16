// 여러 모달이 똑같이 쓰던 자잘한 훅들.
import { useEffect, useRef } from 'react'

// Esc 로 닫기. 모달 5곳에 같은 코드가 있었고, 그중 일부는 의존성 배열이 없어
// 매 렌더마다 리스너를 붙였다 뗐다 했다.
export function useEscapeKey(handler, enabled = true) {
  const ref = useRef(handler)
  useEffect(() => { ref.current = handler })

  useEffect(() => {
    if (!enabled) return
    function onKey(e) {
      if (e.key === 'Escape') ref.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
