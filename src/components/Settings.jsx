// 설정 모달. 지금 담긴 것은 화면 테마와 플랜 표시(자리만)뿐이다.
// 플랜은 하드코딩된 '무료' — 구독 상태를 읽어 오는 곳이 아직 없다.
import { THEME_ICON, THEME_LABEL, THEME_ORDER } from '../theme.js'
import { useEscapeKey } from '../hooks.js'

export default function Settings({ email, themePref, onThemeChange, onOpenPricing, onClose }) {
  useEscapeKey(onClose)

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
