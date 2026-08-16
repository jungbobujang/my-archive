import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase.js'
import SlotManager from './SlotManager.jsx'
import { useToast } from './Toast.jsx'

const UNCAT_LIMIT = 10
const RECENT_LIMIT = 5
const UPCOMING_LIMIT = 5

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayLabel() {
  return new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
}

// 'YYYY-MM-DD' -> '8/18 (일)'. UTC 로 새지 않게 직접 쪼갠다.
function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const wd = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  return `${m}/${d} (${wd})`
}

// 상한 없이 전부 받아야 하는 가벼운 조회 (id 목록 등)
async function fetchAllRows(table, columns, tweak) {
  const CHUNK = 1000
  const rows = []
  for (let from = 0; ; from += CHUNK) {
    let q = supabase.from(table).select(columns)
    if (tweak) q = tweak(q)
    const { data, error } = await q.range(from, from + CHUNK - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < CHUNK) break
  }
  return rows
}

export default function Today({ categories, slots, userId, refreshKey, onOpen, onChanged, onSlotsChanged }) {
  const toast = useToast()
  const [todos, setTodos] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [slotOpen, setSlotOpen] = useState(false)
  const [uncat, setUncat] = useState([])
  const [uncatTotal, setUncatTotal] = useState(0)
  const [recent, setRecent] = useState([])
  const [itemCats, setItemCats] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const today = ymd(new Date())

      // 1) 오늘의 할 것 — 기한이 없거나 오늘까지인 것
      const { data: todoRows, error: todoErr } = await supabase
        .from('items').select('*').eq('status', 'todo').is('deleted_at', null)
        .or(`due_date.is.null,due_date.lte.${today}`)
        .order('created_at', { ascending: true })
      if (todoErr) throw todoErr

      // 1-b) 예정 — 내일 이후
      const { data: upcomingRows, error: upErr } = await supabase
        .from('items').select('*').eq('status', 'todo').is('deleted_at', null)
        .gt('due_date', today)
        .order('due_date', { ascending: true })
        .range(0, UPCOMING_LIMIT - 1)
      if (upErr) throw upErr

      // 2) 미분류 — 소속이 하나도 없는 항목.
      //    id 목록만 가볍게 받아 차집합을 구한 뒤 필요한 행만 다시 읽는다.
      const [idx, links] = [
        await fetchAllRows('items', 'id, created_at', (q) => q.is('deleted_at', null).order('created_at', { ascending: false })),
        await fetchAllRows('item_categories', 'item_id')
      ]
      const categorized = new Set(links.map((r) => r.item_id))
      const uncatIds = idx.filter((r) => !categorized.has(r.id)).map((r) => r.id)

      let uncatRows = []
      if (uncatIds.length > 0) {
        const { data, error: uncatErr } = await supabase
          .from('items').select('*').in('id', uncatIds.slice(0, UNCAT_LIMIT))
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
        if (uncatErr) throw uncatErr
        uncatRows = data ?? []
      }

      // 3) 최근 저장
      const { data: recentRows, error: recentErr } = await supabase
        .from('items').select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(0, RECENT_LIMIT - 1)
      if (recentErr) throw recentErr

      const shown = [...(todoRows ?? []), ...(upcomingRows ?? []), ...uncatRows, ...(recentRows ?? [])]
      const shownIds = [...new Set(shown.map((i) => i.id))]

      let map = {}
      if (shownIds.length > 0) {
        const { data: catRows, error: catErr } = await supabase
          .from('item_categories').select('item_id, category_id').in('item_id', shownIds)
        if (catErr) throw catErr
        for (const row of catRows ?? []) {
          (map[row.item_id] ??= []).push(row.category_id)
        }
      }

      setTodos(todoRows ?? [])
      setUpcoming(upcomingRows ?? [])
      setUncat(uncatRows)
      setUncatTotal(uncatIds.length)
      setRecent(recentRows ?? [])
      setItemCats(map)
    } catch (err) {
      console.error(err)
      toast.error('오늘 화면을 불러오지 못했어요. 연결 상태를 확인해 주세요')
    }
    setLoading(false)
  }, [toast])

  useEffect(() => { load() }, [load, refreshKey])

  async function toggleDone(item) {
    const next = item.status === 'done' ? 'todo' : 'done'
    const before = todos
    setTodos((prev) => prev.filter((t) => t.id !== item.id))
    const { error } = await supabase.from('items').update({ status: next }).eq('id', item.id)
    if (error) {
      setTodos(before)
      toast.error('완료 처리를 저장하지 못했어요')
      return
    }
    onChanged()
  }

  function Badges({ item }) {
    const own = categories.filter((c) => (itemCats[item.id] ?? []).includes(c.id))
    if (own.length === 0) return null
    const shown = own.slice(0, 2)
    return (
      <span className="today-badges">
        {shown.map((c) => (
          <span key={c.id} className={`badge badge-${c.color ?? 'gray'}`}>{c.name}</span>
        ))}
        {own.length > shown.length && (
          <span className="badge badge-gray">+{own.length - shown.length}</span>
        )}
      </span>
    )
  }

  if (loading) {
    return <div className="center-block"><div className="spinner" aria-label="불러오는 중" /></div>
  }

  const todayStr = ymd(new Date())

  // 슬롯 순서대로 묶고, 슬롯 없는 항목은 마지막 "언제든" 그룹으로
  const groups = [
    ...slots
      .map((s) => ({
        key: s.id,
        icon: s.icon,
        name: s.name,
        items: todos.filter((t) => t.slot_id === s.id)
      }))
      .filter((g) => g.items.length > 0),
    {
      key: '__none__',
      icon: '📌',
      name: '언제든',
      items: todos.filter((t) => !t.slot_id || !slots.some((s) => s.id === t.slot_id))
    }
  ].filter((g) => g.items.length > 0)

  return (
    <div className="today">
      <p className="today-date">{todayLabel()}</p>

      <section className="today-section">
        <h2 className="today-head">
          ⚡ 오늘의 할 것
          <span className="today-count">{todos.length}</span>
          <button
            className="slot-gear"
            onClick={() => setSlotOpen(true)}
            aria-label="시간대 관리"
            title="시간대 관리"
          >⚙️</button>
        </h2>
        {todos.length === 0 ? (
          <p className="today-empty">할 것이 없어요. 홀가분하네요!</p>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="slot-group">
              <h3 className="slot-head">
                {g.icon} {g.name}
                <span className="today-count">{g.items.length}</span>
              </h3>
              <ul className="today-list">
                {g.items.map((item) => (
                  <li key={item.id} className="today-row">
                    <button
                      className="check"
                      onClick={() => toggleDone(item)}
                      aria-label="완료 처리"
                    />
                    <button className="today-title" onClick={() => onOpen(item)}>
                      {item.due_date && item.due_date < todayStr ? '🔴 ' : ''}{item.title}
                    </button>
                    <Badges item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="today-section">
          <h2 className="today-head">
            📅 예정
            <span className="today-count">{upcoming.length}</span>
          </h2>
          <ul className="today-list">
            {upcoming.map((item) => {
              const slot = slots.find((s) => s.id === item.slot_id)
              return (
                <li key={item.id} className="today-row">
                  <span className="today-when">{shortDate(item.due_date)}</span>
                  <button className="today-title" onClick={() => onOpen(item)}>{item.title}</button>
                  {slot && <span className="today-slot">{slot.icon} {slot.name}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="today-section">
        <h2 className="today-head">
          📥 미분류
          <span className="today-count">{uncatTotal}</span>
        </h2>
        {uncat.length === 0 ? (
          <p className="today-empty">전부 분류돼 있어요.</p>
        ) : (
          <ul className="today-list">
            {uncat.map((item) => (
              <li key={item.id} className="today-row">
                <button className="today-title" onClick={() => onOpen(item)}>{item.title}</button>
                <span className="today-hint">분류하기</span>
              </li>
            ))}
          </ul>
        )}
        {uncatTotal > uncat.length && (
          <p className="today-more">외 {uncatTotal - uncat.length}개 더</p>
        )}
      </section>

      <section className="today-section">
        <h2 className="today-head">
          🕐 최근 저장
          <span className="today-count">{recent.length}</span>
        </h2>
        {recent.length === 0 ? (
          <p className="today-empty">아직 저장한 항목이 없어요.</p>
        ) : (
          <ul className="today-list">
            {recent.map((item) => (
              <li key={item.id} className="today-row">
                <button className="today-title" onClick={() => onOpen(item)}>{item.title}</button>
                <Badges item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {slotOpen && (
        <SlotManager
          slots={slots}
          userId={userId}
          onClose={() => setSlotOpen(false)}
          onChanged={() => { onSlotsChanged(); load() }}
        />
      )}
    </div>
  )
}
