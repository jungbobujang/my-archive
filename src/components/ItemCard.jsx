// 목록의 항목 하나. 갤러리(grid)와 리스트(row) 두 모양을 view prop 으로 전환한다.
//
// memo 로 감싼 이유: 검색어를 한 글자 칠 때마다 Archive 가 리렌더되는데,
// 그때 화면의 카드 24개가 전부 다시 그려질 이유는 없다.
// 대신 Archive 쪽에서 콜백을 useCallback 으로 고정하고 categoryIds 도
// 없을 때 같은 빈 배열을 넘겨야 memo 가 실제로 걸린다.
import { memo } from 'react'
import { parseFiles, parseImages } from '../supabase.js'

function formatDate(iso) {
  const d = new Date(iso)
  const today = new Date()
  const diff = Math.floor((today - d) / 86400000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '어제'
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}

function ItemCard({ item, categories, categoryIds, view, onOpen, onStar, onTag, onDone }) {
  // 소속 순서는 categories 정렬(position)을 따른다
  const own = (categories ?? []).filter((c) => (categoryIds ?? []).includes(c.id))
  const shown = own.slice(0, 3)
  const overflow = own.length - shown.length
  const color = own[0]?.color ?? 'gray'
  const links = (item.link_url ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  const firstLink = links[0] ?? null
  const actionable = item.status === 'todo' || item.status === 'done'
  const done = item.status === 'done'
  // 카드에는 첫 장만 대표로 싣는다. 나머지는 장수만 알리고 모달에서 본다.
  const images = parseImages(item.image_url)
  const cover = images[0] ?? null
  const more = images.length - 1
  // 첨부 파일은 개수만 알린다. 이름·용량은 모달에서 본다.
  const fileCount = parseFiles(item.files).length

  return (
    <article className={`card cat-border-${color} ${view === 'list' ? 'card-row' : ''} ${done ? 'card-done' : ''}`}>
      {cover && (
        firstLink ? (
          <a
            className="card-thumb"
            href={firstLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${item.title} 링크 열기`}
          >
            <img src={cover} alt="" loading="lazy" decoding="async" />
            {more > 0 && <span className="thumb-more">외 {more}장</span>}
          </a>
        ) : (
          <button className="card-thumb" onClick={() => onOpen(item)} aria-label={`${item.title} 열기`}>
            <img src={cover} alt="" loading="lazy" decoding="async" />
            {more > 0 && <span className="thumb-more">외 {more}장</span>}
          </button>
        )
      )}
      <div className="card-body">
        <div className="card-top">
          {actionable && (
            <button
              className={`check ${done ? 'check-on' : ''}`}
              onClick={() => onDone(item)}
              aria-label={done ? '다시 할 것으로 되돌리기' : '완료 처리'}
            >{done ? '✓' : ''}</button>
          )}
          <button className="card-title" onClick={() => onOpen(item)}>{item.title}</button>
          <button
            className={`star ${item.starred ? 'star-on' : ''}`}
            onClick={() => onStar(item)}
            aria-label={item.starred ? '중요 해제' : '중요 표시'}
          >★</button>
        </div>
        {item.content && !cover && (
          <p className="card-preview">{item.content.slice(0, 120)}</p>
        )}
        <div className="card-meta">
          {item.status === 'todo' && <span className="badge badge-todo">⚡ 할 것</span>}
          {shown.map((c) => (
            <span key={c.id} className={`badge badge-${c.color ?? 'gray'}`}>{c.name}</span>
          ))}
          {overflow > 0 && <span className="badge badge-gray">+{overflow}</span>}
          {(item.tags || []).slice(0, 3).map((t) => (
            <button key={t} className="tag-mini" onClick={() => onTag(t)}>#{t}</button>
          ))}
          {links.length === 1 && (
            <a className="link-mini" href={firstLink} target="_blank" rel="noopener noreferrer">🔗 열기</a>
          )}
          {links.length > 1 && (
            <button className="link-mini link-mini-btn" onClick={() => onOpen(item)}>🔗 링크 {links.length}개</button>
          )}
          {fileCount > 0 && <span className="badge badge-gray">📎{fileCount}</span>}
          <span className="card-date">{formatDate(item.created_at)}</span>
        </div>
      </div>
    </article>
  )
}

export default memo(ItemCard)
