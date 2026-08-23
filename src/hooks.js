// 여러 모달이 똑같이 쓰던 자잘한 훅들.
import { useEffect, useRef } from 'react'
import { IDLE_TICK_MS } from './lock.js'

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

// 자리비움 감시. 정해진 시간 동안 입력·터치·스크롤이 없으면 onIdle 을 부른다.
//
// setTimeout 을 한 번 걸어 두지 않고 짧은 간격으로 '마지막 움직임' 을 들여다보는 이유:
// 노트북 덮개를 닫으면 타이머가 그대로 멈춰 있다가 깨어난 뒤에 남은 시간만큼 더 기다린다.
// 시각을 재서 비교하면 덮개를 열자마자 '그동안 유휴였다' 를 알아본다.
//
// capture 로 듣는 이유: 모달 안쪽처럼 따로 스크롤되는 영역의 움직임도 세어야 한다.
// passive 로 두는 이유: 스크롤·터치를 한 박자도 늦추지 않기 위해서다.
export function useIdleLock({ enabled, minutes, onIdle }) {
  const fire = useRef(onIdle)
  useEffect(() => { fire.current = onIdle })

  useEffect(() => {
    if (!enabled) return
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove']
    let last = Date.now()
    const bump = () => { last = Date.now() }

    for (const name of events) {
      window.addEventListener(name, bump, { passive: true, capture: true })
    }
    const timer = setInterval(() => {
      if (Date.now() - last >= minutes * 60_000) fire.current()
    }, IDLE_TICK_MS)

    return () => {
      clearInterval(timer)
      for (const name of events) window.removeEventListener(name, bump, { capture: true })
    }
  }, [enabled, minutes])
}

// 닫기 전에 한 번 물어본다. 쓰던 게 없으면 묻지 않는다.
// 배경 클릭·포커스 이동으로는 어떤 모달도 닫히지 않으므로, 이 확인은 Esc 에만 붙는다
// (✕ · 취소는 눌러야 닿는 자리라 그냥 닫는다).
export function confirmDiscard(dirty, message = '작성 중인 내용이 있습니다. 닫을까요?') {
  return !dirty || window.confirm(message)
}
