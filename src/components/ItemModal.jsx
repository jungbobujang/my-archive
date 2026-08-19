// 항목 생성/수정 모달. 저장은 items 한 줄 + item_categories 를 통째로 갈아끼우는 두 단계다.
//
// '여러 링크 저장' 모달을 여기로 흡수했다(별도 화면 폐지). 링크를 여러 개 붙여넣으면
// '한 항목에 모두 담기'(기본)와 '링크마다 개별 항목'을 고르게 하고, 개별 모드가
// 예전 그 화면이 하던 일(링크마다 noembed 로 제목을 받아 한 건씩 저장)을 그대로 한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  supabase, extractUrls, parseTags, youtubeThumb, ymd, fetchLinkTitle,
  parseImages, joinImages, uploadImage, imageFilesFromPaste, imageFilesFromDrop, MAX_IMAGES,
  treeOrder, categoryPath
} from '../supabase.js'
import { useEscapeKey, draftKeyFor, readDraft, writeDraft, clearDraft } from '../hooks.js'

// youtu.be/abc123 형태로 줄인다
function shortenUrl(url) {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    const short = `${u.hostname.replace(/^www\./, '')}${path}`
    return short.length > 42 ? `${short.slice(0, 42)}…` : short
  } catch {
    return url.length > 42 ? `${url.slice(0, 42)}…` : url
  }
}

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
  const [linkUrl, setLinkUrl] = useState(draft?.linkUrl ?? item?.link_url ?? '')
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

  // 링크마다 개별 항목으로 나눌지 (링크가 2개 이상일 때만 고를 수 있다)
  const [splitMode, setSplitMode] = useState(draft?.splitMode ?? false)

  // '바뀌었는지' 를 재는 기준선. 수정 모드의 소속은 아래에서 비동기로 불러오므로
  // 그때 같이 갱신한다 — 안 그러면 열자마자 '바뀜' 으로 잡혀 Esc 마다 확인창이 뜬다.
  const [baseCategoryIds, setBaseCategoryIds] = useState(
    item?.category_id ? [item.category_id] : []
  )
  const [progress, setProgress] = useState(null) // { done, total }

  const links = useMemo(() => extractUrls(linkUrl), [linkUrl])
  const splitting = !isEdit && splitMode && links.length > 1

  // 제목·링크·내용·이미지 중 하나라도 있으면 저장할 수 있다. 제목은 이제 필수가 아니다.
  const hasAnything =
    title.trim().length > 0 || links.length > 0 || content.trim().length > 0 || images.length > 0

  // 수정 모드에서 DB에 저장돼 있는 링크 목록
  const savedLinks = extractUrls(item?.link_url ?? '')

  // 열었을 때와 견줘 하나라도 달라졌는지. '내용이 있는지' 가 아니라 '바뀌었는지' 로 잰다 —
  // 수정 모달은 열자마자 내용이 차 있으므로, 내용 유무로 재면 Esc 마다 확인창이 뜬다.
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
  const dirty =
    title !== (item?.title ?? '') ||
    content !== (item?.content ?? '') ||
    linkUrl !== (item?.link_url ?? '') ||
    tagsText !== (item?.tags ?? []).join(', ') ||
    status !== (item?.status ?? 'none') ||
    dueDate !== (item?.due_date ?? '') ||
    slotId !== (item?.slot_id ?? null) ||
    joinImages(images) !== joinImages(parseImages(item?.image_url)) ||
    !sameSet(categoryIds, baseCategoryIds)

  // 작성 중인 값을 sessionStorage 에 남긴다. 바뀐 게 없으면 남길 것도 없다.
  useEffect(() => {
    if (!dirty) { clearDraft(draftKey); return }
    writeDraft(draftKey, {
      title, content, linkUrl, tagsText, categoryIds, status, dueDate, slotId, images, splitMode
    })
  }, [draftKey, dirty, title, content, linkUrl, tagsText, categoryIds, status, dueDate, slotId, images, splitMode])

  // Esc 는 손이 미끄러지기 쉬운 자리라, 쓰던 게 있으면 한 번 물어본다.
  // ✕·취소는 눌러야 닿는 자리라 그냥 닫는다 (어차피 초안은 남는다).
  function closeFromEscape() {
    if (dirty && !window.confirm('작성 중인 내용이 있습니다. 닫을까요?')) return
    onClose()
  }

  // 크게 보기가 떠 있으면 Esc 는 그것부터 닫는다 (모달까지 같이 닫히면 쓴 내용이 날아간다)
  useEscapeKey(() => { if (zoom) setZoom(null); else closeFromEscape() })

  // 되살린 초안을 버리고 처음 상태로 되돌린다
  function discardDraft() {
    clearDraft(draftKey)
    setTitle(item?.title ?? '')
    setContent(item?.content ?? '')
    setLinkUrl(item?.link_url ?? '')
    setTagsText((item?.tags ?? []).join(', '))
    setCategoryIds(baseCategoryIds)
    setStatus(item?.status ?? 'none')
    setDueDate(item?.due_date ?? '')
    setSlotId(item?.slot_id ?? null)
    setImages(parseImages(item?.image_url))
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

  // 파일 여러 개를 받아 순서대로 올린다. 하나가 실패해도 나머지는 계속 간다.
  async function addFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'))
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

  function handlePaste(e) {
    const files = imageFilesFromPaste(e)
    if (files.length === 0) return // 이미지가 아니면 평소대로 텍스트 붙여넣기
    e.preventDefault()
    addFiles(files)
  }

  function handleDrop(e) {
    const files = imageFilesFromDrop(e)
    setDragOver(false)
    if (files.length === 0) return
    e.preventDefault()
    addFiles(files)
  }

  // 제목이 비었을 때 대신 지어 준다.
  //   ① 링크가 있으면 첫 링크의 제목 (noembed)
  //   ② 내용이 있으면 앞 20자
  //   ③ 이미지만 있으면 '이미지 YYYY-MM-DD'
  // ②를 ③보다 앞에 둔 이유: 글과 이미지가 함께 있을 때 날짜보다 글 첫머리가 훨씬 잘 읽힌다.
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

  // 한 건 저장 + 소속 연결. 여러 건을 만들 때도 이 함수를 돌려 쓴다.
  async function insertOne(payload) {
    const { data: saved, error: dbErr } = await supabase
      .from('items').insert(payload).select().single()
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

  async function handleSave() {
    if (uploading > 0) {
      setError('이미지를 올리는 중이에요. 끝나면 저장해 주세요.')
      return
    }
    if (!hasAnything) {
      setError('제목·링크·내용·이미지 중 하나는 있어야 해요')
      return
    }
    setBusy(true)
    setError('')
    try {
      // ── 링크마다 개별 항목 ─────────────────────────────────
      if (splitting) {
        let made = 0
        for (let i = 0; i < links.length; i++) {
          const url = links[i]
          setProgress({ done: i, total: links.length })
          try {
            const fetched = (await fetchLinkTitle(url)) || url
            await insertOne({
              ...commonFields(),
              title: fetched,
              // 이미지와 내용은 첫 항목에만 (N개에 같은 것을 복사하면 잡음이 된다)
              content: i === 0 ? content : '',
              link_url: url,
              image_url: i === 0 && images.length > 0 ? joinImages(images) : youtubeThumb(url)
            })
            made += 1
          } catch (err) {
            console.error('저장 실패:', url, err) // 하나가 실패해도 나머지는 계속한다
          }
        }
        setProgress({ done: links.length, total: links.length })
        if (made === 0) throw new Error('한 건도 저장하지 못했습니다')
        if (made < links.length) {
          setError(`${made}개 저장 (${links.length - made}개 실패)`)
        }
        clearDraft(draftKey)

        onSaved()
        return
      }

      // ── 한 항목에 모두 담기 (수정도 이 길) ──────────────────
      let finalImages = images
      const cleanLink = links.length > 0 ? links.join('\n') : null
      if (finalImages.length === 0 && links.length > 0) {
        // 대표 이미지가 없으면 첫 번째 유튜브 링크의 썸네일을 쓴다
        const thumb = links.map(youtubeThumb).find(Boolean)
        if (thumb) finalImages = [thumb]
      }

      const finalTitle = title.trim() || (await makeTitle(links[0] ?? null))

      const payload = {
        ...commonFields(),
        title: finalTitle,
        content,
        link_url: cleanLink,
        image_url: joinImages(finalImages)
      }

      if (isEdit) {
        const { data: saved, error: dbErr } = await supabase
          .from('items').update(payload).eq('id', item.id).select().single()
        if (dbErr) throw dbErr
        await linkCategories(saved.id)
      } else {
        await insertOne(payload)
      }

      clearDraft(draftKey)


      onSaved()
    } catch (err) {
      setError('저장에 실패했어요. 네트워크와 Supabase 설정을 확인해 주세요.')
      console.error(err)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

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
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">✕</button>
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
              links.length > 0 ? '비우면 링크 제목을 가져옵니다'
                : images.length > 0 ? `비우면 '이미지 ${ymd(new Date())}'`
                  : '쇼츠 대본 - AI 활용법 3가지'
            }
            autoFocus
          />
        </label>

        <label className="field">
          링크 (선택)
          <textarea
            className="link-input"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onInput={(e) => {
              e.target.style.height = 'auto'
              e.target.style.height = `${e.target.scrollHeight}px`
            }}
            rows={2}
            placeholder="링크 (여러 개면 줄바꿈이나 공백으로 구분)"
            inputMode="url"
          />
        </label>

        {links.length > 0 && (
          <p className={`bulk-count ${links.length > 1 ? 'bulk-count-on' : ''}`}>
            {links.length}개 링크 감지됨
          </p>
        )}

        {/* 링크가 둘 이상일 때만 나눌지 묻는다. 수정 중에는 나눌 수 없다(이미 있는 한 항목이다). */}
        {!isEdit && links.length > 1 && (
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
                <span>한 항목에 모두 담기<small>링크 {links.length}개가 한 항목의 링크 목록으로</small></span>
              </label>
              <label className="split-opt">
                <input
                  type="radio"
                  name="split"
                  checked={splitMode}
                  onChange={() => setSplitMode(true)}
                  disabled={busy}
                />
                <span>링크마다 개별 항목 만들기<small>{links.length}개 항목 · 제목은 링크에서 자동으로</small></span>
              </label>
            </div>
            {splitting && images.length > 0 && (
              <p className="field-note">이미지와 내용은 첫 항목에만 첨부됩니다.</p>
            )}
            {splitting && (
              <p className="field-note">카테고리·태그·실행 상태는 {links.length}개 모두에 함께 적용됩니다.</p>
            )}
          </div>
        )}

        {isEdit && savedLinks.length > 1 && (
          <div className="field">
            저장된 링크 {savedLinks.length}개
            <ul className="link-list">
              {savedLinks.map((u) => (
                <li key={u}>
                  <a href={u} target="_blank" rel="noopener noreferrer">🔗 {shortenUrl(u)}</a>
                </li>
              ))}
            </ul>
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
              // 내용에서 찾은 URL 중 링크 칸에 아직 없는 것만 줄바꿈으로 덧붙인다
              setLinkUrl((prev) => {
                const have = new Set(extractUrls(prev))
                const fresh = extractUrls(next).filter((u) => !have.has(u))
                if (fresh.length === 0) return prev
                return [...extractUrls(prev), ...fresh].join('\n')
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
                      onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
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
                  addFiles(e.target.files ?? [])
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

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-foot">
          {isEdit && (
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>삭제</button>
          )}
          <div className="modal-foot-right">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>취소</button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={busy || uploading > 0 || !hasAnything}
            >
              {progress
                ? `${progress.done}/${progress.total} 저장 중...`
                : busy ? '저장 중...'
                  : uploading > 0 ? '이미지 올리는 중...'
                    : splitting ? `${links.length}개 항목 저장`
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
