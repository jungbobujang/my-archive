// 설정 모달. 지금 담긴 것은 화면 테마, 저장소 사용량, 플랜 표시(자리만)다.
// 플랜은 하드코딩된 '무료' — 구독 상태를 읽어 오는 곳이 아직 없다.
import { useEffect, useState } from 'react'
import { THEME_ICON, THEME_LABEL, THEME_ORDER } from '../theme.js'
import { useEscapeKey } from '../hooks.js'
import {
  supabase, fetchAllRows, totalFileBytes, formatBytes,
  STORAGE_QUOTA_BYTES, STORAGE_WARN_RATIO
} from '../supabase.js'

export default function Settings({ email, themePref, onThemeChange, onOpenPricing, onClose }) {
  useEscapeKey(onClose)

  // 첨부 파일이 차지한 용량. items.files 의 size 를 더한다 —
  // 스토리지를 직접 훑으면(list) 폴더마다 요청이 붙고, 지워진 항목의 고아까지 세게 된다.
  // 우리가 세고 싶은 것은 '지금 항목에 붙어 있는 파일' 이다.
  const [used, setUsed] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let alive = true
    ;(async () => {
      try {
        const rows = await fetchAllRows('items', 'files')
        if (alive) setUsed(totalFileBytes(rows))
      } catch (err) {
        // files 열이 아직 없는 DB(setup.sql 미실행)면 여기로 온다. 게이지만 숨긴다.
        console.warn('[설정] 저장소 사용량을 읽지 못했습니다:', err)
      }
    })()
    return () => { alive = false }
  }, [])

  const ratio = used === null ? 0 : Math.min(1, used / STORAGE_QUOTA_BYTES)
  const warn = ratio > STORAGE_WARN_RATIO

  return (
    // 배경을 눌러도 닫지 않는다. 닫는 길은 ✕ · Esc 뿐이다 (모달 공통 규칙).
    <div className="modal-backdrop">
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

        {used !== null && (
          <section className="set-section">
            <h3 className="set-head">저장소</h3>
            <div
              className="gauge"
              role="meter"
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="첨부 파일 저장소 사용량"
            >
              {/* 0 이어도 눈에 보이게 최소 폭을 준다 — 빈 막대는 '아직 못 읽었다' 로도 읽힌다 */}
              <span
                className={`gauge-fill ${warn ? 'gauge-warn' : ''}`}
                style={{ width: `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
              />
            </div>
            <p className="set-value">
              파일 {formatBytes(used)} / 1GB
              {warn && <span className="gauge-note"> · 80% 를 넘었어요</span>}
            </p>
            <p className="set-hint">
              항목에 붙어 있는 첨부 파일의 합계입니다. 이미지는 세지 않습니다.
            </p>
          </section>
        )}

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
