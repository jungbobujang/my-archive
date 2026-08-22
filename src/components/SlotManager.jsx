// '오늘' 탭에서 할 일을 묶는 시간대(아침/저녁 등) 관리 모달. 순서는 position 값을 이웃과 맞바꿔 바꾼다.
import { useEffect, useState } from 'react'
import { supabase, ICON_CHOICES } from '../supabase.js'
import { useEscapeKey, confirmDiscard } from '../hooks.js'

export default function SlotManager({ slots, userId, onClose, onChanged }) {
  const [rows, setRows] = useState(slots)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [iconOpen, setIconOpen] = useState(null)

  useEffect(() => { setRows(slots) }, [slots])

  // Esc: 아이콘 고르개가 열려 있으면 그것부터 닫는다. 새 이름을 쓰던 중이면 한 번 물어본다.
  useEscapeKey(() => {
    if (iconOpen) { setIconOpen(null); return }
    if (!confirmDiscard(newName.trim().length > 0, '입력 중인 시간대 이름이 있습니다. 닫을까요?')) return
    handleClose()
  })

  function handleClose() {
    onChanged()
    onClose()
  }

  function patchLocal(id, fields) {
    setRows((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)))
  }

  async function persist(id, fields) {
    const { error: err } = await supabase.from('time_slots').update(fields).eq('id', id)
    if (err) setError('저장에 실패했어요.')
  }

  async function handleRename(slot, name) {
    const clean = name.trim()
    if (!clean || clean === slot.name) {
      setRows((prev) => prev.map((s) => (s.id === slot.id ? { ...s, name: slot.name } : s)))
      return
    }
    patchLocal(slot.id, { name: clean })
    await persist(slot.id, { name: clean })
  }

  async function handleIcon(slot, icon) {
    setIconOpen(null)
    patchLocal(slot.id, { icon })
    await persist(slot.id, { icon })
  }

  // 이웃과 position 값을 맞바꾼다
  async function move(index, dir) {
    const target = index + dir
    if (target < 0 || target >= rows.length) return
    const a = rows[index]
    const b = rows[target]
    const next = [...rows]
    next[index] = { ...b, position: a.position }
    next[target] = { ...a, position: b.position }
    setRows(next)
    setBusy(true)
    const [r1, r2] = await Promise.all([
      supabase.from('time_slots').update({ position: b.position }).eq('id', a.id),
      supabase.from('time_slots').update({ position: a.position }).eq('id', b.id)
    ])
    setBusy(false)
    if (r1.error || r2.error) setError('순서 변경에 실패했어요.')
  }

  async function handleDelete(slot) {
    if (!window.confirm('이 시간대를 삭제할까요? 소속 할 일은 "언제든"으로 남습니다')) return
    setBusy(true)
    const { error: err } = await supabase.from('time_slots').delete().eq('id', slot.id)
    setBusy(false)
    if (err) { setError('삭제에 실패했어요.'); return }
    setRows((prev) => prev.filter((s) => s.id !== slot.id))
  }

  async function handleAdd(e) {
    e.preventDefault()
    const clean = newName.trim()
    if (!clean || busy) return
    setBusy(true)
    setError('')
    const position = rows.reduce((max, s) => Math.max(max, s.position ?? 0), 0) + 1
    const { data, error: err } = await supabase
      .from('time_slots')
      .insert({ name: clean, icon: '🕐', position, user_id: userId })
      .select()
      .single()
    setBusy(false)
    if (err) { setError('추가에 실패했어요.'); return }
    setRows((prev) => [...prev, data])
    setNewName('')
  }

  return (
    // 배경을 눌러도 닫지 않는다 (모달 공통 규칙). 닫는 길은 ✕ · Esc 뿐이다.
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="시간대 관리">
        <div className="modal-head">
          <h2>시간대 관리</h2>
          <button className="btn-ghost btn-sm" onClick={handleClose} aria-label="닫기">✕</button>
        </div>

        {rows.length === 0 && (
          <p className="cm-empty">시간대가 없어요. 아래에서 추가해 보세요.</p>
        )}

        <ul className="cm-list">
          {rows.map((slot, i) => (
            <li key={slot.id} className="cm-row">
              <div className="cm-line">
                <button
                  type="button"
                  className="cm-icon"
                  onClick={() => setIconOpen(iconOpen === slot.id ? null : slot.id)}
                  aria-label={`${slot.name} 아이콘 변경`}
                >{slot.icon}</button>

                <input
                  className="cm-name"
                  defaultValue={slot.name}
                  onBlur={(e) => handleRename(slot, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                  aria-label={`${slot.name} 이름`}
                />

                <div className="slot-move">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => move(i, -1)}
                    disabled={busy || i === 0}
                    aria-label="위로"
                  >↑</button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => move(i, 1)}
                    disabled={busy || i === rows.length - 1}
                    aria-label="아래로"
                  >↓</button>
                </div>

                <button
                  type="button"
                  className="btn-ghost btn-sm cm-del"
                  onClick={() => handleDelete(slot)}
                  disabled={busy}
                  aria-label={`${slot.name} 삭제`}
                >삭제</button>
              </div>

              {iconOpen === slot.id && (
                <div className="cm-icons">
                  {ICON_CHOICES.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      className={`chip ${slot.icon === ic ? 'chip-on' : ''}`}
                      onClick={() => handleIcon(slot, ic)}
                    >{ic}</button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {error && <p className="form-error" role="alert">{error}</p>}

        <form className="cm-add" onSubmit={handleAdd}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 시간대 이름"
            aria-label="새 시간대 이름"
          />
          <button type="submit" className="btn-primary btn-sm" disabled={busy || !newName.trim()}>
            + 새 시간대
          </button>
        </form>
      </div>
    </div>
  )
}
