// 격자 칸에 놓이는 계획 카드 한 장.
//
// 카드에 담는 것은 **제목과 상태와 연결 수**뿐이다. 격자는 한 화면에 수십 칸이 들어가는
// 자리라, 카드 하나가 커지면 편중을 보러 온 사람이 스크롤만 하게 된다. 나머지는
// 항목 모달에 다 있다.
//
// 🔴 조작이 둘이다: **누르면 상태 전환 메뉴**, **길게 누르면 항목 모달**(요구사항 4).
//    전환이 주 조작이라 짧은 누름을 거기에 준다 — 격자에서 하는 일의 대부분은
//    '이거 시작했다 / 끝냈다' 이고, 내용을 고치는 일은 그보다 훨씬 드물다.
// 🔴 길게 누르기만으로는 키보드·화면낭독기에서 모달에 닿을 길이 없다. 그래서 메뉴
//    마지막 줄에 '자세히' 를 같이 둔다 — 길게 누르기는 빠른 길이지 유일한 길이 아니다.
import { memo, useEffect, useRef, useState } from 'react'
import { nextStatuses, parseRelatedIds, planStatusOf, stalledDays, STALL_DAYS } from '../plan.js'

// 이만큼 누르고 있으면 '길게 누름' 이다. 모달 안 순서 바꾸기(reorder.js)가 쓰는 값과
// 같은 감각으로 맞췄다 — 같은 앱에서 길게 누르기의 길이가 자리마다 다르면 손이 헷갈린다.
const LONG_PRESS_MS = 500
// 이만큼 손가락이 움직이면 누름이 아니라 스크롤이다. 격자는 옆으로도 세로로도
// 굴러가는 자리라, 굴리려던 손짓이 메뉴를 여는 일이 없어야 한다.
const MOVE_TOLERANCE = 10

function PlanCard({ item, color, onStatus, onOpen }) {
  const status = planStatusOf(item)
  const related = parseRelatedIds(item.related_ids).length
  const stalled = status === 'doing' && stalledDays(item) >= STALL_DAYS

  const [menuOpen, setMenuOpen] = useState(false)
  const boxRef = useRef(null)
  const timer = useRef(null)
  const start = useRef(null)
  // 길게 눌러 모달을 연 뒤에 따라오는 click 을 한 번 삼킨다.
  // 그러지 않으면 손을 떼는 순간 모달이 열리고 그 뒤에서 메뉴까지 같이 열린다.
  const swallow = useRef(false)

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e) {
      if (!boxRef.current?.contains(e.target)) setMenuOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); setMenuOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // 카드가 화면에서 사라질 때 타이머가 남으면, 이미 없는 카드의 모달이 열린다.
  useEffect(() => () => clearTimeout(timer.current), [])

  function pressStart(e) {
    start.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      swallow.current = true
      setMenuOpen(false)
      onOpen(item)
    }, LONG_PRESS_MS)
  }

  function pressMove(e) {
    if (!start.current) return
    const dx = Math.abs((e.clientX ?? 0) - start.current.x)
    const dy = Math.abs((e.clientY ?? 0) - start.current.y)
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) clearTimeout(timer.current)
  }

  function pressEnd() {
    clearTimeout(timer.current)
    start.current = null
  }

  function handleClick() {
    if (swallow.current) { swallow.current = false; return }
    setMenuOpen((v) => !v)
  }

  return (
    <div className="plan-card-box" ref={boxRef}>
      <button
        type="button"
        /* 왼쪽 색 띠가 두 가지를 한 번에 말한다: **색은 영역**, **굵기는 진행 여부**다
           (요구사항 4 — doing 이면 띠가 굵어진다). 진행 중인 것이 격자에서 먼저 눈에
           들어와야, 벌여 놓은 일이 몇 개인지 세지 않고도 보인다. */
        className={`plan-card plan-card-${color} plan-card-${status}${stalled ? ' plan-card-stalled' : ''}`}
        onClick={handleClick}
        onPointerDown={pressStart}
        onPointerMove={pressMove}
        onPointerUp={pressEnd}
        onPointerCancel={pressEnd}
        onPointerLeave={pressEnd}
        // 길게 누를 때 브라우저가 글자를 선택하거나 맥락 메뉴를 띄우지 않게 한다
        onContextMenu={(e) => e.preventDefault()}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        title={`${item.title} — 누르면 상태 바꾸기 · 길게 누르면 자세히`}
      >
        {/* 🔴 가로 배치를 button 자신이 아니라 이 span 이 맡는다. 크롬에서 button 을
            flex 컨테이너로 쓰면 안쪽 내용이 **최대 너비로 굳어** 줄어들지 않는다 —
            110px 짜리 칸에서 긴 제목이 말줄임 없이 칸 밖으로 샜다(375px 점검에서 잡혔다). */}
        <span className="plan-card-row">
          <span className="plan-card-title">{item.title}</span>
          <span className="plan-card-marks">
            {related > 0 && (
              <span className="plan-card-rel" title={`관련 항목 ${related}개`}>🔗{related}</span>
            )}
            {/* 정체 표시는 진행 중인 것에만 붙는다. 주간 리뷰에서만 보이면 격자를
                볼 때는 알 수 없어서, 리뷰를 여는 사람만 아는 사실이 된다. */}
            {stalled && <span className="plan-card-stall" title={`${STALL_DAYS}일 넘게 그대로예요`}>⏳</span>}
          </span>
        </span>
      </button>

      {menuOpen && (
        <div className="plan-menu" role="menu" aria-label={`${item.title} 상태 바꾸기`}>
          {nextStatuses(status).map((s) => (
            <button
              key={s.key}
              type="button"
              role="menuitem"
              className="plan-menu-item"
              onClick={() => { setMenuOpen(false); onStatus(item, s.key) }}
            >
              <span className="plan-menu-icon" aria-hidden="true">{s.icon}</span> {s.name}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="plan-menu-item plan-menu-open"
            onClick={() => { setMenuOpen(false); onOpen(item) }}
          >✎ 자세히</button>
        </div>
      )}
    </div>
  )
}

export default memo(PlanCard)
