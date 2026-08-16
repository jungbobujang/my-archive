import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, CATEGORIES, PAGE_SIZE } from '../supabase.js'
import ItemModal from './ItemModal.jsx'
import ItemCard from './ItemCard.jsx'

export default function Archive({ session }) {
  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({})
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState(null)
  const [activeTag, setActiveTag] = useState(null)
  const [starredOnly, setStarredOnly] = useState(false)
  const [view, setView] = useState(() => localStorage.getItem('archive-view') || 'grid')

  const [modalItem, setModalItem] = useState(undefined) // undefined=닫힘, null=새 항목, 객체=수정
  const pageRef = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    localStorage.setItem('archive-view', view)
  }, [view])

  const buildQuery = useCallback((withCount) => {
    let q = supabase
      .from('items')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })
    if (category) q = q.eq('category', category)
    if (activeTag) q = q.contains('tags', [activeTag])
    if (starredOnly) q = q.eq('starred', true)
    if (debounced) q = q.or(`title.ilike.%${debounced}%,content.ilike.%${debounced}%`)
    return q
  }, [category, activeTag, starredOnly, debounced])

  const loadPage = useCallback(async (page) => {
    setLoading(true)
    const from = page * PAGE_SIZE
    const { data, count, error } = await buildQuery(page === 0)
      .range(from, from + PAGE_SIZE - 1)
    if (!error) {
      setItems((prev) => (page === 0 ? data : [...prev, ...data]))
      if (page === 0 && count !== null) setTotal(count)
      setHasMore(data.length === PAGE_SIZE)
      pageRef.current = page
    }
    setLoading(false)
  }, [buildQuery])

  const loadCounts = useCallback(async () => {
    const results = await Promise.all(
      CATEGORIES.map((c) =>
        supabase.from('items').select('id', { count: 'exact', head: true }).eq('category', c.key)
      )
    )
    const next = {}
    CATEGORIES.forEach((c, i) => { next[c.key] = results[i].count ?? 0 })
    setCounts(next)
  }, [])

  useEffect(() => { loadPage(0) }, [loadPage])
  useEffect(() => { loadCounts() }, [loadCounts])

  const refresh = useCallback(() => {
    loadPage(0)
    loadCounts()
  }, [loadPage, loadCounts])

  const recentTags = useMemo(() => {
    const seen = []
    for (const it of items) {
      for (const t of it.tags || []) {
        if (!seen.includes(t)) seen.push(t)
        if (seen.length >= 8) return seen
      }
    }
    return seen
  }, [items])

  async function toggleStar(item) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, starred: !i.starred } : i)))
    await supabase.from('items').update({ starred: !item.starred }).eq('id', item.id)
  }

  const filterActive = category || activeTag || starredOnly || debounced

  return (
    <div className="archive">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">나의 아카이브</span>
        </div>
        <div className="topbar-actions">
          <button className="btn-primary" onClick={() => setModalItem(null)}>+ 새 항목</button>
          <button className="btn-ghost" onClick={() => supabase.auth.signOut()} title="로그아웃">나가기</button>
        </div>
      </header>

      <div className="search-row">
        <div className="search-box">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="제목, 내용 통합 검색..."
            aria-label="아카이브 검색"
          />
        </div>
        <button
          className={`chip ${starredOnly ? 'chip-on' : ''}`}
          onClick={() => setStarredOnly((v) => !v)}
        >★ 중요</button>
      </div>

      {recentTags.length > 0 && (
        <div className="tag-row">
          {recentTags.map((t) => (
            <button
              key={t}
              className={`chip ${activeTag === t ? 'chip-on' : ''}`}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
            >#{t}</button>
          ))}
        </div>
      )}

      <div className="category-grid">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`cat-card cat-${c.key} ${category === c.key ? 'cat-on' : ''}`}
            onClick={() => setCategory(category === c.key ? null : c.key)}
          >
            <span className="cat-icon" aria-hidden="true">{c.icon}</span>
            <span className="cat-label">{c.label}</span>
            <span className="cat-count">{counts[c.key] ?? 0}개</span>
          </button>
        ))}
      </div>

      <div className="list-head">
        <span className="list-title">
          {filterActive ? `검색 결과 ${total}개` : `전체 ${total}개`}
        </span>
        {filterActive && (
          <button
            className="btn-ghost btn-sm"
            onClick={() => { setSearch(''); setCategory(null); setActiveTag(null); setStarredOnly(false) }}
          >필터 초기화</button>
        )}
        <div className="view-toggle" role="group" aria-label="보기 방식">
          <button
            className={view === 'grid' ? 'vt-on' : ''}
            onClick={() => setView('grid')}
            aria-label="갤러리 보기"
          >▦</button>
          <button
            className={view === 'list' ? 'vt-on' : ''}
            onClick={() => setView('list')}
            aria-label="리스트 보기"
          >☰</button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="center-block"><div className="spinner" aria-label="불러오는 중" /></div>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>{filterActive ? '조건에 맞는 항목이 없어요.' : '첫 항목을 저장해 보세요.'}</p>
          {!filterActive && (
            <button className="btn-primary" onClick={() => setModalItem(null)}>+ 새 항목 만들기</button>
          )}
        </div>
      ) : (
        <div className={view === 'grid' ? 'item-grid' : 'item-list'}>
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              view={view}
              onOpen={() => setModalItem(item)}
              onStar={() => toggleStar(item)}
              onTag={(t) => setActiveTag(activeTag === t ? null : t)}
            />
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="center-block">
          <button className="btn-ghost" onClick={() => loadPage(pageRef.current + 1)}>더 보기</button>
        </div>
      )}

      {modalItem !== undefined && (
        <ItemModal
          item={modalItem}
          userId={session.user.id}
          onClose={() => setModalItem(undefined)}
          onSaved={() => { setModalItem(undefined); refresh() }}
        />
      )}
    </div>
  )
}
