// 아카이브 카드에서 바로 격자에 올리는 작은 창 (요구사항 5).
//
// 🔴 모달을 열지 않는다. 목록을 훑다가 '이건 계획이다' 싶은 순간에 항목 모달이 뜨면,
//    제목·본문·첨부까지 통째로 눈앞에 와서 하려던 일(격자에 올리기)이 뒤로 밀린다.
//    여기서 묻는 것은 **지평과 영역 둘뿐**이고, 나머지는 기본값으로 간다
//    (상태는 '계획', 관련 항목은 없음 — 둘 다 나중에 격자에서 바꿀 수 있다).
// 🔴 영역을 고르지 않아도 올릴 수 있다. 고르라고 막으면 '일단 올려 두기' 가 안 되고,
//    안 고른 것은 격자의 '미지정' 줄에 모여 나중에 정리된다.
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_HORIZON, HORIZONS } from '../plan.js'

export default function PlanQuickAdd({ domains, onAdd, onClose }) {
  const [horizon, setHorizon] = useState(DEFAULT_HORIZON)
  const [domain, setDomain] = useState(null)
  const boxRef = useRef(null)

  useEffect(() => {
    function onDown(e) {
      if (!boxRef.current?.contains(e.target)) onClose()
    }
    function onKey(e) {
      // 항목 모달의 Esc 와 겹치지 않게 여기서 멈춘다 — 작은 창 하나만 닫혀야 한다
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="plan-quick" ref={boxRef} role="dialog" aria-label="계획 격자에 올리기">
      <p className="plan-quick-head">계획 격자에 올리기</p>

      <div className="plan-quick-row">
        <span className="plan-field-label">지평</span>
        <div className="cat-select">
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              type="button"
              className={`chip ${horizon === h.key ? 'chip-on' : ''}`}
              onClick={() => setHorizon(h.key)}
              aria-pressed={horizon === h.key}
            >{h.name}</button>
          ))}
        </div>
      </div>

      <div className="plan-quick-row">
        <span className="plan-field-label">영역</span>
        <div className="cat-select">
          {(domains ?? []).map((d) => (
            <button
              key={d.key}
              type="button"
              className={`chip chip-dot-${d.color ?? 'gray'} ${domain === d.key ? 'chip-on' : ''}`}
              onClick={() => setDomain(domain === d.key ? null : d.key)}
              aria-pressed={domain === d.key}
            >{d.name}</button>
          ))}
        </div>
      </div>

      <div className="plan-quick-foot">
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>취소</button>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => onAdd({ horizon, domain })}
        >올리기</button>
      </div>
    </div>
  )
}
