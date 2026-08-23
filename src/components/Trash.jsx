// 휴지통. items.deleted_at 이 채워진 행만 모아 복원하거나 영구 삭제한다.
import { useCallback, useEffect, useState } from 'react'
import { supabase, parseFiles, removeFiles } from '../supabase.js'
import { useEscapeKey } from '../hooks.js'
import { SkeletonRows } from './Skeleton.jsx'

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

  useEscapeKey(handleClose, !busy)

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

  // 첨부 파일은 DB 행과 함께 사라지지 않는다(스토리지는 별개다).
  // 행을 지우기 '전에' 경로를 모아 둬야 한다 — 지운 뒤에는 어디에 뭐가 있었는지 알 길이 없다.
  // 파일 정리가 실패해도 항목 삭제는 계속한다. 실패하면 removeFiles 가 콘솔에 남기고,
  // 남은 실체는 설정의 사용량 게이지에 잡힌다.
  const filePathsOf = (list) => list.flatMap((r) => parseFiles(r.files).map((f) => f.path))

  async function purge(item) {
    if (!window.confirm('영구 삭제할까요? 이 항목은 되돌릴 수 없습니다.')) return
    setBusy(true)
    await removeFiles(filePathsOf([item]))
    // item_categories 는 on delete cascade 로 함께 지워진다
    const { error: err } = await supabase.from('items').delete().eq('id', item.id)
    setBusy(false)
    if (err) { setError('삭제에 실패했어요.'); return }
    setRows((prev) => prev.filter((r) => r.id !== item.id))
  }

  async function purgeAll() {
    if (rows.length === 0) return
    const fileCount = filePathsOf(rows).length
    if (!window.confirm(
      `휴지통의 ${rows.length}개 항목을 모두 영구 삭제할까요? 되돌릴 수 없습니다.`
      + (fileCount > 0 ? `\n첨부 파일 ${fileCount}개도 함께 지워집니다.` : '')
    )) return
    setBusy(true)
    await removeFiles(filePathsOf(rows))
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
          <SkeletonRows count={3} />
        ) : rows.length === 0 ? (
          <p className="cm-empty">휴지통이 비어 있어요. 지운 항목은 여기로 들어옵니다.</p>
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
