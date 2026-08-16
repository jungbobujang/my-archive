import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, extractUrls, fetchLinkTitle, youtubeThumb } from '../supabase.js'

export default function BulkAdd({ categories, userId, onClose, onSaved }) {
  const [text, setText] = useState('')
  const [selected, setSelected] = useState([])
  const [tagsText, setTagsText] = useState('')
  const [asTodo, setAsTodo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [doneMsg, setDoneMsg] = useState('')
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const urls = useMemo(() => extractUrls(text), [text])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function parseTags(value) {
    return [...new Set(
      value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
    )].slice(0, 10)
  }

  function toggleCategory(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSave() {
    if (urls.length === 0 || busy) return
    setBusy(true)
    setError('')
    setProgress(0)

    const tags = parseTags(tagsText)
    let saved = 0

    // 순차 처리. noembed rate limit 을 피하고, 하나가 실패해도 나머지를 계속한다.
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      setProgress(i + 1)
      try {
        const title = (await fetchLinkTitle(url)) || url
        const { data, error: dbErr } = await supabase
          .from('items')
          .insert({
            title,
            content: '',
            category_id: selected[0] ?? null,
            tags,
            status: asTodo ? 'todo' : 'none',
            link_url: url,
            image_url: youtubeThumb(url),
            user_id: userId
          })
          .select()
          .single()
        if (dbErr) throw dbErr

        if (selected.length > 0) {
          const rows = selected.map((cid) => ({
            item_id: data.id,
            category_id: cid,
            user_id: userId
          }))
          const { error: linkErr } = await supabase.from('item_categories').insert(rows)
          if (linkErr) throw linkErr
        }
        saved++
      } catch (err) {
        console.error('저장 실패:', url, err)
      }
    }

    setBusy(false)
    if (saved === 0) {
      setError('저장된 항목이 없어요. 네트워크와 Supabase 설정을 확인해 주세요.')
      return
    }
    if (saved < urls.length) {
      setDoneMsg(`${saved}개 저장 완료 (${urls.length - saved}개 실패)`)
    } else {
      setDoneMsg(`${saved}개 저장 완료`)
    }
    timerRef.current = setTimeout(() => onSaved(), 1200)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="여러 링크 저장">
        <div className="modal-head">
          <h2>여러 링크 저장</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} disabled={busy} aria-label="닫기">✕</button>
        </div>

        <label className="field">
          링크
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="링크를 붙여넣으세요 (여러 개면 줄바꿈이나 공백으로 구분)"
            disabled={busy}
          />
        </label>

        <p className={`bulk-count ${urls.length > 0 ? 'bulk-count-on' : ''}`}>
          {urls.length}개 링크 감지됨
        </p>

        {categories.length > 0 && (
          <div className="field">
            카테고리 (공통 적용 · 여러 개 선택 가능)
            <div className="cat-select">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${selected.includes(c.id) ? 'chip-on' : ''}`}
                  onClick={() => toggleCategory(c.id)}
                  disabled={busy}
                >{c.icon} {c.name}</button>
              ))}
            </div>
          </div>
        )}

        <label className="field">
          태그 (쉼표로 구분 · 공통 적용)
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="유튜브, 참고자료"
            disabled={busy}
          />
        </label>

        <label className="bulk-check">
          <input
            type="checkbox"
            checked={asTodo}
            onChange={(e) => setAsTodo(e.target.checked)}
            disabled={busy}
          />
          ⚡ 할 것으로 저장
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        {doneMsg && <p className="bulk-done" role="status">{doneMsg}</p>}

        <div className="modal-foot">
          <div className="modal-foot-right">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>취소</button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={busy || urls.length === 0 || !!doneMsg}
            >
              {busy ? `${progress}/${urls.length} 저장 중...` : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
