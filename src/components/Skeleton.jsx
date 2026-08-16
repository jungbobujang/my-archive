// 로딩 중에 보여 주는 자리 표시자. 스피너 대신 곧 나올 목록의 모양을 미리 그려서
// 화면이 갑자기 튀지 않게 한다.

// 갤러리/리스트 목록용 카드 뼈대
export function SkeletonCards({ count = 6, view = 'grid' }) {
  return (
    <div className={view === 'grid' ? 'item-grid' : 'item-list'} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-card">
          {view === 'grid' && <div className="skel skel-thumb" />}
          <div className="skel skel-line skel-line-title" />
          <div className="skel skel-line skel-line-short" />
        </div>
      ))}
    </div>
  )
}

// '오늘' 탭처럼 한 줄씩 늘어서는 목록용
export function SkeletonRows({ count = 4, withCheck = false }) {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-row">
          {withCheck && <div className="skel skel-dot" />}
          <div className="skel skel-line" style={{ width: `${72 - i * 9}%` }} />
        </div>
      ))}
    </div>
  )
}
