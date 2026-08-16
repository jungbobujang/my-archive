import { useEffect, useRef, useState } from 'react'
import { supabase, CATEGORIES, BUCKET } from '../supabase.js'

export default function ItemModal({ item, userId, onClose, onSaved }) {
  const isEdit = !!item
  const [title, setTitle] = useState(item?.title ?? '')
  const [content, setContent] = useState(item?.content ?? '')
  const [category, setCategory] = useState(item?.category ?? 'idea')
  const [status, setStatus] = useState(item?.status ?? 'none')
  const [tagsText, setTagsText] = useState((item?.tags ?? []).join(', '))
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

      const payload = {
        title: title.trim(),
        content,
        category,
        tags: parseTags(tagsText),
        status,
        image_url: finalImageUrl,
        user_id: userId
      }

      const { error: dbErr } = isEdit
        ? await supabase.from('items').update(payload).eq('id', item.id)
        : await supabase.from('items').insert(payload)
      if (dbErr) throw dbErr

      onSaved()
    } catch (err) {
      setError('저장에 실패했어요. 네트워크와 Supabase 설정을 확인해 주세요.')
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('이 항목을 삭제할까요? 되돌릴 수 없어요.')) return
    setBusy(true)
    const { error: err } = await supabase.from('items').delete().eq('id', item.id)
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

        <div className="field">
          카테고리
          <div className="cat-select">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`chip ${category === c.key ? 'chip-on' : ''}`}
                onClick={() => setCategory(c.key)}
              >{c.icon} {c.label}</button>
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

        <label className="field">
          내용
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
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
