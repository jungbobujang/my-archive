// 모션 — 라이브러리 없이 CSS transition/keyframes 와 FLIP 두 가지로만 한다.
//
// 원칙 (여기서 벗어나는 모션은 넣지 않는다):
//  1) 150~250ms, ease-out. 그보다 길면 기다림이 되고, 짧으면 '깜빡' 으로 읽힌다.
//  2) 목적은 **피드백**이다 — 무엇이 새로 들어왔는지, 무엇이 어디로 갔는지, 저장이 됐는지.
//     장식은 넣지 않는다. 움직임이 뜻을 못 가지면 그건 소음이고, 매번 봐야 하는 소음이다.
//  3) transform·opacity 만 움직인다. width·top·margin 을 건드리면 프레임마다 레이아웃을
//     다시 계산해서, 카드가 수십 장인 화면에서 바로 프레임이 떨어진다.
//  4) `prefers-reduced-motion: reduce` 면 **전부 끈다.** 어지럼증·전정기관 문제로 그 설정을
//     켠 사람에게 '조금 줄인 애니메이션' 은 여전히 그 증상을 부른다.
//
// will-change 는 쓰지 않는다. 저사양 기기에서 그 속성은 요소마다 레이어를 미리 만들어
// 메모리를 잡아먹는데, 우리 모션은 짧고 드물어서 얻는 것이 없다.

import { useLayoutEffect, useRef } from 'react'

export const DUR_MS = 180          // 표준 지속시간 (150~250 안)
export const EASE = 'cubic-bezier(.2,.8,.3,1)'   // ease-out 계열
export const STAGGER_MS = 25       // 카드 한 장씩 밀리는 간격
export const STAGGER_MAX = 12      // 🔴 12장까지만. 24번째 카드가 0.6초 뒤에 뜨면 그건 느린 것이다

export function reducedMotion() {
  try { return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) } catch { return false }
}

// 카드 i 번째의 등장 지연. 12장 뒤부터는 0 — 기다리게 하지 않는다.
export function staggerDelay(i) {
  if (reducedMotion()) return 0
  return i < STAGGER_MAX ? i * STAGGER_MS : 0
}

/* 요소의 '가만히 있을 때의 자리'.
 *
 * 🔴 getBoundingClientRect 를 그대로 쓰면 안 된다. 그 값은 **transform 이 얹힌 뒤**의
 *    자리라, 카드가 아직 등장 애니메이션(12px 아래) 중이면 그 12px 이 원래 자리로
 *    기록되고 다음 이동이 어긋난 데서 출발한다 (점검이 28 vs 16 으로 잡았다).
 *    그래서 지금 걸린 transform 의 이동분을 **빼서** 되돌린다.
 * 🔴 offsetLeft/Top 을 쓰지 않는 이유: 메이슨리(CSS columns)에서는 요소가 단(column)
 *    조각 안에 놓여 offset* 이 화면에서 보이는 자리와 어긋난다. rect 는 어디에 놓이든
 *    화면 좌표 그대로다.
 * 🔴 스크롤을 더해 문서 좌표로 만든다. 두 측정 사이에 화면이 굴러가면 그 차이가
 *    '이동' 으로 오해되기 때문이다.
 */
function restPosition(el) {
  const r = el.getBoundingClientRect()
  let tx = 0
  let ty = 0
  const t = getComputedStyle(el).transform
  if (t && t !== 'none') {
    try {
      const m = new DOMMatrixReadOnly(t)
      tx = m.m41
      ty = m.m42
    } catch { /* DOMMatrix 를 모르는 브라우저면 보정 없이 간다 */ }
  }
  return { x: r.left - tx + window.scrollX, y: r.top - ty + window.scrollY }
}

/**
 * FLIP — 자리가 바뀐 요소를 '순간이동' 대신 미끄러지게 한다.
 *
 * First(이전 위치) → Last(새 위치) → Invert(차이만큼 되돌려 놓기) → Play(놓아주기).
 * 🔴 레이아웃은 브라우저가 이미 계산해 둔 것을 그대로 쓰고, 우리는 transform 만 얹는다.
 *    'top 을 애니메이션' 하는 방식과 결과는 같아 보이지만 비용이 다르다.
 * 🔴 이전 위치는 **지난번 layout effect 때 재어 둔 값**이다. 렌더 전에 따로 재지 않는다 —
 *    그 시점에는 이미 새 DOM 이라 옛 위치를 알 수 없다.
 *
 * 쓰는 쪽: 컨테이너에 ref 를 걸고, 각 자식에 data-flip-key 를 준다.
 *   const ref = useFlip([항목들의 순서를 나타내는 값])
 *   <div ref={ref}>{items.map((x) => <li data-flip-key={x.id} .../>)}</div>
 *
 * @param {Array} deps  이 값이 바뀌면 자리를 다시 잰다
 * @param {object} [opt] { enabled }
 * @returns ref — 컨테이너에 건다
 */
export function useFlip(deps, opt = {}) {
  const ref = useRef(null)
  const prev = useRef(new Map())
  const enabled = opt.enabled !== false

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const next = new Map()
    const moves = []

    for (const el of box.querySelectorAll('[data-flip-key]')) {
      const key = el.getAttribute('data-flip-key')
      const { x, y } = restPosition(el)
      next.set(key, { x, y })
      const was = prev.current.get(key)
      if (!was) continue                       // 새로 들어온 것 — 이동이 아니라 등장이다
      const dx = was.x - x
      const dy = was.y - y
      // 1px 미만은 사람 눈에 안 보인다. 그걸 움직이면 비용만 든다.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      moves.push([el, dx, dy])
    }
    prev.current = next

    if (!enabled || !moves.length || reducedMotion()) return

    for (const [el, dx, dy] of moves) {
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    // 🔴 두 번 기다린다. 한 번만 기다리면 같은 프레임에 두 값이 합쳐져
    //    브라우저가 시작점을 못 잡고 그냥 순간이동한다.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const [el] of moves) {
          el.style.transition = `transform ${DUR_MS}ms ${EASE}`
          el.style.transform = ''
        }
      })
    })
    // 끝나면 인라인 값을 걷어낸다 — 남겨 두면 다음 FLIP 이 그 위에 얹힌다
    const t = setTimeout(() => {
      for (const [el] of moves) { el.style.transition = ''; el.style.transform = '' }
    }, DUR_MS + 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}

/**
 * 요소 하나를 잠깐 애니메이션시키고, 끝나면 클래스를 뗀다.
 * 삭제처럼 **우리가 시점을 아는** 자리에서 쓴다 (그 뒤에 목록을 새로 받는다).
 * @returns Promise<void> — reduced-motion 이면 곧바로 끝난다
 */
export function playOnce(el, className, ms = DUR_MS) {
  if (!el || reducedMotion()) return Promise.resolve()
  el.classList.add(className)
  return new Promise((done) => setTimeout(() => {
    el.classList.remove(className)
    done()
  }, ms))
}
