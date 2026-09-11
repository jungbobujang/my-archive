// 상단 헤더의 공간(서랍) 전환기.
//
// 🔴 **지금 어느 서랍인지를 언제나 적는다.** 목록이 비어 보일 때 "왜 없지" 의 답이
//    여기 있어야 한다. 그래서 아이콘만 남기는 축약은 좁은 화면에서도 하지 않는다
//    (이름을 자를 뿐이다 — styles.css 의 .space-current).
//
// 세그먼트가 아니라 드롭다운인 이유: 공간은 최대 5개이고 이름은 사람이 직접 짓는다.
// 다섯 칸을 한 줄에 늘어놓으면 380px 에서 헤더가 통째로 밀린다 — 실제로 상단 보조
// 버튼들이 그 이유로 ⋯ 메뉴가 되었다(styles.css 의 .more-menu 주석).
//
// Archive 에서 떼어 둔 이유는 좁은 화면 점검(check:mobile)이 이 조각만 따로 띄워
// 재기 때문이다. 헤더 전체를 띄우려면 로그인·Supabase 를 흉내 내야 하는데,
// 그것은 '헤더가 375px 에서 밀리는가' 와 아무 상관이 없다.
import { useEffect, useRef, useState } from 'react'
import { SPACE_ICON_FALLBACK, findSpace } from '../spaces.js'

export default function SpaceSwitcher({ spaces, current, onSelect, onManage }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (!boxRef.current?.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!spaces || spaces.length === 0) return null

  const here = findSpace(spaces, current)

  return (
    <div className="space-switch" ref={boxRef}>
      <button
        type="button"
        className="space-current"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`공간 바꾸기 (지금 ${here?.name ?? current})`}
        title="공간 바꾸기"
      >
        <span className="space-icon" aria-hidden="true">{here?.icon ?? SPACE_ICON_FALLBACK}</span>
        <span className="space-name">{here?.name ?? current}</span>
        <span className="space-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="space-menu" role="menu">
          {spaces.map((s) => (
            <button
              key={s.key}
              type="button"
              role="menuitemradio"
              aria-checked={s.key === current}
              className={`space-opt ${s.key === current ? 'space-opt-on' : ''}`}
              onClick={() => { setOpen(false); onSelect(s.key) }}
            >
              <span aria-hidden="true">{s.icon ?? SPACE_ICON_FALLBACK}</span>
              <span className="space-opt-name">{s.name}</span>
              {s.key === current && <span className="space-tick" aria-hidden="true">✓</span>}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="space-opt space-opt-manage"
            onClick={() => { setOpen(false); onManage() }}
          >⚙️ 공간 관리</button>
        </div>
      )}
    </div>
  )
}
