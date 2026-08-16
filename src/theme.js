// 테마 설정. 저장값은 'system' | 'light' | 'dark' 세 가지고,
// 실제로 <html data-theme> 에 들어가는 값은 언제나 'light' 또는 'dark' 로 확정된다.
// (index.html 의 부트스트랩 스크립트가 첫 페인트 전에 같은 규칙으로 한 번 적용한다)
import { useCallback, useEffect, useState } from 'react'

export const THEME_KEY = 'archive-theme'
export const THEME_ORDER = ['system', 'light', 'dark']
export const THEME_LABEL = { system: '시스템', light: '라이트', dark: '다크' }
export const THEME_ICON = { system: '🖥', light: '☀️', dark: '🌙' }

const BAR_COLOR = { light: '#f4f4f1', dark: '#191b17' }

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return THEME_ORDER.includes(saved) ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref
  return darkQuery().matches ? 'dark' : 'light'
}

export function applyTheme(pref) {
  const resolved = resolveTheme(pref)
  document.documentElement.dataset.theme = resolved
  // 스탠드얼론(홈 화면 앱)에서 상태 표시줄 색을 배경과 맞춘다
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', BAR_COLOR[resolved])
  return resolved
}

export function useTheme() {
  const [pref, setPref] = useState(readTheme)

  useEffect(() => {
    applyTheme(pref)
    try {
      localStorage.setItem(THEME_KEY, pref)
    } catch { /* 시크릿 모드 등에서 저장이 막혀도 화면은 정상 동작한다 */ }
  }, [pref])

  // '시스템'일 때만 OS 설정 변화를 따라간다
  useEffect(() => {
    if (pref !== 'system') return
    const mq = darkQuery()
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const cycle = useCallback(() => {
    setPref((p) => THEME_ORDER[(THEME_ORDER.indexOf(p) + 1) % THEME_ORDER.length])
  }, [])

  return { pref, setPref, cycle }
}
