// 로그인 후의 메인 화면. '오늘' 탭과 '아카이브' 탭을 함께 들고 있고,
// 목록 조회·필터·페이지네이션과 모달 열림 상태를 여기서 관리한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  supabase, PAGE_SIZE, subtreeIds, childrenOf, fetchAllRows,
  joinImages, uploadImage, imageFilesFromPaste, imageFilesFromDrop, ymd, MAX_IMAGES,
  parseFiles, removeStorageImages
} from '../supabase.js'
import { useTheme } from '../theme.js'
import { useToast } from './Toast.jsx'
import ItemModal from './ItemModal.jsx'
import ItemCard from './ItemCard.jsx'
import CategoryManager from './CategoryManager.jsx'
import MindMap from './MindMap.jsx'
import Today from './Today.jsx'
import Trash from './Trash.jsx'
import { SkeletonCards } from './Skeleton.jsx'
import Settings from './Settings.jsx'
import LockScreen from './LockScreen.jsx'
import { useIdleLock } from '../hooks.js'
import { readLockConfig, inGrace, endGrace } from '../lock.js'

// categoryIds 가 없을 때 넘길 고정 빈 배열 (매번 [] 를 새로 만들면 ItemCard 의 memo 가 풀린다)
const NO_CATEGORIES = []

export default function Archive({ session, onNavigate }) {
  const [items, setItems] = useState([])
  const [itemCats, setItemCats] = useState({}) // item_id -> [category_id]
  const [counts, setCounts] = useState({})
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const [categories, setCategories] = useState([])
  const [slots, setSlots] = useState([])
  const [managerOpen, setManagerOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [trashCount, setTrashCount] = useState(0)
  const [trashOpen, setTrashOpen] = useState(false)
  const [importStep, setImportStep] = useState(null) // null | 1..4 (복원 단계)
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
  const [quickUpload, setQuickUpload] = useState(0)  // 빠른 저장에서 올리는 중인 장수
  const [quickDrag, setQuickDrag] = useState(false)

  const [modalItem, setModalItem] = useState(undefined) // undefined=닫힘, null=새 항목, 객체=수정
  const pageRef = useRef(0)

  const toast = useToast()
  const { pref: themePref, setPref: setThemePref } = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 좁은 화면에서 상단 보조 버튼들을 담는 ⋯ 메뉴 (넓은 화면에서는 CSS 로 그냥 한 줄이 된다)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // ── 자리비움 잠금 ──────────────────────────────────────────
  // 설정은 기기(localStorage)에 있고 PIN 이 없으면 통째로 꺼진 상태다.
  const userId = session.user.id
  const [lockCfg, setLockCfg] = useState(() => readLockConfig(userId))
  const [locked, setLocked] = useState(false)
  const lockedRef = useRef(false)
  useEffect(() => { lockedRef.current = locked }, [locked])

  const syncLockCfg = useCallback(() => setLockCfg(readLockConfig(userId)), [userId])

  // 수동 잠금. 기기 스위치가 꺼져 있어도 PIN 만 걸려 있으면 눌러서 잠글 수 있다 —
  // 평소에는 아무 비용이 없다가 자리를 뜰 때 한 번 쓰는 쪽이 대부분의 사람에게 맞다.
  // 사람이 직접 잠갔으므로 '방금 풀었으니 봐준다'(유예)는 여기서 걷어낸다.
  const lockNow = useCallback(() => {
    if (!lockCfg.pinSet) return
    endGrace(userId)
    setMenuOpen(false)
    setLocked(true)
  }, [lockCfg.pinSet, userId])

  useIdleLock({
    enabled: lockCfg.enabled && !locked,
    minutes: lockCfg.minutes,
    onIdle: () => { if (!inGrace(userId)) setLocked(true) }
  })

  // 자리를 뜨면서 한 손으로 누르는 단축키. Ctrl(⌘)+Shift+L.
  useEffect(() => {
    if (!lockCfg.pinSet) return
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault()
        lockNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lockCfg.pinSet, lockNow])

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
    if (error) {
      toast.error('카테고리 필터를 적용하지 못했어요')
      return []
    }
    return [...new Set((data ?? []).map((r) => r.item_id))]
  }, [categoryId, categories, toast])

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
    if (error) {
      toast.error('항목의 카테고리 정보를 불러오지 못했어요')
      return
    }
    const next = {}
    for (const row of data ?? []) {
      (next[row.item_id] ??= []).push(row.category_id)
    }
    setItemCats((prev) => (replace ? next : { ...prev, ...next }))
  }, [toast])

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
    } else {
      toast.error('목록을 불러오지 못했어요. 연결 상태를 확인해 주세요')
    }
    setLoading(false)
  }, [buildQuery, resolveAllowedIds, loadItemCats, toast])

  const loadCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('position', { ascending: true })
    if (error) toast.error('카테고리를 불러오지 못했어요')
    else setCategories(data ?? [])
  }, [toast])

  const loadSlots = useCallback(async () => {
    const { data, error } = await supabase
      .from('time_slots')
      .select('*')
      .order('position', { ascending: true })
    if (error) toast.error('시간대를 불러오지 못했어요')
    else setSlots(data ?? [])
  }, [toast])

  const loadCounts = useCallback(async () => {
    try {
      // item_categories 에는 deleted_at 이 없어 휴지통 항목이 섞인다.
      // 살아있는 id 를 먼저 모아 걸러낸다.
      const [liveIds, links] = [
        await fetchAllRows('items', 'id', (q) => q.is('deleted_at', null)),
        await fetchAllRows('item_categories', 'item_id, category_id')
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
      toast.error('카테고리별 개수를 세지 못했어요')
    }

    const { count: tc } = await supabase
      .from('items').select('id', { count: 'exact', head: true })
      .eq('status', 'todo').is('deleted_at', null)
    setTodoCount(tc ?? 0)

    const { count: trash } = await supabase
      .from('items').select('id', { count: 'exact', head: true })
      .not('deleted_at', 'is', null)
    setTrashCount(trash ?? 0)
  }, [categories, toast])

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

  // 화면을 먼저 바꾸고 저장한다. 실패하면 되돌리고 알린다.
  // useCallback 인 이유: ItemCard 가 memo 라 콜백 참조가 매번 바뀌면 의미가 없다.
  const toggleStar = useCallback(async (item) => {
    const next = !item.starred
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, starred: next } : i)))
    const { error } = await supabase.from('items').update({ starred: next }).eq('id', item.id)
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, starred: !next } : i)))
      toast.error('중요 표시를 저장하지 못했어요')
    }
  }, [toast])

  const toggleDone = useCallback(async (item) => {
    const next = item.status === 'done' ? 'todo' : 'done'
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)))
    setTodoCount((c) => Math.max(0, next === 'done' ? c - 1 : c + 1))
    const { error } = await supabase.from('items').update({ status: next }).eq('id', item.id)
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)))
      setTodoCount((c) => Math.max(0, next === 'done' ? c + 1 : c - 1))
      toast.error('완료 상태를 저장하지 못했어요')
    }
  }, [toast])

  // 좌상단 로고 = 홈. 검색·필터를 모두 지우고 기본 탭으로 돌아간 뒤 다시 읽어 온다.
  const goHome = useCallback(() => {
    setSearch('')
    setDebounced('')       // 디바운스가 300ms 뒤에 옛 검색어를 되살리지 않도록 같이 지운다
    setCategoryId(null)
    setActiveTag(null)
    setStarredOnly(false)
    setStatusFilter(null)
    setTab('today')
    setMenuOpen(false)
    setModalItem(undefined)
    refresh()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [refresh])

  const openItem = useCallback((item) => setModalItem(item), [])
  const toggleTag = useCallback((t) => setActiveTag((prev) => (prev === t ? null : t)), [])

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
    if (error) {
      toast.error('저장하지 못했어요. 연결 상태를 확인해 주세요')
      return
    }
    setQuickText('')
    toast.success(isTodo ? '할 것으로 저장했어요' : '저장했어요')
    refresh()
  }

  // 빠른 저장에 이미지를 붙여넣거나 끌어놓으면 바로 한 항목으로 저장한다.
  // 제목은 입력 중인 글이 있으면 그걸 쓰고(!로 시작하면 할 것), 비어 있으면 날짜로 만든다.
  async function quickSaveImages(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_IMAGES)
    if (list.length === 0 || quickBusy || quickUpload > 0) return

    const raw = quickText.trim()
    const isTodo = raw.startsWith('!')
    const typed = (isTodo ? raw.slice(1) : raw).trim()
    const title = typed || `이미지 ${ymd(new Date())}`

    setQuickUpload(list.length)
    const urls = []
    let failed = 0
    for (const f of list) {
      try {
        urls.push(await uploadImage(f, session.user.id))
      } catch (err) {
        failed += 1
        console.error('이미지 업로드 실패:', err)
      } finally {
        setQuickUpload((n) => Math.max(0, n - 1))
      }
    }

    if (urls.length === 0) {
      toast.error('이미지를 올리지 못했어요. 연결 상태를 확인해 주세요')
      return
    }

    const { error } = await supabase.from('items').insert({
      title,
      content: '',
      category_id: null,
      tags: [],
      status: isTodo ? 'todo' : 'none',
      image_url: joinImages(urls),
      user_id: session.user.id
    })
    if (error) {
      // 올리기는 됐는데 행이 안 들어간 경우다. 그대로 두면 아무 항목도 가리키지 않는
      // 이미지가 스토리지에 남는다 — 화면에는 보이지 않아 나중에 찾을 방법도 없다.
      await removeStorageImages(urls)
      toast.error('저장하지 못했어요. 연결 상태를 확인해 주세요')
      return
    }
    setQuickText('')
    toast.success(
      failed > 0
        ? `이미지 ${urls.length}장 저장 (${failed}장 실패)`
        : `이미지 ${urls.length}장을 "${title}" 로 저장했어요`
    )
    refresh()
  }

  async function exportBackup() {
    if (lockedRef.current) return
    setExporting(true)
    try {
      const [allItems, allCategories, allSlots, allLinks] = [
        await fetchAllRows('items'),
        await fetchAllRows('categories'),
        await fetchAllRows('time_slots'),
        await fetchAllRows('item_categories')
      ]

      const payload = {
        exported_at: new Date().toISOString(),
        // 첨부 파일은 '메타만' 들어간다. 파일 실체를 JSON 에 담으면(base64) 10MB 짜리
        // 다섯 개만 있어도 백업이 수십 MB 로 부풀어 브라우저에서 만들다 멈춘다.
        // 읽는 사람이 그 사실을 알 수 있도록 파일 안에도 한 줄 적어 둔다.
        files_note: '첨부 파일의 실체는 이 백업에 들어 있지 않습니다. '
          + 'items[].files 는 이름(name)·경로(path)·용량(size) 만 담고, '
          + '파일 자체는 Supabase 스토리지의 archive-files 버킷에 있습니다.',
        // 혹시 다른 열쇠가 섞여 들어가도 메타 세 가지만 남긴다
        items: allItems.map((it) => (
          it.files === undefined ? it : { ...it, files: parseFiles(it.files) }
        )),
        categories: allCategories,
        time_slots: allSlots,
        item_categories: allLinks
      }

      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

      // 내보내기를 누른 뒤 다 만들기 전에 잠겼을 수 있다. 그때는 내려받지 않는다 —
      // 잠긴 화면 뒤에서 파일이 떨어지면 가려 둔 내용이 그대로 새어 나간다.
      if (lockedRef.current) {
        toast.error('잠겨 있는 동안에는 내보낼 수 없어요')
        return
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `my-archive-backup-${stamp}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(
        `백업 파일을 내려받았어요 (항목 ${allItems.length}개 · 첨부 파일 실체는 별도)`
      )
    } catch (err) {
      console.error(err)
      toast.error('백업에 실패했어요. 연결 상태를 확인하고 다시 시도해 주세요')
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
    if (!file || lockedRef.current) return

    let backup
    try {
      backup = JSON.parse(await file.text())
    } catch {
      toast.error('읽을 수 없는 파일이에요. JSON 백업 파일인지 확인해 주세요')
      return
    }

    const ok = backup && typeof backup === 'object'
      && Array.isArray(backup.items)
      && Array.isArray(backup.categories)
      && Array.isArray(backup.item_categories)
    if (!ok) {
      toast.error('백업 파일 형식이 맞지 않아요 (items·categories·item_categories 필요)')
      return
    }

    // time_slots 는 나중에 추가된 항목이라 옛 백업에는 없다. 없으면 그냥 건너뛴다.
    const backupSlots = Array.isArray(backup.time_slots) ? backup.time_slots : []

    const proceed = window.confirm(
      `백업의 항목 ${backup.items.length}개, 카테고리 ${backup.categories.length}개`
      + (backupSlots.length > 0 ? `, 시간대 ${backupSlots.length}개` : '')
      + '를 가져올까요? '
      + '기존 데이터는 삭제되지 않고, 같은 id의 데이터는 백업 내용으로 덮어써집니다.'
    )
    if (!proceed) return

    const uid = session.user.id
    let stage = ''
    try {
      // 외래키 순서를 지켜야 한다.
      // items.category_id -> categories, items.slot_id -> time_slots 라서
      // 둘 다 items 보다 먼저 들어가야 한다.
      stage = '카테고리'
      setImportStep(1)
      await upsertChunked('categories', backup.categories.map((c) => ({ ...c, user_id: uid })))

      stage = '시간대'
      setImportStep(2)
      await upsertChunked('time_slots', backupSlots.map((s) => ({ ...s, user_id: uid })))

      stage = '항목'
      setImportStep(3)
      await upsertChunked('items', backup.items.map((i) => ({ ...i, user_id: uid })))

      stage = '카테고리 소속'
      setImportStep(4)
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
      toast.success(`복원 완료: 항목 ${backup.items.length}개`)
      loadCategories()
      loadSlots() // 복원된 시간대를 '오늘' 탭이 바로 쓰도록
      refresh()
    } catch (err) {
      console.error(err)
      setImportStep(null)
      toast.error(`복원 실패 (${stage} 단계): ${err?.message ?? '알 수 없는 오류'}`)
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
    if (error) toast.error('카테고리를 추가하지 못했어요')
    else loadCategories()
  }

  const filterActive = categoryId || activeTag || starredOnly || statusFilter || debounced

  // 잠겨 있으면 본문을 아예 그리지 않는다. 가림막을 덮는 대신 이렇게 하는 이유는
  // LockScreen.jsx 머리말에 적어 두었다 — 덮기만 하면 글자가 DOM 에 남는다.
  // 이 return 은 훅을 모두 부른 뒤에 있고, Archive 자신은 마운트된 채로 있다.
  // 그래서 검색어·탭·열려 있던 모달 같은 상태가 잠금 동안 그대로 살아 있고,
  // 풀면 있던 자리로 돌아온다 (쓰던 글은 ItemModal 이 초안으로 남겨 둔다).
  if (locked) {
    return <LockScreen userId={userId} onUnlock={() => setLocked(false)} />
  }

  return (
    <div className="archive">
      <header className="topbar">
        <button
          type="button"
          className="brand"
          onClick={goHome}
          title="홈으로 (필터 초기화)"
          aria-label="홈으로. 검색과 필터를 초기화합니다"
        >
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-name">나의 아카이브</span>
        </button>
        <div className="topbar-actions" ref={menuRef}>
          <button className="btn-primary" onClick={() => setModalItem(null)}>+ 새 항목</button>
          {/* PIN 을 건 기기에서만 보인다. PIN 이 없으면 잠가도 풀 길이 없다. */}
          {lockCfg.pinSet && (
            <button
              className="btn-ghost lock-btn"
              onClick={lockNow}
              title="지금 잠그기 (Ctrl+Shift+L)"
              aria-label="지금 잠그기"
            >🔒</button>
          )}
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
              onClick={() => { setSettingsOpen(true); setMenuOpen(false) }}
              title="설정 (화면 테마, 플랜)"
            >⚙️ <span className="menu-label">설정</span></button>
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
            >{importStep !== null ? `복원 중... (${importStep}/4)` : '📥 가져오기'}</button>
            <button
              className="btn-ghost"
              onClick={async () => {
                const { error } = await supabase.auth.signOut()
                if (error) toast.error('로그아웃하지 못했어요')
              }}
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

      <form
        className={`quick-row ${quickDrag ? 'quick-row-drop' : ''}`}
        onSubmit={quickSave}
        onDragOver={(e) => { e.preventDefault(); setQuickDrag(true) }}
        onDragLeave={() => setQuickDrag(false)}
        onDrop={(e) => {
          const files = imageFilesFromDrop(e)
          setQuickDrag(false)
          if (files.length === 0) return
          e.preventDefault()
          quickSaveImages(files)
        }}
      >
        <span className="quick-icon" aria-hidden="true">⚡</span>
        <input
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          onPaste={(e) => {
            const files = imageFilesFromPaste(e)
            if (files.length === 0) return // 이미지가 아니면 평소대로 텍스트 붙여넣기
            e.preventDefault()
            quickSaveImages(files)
          }}
          placeholder="빠른 저장 — 입력 후 엔터"
          aria-label="빠른 저장"
          disabled={quickUpload > 0}
        />
        <button
          type="submit"
          className="btn-primary btn-sm"
          disabled={quickBusy || quickUpload > 0 || !quickText.trim()}
        >저장</button>
      </form>
      {/* 좁은 화면에서는 placeholder 에 다 담기지 않아, 입력 중에만 힌트를 보여 준다 */}
      <p className="quick-hint" aria-live="polite">
        {quickUpload > 0
          ? `이미지 ${quickUpload}장 올리는 중…`
          : '!로 시작하면 ‘할 것’으로 저장돼요 · 이미지는 붙여넣기(Ctrl+V)로 바로 저장'}
      </p>

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
        <SkeletonCards view={view} count={view === 'grid' ? 6 : 4} />
      ) : items.length === 0 ? (
        <div className="empty">
          <span className="empty-icon" aria-hidden="true">{filterActive ? '🔍' : '🗂'}</span>
          <p className="empty-title">
            {filterActive ? '조건에 맞는 항목이 없어요' : '아직 저장한 것이 없어요'}
          </p>
          <p className="empty-sub">
            {filterActive
              ? '검색어를 줄이거나 필터를 지워 보세요.'
              : '떠오른 생각, 링크, 대본을 여기에 모아 두면 나중에 찾기 쉬워요.'}
          </p>
          {filterActive ? (
            <button
              className="btn-ghost btn-sm"
              onClick={() => { setSearch(''); setCategoryId(null); setActiveTag(null); setStarredOnly(false); setStatusFilter(null) }}
            >필터 초기화</button>
          ) : (
            <button className="btn-primary" onClick={() => setModalItem(null)}>+ 첫 항목 만들기</button>
          )}
        </div>
      ) : (
        <div className={view === 'grid' ? 'item-grid' : 'item-list'}>
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              categories={categories}
              categoryIds={itemCats[item.id] ?? NO_CATEGORIES}
              view={view}
              onOpen={openItem}
              onStar={toggleStar}
              onDone={toggleDone}
              onTag={toggleTag}
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
          onSaved={(warn) => {
            setModalItem(undefined)
            refresh()
            // 모달이 닫히므로 인라인 문구로는 전할 수 없는 것만 토스트로 올라온다
            // (지금은 items.files 열이 없어 첨부를 못 붙인 경우뿐이다)
            if (warn) toast.error(warn)
          }}
        />
      )}

      {(exporting || importStep !== null) && (
        <div className="busy-pill" role="status">
          <span className="busy-dot" aria-hidden="true" />
          {exporting ? '백업을 만드는 중...' : `복원 중 (${importStep}/4)`}
        </div>
      )}

      {settingsOpen && (
        <Settings
          email={session.user.email}
          userId={userId}
          themePref={themePref}
          onThemeChange={setThemePref}
          onOpenPricing={() => { setSettingsOpen(false); onNavigate('/pricing') }}
          onLockChanged={syncLockCfg}
          onClose={() => setSettingsOpen(false)}
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
