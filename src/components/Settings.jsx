// 설정 모달. 지금 담긴 것은 화면 테마와 플랜 표시(자리만)뿐이다.
// 플랜은 하드코딩된 '무료' — 구독 상태를 읽어 오는 곳이 아직 없다.
import { useEffect, useState } from 'react'
import { THEME_ICON, THEME_LABEL, THEME_ORDER } from '../theme.js'
import { useEscapeKey } from '../hooks.js'
import { fileUsageBytes, formatBytes, FILE_QUOTA_BYTES, FILE_QUOTA_WARN } from '../supabase.js'

export default function Settings({ email, themePref, onThemeChange, onOpenPricing, onClose }) {
  useEscapeKey(onClose)

  // 파일 저장소 사용량. 스토리지를 훑지 않고 items.files 메타의 합으로 잰다
  // (휴지통에 있는 항목의 파일도 자리를 차지하므로 함께 센다).
  const [usage, setUsage] = useState(null)
  const [usageError, setUsageError] = useState(false)

  useEffect(() => {
    let alive = true
    fileUsageBytes()
      .then((u) => { if (alive) setUsage(u) })
      .catch(() => { if (alive) setUsageError(true) })
    return () => { alive = false }
  }, [])

  const ratio = usage ? Math.min(1, usage.bytes / FILE_QUOTA_BYTES) : 0
  const warn = ratio >= FILE_QUOTA_WARN

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="설정">
        <div className="modal-head">
          <h2>설정</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <section className="set-section">
          <h3 className="set-head">화면 테마</h3>
          <div className="cat-select" role="group" aria-label="화면 테마">
            {THEME_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                className={`chip ${themePref === key ? 'chip-on' : ''}`}
                onClick={() => onThemeChange(key)}
                aria-pressed={themePref === key}
              >{THEME_ICON[key]} {THEME_LABEL[key]}</button>
            ))}
          </div>
          <p className="set-hint">
            시스템으로 두면 폰이나 컴퓨터의 밝게/어둡게 설정을 그대로 따라갑니다.
          </p>
        </section>

        <section className="set-section">
          <h3 className="set-head">플랜</h3>
          <div className="set-row">
            <span className="set-plan">
              <span className="badge badge-teal">무료</span>
              <span className="set-plan-note">모든 기능을 쓰고 있어요</span>
            </span>
            <button className="btn-ghost btn-sm" onClick={onOpenPricing}>요금제 보기</button>
          </div>
          {/* 구독 상태를 읽어 오는 곳이 아직 없다. 유료화할 때 이 자리를 채우면 된다. */}
        </section>

        <section className="set-section">
          <h3 className="set-head">파일 저장소</h3>
          {usageError ? (
            <p className="set-hint">사용량을 불러오지 못했어요.</p>
          ) : usage === null ? (
            <p className="set-hint">사용량을 세는 중…</p>
          ) : (
            <>
              <div className="set-row">
                <span className="set-value">
                  {formatBytes(usage.bytes)} / {formatBytes(FILE_QUOTA_BYTES)}
                </span>
                <span className="set-plan-note">파일 {usage.count}개</span>
              </div>
              <div
                className={`gauge ${warn ? 'gauge-warn' : ''}`}
                role="progressbar"
                aria-valuenow={Math.round(ratio * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="파일 저장소 사용량"
              >
                {/* 0.5% 는 깔아 둔다 — 조금 썼는데 막대가 아예 안 보이면 고장으로 보인다 */}
                <span className="gauge-fill" style={{ width: `${Math.max(0.5, ratio * 100)}%` }} />
              </div>
              <p className="set-hint">
                {warn
                  ? `무료 한도의 ${Math.round(ratio * 100)}% 를 썼어요. 안 쓰는 항목을 휴지통에서 비우면 파일도 함께 지워집니다.`
                  : 'Supabase 무료 한도는 1GB 입니다. 이미지는 이 수치에 포함되지 않아요.'}
              </p>
            </>
          )}
        </section>

        <section className="set-section">
          <h3 className="set-head">계정</h3>
          <p className="set-value">{email}</p>
          <p className="set-hint">
            계정 정보 변경은 Supabase 대시보드의 Authentication 에서 합니다.
          </p>
        </section>
      </div>
    </div>
  )
}
