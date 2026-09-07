// 목록 순서 바꾸기 — 이미지 썸네일(가로)과 파일 목록(세로)이 같이 쓴다.
//
// 라이브러리를 쓰지 않는 이유 (판단 근거):
//  1) 이 저장소는 react·supabase 말고 화면 의존성이 없다. 정렬 하나 때문에 dnd-kit
//     (약 30KB) 을 들이면 번들이 커지고, 그 라이브러리의 접근성·터치 규칙을 이 화면의
//     기존 규칙에 다시 맞춰야 한다.
//  2) HTML5 끌어놓기(draggable)는 여기서 못 쓴다. 이미지·파일 영역이 이미 dragover/drop 을
//     **파일 올리기**에 쓰고 있어서(ItemModal 의 img-drop · file-drop), 같은 이벤트 위에
//     항목 끌기를 얹으면 둘이 서로를 가린다. 게다가 iOS 사파리는 HTML5 끌어놓기를
//     사실상 지원하지 않는다 — 모바일 요구가 있는 이 일에는 애초에 답이 아니다.
//  3) 포인터 이벤트 하나로 마우스·터치·펜이 같은 코드로 처리된다. 필요한 것은 그뿐이다.
//
// 접근성: 끌기만 두면 키보드로는 순서를 못 바꾼다. 그래서 손잡이(handle)에 방향키를
// 달아 두고, 파일 줄에는 ↑↓ 버튼도 따로 둔다.

import { useCallback, useEffect, useRef, useState } from 'react'

export const LONG_PRESS_MS = 300   // 터치는 이만큼 누르고 있어야 끌기가 시작된다
export const DRAG_THRESHOLD_PX = 4 // 마우스는 이만큼 움직여야 끌기로 본다 (클릭을 안 잡아먹게)
export const CANCEL_MOVE_PX = 10   // 길게 누르기 전에 이만큼 움직이면 스크롤로 본다

/* 손가락으로 쓰는 기기인가.
 *
 * 🔴 끌어놓기는 폰에서 **실사용으로 못 쓴다는 판정이 났다.** 꾹 누르는 300ms 를 기다려야
 *    하고, 그 사이 조금만 움직이면 스크롤로 넘어가고, 84px 짜리 썸네일 줄 안에서
 *    손가락이 목록 밖으로 나가기 일쑤다. 그래서 터치 기기에서는 끌기를 **버리고**
 *    탭으로 고르고 버튼으로 옮긴다. 마우스에서는 끌기가 제일 빠르므로 그대로 둔다.
 * 🔴 '화면 폭' 이 아니라 '포인터 종류' 로 가른다. 좁은 창으로 줄인 데스크톱에는 마우스가
 *    있고, 넓은 태블릿에는 없다. 판단 근거는 입력 장치여야 한다.
 */
export function useCoarsePointer() {
  const get = () => {
    try { return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches) } catch { return false }
  }
  const [coarse, setCoarse] = useState(get)
  useEffect(() => {
    let mq = null
    try { mq = window.matchMedia?.('(pointer: coarse)') } catch { mq = null }
    if (!mq) return undefined
    const on = () => setCoarse(Boolean(mq.matches))
    on()
    // 옛 사파리는 addEventListener 가 없다 (마우스를 붙였다 뗀 태블릿에서 바뀐다)
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener?.(on)
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener?.(on)
    }
  }, [])
  return coarse
}

// from 번째를 to 자리로 옮긴 새 배열. 원본은 건드리지 않는다.
export function moveItem(list, from, to) {
  const arr = [...(list ?? [])]
  if (!arr.length) return arr
  if (from < 0 || from >= arr.length) return arr
  const target = Math.max(0, Math.min(arr.length - 1, to))
  if (from === target) return arr
  const [picked] = arr.splice(from, 1)
  arr.splice(target, 0, picked)
  return arr
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * 끌어서 순서 바꾸기.
 *
 * @param {object} o
 *   count        항목 수 (범위 밖으로 떨어뜨리는 것을 막는다)
 *   onMove       (from, to) => void — 실제로 순서를 바꾸는 쪽
 *   longPressMs  터치에서 끌기가 시작되기까지 (기본 300ms)
 *   enabled      false 면 아무것도 하지 않는다
 *
 * @returns { dragIndex, overIndex, onPointerDown, itemProps }
 *   itemProps(i) 를 각 항목의 겉 요소에 펼쳐 준다.
 */
export function useDragOrder({ count, onMove, longPressMs = LONG_PRESS_MS, enabled = true }) {
  const [dragIndex, setDragIndex] = useState(-1)
  const [overIndex, setOverIndex] = useState(-1)
  // 화면에 그리지 않는 값은 ref 에 둔다. 끌기 중 setState 를 남발하면 매 픽셀마다 다시 그린다.
  const st = useRef(null)

  const cleanup = useCallback(() => {
    const s = st.current
    if (!s) return
    clearTimeout(s.timer)
    window.removeEventListener('pointermove', s.onMove)
    window.removeEventListener('pointerup', s.onUp)
    window.removeEventListener('pointercancel', s.onUp)
    // 🔴 끌기 중에만 스크롤을 막는다. touch-action 으로는 안 된다 — 그 값은 손가락이
    //    닿는 순간에 정해지고, 길게 누른 뒤에 바꿔도 이미 시작된 제스처에는 안 먹는다.
    //    그래서 끌기가 시작되는 순간 non-passive 리스너를 붙였다가 여기서 뗀다.
    if (s.blocking) document.removeEventListener('touchmove', s.block, { passive: false })
    st.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  /* 지금 손가락/커서 아래에 있는 항목의 번호.
   *
   * 🔴 항목을 정확히 짚지 못했을 때 그냥 -1 로 두면 **첫 자리에 놓기가 유난히 어렵다.**
   *    맨 앞으로 보내려면 커서를 1번 썸네일 위에 얹어야 하는데, 사람은 본능적으로 그
   *    **왼쪽**(줄의 여백)으로 끌고 간다. 거기는 항목이 아니라 통(strip)이라 판정이 -1 이
   *    되고, 마지막 값이 유지돼서 "왼쪽 끝까지 끌었는데 안 맨 앞으로 감" 이 된다.
   *    실제로 '가장자리 절반 폭' 문제로 보고된 것이 이 자리다.
   *    그래서 통 안이면 **가장 가까운 칸**으로 떨어뜨린다 — 여백·항목 사이 틈·양 끝
   *    바깥쪽까지 전부 판정이 선다.
   */
  const indexAt = useCallback((x, y) => {
    const el = document.elementFromPoint?.(x, y)
    const host = el?.closest?.('[data-reorder-index]')
    if (host) {
      const n = Number(host.getAttribute('data-reorder-index'))
      if (Number.isInteger(n)) return n
    }
    const box = el?.closest?.('[data-reorder-container]')
    if (!box) return -1
    const axis = box.getAttribute('data-reorder-axis') === 'y' ? 'y' : 'x'
    let best = -1
    let bestGap = Infinity
    for (const node of box.querySelectorAll('[data-reorder-index]')) {
      const n = Number(node.getAttribute('data-reorder-index'))
      if (!Number.isInteger(n)) continue
      const r = node.getBoundingClientRect()
      const mid = axis === 'y' ? r.top + r.height / 2 : r.left + r.width / 2
      const gap = Math.abs((axis === 'y' ? y : x) - mid)
      if (gap < bestGap) { bestGap = gap; best = n }
    }
    return best
  }, [])

  const begin = useCallback((index) => {
    const s = st.current
    if (!s || s.dragging) return
    s.dragging = true
    setDragIndex(index)
    setOverIndex(index)
    if (s.pointerType !== 'mouse') {
      // 진동은 되면 좋고 안 되면 그만이다 (iOS 사파리는 지원하지 않는다)
      try { navigator.vibrate?.(20) } catch { /* 무시 */ }
      s.blocking = true
      document.addEventListener('touchmove', s.block, { passive: false })
    }
  }, [])

  const onPointerDown = useCallback((e, index) => {
    if (!enabled || count < 2) return
    // 왼쪽 단추(또는 터치)만. 오른쪽 클릭으로 끌기가 시작되면 메뉴와 엉킨다.
    if (e.button != null && e.button !== 0) return
    cleanup()

    const start = { x: e.clientX, y: e.clientY }
    const s = {
      index, start, pointerType: e.pointerType || 'mouse',
      dragging: false, blocking: false, moved: false, timer: 0, over: -1,
      block: (ev) => { if (ev.cancelable) ev.preventDefault() }
    }
    st.current = s

    s.onMove = (ev) => {
      const cur = { x: ev.clientX, y: ev.clientY }
      const gone = dist(start, cur)
      if (!s.dragging) {
        if (s.pointerType === 'mouse') {
          if (gone >= DRAG_THRESHOLD_PX) begin(index)
        } else if (gone >= CANCEL_MOVE_PX) {
          // 길게 누르기 전에 움직였다 = 스크롤하려는 것이다. 끌기를 포기한다.
          cleanup()
          return
        }
        if (!s.dragging) return
      }
      s.moved = true
      const over = indexAt(cur.x, cur.y)
      // 🔴 빈 곳(-1)에서는 마지막 값을 지킨다. 손가락이 잠깐 틈을 지날 때마다 표시가
      //    꺼지면 어디에 놓이는지 알 수 없어진다.
      if (over >= 0 && over < count) { s.over = over; setOverIndex(over) }
    }

    /* 🔴 놓을 자리를 **ref 에도** 적어 두고, 놓을 때는 그 값을 쓴다.
       예전에는 setOverIndex 의 갱신 함수 안에서 onMove 를 불렀는데, 그건 상태 갱신
       함수에 부수효과를 넣은 것이다 — React 는 그 함수를 **두 번 부를 수 있고**
       (StrictMode·렌더 재시도), 실제로 그렇게 되면 한 번 끈 것이 두 칸 움직인다.
       브라우저 점검에서 세 장을 [1,2,3] → 끝을 맨 앞으로 끌었더니 [2,3,1] 이 나온 것이
       이 자리였다. 상태는 상태만, 이동은 여기서 한 번만. */
    s.onUp = () => {
      const cur = st.current
      const dragged = cur?.dragging
      const from = cur?.index ?? -1
      const to = cur?.over ?? -1
      cleanup()
      setDragIndex(-1)
      setOverIndex(-1)
      if (dragged && from >= 0 && to >= 0 && to !== from) onMove?.(from, to)
    }

    window.addEventListener('pointermove', s.onMove)
    window.addEventListener('pointerup', s.onUp)
    window.addEventListener('pointercancel', s.onUp)

    if (s.pointerType !== 'mouse') s.timer = setTimeout(() => begin(index), longPressMs)
  }, [enabled, count, cleanup, begin, indexAt, longPressMs, onMove])

  // 끌기로 순서를 바꾼 직후의 클릭은 삼킨다 — 썸네일을 끌었을 뿐인데 크게 보기가 열리면 안 된다.
  const swallowClick = useCallback((e) => {
    if (st.current?.moved) { e.preventDefault(); e.stopPropagation() }
  }, [])

  const itemProps = useCallback((index) => ({
    'data-reorder-index': index,
    onPointerDown: (e) => onPointerDown(e, index),
    onClickCapture: swallowClick
  }), [onPointerDown, swallowClick])

  /* 항목을 담은 통에 펼친다. 가장자리·틈에서도 판정이 서게 하는 자리다 (indexAt 참고).
     axis 는 'x'(가로 썸네일 줄) 또는 'y'(세로 파일 목록). */
  const containerProps = useCallback((axis = 'x') => ({
    'data-reorder-container': '',
    'data-reorder-axis': axis
  }), [])

  return { dragIndex, overIndex, onPointerDown, itemProps, containerProps, dragging: dragIndex >= 0 }
}
