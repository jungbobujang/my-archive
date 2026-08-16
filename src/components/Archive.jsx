import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, PAGE_SIZE, subtreeIds, childrenOf } from '../supabase.js'
import ItemModal from './ItemModal.jsx'
import ItemCard from './ItemCard.jsx'
import CategoryManager from './CategoryManager.jsx'
import MindMap from './MindMap.jsx'
import BulkAdd from './BulkAdd.jsx'
import Today from './Today.jsx'
import Trash from './Trash.jsx'

export default function Archive({ session }) {
  const [items, setItems] = useState([])
  const [itemCats, setItemCats] = useState({}) // item_id -> [category_id]
  const [counts, setCounts] = useState({})
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const [categories, setCategories] = useState([])
  const [slots, setSlots] = useState([])
  const [managerOpen, setManagerOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [trashCount, setTrashCount] = useState(0)
  const [trashOpen, setTrashOpen] = useState(false)
  const [importStep, setImportStep] = useState(null) // null | 1 | 2 | 3
  const fileRef = useRef(null)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [categoryId, setCategoryId] = useState(null)
  const [activeTag, setActiveTag] = useState(null)
  const [starredOnly, setStarredOnly] = useState(false)
  const [statusFilter, setStatusFilter] = useState(null)
  const [todoCount, setTodoCount] = useState(0)
  const [view, setView] = useState(() => localStorage.getItem('archive-view') || 'grid')
  const [tab, setTab] = useState(() => localStorage.getItem('archive-tab') || 'today')
  const [refreshKey, setRefreshKey] = useState(0)

  const [quickText, setQuickText] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)

  const [modalItem, setModalItem] = useState(undefined) // undefined=닫힘, null=새 항목, 객체=수정
  const pageRef = useRef(0)

  // 좁은 화면에서 상단 보조 버튼들을 담는 ⋯ 메뉴 (넓은 화면에서는 CSS 로 그냥 한 줄이 된다)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDown(e) {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    localStorage.setItem('archive-view', view)
  }, [view])

  useEffect(() => {
    localStorage.setItem('archive-tab', tab)
  }, [tab])

  const buildQuery = useCallback((withCount, allowedIds) => {
    let q = supabase
      .from('items')
      .select('*', withCount ? { count: 'exact' } : undefined)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (allowedIds) q = q.in('id', allowedIds)
    if (activeTag) q = q.contains('tags', [activeTag])
    if (starredOnly) q = q.eq('starred', true)
    if (statusFilter) q = q.eq('status', statusFilter)
    if (debounced) q = q.or(`title.ilike.%${debounced}%,content.ilike.%${debounced}%`)
    return q
  }, [activeTag, starredOnly, statusFilter, debounced])

  // 선택 카테고리 + 자손에 속한 item_id 목록. 필터가 없으면 null(=제한 없음).
  const resolveAllowedIds = useCallback(async () => {
    if (!categoryId) return null
    const ids = subtreeIds(categories, categoryId)
    const { data, error } = await supabase
      .from('item_categories')
      .select('item_id')
      .in('category_id', ids)
    if (error) return []
    return [...new Set((data ?? []).map((r) => r.item_id))]
  }, [categoryId, categories])

  // 화면에 올라온 항목들의 소속 카테고리를 한 번의 조회로 매핑한다
  const loadItemCats = useCallback(async (itemIds, replace) => {
    if (itemIds.length === 0) {
      if (replace) setItemCats({})
      return
    }
    const { data, error } = await supabase
      .from('item_categories')
      .select('item_id, category_id')
      .in('item_id', itemIds)
    if (error) return
    const next = {}
    for (const row of data ?? []) {
      (next[row.item_id] ??= []).push(row.category_id)
    }
    setItemCats((prev) => (replace ? next : { ...prev, ...next }))
  }, [])

  const loadPage = useCallback(async (page) => {
    setLoading(true)
    const allowedIds = await resolveAllowedIds()

    // 소속 항목이 하나도 없으면 조회 없이 0개 처리
    if (allowedIds && allowedIds.length === 0) {
      setItems([])
      setItemCats({})
      setTotal(0)
      setHasMore(false)
      pageRef.current = 0
      setLoading(false)
      return
    }

    const from = page * PAGE_SIZE
    const { data, count, error } = await buildQuery(page === 0, allowedIds)
      .range(from, from + PAGE_SIZE - 1)
    if (!error) {
      setItems((prev) => (page === 0 ? data : [...prev, ...data]))
      if (page === 0 && count !== null) setTotal(count)
      setHasMore(data.length === PAGE_SIZE)
      pageRef.current = page
      await loadItemCats(data.map((i) => i.id), page === 0)
    }
    setLoading(false)
  }, [buildQuery, resolveAllowedIds, loadItemCats])

  const loadCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('position', { ascending: true })
    if (!error) setCategories(data ?? [])
  }, [])

  const loadSlots = useCallback(async () => {
    const { data, error } = await supabase
      .from('time_slots')
      .select('*')
      .order('position', { ascending: true })
    if (!error) setSlots(data ?? [])
  }, [])

  // 상한 없이 끝까지 받는 가벼운 조회
  const fetchAllLight = useCallback(async (table, columns, tweak) => {
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
  }, [])

  const loadCounts = useCallback(async () => {
    try {
      // item_categories 에는 deleted_at 이 없어 휴지통 항목이 섞인다.
      // 살아있는 id 를 먼저 모아 걸러낸다.
      const [liveIds, links] = [
        await fetchAllLight('items', 'id', (q) => q.is('deleted_at', null)),
        await fetchAllLight('item_categories', 'item_id, category_id')
      ]
      const live = new Set(liveIds.map((r) => r.id))
      const next = {}
      for (const c of categories) next[c.id] = 0
      for (const row of links) {
        if (live.has(row.item_id) && row.category_id in next) next[row.category_id]++
      }
      setCounts(next)
    } catch (err) {
      console.error(err)
    }

    const { count: tc } = await supabase
      .from('items').select('id', { count: 'exact', head: true })
      .eq('status', 'todo').is('deleted_at', null)
    setTodoCount(tc ?? 0)

    const { count: trash } = await supabase
      .from('items').select('id', { count: 'exact', head: true })
      .not('deleted_at', 'is', null)
    setTrashCount(trash ?? 0)
  }, [categories, fetchAllLight])

  useEffect(() => { loadCategories() }, [loadCategories])
  useEffect(() => { loadSlots() }, [loadSlots])
  useEffect(() => { loadPage(0) }, [loadPage])
  useEffect(() => { loadCounts() }, [loadCounts])

  const refresh = useCallback(() => {
    loadPage(0)
    loadCounts()
    setRefreshKey((k) => k + 1) // 오늘 탭도 같이 갱신
  }, [loadPage, loadCounts])

  const rootCategories = useMemo(() => childrenOf(categories, null), [categories])

  // 최상위 카드에는 자기 + 모든 자손의 항목 수 합계를 보여준다
  const subtreeCount = useCallback(
    (id) => subtreeIds(categories, id).reduce((sum, cid) => sum + (counts[cid] ?? 0), 0),
    [categories, counts]
  )

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

  async function toggleDone(item) {
    const next = item.status === 'done' ? 'todo' : 'done'
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)))
    setTodoCount((c) => Math.max(0, next === 'done' ? c - 1 : c + 1))
    await supabase.from('items').update({ status: next }).eq('id', item.id)
  }

  async function quickSave(e) {
    e.preventDefault()
    const raw = quickText.trim()
    if (!raw || quickBusy) return
    const isTodo = raw.startsWith('!')
    const title = (isTodo ? raw.slice(1) : raw).trim()
    if (!title) return
    setQuickBusy(true)
    const { error } = await supabase.from('items').insert({
      title,
      content: '',
      category_id: null,
      tags: [],
      status: isTodo ? 'todo' : 'none',
      user_id: session.user.id
    })
    setQuickBusy(false)
    if (!error) {
      setQuickText('')
      refresh()
    }
  }

  // PostgREST 는 한 번에 돌려주는 행 수에 상한이 있어 끝까지 나눠 받는다
  async function fetchAll(table) {
    const CHUNK = 1000
    const rows = []
    for (let from = 0; ; from += CHUNK) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .range(from, from + CHUNK - 1)
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < CHUNK) break
    }
    return rows
  }

  async function exportBackup() {
    setExporting(true)
    try {
      const [allItems, allCategories, allLinks] = [
        await fetchAll('items'),
        await fetchAll('categories'),
        await fetchAll('item_categories')
      ]

      const payload = {
        exported_at: new Date().toISOString(),
        items: allItems,
        categories: allCategories,
        item_categories: allLinks
      }

      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `my-archive-backup-${stamp}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('백업에 실패했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.')
    } finally {
      setExporting(false)
    }
  }

  // 1000개씩 나눠 upsert. 한 덩어리라도 실패하면 그 자리에서 던진다.
  async function upsertChunked(table, rows, onConflict) {
    const CHUNK = 1000
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const { error } = await supabase
        .from(table)
        .upsert(slice, onConflict ? { onConflict } : undefined)
      if (error) throw error
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 change 가 뜨도록
    if (!file) return

    let backup
    try {
      backup = JSON.parse(await file.text())
    } catch {
      alert('올바른 백업 파일이 아니에요')
      return
    }

    const ok = backup && typeof backup === 'object'
      && Array.isArray(backup.items)
      && Array.isArray(backup.categories)
      && Array.isArray(backup.item_categories)
    if (!ok) {
      alert('올바른 백업 파일이 아니에요')
      return
    }

    const proceed = window.confirm(
      `백업의 항목 ${backup.items.length}개, 카테고리 ${backup.categories.length}개를 가져올까요? `
      + '기존 데이터는 삭제되지 않고, 같은 id의 데이터는 백업 내용으로 덮어써집니다.'
    )
    if (!proceed) return

    const uid = session.user.id
    let stage = ''
    try {
      // 외래키 때문에 categories → items → item_categories 순서를 지켜야 한다
      stage = '카테고리'
      setImportStep(1)
      await upsertChunked('categories', backup.categories.map((c) => ({ ...c, user_id: uid })))

      stage = '항목'
      setImportStep(2)
      await upsertChunked('items', backup.items.map((i) => ({ ...i, user_id: uid })))

      stage = '카테고리 소속'
      setImportStep(3)
      await upsertChunked(
        'item_categories',
        backup.item_categories.map((r) => ({
          item_id: r.item_id,
          category_id: r.category_id,
          user_id: uid
        })),
        'item_id,category_id'
      )

      setImportStep(null)
      alert(`복원 완료: 항목 ${backup.items.length}개`)
      loadCategories()
      refresh()
    } catch (err) {
      console.error(err)
      setImportStep(null)
      alert(`복원 실패 (${stage} 단계): ${err?.message ?? '알 수 없는 오류'}`)
    }
  }

  // 마인드맵 노드의 + 버튼에서 호출. 색상은 부모에서 물려받는다.
  async function addCategory(parentId, name) {
    const clean = name.trim()
    if (!clean) return
    const parent = parentId ? categories.find((c) => c.id === parentId) : null
    const position = categories.reduce((max, c) => Math.max(max, c.position ?? 0), 0) + 1
    const { error } = await supabase.from('categories').insert({
      name: clean,
      icon: '📁',
      color: parent?.color ?? 'gray',
      parent_id: parentId ?? null,
      position,
      user_id: session.user.id
    })
    if (!error) loadCategories()
  }

  const filterActive = categoryId || activeTag || starredOnly || statusFilter || debounced

  return (
    <div className="archive">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">나의 아카이브</span>
        </div>
        <div className="topbar-actions" ref={menuRef}>
          <button className="btn-primary" onClick={() => setModalItem(null)}>+ 새 항목</button>
          <button
            className="btn-ghost more-toggle"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="더 보기"
            title="더 보기"
          >⋯</button>
          <div className={`more-menu ${menuOpen ? 'more-open' : ''}`}>
            <button
              className="btn-ghost"
              onClick={() => { setBulkOpen(true); setMenuOpen(false) }}
              title="여러 링크 저장"
            >⧉ 여러 링크</button>
            <button
              className="btn-ghost"
              onClick={() => { exportBackup(); setMenuOpen(false) }}
              disabled={exporting || importStep !== null}
              title="글/링크/분류 전체를 JSON으로 저장 (이미지는 링크로 포함)"
            >{exporting ? '내보내는 중...' : '💾 내보내기'}</button>
            <button
              className="btn-ghost"
              onClick={() => { fileRef.current?.click(); setMenuOpen(false) }}
              disabled={exporting || importStep !== null}
              title="백업 JSON을 불러와 합칩니다 (기존 데이터는 삭제되지 않음)"
            >{importStep !== null ? `복원 중... (${importStep}/3)` : '📥 가져오기'}</button>
            <button
              className="btn-ghost"
              onClick={() => supabase.auth.signOut()}
              title="로그아웃"
            >나가기</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            hidden
            onChange={handleImportFile}
          />
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="화면 전환">
        <button
          role="tab"
          aria-selected={tab === 'today'}
          className={`tab ${tab === 'today' ? 'tab-on' : ''}`}
          onClick={() => setTab('today')}
        >☀️ 오늘</button>
        <button
          role="tab"
          aria-selected={tab === 'archive'}
          className={`tab ${tab === 'archive' ? 'tab-on' : ''}`}
          onClick={() => setTab('archive')}
        >🗂 아카이브</button>
      </div>

      {tab === 'archive' && (
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
          className={`chip chip-todo ${statusFilter === 'todo' ? 'chip-on' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'todo' ? null : 'todo')}
        >⚡ 할 것{todoCount > 0 ? ` ${todoCount}` : ''}</button>
        <button
          className={`chip ${starredOnly ? 'chip-on' : ''}`}
          onClick={() => setStarredOnly((v) => !v)}
        >★ 중요</button>
      </div>
      )}

      <form className="quick-row" onSubmit={quickSave}>
        <span className="quick-icon" aria-hidden="true">⚡</span>
        <input
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          placeholder="빠른 저장: 입력 후 엔터 (!로 시작하면 할 것으로 저장)"
          aria-label="빠른 저장"
        />
        <button type="submit" className="btn-primary btn-sm" disabled={quickBusy || !quickText.trim()}>저장</button>
      </form>

      {tab === 'today' && (
        <Today
          categories={categories}
          slots={slots}
          userId={session.user.id}
          refreshKey={refreshKey}
          onOpen={(item) => setModalItem(item)}
          onChanged={refresh}
          onSlotsChanged={loadSlots}
        />
      )}

      {tab === 'archive' && (<>

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
        {rootCategories.map((c) => (
          <button
            key={c.id}
            className={`cat-card cat-${c.color} ${categoryId === c.id ? 'cat-on' : ''}`}
            onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
          >
            <span className="cat-icon" aria-hidden="true">{c.icon}</span>
            <span className="cat-label">{c.name}</span>
            <span className="cat-count">{subtreeCount(c.id)}개</span>
          </button>
        ))}
        <button
          className="cat-manage"
          onClick={() => setManagerOpen(true)}
          aria-label="카테고리 관리"
          title="카테고리 관리"
        >⚙️</button>
      </div>

      <div className="list-head">
        <span className="list-title">
          {filterActive ? `검색 결과 ${total}개` : `전체 ${total}개`}
        </span>
        {filterActive && (
          <button
            className="btn-ghost btn-sm"
            onClick={() => { setSearch(''); setCategoryId(null); setActiveTag(null); setStarredOnly(false); setStatusFilter(null) }}
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
          <button
            className={view === 'map' ? 'vt-on' : ''}
            onClick={() => setView('map')}
            aria-label="마인드맵 보기"
          >🗺️</button>
        </div>
      </div>

      {view === 'map' ? (
        <MindMap
          categories={categories}
          counts={counts}
          onSelect={(id) => { setCategoryId(id); setView('grid') }}
          onAdd={addCategory}
        />
      ) : loading && items.length === 0 ? (
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
              categories={categories}
              categoryIds={itemCats[item.id] ?? []}
              view={view}
              onOpen={() => setModalItem(item)}
              onStar={() => toggleStar(item)}
              onDone={() => toggleDone(item)}
              onTag={(t) => setActiveTag(activeTag === t ? null : t)}
            />
          ))}
        </div>
      )}

      {hasMore && !loading && view !== 'map' && (
        <div className="center-block">
          <button className="btn-ghost" onClick={() => loadPage(pageRef.current + 1)}>더 보기</button>
        </div>
      )}

      <div className="trash-link-row">
        <button className="trash-link" onClick={() => setTrashOpen(true)}>
          🗑 휴지통 ({trashCount})
        </button>
      </div>

      </>)}

      {trashOpen && (
        <Trash
          onClose={() => setTrashOpen(false)}
          onChanged={refresh}
        />
      )}

      {modalItem !== undefined && (
        <ItemModal
          item={modalItem}
          categories={categories}
          slots={slots}
          userId={session.user.id}
          onClose={() => setModalItem(undefined)}
          onSaved={() => { setModalItem(undefined); refresh() }}
        />
      )}

      {bulkOpen && (
        <BulkAdd
          categories={categories}
          userId={session.user.id}
          onClose={() => setBulkOpen(false)}
          onSaved={() => { setBulkOpen(false); refresh() }}
        />
      )}

      {managerOpen && (
        <CategoryManager
          categories={categories}
          userId={session.user.id}
          onClose={() => setManagerOpen(false)}
          onChanged={() => { loadCategories(); refresh() }}
        />
      )}
    </div>
  )
}
