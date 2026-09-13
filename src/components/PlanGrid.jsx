// 격자 그 자체 — 지평(가로) × 영역(세로). **자료를 받아서 그리기만 한다.**
//
// 🔴 Plan.jsx 에서 떼어 낸 이유: 375px 점검이 이 격자를 띄워야 하는데, Plan 은 뜨자마자
//    Supabase 에 묻는다. 재려는 것은 '4칸이 한 줄에 들어가는가' 하나뿐인데 그것 때문에
//    로그인과 DB 를 흉내 내야 한다면, 점검이 재려는 것과 상관없는 이유로 흔들린다
//    (모션·공간 점검에서 이미 같은 판단을 했다 — scripts/mobile-harness/main.jsx).
//    조회는 Plan 이 하고, 그리는 일은 여기가 한다.
//
// 좁은 화면에서 접는 상태(collapsed)도 여기 둔다. 그리는 일에 딸린 값이라
// 조회하는 쪽이 알 필요가 없다.
import { useState } from 'react'
import { HORIZONS, domainColor, horizonLabel } from '../plan.js'
import { useNarrow } from '../hooks.js'
import PlanCard from './PlanCard.jsx'

export default function PlanGrid({ grid, domains, onStatus, onOpen }) {
  const narrow = useNarrow()
  const [collapsed, setCollapsed] = useState(() => new Set())

  function toggleRow(key) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className={`plan-grid ${narrow ? 'plan-grid-narrow' : ''}`}>
      {/* 가로축 머리. 좁은 화면에서는 숨고, 대신 칸마다 지평 이름이 붙는다. */}
      {!narrow && (
        <div className="plan-grid-head" role="presentation">
          <span className="plan-axis-corner" aria-hidden="true" />
          {HORIZONS.map((h) => (
            <div key={h.key} className="plan-col-head">
              {h.name} <small>{h.sub}</small>
            </div>
          ))}
        </div>
      )}

      {grid.rows.map((row) => {
        const shut = narrow && collapsed.has(row.domain.key)
        return (
          <section
            key={row.domain.key}
            className={`plan-row plan-row-${row.domain.color ?? 'gray'}${shut ? ' plan-row-shut' : ''}`}
          >
            {/* 좁은 화면에서만 눌러서 접는다. 넓은 화면에서는 그냥 이름표다 —
                접을 수 있는 것처럼 보이면 눌러 보게 되고, 눌러도 아무 일이 없다. */}
            {narrow ? (
              <button
                type="button"
                className="plan-row-head plan-row-toggle"
                onClick={() => toggleRow(row.domain.key)}
                aria-expanded={!shut}
              >
                <span className="plan-row-name">{row.domain.name}</span>
                <span className="plan-row-count">{row.count}</span>
                <span className="plan-row-caret" aria-hidden="true">{shut ? '▸' : '▾'}</span>
              </button>
            ) : (
              <h3 className="plan-row-head">
                <span className="plan-row-name">{row.domain.name}</span>
                <span className="plan-row-count">{row.count}</span>
              </h3>
            )}

            {!shut && (
              <div className="plan-row-cells">
                {row.cells.map((cell) => (
                  <div
                    key={cell.horizon}
                    className={`plan-cell${cell.items.length === 0 ? ' plan-cell-empty' : ''}`}
                  >
                    <div className="plan-cell-head">
                      <span className="plan-cell-when">{horizonLabel(cell.horizon)}</span>
                      <span className="plan-cell-count">{cell.items.length}</span>
                    </div>
                    {cell.items.length === 0 ? (
                      /* 🔴 '비어 있음' 을 글자로 적는다. 빈 네모만 두면 여백으로 읽혀
                         한쪽에 몰려 있는 것이 눈에 들어오지 않는다 (요구사항 3). */
                      <p className="plan-cell-none">비어 있음</p>
                    ) : (
                      cell.items.map((it) => (
                        <PlanCard
                          key={it.id}
                          item={it}
                          color={domainColor(domains, row.domain.key)}
                          onStatus={onStatus}
                          onOpen={onOpen}
                        />
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
