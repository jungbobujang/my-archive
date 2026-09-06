// 항목 모달 위에 뜨는 작은 창 — 유효기간을 고르고 링크를 만든다.
//
// Esc 는 여기서 듣지 않는다. 항목 모달이 '크게 보기 → 공유 창 → 모달' 차례로
// 하나씩 닫아 주기 때문이다 (ItemModal 의 useEscapeKey 참고). 여기서도 들으면
// Esc 한 번에 두 겹이 같이 닫힌다.
import { useState } from 'react'
import {
  SHARE_DAYS, SHARE_DAY_LABEL, VIEW_ONLY_NOTE,
  createShare, revokeShare, shareUrlFor, formatWhen, copyText,
  isMissingShareSchema, SHARE_SETUP_MESSAGE
} from '../share.js'
import { parseFiles, saveErrorMessage } from '../supabase.js'
import { useOptionalToast } from './Toast.jsx'

export default function ShareDialog({ item, userId, dirty, onClose }) {
  const toast = useOptionalToast()
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState(null)      // { id, expires_at, signedCount }
  const [copied, setCopied] = useState(false)
  const [revoked, setRevoked] = useState(false)

  const fileCount = parseFiles(item?.files).length
  const url = made ? shareUrlFor(made.id) : ''

  async function make() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const row = await createShare({ item, userId, days })
      setMade(row)
      // 만들자마자 복사까지 해 준다 — 링크는 복사하려고 만드는 것이다.
      const ok = await copyText(shareUrlFor(row.id))
      setCopied(ok)
      if (ok) toast.success('공유 링크를 복사했어요')
    } catch (err) {
      console.error('[공유] 링크를 만들지 못했습니다:', err)
      const message = isMissingShareSchema(err)
        ? SHARE_SETUP_MESSAGE
        : `공유 링크를 만들지 못했어요 — ${saveErrorMessage(err)}`
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    const ok = await copyText(url)
    setCopied(ok)
    if (ok) toast.success('공유 링크를 복사했어요')
    else setError('복사하지 못했어요. 주소를 직접 선택해 복사해 주세요.')
  }

  async function revoke() {
    if (!window.confirm('이 링크를 지금 회수할까요? 받은 사람은 바로 볼 수 없게 됩니다.')) return
    setBusy(true)
    try {
      await revokeShare(made.id)
      setRevoked(true)
      toast.success('링크를 회수했어요')
    } catch (err) {
      console.error('[공유] 회수하지 못했습니다:', err)
      const message = `회수하지 못했어요 — ${saveErrorMessage(err)}`
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop share-backdrop">
      <div className="modal modal-narrow" role="dialog" aria-modal="true" aria-label="공유 링크">
        <div className="modal-head">
          <h2>🔗 공유 링크</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <p className="share-lead">
          이 항목 하나만 로그인 없이 볼 수 있는 주소를 만듭니다.
          받는 사람은 <b>읽기만</b> 할 수 있고, 다른 항목으로는 갈 수 없어요.
        </p>

        {dirty && (
          <p className="field-note">
            저장하지 않은 변경 내용은 공유 화면에 나타나지 않아요. 먼저 저장해 주세요.
          </p>
        )}

        {!made && (
          <>
            <div className="field">
              유효기간
              <div className="cat-select" role="group" aria-label="유효기간">
                {SHARE_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`chip ${days === d ? 'chip-on' : ''}`}
                    onClick={() => setDays(d)}
                    aria-pressed={days === d}
                    disabled={busy}
                  >{SHARE_DAY_LABEL[d]}</button>
                ))}
              </div>
            </div>
            {fileCount > 0 && (
              <p className="set-hint">
                첨부 파일 {fileCount}개도 함께 담깁니다. 파일 주소의 수명은 유효기간과 같아요.
              </p>
            )}
          </>
        )}

        {made && !revoked && (
          <div className="share-made">
            <label className="field">
              만든 링크
              <input className="share-url" value={url} readOnly onFocus={(e) => e.target.select()} />
            </label>
            <p className="set-value">{formatWhen(made.expires_at)} 까지 · {SHARE_DAY_LABEL[days]}</p>
            {fileCount > 0 && (
              <p className="set-hint">
                {made.signedCount === fileCount
                  ? `첨부 파일 ${fileCount}개를 같은 기간 동안 받을 수 있어요.`
                  : `첨부 파일 ${made.signedCount}/${fileCount}개만 담겼어요. 다시 만들어 보세요.`}
              </p>
            )}
            <p className="set-hint">{VIEW_ONLY_NOTE} · 설정 › 공유 중인 링크 에서도 회수할 수 있어요.</p>
          </div>
        )}

        {revoked && (
          <p className="share-revoked" role="status">
            회수했습니다. 이 주소로는 더 이상 열리지 않아요.
          </p>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-foot">
          <div className="modal-foot-right">
            <button className="btn-ghost" onClick={onClose}>닫기</button>
            {!made && (
              <button className="btn-primary" onClick={make} disabled={busy}>
                {busy ? '만드는 중...' : '링크 만들기'}
              </button>
            )}
            {made && !revoked && (
              <>
                <button className="btn-ghost cm-del" onClick={revoke} disabled={busy}>회수</button>
                <button className="btn-primary" onClick={copy} disabled={busy}>
                  {copied ? '복사됨 ✓' : '복사'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
