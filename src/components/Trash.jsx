// 휴지통. items.deleted_at 이 채워진 행만 모아 복원하거나 영구 삭제한다.
import { useCallback, useEffect, useState } from 'react'
import {
  supabase, filePathsOf, parseImages, removeStorageFiles, removeStorageImages
} from '../supabase.js'
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

  // 첨부 파일도 이미지도 스토리지에 있어 cascade 가 닿지 않는다. 행을 먼저 지우고 지운다 —
  // 순서를 뒤집으면 행 삭제가 실패했을 때 항목만 남고 첨부가 사라진다.
  // 지우기가 실패해도 삭제 자체는 끝난 것으로 다룬다(remove* 가 삼킨다).
  // 유튜브 썸네일처럼 우리 버킷 밖의 주소는 removeStorageImages 가 알아서 거른다.
  async function purge(item) {
    if (!window.confirm('영구 삭제할까요? 이 항목은 되돌릴 수 없습니다.')) return
    setBusy(true)
    // item_categories 는 on delete cascade 로 함께 지워진다
    const { error: err } = await supabase.from('items').delete().eq('id', item.id)
    if (err) { setBusy(false); setError('삭제에 실패했어요.'); return }
    await removeStorageFiles(filePathsOf(item))
    await removeStorageImages(parseImages(item.image_url))
    setBusy(false)
    setRows((prev) => prev.filter((r) => r.id !== item.id))
  }

  async function purgeAll() {
    if (rows.length === 0) return
    if (!window.confirm(`휴지통의 ${rows.length}개 항목을 모두 영구 삭제할까요? 되돌릴 수 없습니다.`)) return
    setBusy(true)
    const paths = rows.flatMap(filePathsOf)
    const urls = rows.flatMap((r) => parseImages(r.image_url))
    const { error: err } = await supabase
      .from('items').delete().not('deleted_at', 'is', null)
    if (err) { setBusy(false); setError('비우기에 실패했어요.'); return }
    await removeStorageFiles(paths)
    await removeStorageImages(urls)
    setBusy(false)
    setRows([])
  }

  return (
    // 배경을 눌러도 닫지 않는다 (모달 공통 규칙). 닫는 길은 ✕ · Esc 뿐이다.
    <div className="modal-backdrop">
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
