// 카테고리 계층을 방사형 SVG 로 그린다. 2단계까지만 그리고 그 아래는 부모에 +N 으로 접는다.
// 노드의 + 버튼으로 하위 카테고리를 그 자리에서 추가할 수 있다.
import { useMemo, useState } from 'react'
import { childrenOf } from '../supabase.js'

const W = 760
const H = 620
const CX = W / 2
const CY = H / 2
const R_ROOT = 168
const R_CHILD = 268
const R_CENTER = 52

const INPUT_W = 168
const INPUT_H = 34

// addingFor 는 3상태: undefined = 닫힘, null = 중앙(최상위 추가), 문자열 = 해당 노드 id
const CLOSED = undefined

function polar(angle, radius) {
  return { x: CX + Math.cos(angle) * radius, y: CY + Math.sin(angle) * radius }
}

function nodeSize(depth) {
  return depth === 1 ? { w: 124, h: 46 } : { w: 104, h: 38 }
}

// 노드에 붙는 + 버튼. 컴포넌트 밖에 둬야 렌더마다 새 타입이 되어 다시 마운트되지 않는다.
function AddButton({ cx, cy, id, label, onOpen }) {
  return (
    <g
      className="mm-add"
      onClick={(e) => onOpen(e, id)}
      onMouseDown={(e) => e.stopPropagation()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onOpen(e, id) }
      }}
      aria-label={label}
    >
      {/* 보이지 않는 넓은 터치 영역. SVG 가 축소돼 그려지는 폰에서 점만으로는 누르기 어렵다 */}
      <circle className="mm-add-hit" cx={cx} cy={cy} r={22} />
      <circle className="mm-add-dot" cx={cx} cy={cy} r={11} />
      <text className="mm-add-sign" x={cx} y={cy + 4.5} textAnchor="middle">+</text>
    </g>
  )
}

export default function MindMap({ categories, counts, onSelect, onAdd }) {
  const [addingFor, setAddingFor] = useState(CLOSED)
  const [draft, setDraft] = useState('')

  const nodes = useMemo(() => {
    const roots = childrenOf(categories, null)
    if (roots.length === 0) return { laid: [], edges: [] }

    const laid = []
    const edges = []
    const step = (Math.PI * 2) / roots.length

    roots.forEach((root, i) => {
      const angle = i * step - Math.PI / 2
      const pos = polar(angle, R_ROOT)
      const kids = childrenOf(categories, root.id)

      laid.push({ cat: root, ...pos, depth: 1, extra: 0 })
      edges.push({ x1: CX, y1: CY, x2: pos.x, y2: pos.y, color: root.color })

      if (kids.length > 0) {
        // 부모가 차지한 각도 구간 안에서만 부채꼴로 펼친다
        const spread = Math.min(step * 0.8, 0.5 * kids.length + 0.3)
        const start = angle - spread / 2
        const gap = kids.length === 1 ? 0 : spread / (kids.length - 1)

        kids.forEach((kid, j) => {
          const kAngle = kids.length === 1 ? angle : start + j * gap
          const kPos = polar(kAngle, R_CHILD)
          // 3단계 이상은 그리지 않고 '그 자식을 가진 노드' 에 +N 으로 요약한다.
          // 예전에는 이 수를 최상위에 붙였다 — 생활 > 맛집·음식 > 국내 구조에서
          // '+3' 이 맛집·음식이 아니라 생활 옆에 떠서, 생활 밑에 뭔가 숨어 있는 것처럼 보였다.
          laid.push({
            cat: kid, ...kPos, depth: 2,
            extra: childrenOf(categories, kid.id).length,
          })
          edges.push({ x1: pos.x, y1: pos.y, x2: kPos.x, y2: kPos.y, color: kid.color })
        })
      }
    })

    return { laid, edges }
  }, [categories])

  function openAdd(e, id) {
    e.stopPropagation()
    setDraft('')
    setAddingFor(id)
  }

  function closeAdd() {
    setAddingFor(CLOSED)
    setDraft('')
  }

  function submitAdd() {
    const clean = draft.trim()
    if (!clean) { closeAdd(); return }
    onAdd(addingFor ?? null, clean)
    closeAdd()
  }

  // 입력창을 띄울 좌표. 노드 아래쪽에 붙이되 캔버스를 벗어나지 않게 자른다.
  const inputPos = useMemo(() => {
    if (addingFor === CLOSED) return null
    if (addingFor === null) return { x: CX - INPUT_W / 2, y: CY + R_CENTER + 8 }
    const n = nodes.laid.find((it) => it.cat.id === addingFor)
    if (!n) return null
    const { h } = nodeSize(n.depth)
    return {
      x: Math.max(4, Math.min(W - INPUT_W - 4, n.x - INPUT_W / 2)),
      y: Math.min(H - INPUT_H - 4, n.y + h / 2 + 6)
    }
  }, [addingFor, nodes])

  if (categories.length === 0) {
    return (
      <div className="empty">
        <span className="empty-icon" aria-hidden="true">🗺️</span>
        <p className="empty-title">아직 카테고리가 없어요</p>
        <p className="empty-sub">최상위 카테고리를 하나 만들면 여기에 지도가 그려집니다.</p>
        <button className="btn-primary" onClick={() => { setDraft(''); setAddingFor(null) }}>
          + 최상위 카테고리
        </button>
        {addingFor === null && (
          <form
            className="mm-empty-add"
            onSubmit={(e) => { e.preventDefault(); submitAdd() }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') closeAdd() }}
              placeholder="하위 카테고리 이름"
              aria-label="새 카테고리 이름"
            />
          </form>
        )}
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

        {/* 입력 중 바깥을 누르면 취소 */}
        {addingFor !== CLOSED && (
          <rect
            className="mm-backdrop"
            x={0} y={0} width={W} height={H}
            onMouseDown={closeAdd}
          />
        )}

        <g className="mm-node">
          <g
            onClick={() => onSelect(null)}
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') onSelect(null) }}
            aria-label="전체 보기"
          >
            <circle className="mm-center" cx={CX} cy={CY} r={R_CENTER} />
            <text className="mm-center-text" x={CX} y={CY - 3} textAnchor="middle">나의</text>
            <text className="mm-center-text" x={CX} y={CY + 13} textAnchor="middle">아카이브</text>
          </g>
          <AddButton cx={CX + 37} cy={CY - 37} id={null} label="최상위 카테고리 추가" onOpen={openAdd} />
        </g>

        {nodes.laid.map((n) => {
          const { w, h } = nodeSize(n.depth)
          const color = n.cat.color ?? 'gray'
          const label = n.cat.name.length > 7 ? `${n.cat.name.slice(0, 7)}…` : n.cat.name
          return (
            <g key={n.cat.id} className="mm-node">
              <g
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
              <AddButton
                cx={n.x + w / 2}
                cy={n.y - h / 2}
                id={n.cat.id}
                label={`${n.cat.name} 하위 카테고리 추가`}
                onOpen={openAdd}
              />
            </g>
          )
        })}

        {inputPos && (
          <foreignObject
            x={inputPos.x} y={inputPos.y}
            width={INPUT_W} height={INPUT_H}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <form
              className="mm-input-wrap"
              onSubmit={(e) => { e.preventDefault(); submitAdd() }}
            >
              <input
                className="mm-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') closeAdd()
                }}
                placeholder="하위 카테고리 이름"
                aria-label="하위 카테고리 이름"
              />
            </form>
          </foreignObject>
        )}
      </svg>
    </div>
  )
}
