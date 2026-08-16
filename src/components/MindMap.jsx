import { useMemo } from 'react'
import { childrenOf } from '../supabase.js'

const W = 760
const H = 620
const CX = W / 2
const CY = H / 2
const R_ROOT = 168
const R_CHILD = 268

function polar(angle, radius) {
  return { x: CX + Math.cos(angle) * radius, y: CY + Math.sin(angle) * radius }
}

export default function MindMap({ categories, counts, onSelect }) {
  const nodes = useMemo(() => {
    const roots = childrenOf(categories, null)
    if (roots.length === 0) return { roots: [], edges: [] }

    const laid = []
    const edges = []
    const step = (Math.PI * 2) / roots.length

    roots.forEach((root, i) => {
      const angle = i * step - Math.PI / 2
      const pos = polar(angle, R_ROOT)
      const kids = childrenOf(categories, root.id)

      // 3단계 이상은 그리지 않고 부모에 +N 으로 요약한다
      const deeper = kids.reduce((n, k) => n + childrenOf(categories, k.id).length, 0)

      laid.push({ cat: root, ...pos, depth: 1, extra: deeper })
      edges.push({ x1: CX, y1: CY, x2: pos.x, y2: pos.y, color: root.color })

      if (kids.length > 0) {
        // 부모가 차지한 각도 구간 안에서만 부채꼴로 펼친다
        const spread = Math.min(step * 0.8, 0.5 * kids.length + 0.3)
        const start = angle - spread / 2
        const gap = kids.length === 1 ? 0 : spread / (kids.length - 1)

        kids.forEach((kid, j) => {
          const kAngle = kids.length === 1 ? angle : start + j * gap
          const kPos = polar(kAngle, R_CHILD)
          laid.push({ cat: kid, ...kPos, depth: 2, extra: 0 })
          edges.push({ x1: pos.x, y1: pos.y, x2: kPos.x, y2: kPos.y, color: kid.color })
        })
      }
    })

    return { roots: laid, edges }
  }, [categories])

  if (categories.length === 0) {
    return (
      <div className="empty">
        <p>카테고리가 없어요. ⚙️ 에서 먼저 만들어 보세요.</p>
      </div>
    )
  }

  return (
    <div className="mindmap-wrap">
      <svg
        className="mindmap"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="카테고리 마인드맵"
      >
        {nodes.edges.map((e, i) => (
          <line
            key={i}
            className={`mm-edge mm-stroke-${e.color ?? 'gray'}`}
            x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          />
        ))}

        <g
          className="mm-node"
          onClick={() => onSelect(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') onSelect(null) }}
          aria-label="전체 보기"
        >
          <circle className="mm-center" cx={CX} cy={CY} r={52} />
          <text className="mm-center-text" x={CX} y={CY - 3} textAnchor="middle">나의</text>
          <text className="mm-center-text" x={CX} y={CY + 13} textAnchor="middle">아카이브</text>
        </g>

        {nodes.roots.map((n) => {
          const w = n.depth === 1 ? 124 : 104
          const h = n.depth === 1 ? 46 : 38
          const color = n.cat.color ?? 'gray'
          const label = n.cat.name.length > 7 ? `${n.cat.name.slice(0, 7)}…` : n.cat.name
          return (
            <g
              key={n.cat.id}
              className="mm-node"
              onClick={() => onSelect(n.cat.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') onSelect(n.cat.id) }}
              aria-label={`${n.cat.name} ${counts[n.cat.id] ?? 0}개`}
            >
              <rect
                className={`mm-box mm-fill-${color}`}
                x={n.x - w / 2} y={n.y - h / 2}
                width={w} height={h} rx={11}
              />
              <text
                className={`mm-label mm-text-${color}`}
                x={n.x} y={n.y - (n.depth === 1 ? 3 : 1)}
                textAnchor="middle"
              >
                {n.cat.icon} {label}
              </text>
              <text
                className={`mm-count mm-text-${color}`}
                x={n.x} y={n.y + (n.depth === 1 ? 14 : 12)}
                textAnchor="middle"
              >
                {counts[n.cat.id] ?? 0}개{n.extra > 0 ? ` +${n.extra}` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
