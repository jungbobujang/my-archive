// '계획' 탭 — 지평(가로) × 영역(세로) 격자.
//
// 이 화면이 답하려는 질문은 둘이다.
//   ① 지금 무엇을 벌여 놓았나 (칸 안의 카드)
//   ② **어디가 비었나** (빈 칸)
// ②가 이 격자를 목록이 아니라 격자로 만드는 이유다. 그래서 항목이 없는 칸도 반드시
// 그리고, 비었다고 글자로 적는다 — 줄이 없으면 없는 줄은 눈에 띄지 않는다.
//
// 완료는 격자 아래 접힌 목록으로 내려간다. 칸에 남겨 두면 끝낸 일이 자리를 차지해
// '지금 벌여 놓은 것' 이 실제보다 많아 보인다. 접음(dropped)은 아예 그리지 않는다 —
// 접었다는 것은 안 보고 싶다는 뜻이고, 보고 싶으면 아카이브 탭에 그대로 있다.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase.js'
import {
  UNSORTED_DOMAIN, buildGrid, emptyCells, horizonLabel,
  isDoneThisWeek, isStalled, planStatusLabel, stalledDays, STALL_DAYS
} from '../plan.js'
import { useEscapeKey } from '../hooks.js'
import PlanGrid from './PlanGrid.jsx'
import { SkeletonRows } from './Skeleton.jsx'
import { useToast } from './Toast.jsx'

// 접힌 완료 목록에 한 번에 보여 줄 수. 넘으면 개수만 적는다 —
// 완료가 수백 개 쌓인 계정에서 이 목록이 화면을 통째로 먹으면 격자를 못 본다.
const DONE_LIMIT = 30

// space 가 null 이면 공간 열이 아직 없는 DB 다 — 그때는 조건을 붙이지 않는다
// (Today.jsx 와 같은 규칙).
export default function Plan({ domains, space, userId, refreshKey, onOpen, onChanged }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [doneOpen, setDoneOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('items').select('*')
        .is('deleted_at', null)
        // 🔴 계획만 받아 온다. 전부 받아 와서 화면에서 거르면 항목이 늘수록 이 탭만
        //    느려지고, 그 사실은 항목이 많은 사람에게만 보인다.
        .not('plan_status', 'is', null)
      if (space) q = q.eq('space', space)
      const { data, error } = await q.order('created_at', { ascending: false })
      if (error) throw error
      setItems(data ?? [])
    } catch (err) {
      console.error(err)
      toast.error('계획을 불러오지 못했어요. 연결 상태를 확인해 주세요')
    }
    setLoading(false)
  }, [toast, space])

  useEffect(() => { load() }, [load, refreshKey])

  const grid = useMemo(() => buildGrid(items, domains), [items, domains])

  const doingCount = items.filter((i) => i.plan_status === 'doing').length
  const weekDone = useMemo(() => items.filter((i) => isDoneThisWeek(i)), [items])
  const stalled = useMemo(() => items.filter((i) => isStalled(i)), [items])
  const empties = useMemo(() => emptyCells(grid), [grid])

  /* 상태 바꾸기 — 화면을 먼저 바꾸고 저장한다. 실패하면 되돌리고 알린다
     (Archive 의 toggleStar·toggleDone 과 같은 규칙).
     🔴 plan_status_at 을 **함께** 찍는다. 이 값이 곧 주간 리뷰의 '이번 주 완료' 와
        '7일 정체' 의 근거다 — 상태만 바꾸고 시각을 안 남기면 리뷰가 옛말을 한다. */
  const setStatus = useCallback(async (item, next) => {
    if (next === item.plan_status) return
    const at = new Date().toISOString()
    const before = item.plan_status
    const beforeAt = item.plan_status_at
    setItems((prev) => prev.map((i) => (
      i.id === item.id ? { ...i, plan_status: next, plan_status_at: at } : i
    )))
    const { error } = await supabase
      .from('items').update({ plan_status: next, plan_status_at: at }).eq('id', item.id)
    if (error) {
      setItems((prev) => prev.map((i) => (
        i.id === item.id ? { ...i, plan_status: before, plan_status_at: beforeAt } : i
      )))
      toast.error('상태를 저장하지 못했어요')
      return
    }
    // 오늘 탭의 '진행 중 N · 이번 주 완료 N' 한 줄도 같이 움직여야 한다
    onChanged?.()
  }, [toast, onChanged])

  if (loading) {
    return (
      <div className="plan">
        <div className="plan-head"><h2 className="plan-title">🧭 계획</h2></div>
        <SkeletonRows count={5} />
      </div>
    )
  }

  return (
    <div className="plan">
      <div className="plan-head">
        <h2 className="plan-title">🧭 계획</h2>
        <span className="plan-sum" aria-live="polite">
          진행 중 {doingCount} · 이번 주 완료 {weekDone.length}
          {stalled.length > 0 && <span className="plan-sum-warn"> · 정체 {stalled.length}</span>}
        </span>
        <button
          type="button"
          className="btn-ghost btn-sm plan-review-btn"
          onClick={() => setReviewOpen(true)}
        >📋 주간 리뷰</button>
      </div>

      {grid.rows.length === 0 ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">🧭</span>
          <p className="empty-title">아직 격자에 올린 계획이 없어요</p>
          <p className="empty-sub">
            항목을 열고 <b>계획으로</b> 를 켜면 지평(단기·중기·장기)과 영역을 골라
            이 격자에 올릴 수 있어요.
          </p>
        </div>
      ) : (
        <PlanGrid grid={grid} domains={domains} onStatus={setStatus} onOpen={onOpen} />
      )}

      {/* 미지정 줄이 생겼다면 왜 생겼는지 한 줄 적는다 — 안 그러면 '미지정' 이
          기본 영역인 줄 안다. */}
      {grid.rows.some((r) => r.domain.key === UNSORTED_DOMAIN.key) && (
        <p className="plan-note" role="status">
          영역을 고르지 않았거나 지워진 영역에 있던 계획은 <b>미지정</b> 줄에 모입니다.
          항목을 열어 영역을 골라 주세요.
        </p>
      )}

      {grid.done.length > 0 && (
        <section className="plan-done">
          <button
            type="button"
            className="plan-done-toggle"
            onClick={() => setDoneOpen((v) => !v)}
            aria-expanded={doneOpen}
          >
            {doneOpen ? '▾' : '▸'} 완료 <span className="plan-row-count">{grid.done.length}</span>
          </button>
          {doneOpen && (
            <ul className="plan-done-list">
              {grid.done.slice(0, DONE_LIMIT).map((it) => (
                <li key={it.id} className="plan-done-row">
                  <button className="today-title" onClick={() => onOpen(it)}>{it.title}</button>
                  {isDoneThisWeek(it) && <span className="badge badge-teal">이번 주</span>}
                </li>
              ))}
              {grid.done.length > DONE_LIMIT && (
                <li className="plan-done-row today-more">
                  외 {grid.done.length - DONE_LIMIT}개 더 — 아카이브 탭에서 볼 수 있어요
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {reviewOpen && (
        <WeeklyReview
          weekDone={weekDone}
          stalled={stalled}
          empties={empties}
          onOpen={(it) => { setReviewOpen(false); onOpen(it) }}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  )
}

/* 주간 리뷰 — 세 가지만 본다 (요구사항 8).
 *   · 이번 주에 끝낸 것        → 한 주가 헛되지 않았다는 증거
 *   · 진행으로 둔 채 멈춘 것   → 벌여만 놓고 손을 안 댄 것
 *   · 빈 칸                    → 아예 손대지 않은 갈래
 *
 * 🔴 숫자만 적지 않고 **목록을 준다.** '정체 3개' 는 다음에 할 일을 알려 주지 않는다.
 *    줄을 누르면 그 항목이 바로 열린다.
 */
function WeeklyReview({ weekDone, stalled, empties, onOpen, onClose }) {
  useEscapeKey(onClose)

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="주간 리뷰">
        <div className="modal-head">
          <h2>주간 리뷰</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <section className="set-section">
          <h3 className="set-head">이번 주 완료 <span className="plan-row-count">{weekDone.length}</span></h3>
          {weekDone.length === 0 ? (
            <p className="set-hint">이번 주에 완료로 옮긴 계획이 아직 없어요.</p>
          ) : (
            <ul className="today-list">
              {weekDone.map((it) => (
                <li key={it.id} className="today-row">
                  <button className="today-title" onClick={() => onOpen(it)}>{it.title}</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="set-section">
          <h3 className="set-head">
            멈춰 있는 진행 <span className="plan-row-count">{stalled.length}</span>
          </h3>
          {stalled.length === 0 ? (
            <p className="set-hint">
              진행 중인 계획이 모두 {STALL_DAYS}일 안에 움직였어요.
            </p>
          ) : (
            <ul className="today-list">
              {stalled.map((it) => (
                <li key={it.id} className="today-row">
                  <button className="today-title" onClick={() => onOpen(it)}>{it.title}</button>
                  <span className="today-when">{stalledDays(it)}일째</span>
                </li>
              ))}
            </ul>
          )}
          <p className="set-hint">
            {planStatusLabel('doing')} 으로 둔 뒤 {STALL_DAYS}일 넘게 상태가 바뀌지 않은 것들이에요.
            다시 손댈 것이 아니면 <b>접음</b> 으로 옮겨 두면 격자가 가벼워집니다.
          </p>
        </section>

        <section className="set-section">
          <h3 className="set-head">빈 칸 <span className="plan-row-count">{empties.length}</span></h3>
          {empties.length === 0 ? (
            <p className="set-hint">모든 칸에 계획이 하나씩은 있어요.</p>
          ) : (
            <ul className="plan-empty-list">
              {empties.map((e) => (
                <li key={`${e.domain.key}-${e.horizon}`}>
                  <span className={`badge badge-${e.domain.color ?? 'gray'}`}>{e.domain.name}</span>
                  <span className="plan-empty-when">{horizonLabel(e.horizon)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="set-hint">
            비어 있다는 것이 곧 잘못은 아니에요. 다만 <b>한쪽에만 몰려 있는지</b> 는
            이 목록으로 한 번에 보입니다.
          </p>
        </section>
      </div>
    </div>
  )
}
