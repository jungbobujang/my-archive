// 카테고리 목록 관리 모달. 이름·아이콘·색·상위 카테고리를 그 자리에서 고치고 바로 저장한다.
import { useEffect, useState } from 'react'
import { supabase, COLOR_KEYS, ICON_CHOICES, subtreeIds } from '../supabase.js'
import { useEscapeKey } from '../hooks.js'

export default function CategoryManager({ categories, userId, onClose, onChanged }) {
  const [rows, setRows] = useState(categories)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [iconOpen, setIconOpen] = useState(null)

  useEffect(() => { setRows(categories) }, [categories])

  useEscapeKey(handleClose)

  function handleClose() {
    onChanged()
    onClose()
  }

  function patchLocal(id, fields) {
    setRows((prev) => prev.map((c) => (c.id === id ? { ...c, ...fields } : c)))
  }

  async function persist(id, fields) {
    const { error: err } = await supabase.from('categories').update(fields).eq('id', id)
    if (err) setError('저장에 실패했어요.')
  }

  async function handleRename(cat, name) {
    const clean = name.trim()
    if (!clean || clean === cat.name) {
      setRows((prev) => prev.map((c) => (c.id === cat.id ? { ...c, name: cat.name } : c)))
      return
    }
    patchLocal(cat.id, { name: clean })
    await persist(cat.id, { name: clean })
  }

  async function handleIcon(cat, icon) {
    setIconOpen(null)
    patchLocal(cat.id, { icon })
    await persist(cat.id, { icon })
  }

  async function handleColor(cat, color) {
    patchLocal(cat.id, { color })
    await persist(cat.id, { color })
  }

  async function handleParent(cat, value) {
    const parentId = value || null
    patchLocal(cat.id, { parent_id: parentId })
    await persist(cat.id, { parent_id: parentId })
  }

  // 자기 자신과 자손은 상위로 지정할 수 없다 (순환 방지)
  function parentOptions(cat) {
    const blocked = new Set(subtreeIds(rows, cat.id))
    return rows.filter((c) => !blocked.has(c.id))
  }

  async function handleDelete(cat) {
    if (!window.confirm('이 카테고리를 삭제할까요? 소속 항목들은 미분류로 남습니다')) return
    setBusy(true)
    const { error: err } = await supabase.from('categories').delete().eq('id', cat.id)
    setBusy(false)
    if (err) {
      setError('삭제에 실패했어요.')
      return
    }
    setRows((prev) => prev.filter((c) => c.id !== cat.id))
  }

  async function handleAdd(e) {
    e.preventDefault()
    const clean = newName.trim()
    if (!clean || busy) return
    setBusy(true)
    setError('')
    const position = rows.reduce((max, c) => Math.max(max, c.position ?? 0), 0) + 1
    const { data, error: err } = await supabase
      .from('categories')
      .insert({ name: clean, icon: '📁', color: 'gray', position, parent_id: null, user_id: userId })
      .select()
      .single()
    setBusy(false)
    if (err) {
      setError('추가에 실패했어요.')
      return
    }
    setRows((prev) => [...prev, data])
    setNewName('')
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="카테고리 관리">
        <div className="modal-head">
          <h2>카테고리 관리</h2>
          <button className="btn-ghost btn-sm" onClick={handleClose} aria-label="닫기">✕</button>
        </div>

        {rows.length === 0 && (
          <p className="cm-empty">아직 카테고리가 없어요. 아래에서 첫 카테고리를 만들어 보세요.</p>
        )}

        <ul className="cm-list">
          {rows.map((cat) => (
            <li key={cat.id} className="cm-row">
              <div className="cm-line">
                <button
                  type="button"
                  className={`cm-icon cat-${cat.color}`}
                  onClick={() => setIconOpen(iconOpen === cat.id ? null : cat.id)}
                  aria-label={`${cat.name} 아이콘 변경`}
                >{cat.icon}</button>

                <input
                  className="cm-name"
                  defaultValue={cat.name}
                  onBlur={(e) => handleRename(cat, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                  aria-label={`${cat.name} 이름`}
                />

                <button
                  type="button"
                  className="btn-ghost btn-sm cm-del"
                  onClick={() => handleDelete(cat)}
                  disabled={busy}
                  aria-label={`${cat.name} 삭제`}
                >삭제</button>
              </div>

              {iconOpen === cat.id && (
                <div className="cm-icons">
                  {ICON_CHOICES.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      className={`chip ${cat.icon === ic ? 'chip-on' : ''}`}
                      onClick={() => handleIcon(cat, ic)}
                    >{ic}</button>
                  ))}
                </div>
              )}

              <div className="cm-parent">
                <label>
                  상위
                  <select
                    value={cat.parent_id ?? ''}
                    onChange={(e) => handleParent(cat, e.target.value)}
                  >
                    <option value="">(없음 · 최상위)</option>
                    {parentOptions(cat).map((p) => (
                      <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="cm-colors" role="group" aria-label={`${cat.name} 색상`}>
                {COLOR_KEYS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    className={`cm-dot dot-${col} ${cat.color === col ? 'cm-dot-on' : ''}`}
                    onClick={() => handleColor(cat, col)}
                    aria-label={col}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>

        {error && <p className="form-error" role="alert">{error}</p>}

        <form className="cm-add" onSubmit={handleAdd}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 카테고리 이름"
            aria-label="새 카테고리 이름"
          />
          <button type="submit" className="btn-primary btn-sm" disabled={busy || !newName.trim()}>
            + 새 카테고리
          </button>
        </form>
      </div>
    </div>
  )
}
