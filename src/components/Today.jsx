import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase.js'

const UNCAT_LIMIT = 10
const RECENT_LIMIT = 5

function todayLabel() {
  return new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
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

export default function Today({ categories, refreshKey, onOpen, onChanged }) {
  const [todos, setTodos] = useState([])
  const [uncat, setUncat] = useState([])
  const [uncatTotal, setUncatTotal] = useState(0)
  const [recent, setRecent] = useState([])
  const [itemCats, setItemCats] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 1) 할 것 — 오래된 것부터
      const { data: todoRows } = await supabase
        .from('items').select('*').eq('status', 'todo')
        .order('created_at', { ascending: true })

      // 2) 미분류 — 소속이 하나도 없는 항목.
      //    id 목록만 가볍게 받아 차집합을 구한 뒤 필요한 행만 다시 읽는다.
      const [idx, links] = [
        await fetchAllRows('items', 'id, created_at', (q) => q.order('created_at', { ascending: false })),
        await fetchAllRows('item_categories', 'item_id')
      ]
      const categorized = new Set(links.map((r) => r.item_id))
      const uncatIds = idx.filter((r) => !categorized.has(r.id)).map((r) => r.id)

      let uncatRows = []
      if (uncatIds.length > 0) {
        const { data } = await supabase
          .from('items').select('*').in('id', uncatIds.slice(0, UNCAT_LIMIT))
          .order('created_at', { ascending: false })
        uncatRows = data ?? []
      }

      // 3) 최근 저장
      const { data: recentRows } = await supabase
        .from('items').select('*')
        .order('created_at', { ascending: false })
        .range(0, RECENT_LIMIT - 1)

      const shown = [...(todoRows ?? []), ...uncatRows, ...(recentRows ?? [])]
      const shownIds = [...new Set(shown.map((i) => i.id))]

      let map = {}
      if (shownIds.length > 0) {
        const { data: catRows } = await supabase
          .from('item_categories').select('item_id, category_id').in('item_id', shownIds)
        for (const row of catRows ?? []) {
          (map[row.item_id] ??= []).push(row.category_id)
        }
      }

      setTodos(todoRows ?? [])
      setUncat(uncatRows)
      setUncatTotal(uncatIds.length)
      setRecent(recentRows ?? [])
      setItemCats(map)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  async function toggleDone(item) {
    const next = item.status === 'done' ? 'todo' : 'done'
    setTodos((prev) => prev.filter((t) => t.id !== item.id))
    await supabase.from('items').update({ status: next }).eq('id', item.id)
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

  return (
    <div className="today">
      <p className="today-date">{todayLabel()}</p>

      <section className="today-section">
        <h2 className="today-head">
          ⚡ 오늘의 할 것
          <span className="today-count">{todos.length}</span>
        </h2>
        {todos.length === 0 ? (
          <p className="today-empty">할 것이 없어요. 홀가분하네요!</p>
        ) : (
          <ul className="today-list">
            {todos.map((item) => (
              <li key={item.id} className="today-row">
                <button
                  className="check"
                  onClick={() => toggleDone(item)}
                  aria-label="완료 처리"
                />
                <button className="today-title" onClick={() => onOpen(item)}>{item.title}</button>
                <Badges item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>

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
    </div>
  )
}
