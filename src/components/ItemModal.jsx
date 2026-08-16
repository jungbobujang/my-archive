import { useEffect, useRef, useState } from 'react'
import { supabase, BUCKET, extractUrls, youtubeThumb } from '../supabase.js'

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

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ItemModal({ item, categories, slots, userId, onClose, onSaved }) {
  const isEdit = !!item
  const [title, setTitle] = useState(item?.title ?? '')
  const [content, setContent] = useState(item?.content ?? '')
  const [categoryIds, setCategoryIds] = useState(item?.category_id ? [item.category_id] : [])
  const [status, setStatus] = useState(item?.status ?? 'none')
  const [dueDate, setDueDate] = useState(item?.due_date ?? '')
  const [slotId, setSlotId] = useState(item?.slot_id ?? null)
  const [linkUrl, setLinkUrl] = useState(item?.link_url ?? '')
  const [tagsText, setTagsText] = useState((item?.tags ?? []).join(', '))
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef(null)

  // 수정 모드에서 DB에 저장돼 있는 링크 목록
  const savedLinks = extractUrls(item?.link_url ?? '')

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 수정 모드: 기존 소속을 item_categories 에서 불러온다
  useEffect(() => {
    if (!item?.id) return
    let alive = true
    ;(async () => {
      const { data, error: err } = await supabase
        .from('item_categories')
        .select('category_id')
        .eq('item_id', item.id)
      if (alive && !err && data) setCategoryIds(data.map((r) => r.category_id))
    })()
    return () => { alive = false }
  }, [item?.id])

  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function parseTags(text) {
    return [...new Set(
      text.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
    )].slice(0, 10)
  }

  async function handleSave() {
    if (!title.trim()) {
      setError('제목을 입력해 주세요')
      return
    }
    setBusy(true)
    setError('')
    try {
      let finalImageUrl = imageUrl

      if (file) {
        const ext = file.name.split('.').pop().toLowerCase()
        const path = `${userId}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file)
        if (upErr) throw upErr
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
        finalImageUrl = data.publicUrl
      }

      const links = extractUrls(linkUrl)
      const cleanLink = links.length > 0 ? links.join('\n') : null
      if (!finalImageUrl && links.length > 0) {
        // 썸네일은 첫 번째 유튜브 링크 기준
        const thumb = links.map(youtubeThumb).find(Boolean)
        if (thumb) finalImageUrl = thumb
      }

      const payload = {
        title: title.trim(),
        content,
        category_id: categoryIds[0] ?? null, // 하위호환용 단일 컬럼
        tags: parseTags(tagsText),
        status,
        // 할 것이 아니면 일정 정보는 남기지 않는다
        due_date: status === 'todo' ? (dueDate || null) : null,
        slot_id: status === 'todo' ? slotId : null,
        link_url: cleanLink,
        image_url: finalImageUrl,
        user_id: userId
      }

      const { data: saved, error: dbErr } = isEdit
        ? await supabase.from('items').update(payload).eq('id', item.id).select().single()
        : await supabase.from('items').insert(payload).select().single()
      if (dbErr) throw dbErr

      // 소속은 통째로 갈아끼운다 (delete → insert)
      const { error: delErr } = await supabase
        .from('item_categories').delete().eq('item_id', saved.id)
      if (delErr) throw delErr

      if (categoryIds.length > 0) {
        const rows = categoryIds.map((cid) => ({
          item_id: saved.id,
          category_id: cid,
          user_id: userId
        }))
        const { error: linkErr } = await supabase.from('item_categories').insert(rows)
        if (linkErr) throw linkErr
      }

      onSaved()
    } catch (err) {
      setError('저장에 실패했어요. 네트워크와 Supabase 설정을 확인해 주세요.')
      console.error(err)
    } finally {
      setBusy(false)
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
    onSaved()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={isEdit ? '항목 수정' : '새 항목'} ref={dialogRef}>
        <div className="modal-head">
          <h2>{isEdit ? '항목 수정' : '새 항목'}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <label className="field">
          제목
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError('') }}
            placeholder="쇼츠 대본 - AI 활용법 3가지"
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
            placeholder="링크 (여러 개면 줄바꿈으로 구분)"
            inputMode="url"
          />
        </label>

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
          <div className="cat-select">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip ${categoryIds.includes(c.id) ? 'chip-on' : ''}`}
                onClick={() => setCategoryIds((prev) => (
                  prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                ))}
              >{c.icon} {c.name}</button>
            ))}
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
          이미지
          {(preview || imageUrl) ? (
            <div className="img-slot">
              <img src={preview || imageUrl} alt="첨부 이미지 미리보기" />
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => { setFile(null); setImageUrl(null) }}
              >이미지 제거</button>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-foot">
          {isEdit && (
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>삭제</button>
          )}
          <div className="modal-foot-right">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>취소</button>
            <button className="btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
