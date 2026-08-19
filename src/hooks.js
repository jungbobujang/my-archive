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

// ── 작성 중인 내용 임시 보존 ─────────────────────────────────────────────
// 모달이 어떤 이유로든 닫히거나 탭이 새로고침돼도 쓰던 값이 남아 있게 한다.
// sessionStorage 를 쓰는 이유: 탭을 닫으면 같이 사라진다. localStorage 였다면
// 몇 달 전에 쓰다 만 초안이 계속 되살아난다.
// 키는 항목 id 기준이라 여러 항목을 오가며 편집해도 서로 안 섞인다 (새 항목은 'new').
export function draftKeyFor(itemId) {
  return `ma:draft:${itemId ?? 'new'}`
}

export function readDraft(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null // 시크릿 모드·용량 초과 등. 초안이 없는 것과 같게 다룬다.
  }
}

export function writeDraft(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    // 저장 못 해도 작성 자체는 계속돼야 한다. 조용히 삼키지는 않는다.
    console.warn('[draft] 임시 저장 실패:', err)
  }
}

export function clearDraft(key) {
  try {
    sessionStorage.removeItem(key)
  } catch { /* 지우기 실패는 무시해도 된다 */ }
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
