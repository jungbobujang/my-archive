// 여러 모달이 똑같이 쓰던 자잘한 훅들.
import { useEffect, useRef } from 'react'

// 폰에서 키보드가 올라오면 "실제로 보이는 높이"가 줄어든다.
// 그런데 position: fixed 요소는 키보드와 무관하게 레이아웃 뷰포트 기준으로 남아 있어서,
// 세로 가운데 정렬된 모달은 아래쪽 입력칸이 키보드에 가려진다.
// visualViewport 높이를 --vvh 로 흘려 두고, 모달 최대 높이를 거기에 맞춘다.
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function apply() {
      document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    return () => vv.removeEventListener('resize', apply)
  }, [])
}

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
