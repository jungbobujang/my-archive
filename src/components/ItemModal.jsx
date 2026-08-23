// 항목 생성/수정 모달. 저장은 items 한 줄 + item_categories 를 통째로 갈아끼우는 두 단계다.
//
// '여러 링크 저장' 모달을 여기로 흡수했다(별도 화면 폐지). 링크는 한 줄짜리 입력칸으로
// 하나씩(또는 여러 개를 한 번에 붙여넣어) 목록에 담고, 목록에서 ✕ 로 뺀다 —
// 수정 중인 항목의 링크도 같은 목록에서 더하고 뺀다.
// 링크가 둘 이상이면 '한 항목에 모두 담기'(기본)와 '링크마다 개별 항목'을 고르게 하고,
// 개별 모드가 예전 그 화면이 하던 일(링크마다 noembed 로 제목을 받아 한 건씩 저장)을 그대로 한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  supabase, extractUrls, parseLinks, parseTags, youtubeThumb, ymd, fetchLinkTitle,
  parseImages, joinImages, uploadImage, imageFilesFromPaste, MAX_IMAGES,
  parseFiles, joinFiles, uploadFile, signedFileUrl, fileRejectReason, fileIcon, formatBytes,
  removeStorageFiles, removeStorageImages, splitByKind, MAX_FILES, FILE_EXTS,
  treeOrder, categoryPath
} from '../supabase.js'
import { useEscapeKey, confirmDiscard, draftKeyFor, readDraft, writeDraft, clearDraft } from '../hooks.js'

// youtu.be/abc123 형태로 줄인다.
// 물음표 뒤(?v=...)까지 남기는 이유: 유튜브 링크는 경로가 전부 /watch 라
// 그것을 떼면 서로 다른 영상이 목록에서 똑같은 줄로 보인다.
function shortenUrl(url) {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    const short = `${u.hostname.replace(/^www\./, '')}${path}${u.search}`
    return short.length > 42 ? `${short.slice(0, 42)}…` : short
  } catch {
    return url.length > 42 ? `${url.slice(0, 42)}…` : url
  }
}

// setup.sql 을 아직 실행하지 않아 items.files 열이 없는 DB 인지.
// PostgREST 는 스키마 캐시에서 못 찾으면 PGRST204, 실제 SQL 오류면 42703 을 준다.
function isMissingFilesColumn(err) {
  const code = err?.code ?? ''
  if (code === 'PGRST204' || code === '42703') return /files/i.test(err?.message ?? '')
  return false
}

const FILE_ACCEPT = FILE_EXTS.map((e) => `.${e}`).join(',')

export default function ItemModal({ item, categories, slots, userId, onClose, onSaved }) {
  const isEdit = !!item

  // 이 항목의 임시본. 렌더 중 한 번만 읽는다 (이후 값은 state 가 들고 있다).
  const draftKey = draftKeyFor(item?.id)
  const [draft] = useState(() => readDraft(draftKey))
  const [restored, setRestored] = useState(!!draft) // 되살렸다는 안내를 띄울지

  // 초안이 있으면 초안이 이긴다. 없으면 DB 값(수정) 또는 빈 값(새 항목).
  const [title, setTitle] = useState(draft?.title ?? item?.title ?? '')
  const [content, setContent] = useState(draft?.content ?? item?.content ?? '')
  const [categoryIds, setCategoryIds] = useState(
    draft?.categoryIds ?? (item?.category_id ? [item.category_id] : [])
  )
  const [status, setStatus] = useState(draft?.status ?? item?.status ?? 'none')
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? item?.due_date ?? '')
  const [slotId, setSlotId] = useState(draft?.slotId ?? item?.slot_id ?? null)
  // 링크는 목록으로 들고 있다. linkInput 은 아직 목록에 담기지 않은, 지금 치고 있는 한 줄.
  // 예전 초안(linkUrl 한 덩어리)도 읽어 준다 — 새로고침으로 되살릴 때 형식이 바뀌었다고 잃으면 안 된다.
  const [links, setLinks] = useState(
    () => draft?.links ?? extractUrls(draft?.linkUrl ?? item?.link_url ?? '')
  )
  const [linkInput, setLinkInput] = useState(draft?.linkInput ?? '')
  const [tagsText, setTagsText] = useState(draft?.tagsText ?? (item?.tags ?? []).join(', '))
  // 이미지는 고를 때 바로 올린다. 그래야 스크린샷을 붙여넣는 순간 썸네일이 뜨고
  // 진행 상태를 보여 줄 수 있다. (대신 저장하지 않고 닫으면 올라간 파일은 남는다)
  // 이미지 URL 도 초안에 넣는다. 파일은 고르는 즉시 스토리지에 올라가 있으므로,
  // 여기서 잃으면 올라간 파일만 남고 화면에서는 사라진다(고아 파일).
  const [images, setImages] = useState(draft?.images ?? parseImages(item?.image_url))
  const [uploading, setUploading] = useState(0) // 올리는 중인 장수
  const [dragOver, setDragOver] = useState(false)
  const [zoom, setZoom] = useState(null)         // 크게 볼 이미지 URL
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  // 첨부 파일. 초안에는 넣지 않는다 — 저장하지 않고 닫으면 스토리지에서 지우므로,
  // 초안에 남겨 두면 다시 열었을 때 이미 없는 파일을 가리키게 된다.
  const [files, setFiles] = useState(() => parseFiles(item?.files))
  const [fileBusy, setFileBusy] = useState(0)    // 올리는 중인 개수
  const [fileDrag, setFileDrag] = useState(false)
  const attachRef = useRef(null)

  // 저장 키의 앞자리. 수정 중이면 항목 id 를, 새 항목이면 아직 id 가 없으므로
  // 이 모달에서만 쓰는 임시 id 를 쓴다. 지우기는 경로 목록으로 하지 폴더로 하지 않아
  // 나중에 항목 id 와 달라도 상관없다.
  const [folderId] = useState(() => (
    item?.id ?? `new-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  ))

  // DB 에 이미 붙어 있는 것들. '이번에 올린 것' 과 가르는 기준선이다.
  const savedImages = useMemo(() => parseImages(item?.image_url), [item?.image_url])
  const savedFilePaths = useMemo(
    () => new Set(parseFiles(item?.files).map((f) => f.path)), [item?.files]
  )
  // ✕ 로 뺐지만 DB 에는 아직 남아 있는 것들. 저장이 성공한 뒤에 지운다 —
  // 취소하고 닫으면 항목에는 그대로 붙어 있어야 하므로 그 자리에서 지우면 안 된다.
  const pendingRemoval = useRef({ images: [], files: [] })
  // 화면에 그리지 않고 저장이 끝난 직후에 한 번 읽는 값이라 ref 다.
  // state 로 두면 setState 가 반영되기 전에 읽게 돼 늘 false 였다.
  const needsSql = useRef(false)

  // 링크마다 개별 항목으로 나눌지 (링크가 2개 이상일 때만 고를 수 있다)
  const [splitMode, setSplitMode] = useState(draft?.splitMode ?? false)

  // '바뀌었는지' 를 재는 기준선. 수정 모드의 소속은 아래에서 비동기로 불러오므로
  // 그때 같이 갱신한다 — 안 그러면 열자마자 '바뀜' 으로 잡혀 Esc 마다 확인창이 뜬다.
  const [baseCategoryIds, setBaseCategoryIds] = useState(
    item?.category_id ? [item.category_id] : []
  )
  const [progress, setProgress] = useState(null) // { done, total }

  // 입력칸에 쳐 두고 '추가' 를 안 누른 링크도 저장 때는 함께 담는다 (쓴 것을 잃지 않게).
  const pendingLinks = useMemo(
    () => parseLinks(linkInput).filter((u) => !links.includes(u)),
    [linkInput, links]
  )
  const allLinks = useMemo(
    () => (pendingLinks.length > 0 ? [...links, ...pendingLinks] : links),
    [links, pendingLinks]
  )
  const splitting = !isEdit && splitMode && allLinks.length > 1

  // 제목·링크·내용·이미지·파일 중 하나라도 있으면 저장할 수 있다. 제목은 이제 필수가 아니다.
  const hasAnything =
    title.trim().length > 0 || allLinks.length > 0 || content.trim().length > 0 ||
    images.length > 0 || files.length > 0

  // 열었을 때와 견줘 하나라도 달라졌는지. '내용이 있는지' 가 아니라 '바뀌었는지' 로 잰다 —
  // 수정 모달은 열자마자 내용이 차 있으므로, 내용 유무로 재면 Esc 마다 확인창이 뜬다.
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
  // 이미지 목록을 인자로 받는다 — 닫을 때 '이번에 올린 것을 뺀 상태' 로도 재야 하기 때문이다.
  function dirtyWith(imgs) {
    return (
      title !== (item?.title ?? '') ||
      content !== (item?.content ?? '') ||
      links.join(' ') !== extractUrls(item?.link_url ?? '').join(' ') ||
      linkInput.trim() !== '' ||
      tagsText !== (item?.tags ?? []).join(', ') ||
      status !== (item?.status ?? 'none') ||
      dueDate !== (item?.due_date ?? '') ||
      slotId !== (item?.slot_id ?? null) ||
      joinImages(imgs) !== joinImages(savedImages) ||
      !sameSet(categoryIds, baseCategoryIds)
    )
  }
  const filesDirty =
    files.map((f) => f.path).join('\n') !== parseFiles(item?.files).map((f) => f.path).join('\n')
  const dirty = dirtyWith(images) || filesDirty

  // 초안에 담을 값. 파일은 넣지 않는다(위 files 선언의 주석 참고).
  function draftBody(imgs) {
    return {
      title, content, links, linkInput, tagsText, categoryIds, status, dueDate, slotId,
      images: imgs, splitMode
    }
  }

  // 작성 중인 값을 sessionStorage 에 남긴다. 바뀐 게 없으면 남길 것도 없다.
  useEffect(() => {
    if (!dirty) { clearDraft(draftKey); return }
    writeDraft(draftKey, draftBody(images))
  }, [draftKey, dirty, title, content, links, linkInput, tagsText, categoryIds, status, dueDate, slotId, images, splitMode])

  // 저장하지 않고 닫을 때: 이번에 올려 둔 이미지·파일을 스토리지에서 지운다.
  //
  // ac74304 는 올린 이미지를 초안에 남겨 두는 쪽을 골랐고, 그 대가로 저장하지 않고
  // 닫으면 스토리지에 고아가 남았다(커밋 본문에 적혀 있다). 이제는 닫는 순간 지운다.
  // 그래서 초안에서도 함께 빼야 한다 — 안 그러면 다시 열었을 때 이미 없는 그림을 가리킨다.
  // 글·링크·카테고리 같은 나머지 초안은 그대로 남는다.
  function cleanupAndClose() {
    const keptImages = images.filter((u) => savedImages.includes(u))
    const goneImages = images.filter((u) => !savedImages.includes(u))
    const goneFiles = files.filter((f) => !savedFilePaths.has(f.path)).map((f) => f.path)

    if (goneImages.length > 0) removeStorageImages(goneImages)
    if (goneFiles.length > 0) removeStorageFiles(goneFiles)

    // 초안을 마지막으로 한 번 더 쓴다. 이 뒤로는 언마운트라 위 useEffect 가 다시 돌지 않는다.
    if (dirtyWith(keptImages)) writeDraft(draftKey, draftBody(keptImages))
    else clearDraft(draftKey)

    onClose()
  }

  // 닫으면 사라질 첨부의 개수. 이미 항목에 붙어 있던 것은 그대로 남으므로 세지 않는다.
  const droppingCount =
    images.filter((u) => !savedImages.includes(u)).length +
    files.filter((f) => !savedFilePaths.has(f.path)).length

  // Esc 는 손이 미끄러지기 쉬운 자리라, 쓰던 게 있으면 한 번 물어본다.
  // ✕·취소는 눌러야 닿는 자리라 그냥 닫는다 (어차피 글·링크 초안은 남는다).
  // 이번에 올린 첨부가 있으면 그것이 사라진다는 것을 문구에 적는다 — 글은 초안으로
  // 되살아나지만 첨부는 되살아나지 않으므로, 같은 '닫기' 라도 잃는 것이 다르다.
  function closeFromEscape() {
    const message = droppingCount > 0
      ? '작성 중인 내용이 있습니다. 닫을까요?\n첨부한 이미지/파일도 함께 삭제됩니다.'
      : undefined
    if (!confirmDiscard(dirty, message)) return
    cleanupAndClose()
  }

  // 크게 보기가 떠 있으면 Esc 는 그것부터 닫는다 (모달까지 같이 닫히면 쓴 내용이 날아간다)
  useEscapeKey(() => { if (zoom) setZoom(null); else closeFromEscape() })

  // 되살린 초안을 버리고 처음 상태로 되돌린다.
  // 되돌리면 이번에 올린 이미지·파일은 화면에서 사라지므로 스토리지에서도 지운다 —
  // 안 지우면 아무 항목도 가리키지 않는 채로 남고, 화면에 없으니 찾을 방법도 없다.
  function discardDraft() {
    clearDraft(draftKey)
    removeStorageImages(images.filter((u) => !savedImages.includes(u)))
    removeStorageFiles(files.filter((f) => !savedFilePaths.has(f.path)).map((f) => f.path))
    setTitle(item?.title ?? '')
    setContent(item?.content ?? '')
    setLinks(extractUrls(item?.link_url ?? ''))
    setLinkInput('')
    setTagsText((item?.tags ?? []).join(', '))
    setCategoryIds(baseCategoryIds)
    setStatus(item?.status ?? 'none')
    setDueDate(item?.due_date ?? '')
    setSlotId(item?.slot_id ?? null)
    setImages(parseImages(item?.image_url))
    setFiles(parseFiles(item?.files))
    setSplitMode(false)
    setRestored(false)
    setError('')
  }

  // 수정 모드: 기존 소속을 item_categories 에서 불러온다
  useEffect(() => {
    if (!item?.id) return
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase
        .from('item_categories')
        .select('category_id')
        .eq('item_id', item.id)
      if (!alive || err || !data) return
      const ids = data.map((r) => r.category_id)
      setBaseCategoryIds(ids)
      // 초안에 소속이 들어 있으면 그쪽이 이긴다 (사용자가 고쳐 둔 값을 DB 값으로 덮지 않는다)
      if (!draft?.categoryIds) setCategoryIds(ids)
    })()
    return () => { alive = false }
  }, [item?.id])

  // 입력칸의 글을 링크 목록으로 옮긴다. 알아볼 수 없으면 목록은 그대로 두고 입력칸도 남긴다.
  // silent 는 포커스가 빠져나갈 때 쓴다 — 주소를 치다 만 사람에게 빨간 글씨를 띄우지 않는다.
  function commitLinkInput(silent = false) {
    if (!linkInput.trim()) return
    const found = parseLinks(linkInput)
    if (found.length === 0) {
      if (!silent) setError('링크를 알아보지 못했어요. 주소 전체를 붙여넣어 주세요.')
      return
    }
    setLinks((prev) => [...prev, ...found.filter((u) => !prev.includes(u))])
    setLinkInput('')
    setError('')
  }

  function removeLink(url) {
    setLinks((prev) => prev.filter((u) => u !== url))
  }

  // 이미지 여러 장을 받아 순서대로 올린다. 하나가 실패해도 나머지는 계속 간다.
  async function addFiles(incoming) {
    const list = [...incoming]
    if (list.length === 0) return

    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      setError(`이미지는 최대 ${MAX_IMAGES}장까지예요`)
      return
    }
    const take = list.slice(0, room)
    if (list.length > room) setError(`${MAX_IMAGES}장까지만 올려서 ${take.length}장만 담았어요`)
    else setError('')

    // 더하기로 올린다. 올리는 중에 또 붙여넣으면 덮어쓰기가 돼서 카운터가 먼저 0 이 되고,
    // 그러면 아직 올라가는 중인데 저장 버튼이 풀린다.
    setUploading((n) => n + take.length)
    let failed = 0
    for (const f of take) {
      try {
        const url = await uploadImage(f, userId)
        // 상한은 넣는 자리에서 한 번 더 막는다 (연속 붙여넣기로 room 계산이 겹칠 수 있다)
        setImages((prev) => (
          prev.includes(url) || prev.length >= MAX_IMAGES ? prev : [...prev, url]
        ))
      } catch (err) {
        failed += 1
        console.error('이미지 업로드 실패:', err)
      } finally {
        setUploading((n) => Math.max(0, n - 1))
      }
    }
    if (failed > 0) setError(`이미지 ${failed}장을 올리지 못했어요. 연결 상태를 확인해 주세요.`)
  }

  // 파일 여러 개를 받아 순서대로 올린다. 거부 사유는 첫 건만 보여 준다 —
  // 한 번에 여러 개를 떨어뜨렸을 때 사유를 다 늘어놓으면 무엇을 고쳐야 하는지 흐려진다.
  async function addAttachments(incoming) {
    const list = [...incoming]
    if (list.length === 0) return

    const take = []
    let reason = ''
    for (const f of list) {
      // 개수 상한은 '지금 담긴 것 + 이번에 담기로 한 것' 으로 센다
      const why = fileRejectReason(f, files.length + take.length)
      if (why) { if (!reason) reason = why; continue }
      take.push(f)
    }
    setError(reason)
    if (take.length === 0) return

    setFileBusy((n) => n + take.length)
    let failed = 0
    for (const f of take) {
      try {
        const meta = await uploadFile(f, folderId)
        setFiles((prev) => (
          prev.length >= MAX_FILES || prev.some((x) => x.path === meta.path) ? prev : [...prev, meta]
        ))
      } catch (err) {
        failed += 1
        console.error('파일 업로드 실패:', err)
      } finally {
        setFileBusy((n) => Math.max(0, n - 1))
      }
    }
    if (failed > 0) setError(`파일 ${failed}개를 올리지 못했어요. 연결 상태를 확인해 주세요.`)
  }

  // 떨어뜨린 것을 이미지와 파일로 갈라 각자에게 보낸다. 어느 칸에 떨어뜨렸든 같다 —
  // 스크린샷을 파일 칸에 놓았다고 "이미지는 안 됩니다" 라고 답하는 것은 도움이 되지 않는다.
  function routeFiles(list) {
    const { images: imgs, docs } = splitByKind(list)
    if (imgs.length > 0) addFiles(imgs)
    if (docs.length > 0) addAttachments(docs)
  }

  // 이미지 빼기. 이번에 올린 것이면 바로 지우고(아직 어디에도 붙지 않았다),
  // 이미 항목에 붙어 있던 것이면 저장이 성공한 뒤에 지운다.
  function removeImage(url) {
    setImages((prev) => prev.filter((u) => u !== url))
    if (savedImages.includes(url)) pendingRemoval.current.images.push(url)
    else removeStorageImages([url])
  }

  function removeFile(f) {
    setFiles((prev) => prev.filter((x) => x.path !== f.path))
    if (savedFilePaths.has(f.path)) pendingRemoval.current.files.push(f.path)
    else removeStorageFiles([f.path])
  }

  // 비공개 버킷이라 누를 때마다 짧은 서명 주소를 받아 내려받는다.
  async function downloadFile(f) {
    try {
      const url = await signedFileUrl(f.path, f.name)
      const a = document.createElement('a')
      a.href = url
      a.download = f.name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      console.error('파일 내려받기 실패:', err)
      setError('파일을 내려받지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    }
  }

  function handlePaste(e) {
    const pasted = imageFilesFromPaste(e)
    if (pasted.length === 0) return // 이미지가 아니면 평소대로 텍스트 붙여넣기
    e.preventDefault()
    addFiles(pasted)
  }

  function handleDrop(e) {
    const dropped = [...(e.dataTransfer?.files ?? [])]
    setDragOver(false)
    setFileDrag(false)
    if (dropped.length === 0) return
    e.preventDefault()
    routeFiles(dropped)
  }

  // 제목이 비었을 때 대신 지어 준다.
  //   ① 링크가 있으면 첫 링크의 제목 (noembed)
  //   ② 내용이 있으면 앞 20자
  //   ③ 이미지만 있으면 '이미지 YYYY-MM-DD'
  // ②를 ③보다 앞에 둔 이유: 글과 이미지가 함께 있을 때 날짜보다 글 첫머리가 훨씬 잘 읽힌다.
  // 첨부 파일 이름은 쓰지 않는다 — 사양에 없다.
  async function makeTitle(firstLink) {
    if (firstLink) {
      const fetched = await fetchLinkTitle(firstLink)
      if (fetched) return fetched
    }
    const body = content.trim()
    if (body) return body.slice(0, 20)
    if (images.length > 0) return `이미지 ${ymd(new Date())}`
    return firstLink || `메모 ${ymd(new Date())}`
  }

  // setup.sql 을 아직 실행하지 않은 DB 에서도 나머지 저장은 되게 한다.
  // files 열이 없다는 오류일 때만 그 열을 빼고 한 번 더 보낸다 — 첨부만 못 붙을 뿐,
  // 쓰던 글이 통째로 날아가지는 않는다. 사람에게는 저장이 끝난 뒤 토스트로 알린다.
  async function runWithFilesFallback(run, payload) {
    const first = await run(payload)
    if (!first.error || !isMissingFilesColumn(first.error)) return first
    needsSql.current = true
    const { files: _omit, ...rest } = payload
    return run(rest)
  }

  // 한 건 저장 + 소속 연결. 여러 건을 만들 때도 이 함수를 돌려 쓴다.
  async function insertOne(payload) {
    const { data: saved, error: dbErr } = await runWithFilesFallback(
      (p) => supabase.from('items').insert(p).select().single(),
      payload
    )
    if (dbErr) throw dbErr
    await linkCategories(saved.id)
    return saved
  }

  async function linkCategories(itemId) {
    // 소속은 통째로 갈아끼운다 (delete → insert)
    const { error: delErr } = await supabase
      .from('item_categories').delete().eq('item_id', itemId)
    if (delErr) throw delErr
    if (categoryIds.length === 0) return
    const rows = categoryIds.map((cid) => ({ item_id: itemId, category_id: cid, user_id: userId }))
    const { error: linkErr } = await supabase.from('item_categories').insert(rows)
    if (linkErr) throw linkErr
  }

  // 카테고리·태그·실행 상태는 어느 모드에서나 공통으로 붙는다
  function commonFields() {
    return {
      category_id: categoryIds[0] ?? null, // 하위호환용 단일 컬럼
      tags: parseTags(tagsText),
      status,
      // 할 것이 아니면 일정 정보는 남기지 않는다
      due_date: status === 'todo' ? (dueDate || null) : null,
      slot_id: status === 'todo' ? slotId : null,
      user_id: userId
    }
  }

  // ✕ 로 뺐던 '이미 붙어 있던' 첨부를 저장이 끝난 뒤에 지운다.
  // 저장이 실패했거나 취소했다면 여기에 오지 않으므로 항목에는 그대로 남는다.
  async function flushPendingRemoval() {
    const { images: imgs, files: fps } = pendingRemoval.current
    pendingRemoval.current = { images: [], files: [] }
    if (imgs.length > 0) await removeStorageImages(imgs)
    if (fps.length > 0) await removeStorageFiles(fps)
  }

  // files 열이 없어 첨부를 못 붙였다면 그 사실을 밖으로 알린다(모달은 닫히므로 토스트로).
  function sqlHint() {
    return needsSql.current && files.length > 0
      ? '첨부 파일은 붙이지 못했어요 — supabase/setup.sql 을 실행해 주세요'
      : null
  }

  async function handleSave() {
    if (uploading > 0) {
      setError('이미지를 올리는 중이에요. 끝나면 저장해 주세요.')
      return
    }
    if (fileBusy > 0) {
      setError('파일을 올리는 중이에요. 끝나면 저장해 주세요.')
      return
    }
    if (!hasAnything) {
      setError('제목·링크·내용·이미지·파일 중 하나는 있어야 해요')
      return
    }
    setBusy(true)
    setError('')
    // 입력칸에 남아 있던 링크까지 포함해 이번 저장에 쓸 목록을 굳힌다
    const finalLinks = allLinks
    try {
      // ── 링크마다 개별 항목 ─────────────────────────────────
      if (splitting) {
        let made = 0
        for (let i = 0; i < finalLinks.length; i++) {
          const url = finalLinks[i]
          setProgress({ done: i, total: finalLinks.length })
          try {
            const fetched = (await fetchLinkTitle(url)) || url
            await insertOne({
              ...commonFields(),
              title: fetched,
              // 이미지와 내용은 첫 항목에만 (N개에 같은 것을 복사하면 잡음이 된다)
              content: i === 0 ? content : '',
              link_url: url,
              image_url: i === 0 && images.length > 0 ? joinImages(images) : youtubeThumb(url),
              files: i === 0 ? joinFiles(files) : []
            })
            made += 1
          } catch (err) {
            console.error('저장 실패:', url, err) // 하나가 실패해도 나머지는 계속한다
          }
        }
        setProgress({ done: finalLinks.length, total: finalLinks.length })
        if (made === 0) throw new Error('한 건도 저장하지 못했습니다')
        if (made < finalLinks.length) {
          setError(`${made}개 저장 (${finalLinks.length - made}개 실패)`)
        }
        clearDraft(draftKey)
        await flushPendingRemoval()

        onSaved(sqlHint())
        return
      }

      // ── 한 항목에 모두 담기 (수정도 이 길) ──────────────────
      let finalImages = images
      const cleanLink = finalLinks.length > 0 ? finalLinks.join('\n') : null
      if (finalImages.length === 0 && finalLinks.length > 0) {
        // 대표 이미지가 없으면 첫 번째 유튜브 링크의 썸네일을 쓴다
        const thumb = finalLinks.map(youtubeThumb).find(Boolean)
        if (thumb) finalImages = [thumb]
      }

      const finalTitle = title.trim() || (await makeTitle(finalLinks[0] ?? null))

      const payload = {
        ...commonFields(),
        title: finalTitle,
        content,
        link_url: cleanLink,
        image_url: joinImages(finalImages),
        files: joinFiles(files)
      }

      if (isEdit) {
        const { data: saved, error: dbErr } = await runWithFilesFallback(
          (p) => supabase.from('items').update(p).eq('id', item.id).select().single(),
          payload
        )
        if (dbErr) throw dbErr
        await linkCategories(saved.id)
      } else {
        await insertOne(payload)
      }

      clearDraft(draftKey)
      await flushPendingRemoval()

      onSaved(sqlHint())
    } catch (err) {
      setError('저장에 실패했어요. 네트워크와 Supabase 설정을 확인해 주세요.')
      console.error(err)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  // 휴지통으로 보내기(soft delete). 항목에 이미 붙어 있던 첨부는 복원할 수 있어야 하므로
  // 건드리지 않고, 이번에 올렸지만 아직 붙지 않은 것만 지운다.
  async function handleDelete() {
    if (!window.confirm('휴지통으로 이동할까요? 언제든 복원할 수 있어요')) return
    setBusy(true)
    const { error: err } = await supabase
      .from('items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', item.id)
    if (err) {
      setError('삭제에 실패했어요.')
      setBusy(false)
      return
    }
    clearDraft(draftKey)
    await removeStorageImages(images.filter((u) => !savedImages.includes(u)))
    await removeStorageFiles(files.filter((f) => !savedFilePaths.has(f.path)).map((f) => f.path))

    onSaved()
  }

  return (
    // 배경을 눌러도 닫지 않는다. 긴 글을 쓰는 창이라 한 번 잘못 닿으면 손해가 크고,
    // 특히 폰에서는 모달이 화면을 다 채우지 않아 가장자리 탭이 바로 배경에 닿는다.
    // 닫는 길은 ✕ · 취소 · Esc 세 가지뿐.
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '항목 수정' : '새 항목'}
        onPaste={handlePaste}
      >
        <div className="modal-head">
          <h2>{isEdit ? '항목 수정' : '새 항목'}</h2>
          <button className="btn-ghost btn-sm" onClick={cleanupAndClose} aria-label="닫기">✕</button>
        </div>

        {restored && (
          <p className="draft-note" role="status">
            작성 중이던 내용을 되살렸어요.
            <button type="button" className="btn-ghost btn-sm" onClick={discardDraft}>
              새로 쓰기
            </button>
          </p>
        )}

        <label className="field">
          제목 <span className="field-hint">(비우면 자동으로 지어요)</span>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError('') }}
            placeholder={
              allLinks.length > 0 ? '비우면 링크 제목을 가져옵니다'
                : images.length > 0 ? `비우면 '이미지 ${ymd(new Date())}'`
                  : '쇼츠 대본 - AI 활용법 3가지'
            }
            autoFocus
          />
        </label>

        <div className="field">
          링크 <span className="field-hint">(여러 개를 한 번에 붙여넣어도 돼요)</span>
          {links.length > 0 && (
            <ul className="link-list">
              {links.map((u, i) => (
                <li className="link-row" key={u}>
                  <a href={u} target="_blank" rel="noopener noreferrer" title={u}>
                    🔗 {shortenUrl(u)}
                  </a>
                  <button
                    type="button"
                    className="link-x"
                    onClick={() => removeLink(u)}
                    aria-label={`${i + 1}번째 링크 빼기`}
                  >✕</button>
                </li>
              ))}
            </ul>
          )}

          <div className="link-add">
            <input
              value={linkInput}
              onChange={(e) => { setLinkInput(e.target.value); setError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitLinkInput() } }}
              onBlur={() => commitLinkInput(true)}
              placeholder="링크 붙여넣고 Enter"
              inputMode="url"
              aria-label="링크 추가"
            />
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => commitLinkInput()}
              disabled={!linkInput.trim()}
            >추가</button>
          </div>

          {pendingLinks.length > 0 && (
            <p className="field-note">
              입력 중인 링크 {pendingLinks.length}개도 저장할 때 함께 담깁니다.
            </p>
          )}
          {allLinks.length > 1 && (
            <p className="bulk-count bulk-count-on">링크 {allLinks.length}개</p>
          )}
        </div>

        {/* 링크가 둘 이상일 때만 나눌지 묻는다. 수정 중에는 나눌 수 없다(이미 있는 한 항목이다). */}
        {!isEdit && allLinks.length > 1 && (
          <div className="field">
            저장 방식
            <div className="split-choice">
              <label className="split-opt">
                <input
                  type="radio"
                  name="split"
                  checked={!splitMode}
                  onChange={() => setSplitMode(false)}
                  disabled={busy}
                />
                <span>한 항목에 모두 담기<small>링크 {allLinks.length}개가 한 항목의 링크 목록으로</small></span>
              </label>
              <label className="split-opt">
                <input
                  type="radio"
                  name="split"
                  checked={splitMode}
                  onChange={() => setSplitMode(true)}
                  disabled={busy}
                />
                <span>링크마다 개별 항목 만들기<small>{allLinks.length}개 항목 · 제목은 링크에서 자동으로</small></span>
              </label>
            </div>
            {splitting && images.length > 0 && (
              <p className="field-note">이미지와 내용은 첫 항목에만 첨부됩니다.</p>
            )}
            {splitting && (
              <p className="field-note">카테고리·태그·실행 상태는 {allLinks.length}개 모두에 함께 적용됩니다.</p>
            )}
          </div>
        )}

        <div className="field">
          카테고리 {categoryIds.length === 0 ? '(미분류)' : `(${categoryIds.length}개 선택)`}
          {/* 트리 차례로 늘어놓고, 3단부터는 바로 위 상위를 앞에 붙인다.
              '국내'·'해외'·'기타' 처럼 짧은 이름은 그것만 봐서는 무엇의 하위인지 모른다. */}
          <div className="cat-select">
            {treeOrder(categories).map(({ cat: c, depth }) => {
              const path = depth >= 2 ? categoryPath(categories, c.id).slice(-1)[0] : null
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip chip-d${Math.min(depth, 2)} ${categoryIds.includes(c.id) ? 'chip-on' : ''}`}
                  onClick={() => setCategoryIds((prev) => (
                    prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                  ))}
                  title={[...categoryPath(categories, c.id), c.name].join(' › ')}
                >
                  {path && <span className="chip-path">{path} › </span>}
                  {c.icon} {c.name}
                </button>
              )
            })}
          </div>
        </div>

        <div className="field">
          실행 상태
          <div className="cat-select">
            <button
              type="button"
              className={`chip ${status === 'none' ? 'chip-on' : ''}`}
              onClick={() => setStatus('none')}
            >📦 보관용</button>
            <button
              type="button"
              className={`chip ${status === 'todo' ? 'chip-on' : ''}`}
              onClick={() => setStatus('todo')}
            >⚡ 할 것</button>
            {isEdit && (
              <button
                type="button"
                className={`chip ${status === 'done' ? 'chip-on' : ''}`}
                onClick={() => setStatus('done')}
              >✓ 완료</button>
            )}
          </div>
        </div>

        {status === 'todo' && (
          <>
            <div className="field">
              날짜
              <div className="due-row">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="할 일 날짜"
                />
                <button
                  type="button"
                  className="chip"
                  onClick={() => setDueDate(ymd(new Date()))}
                >오늘</button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() + 1)
                    setDueDate(ymd(d))
                  }}
                >내일</button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setDueDate('')}
                >지우기</button>
              </div>
            </div>

            {slots.length > 0 && (
              <div className="field">
                시간대
                <div className="cat-select">
                  {slots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`chip ${slotId === s.id ? 'chip-on' : ''}`}
                      onClick={() => setSlotId(slotId === s.id ? null : s.id)}
                    >{s.icon} {s.name}</button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <label className="field">
          내용
          <textarea
            value={content}
            onChange={(e) => {
              const next = e.target.value
              setContent(next)
              // 내용에 붙여넣은 URL 중 목록에 아직 없는 것만 링크 목록에 더한다
              setLinks((prev) => {
                const have = new Set(prev)
                const fresh = extractUrls(next).filter((u) => !have.has(u))
                return fresh.length === 0 ? prev : [...prev, ...fresh]
              })
            }}
            rows={8}
            placeholder="대본 전문, 아이디어 상세 등 길이 제한 없이 저장할 수 있어요"
          />
        </label>

        <label className="field">
          태그 (쉼표로 구분)
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="유튜브, 쇼츠, 기획중"
          />
        </label>

        <div className="field">
          이미지 {images.length > 0 && `(${images.length}/${MAX_IMAGES})`}

          <div
            className={`img-drop ${dragOver ? 'img-drop-on' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {images.length > 0 && (
              <div className="img-strip">
                {images.map((url, i) => (
                  <div className="img-thumb" key={url}>
                    <button
                      type="button"
                      className="img-thumb-open"
                      onClick={() => setZoom(url)}
                      aria-label={`${i + 1}번째 이미지 크게 보기`}
                    >
                      <img src={url} alt="" loading="lazy" decoding="async" />
                    </button>
                    <button
                      type="button"
                      className="img-thumb-x"
                      onClick={() => removeImage(url)}
                      aria-label={`${i + 1}번째 이미지 제거`}
                    >✕</button>
                    {i === 0 && <span className="img-thumb-tag">대표</span>}
                  </div>
                ))}
                {uploading > 0 && (
                  <div className="img-thumb img-thumb-busy" aria-live="polite">
                    <span className="img-spin" aria-hidden="true" />
                    <span className="img-busy-text">{uploading}장 올리는 중…</span>
                  </div>
                )}
              </div>
            )}

            {images.length === 0 && uploading > 0 && (
              <p className="img-hint" aria-live="polite">{uploading}장 올리는 중…</p>
            )}

            <div className="img-actions">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="img-file"
                onChange={(e) => {
                  routeFiles(e.target.files ?? [])
                  e.target.value = '' // 같은 파일을 다시 골라도 변화가 잡히게
                }}
                disabled={images.length >= MAX_IMAGES}
              />
              <p className="img-hint">
                붙여넣기(Ctrl+V)·끌어놓기로도 올릴 수 있어요 · 최대 {MAX_IMAGES}장 ·
                긴 변 1600px 넘으면 줄여서 올려요
              </p>
            </div>
          </div>
        </div>

        <div className="field">
          파일 {files.length > 0 && `(${files.length}/${MAX_FILES})`}

          <div
            className={`file-drop ${fileDrag ? 'file-drop-on' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setFileDrag(true) }}
            onDragLeave={() => setFileDrag(false)}
            onDrop={handleDrop}
          >
            {files.length > 0 && (
              <ul className="file-list">
                {files.map((f) => (
                  <li className="file-row" key={f.path}>
                    <button
                      type="button"
                      className="file-open"
                      onClick={() => downloadFile(f)}
                      title={`${f.name} 내려받기`}
                    >
                      <span className="file-icon" aria-hidden="true">{fileIcon(f.name)}</span>
                      <span className="file-name">{f.name}</span>
                      <span className="file-size">{formatBytes(f.size)}</span>
                    </button>
                    <button
                      type="button"
                      className="link-x"
                      onClick={() => removeFile(f)}
                      aria-label={`${f.name} 빼기`}
                    >✕</button>
                  </li>
                ))}
              </ul>
            )}

            {fileBusy > 0 && (
              <p className="img-hint" aria-live="polite">파일 {fileBusy}개 올리는 중…</p>
            )}

            <div className="img-actions">
              <input
                ref={attachRef}
                type="file"
                multiple
                accept={FILE_ACCEPT}
                className="file-input"
                onChange={(e) => {
                  routeFiles(e.target.files ?? [])
                  e.target.value = '' // 같은 파일을 다시 골라도 변화가 잡히게
                }}
              />
              <button
                type="button"
                className="btn-ghost btn-sm file-pick"
                onClick={() => attachRef.current?.click()}
                disabled={files.length >= MAX_FILES}
              >📎 파일 첨부</button>
              <p className="img-hint">
                끌어놓기로도 올릴 수 있어요 · 최대 {MAX_FILES}개 · 개당 10MB ·
                {' '}{FILE_EXTS.join('·')}
              </p>
            </div>
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-foot">
          {isEdit && (
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>삭제</button>
          )}
          <div className="modal-foot-right">
            <button className="btn-ghost" onClick={cleanupAndClose} disabled={busy}>취소</button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={busy || uploading > 0 || fileBusy > 0 || !hasAnything}
            >
              {progress
                ? `${progress.done}/${progress.total} 저장 중...`
                : busy ? '저장 중...'
                  : uploading > 0 ? '이미지 올리는 중...'
                    : fileBusy > 0 ? '파일 올리는 중...'
                      : splitting ? `${allLinks.length}개 항목 저장`
                        : '저장'}
            </button>
          </div>
        </div>
      </div>

      {zoom && (
        <div
          className="img-zoom"
          role="dialog"
          aria-modal="true"
          aria-label="이미지 크게 보기"
          onMouseDown={() => setZoom(null)}
        >
          <img src={zoom} alt="" />
          <button className="img-zoom-x" onClick={() => setZoom(null)} aria-label="닫기">✕</button>
        </div>
      )}
    </div>
  )
}
