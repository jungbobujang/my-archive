// 요금제 안내 — 정적 초안입니다.
//
// ⚠️ 결제 연동은 들어 있지 않습니다. 아래 한도(1,000개, 100MB 등)는 **어디에서도 강제되지 않는**
//    자리표시 숫자이고, 실제로 유료화를 할 때 정하면 됩니다. 앱 코드 어디에도 플랜 검사가 없습니다.
//    구독 테이블도 만들지 않았습니다 (TODO-SQL.md 참고).

const PLANS = [
  {
    key: 'free',
    name: '무료',
    price: '₩0',
    period: '계속 무료',
    summary: '혼자 쓰기에 충분한 기본 기능 전부',
    current: true,
    features: [
      { text: '항목 1,000개까지', on: true },
      { text: '이미지 첨부 100MB', on: true },
      { text: '카테고리 2단계', on: true },
      { text: '오늘 탭 · 시간대 · 할 일', on: true },
      { text: '태그 · 검색 · 마인드맵', on: true },
      { text: '백업 내보내기 / 가져오기', on: true },
      { text: '휴지통 복원', on: true },
      { text: '자동 백업', on: false },
      { text: '우선 지원', on: false }
    ]
  },
  {
    key: 'pro',
    name: '프로',
    price: '₩4,900',
    period: '월',
    summary: '자료가 계속 쌓이는 사람을 위한 확장',
    current: false,
    features: [
      { text: '항목 무제한', on: true },
      { text: '이미지 첨부 5GB', on: true },
      { text: '카테고리 단계 제한 없음', on: true },
      { text: '오늘 탭 · 시간대 · 할 일', on: true },
      { text: '태그 · 검색 · 마인드맵', on: true },
      { text: '백업 내보내기 / 가져오기', on: true },
      { text: '휴지통 복원', on: true },
      { text: '매일 자동 백업', on: true },
      { text: '우선 지원', on: true }
    ]
  }
]

export default function Pricing({ onBack }) {
  return (
    <div className="archive pricing">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-name">나의 아카이브</span>
        </div>
        <button className="btn-ghost" onClick={onBack}>← 돌아가기</button>
      </header>

      <div className="pricing-head">
        <span className="pricing-tag">준비 중</span>
        <h1>요금제</h1>
        <p className="pricing-lead">
          지금은 모든 기능을 무료로 쓰고 있습니다. 프로 플랜은 아직 준비 중이라 결제할 수 없어요.
        </p>
      </div>

      <div className="plan-grid">
        {PLANS.map((plan) => (
          <section
            key={plan.key}
            className={`plan-card ${plan.current ? 'plan-current' : ''}`}
            aria-label={`${plan.name} 플랜`}
          >
            <div className="plan-top">
              <h2 className="plan-name">{plan.name}</h2>
              {plan.current && <span className="badge badge-teal">현재 플랜</span>}
            </div>
            <p className="plan-price">
              {plan.price}
              <span className="plan-period"> / {plan.period}</span>
            </p>
            <p className="plan-summary">{plan.summary}</p>

            <ul className="plan-features">
              {plan.features.map((f) => (
                <li key={f.text} className={f.on ? '' : 'plan-off'}>
                  <span className="plan-check" aria-hidden="true">{f.on ? '✓' : '—'}</span>
                  {f.text}
                </li>
              ))}
            </ul>

            {plan.current ? (
              <button className="btn-ghost" disabled>이미 사용 중</button>
            ) : (
              <button className="btn-primary" disabled title="결제는 아직 준비되지 않았어요">
                준비 중
              </button>
            )}
          </section>
        ))}
      </div>

      <p className="pricing-foot">
        문의는 앱을 만든 사람에게 직접 주세요. 무료 플랜의 한도는 아직 적용되지 않습니다.
      </p>
    </div>
  )
}
