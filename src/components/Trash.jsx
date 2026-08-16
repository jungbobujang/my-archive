import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase.js'

function deletedLabel(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} 삭제`
}

export default function Trash({ onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('items')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (err) setError('휴지통을 불러오지 못했어요.')
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function handleClose() {
    onChanged()
    onClose()
  }

  async function restore(item) {
    setBusy(true)
    const { error: err } = await supabase
      .from('items').update({ deleted_at: null }).eq('id', item.id)
    setBusy(false)
    if (err) { setError('복원에 실패했어요.'); return }
    setRows((prev) => prev.filter((r) => r.id !== item.id))
  }

  async function purge(item) {
    if (!window.confirm('영구 삭제할까요? 이 항목은 되돌릴 수 없습니다.')) return
    setBusy(true)
    // item_categories 는 on delete cascade 로 함께 지워진다
    const { error: err } = await supabase.from('items').delete().eq('id', item.id)
    setBusy(false)
    if (err) { setError('삭제에 실패했어요.'); return }
    setRows((prev) => prev.filter((r) => r.id !== item.id))
  }

  async function purgeAll() {
    if (rows.length === 0) return
    if (!window.confirm(`휴지통의 ${rows.length}개 항목을 모두 영구 삭제할까요? 되돌릴 수 없습니다.`)) return
    setBusy(true)
    const { error: err } = await supabase
      .from('items').delete().not('deleted_at', 'is', null)
    setBusy(false)
    if (err) { setError('비우기에 실패했어요.'); return }
    setRows([])
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) handleClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="휴지통">
        <div className="modal-head">
          <h2>🗑 휴지통</h2>
          <button className="btn-ghost btn-sm" onClick={handleClose} disabled={busy} aria-label="닫기">✕</button>
        </div>

        {loading ? (
          <div className="center-block"><div className="spinner" aria-label="불러오는 중" /></div>
        ) : rows.length === 0 ? (
          <p className="cm-empty">휴지통이 비어 있어요.</p>
        ) : (
          <>
            <div className="trash-top">
              <span className="list-title">{rows.length}개</span>
              <button className="btn-danger btn-sm" onClick={purgeAll} disabled={busy}>전부 비우기</button>
            </div>

            <ul className="cm-list">
              {rows.map((item) => (
                <li key={item.id} className="trash-row">
                  <div className="trash-main">
                    <span className="trash-title">{item.title}</span>
                    <span className="trash-date">{deletedLabel(item.deleted_at)}</span>
                  </div>
                  <div className="trash-actions">
                    <button className="btn-ghost btn-sm" onClick={() => restore(item)} disabled={busy}>복원</button>
                    <button className="btn-ghost btn-sm cm-del" onClick={() => purge(item)} disabled={busy}>영구 삭제</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </div>
  )
}
