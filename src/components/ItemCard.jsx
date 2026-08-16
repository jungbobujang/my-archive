function formatDate(iso) {
  const d = new Date(iso)
  const today = new Date()
  const diff = Math.floor((today - d) / 86400000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '어제'
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}

export default function ItemCard({ item, categories, view, onOpen, onStar, onTag, onDone }) {
  const cat = (categories ?? []).find((c) => c.id === item.category_id)
  const color = cat?.color ?? 'gray'
  const actionable = item.status === 'todo' || item.status === 'done'
  const done = item.status === 'done'

  return (
    <article className={`card cat-border-${color} ${view === 'list' ? 'card-row' : ''} ${done ? 'card-done' : ''}`}>
      {item.image_url && (
        item.link_url ? (
          <a
            className="card-thumb"
            href={item.link_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${item.title} 링크 열기`}
          >
            <img src={item.image_url} alt="" loading="lazy" />
          </a>
        ) : (
          <button className="card-thumb" onClick={onOpen} aria-label={`${item.title} 열기`}>
            <img src={item.image_url} alt="" loading="lazy" />
          </button>
        )
      )}
      <div className="card-body">
        <div className="card-top">
          {actionable && (
            <button
              className={`check ${done ? 'check-on' : ''}`}
              onClick={onDone}
              aria-label={done ? '다시 할 것으로 되돌리기' : '완료 처리'}
            >{done ? '✓' : ''}</button>
          )}
          <button className="card-title" onClick={onOpen}>{item.title}</button>
          <button
            className={`star ${item.starred ? 'star-on' : ''}`}
            onClick={onStar}
            aria-label={item.starred ? '중요 해제' : '중요 표시'}
          >★</button>
        </div>
        {item.content && !item.image_url && (
          <p className="card-preview">{item.content.slice(0, 120)}</p>
        )}
        <div className="card-meta">
          {item.status === 'todo' && <span className="badge badge-todo">⚡ 할 것</span>}
          {cat && <span className={`badge badge-${color}`}>{cat.name}</span>}
          {(item.tags || []).slice(0, 3).map((t) => (
            <button key={t} className="tag-mini" onClick={() => onTag(t)}>#{t}</button>
          ))}
          {item.link_url && (
            <a className="link-mini" href={item.link_url} target="_blank" rel="noopener noreferrer">🔗 열기</a>
          )}
          <span className="card-date">{formatDate(item.created_at)}</span>
        </div>
      </div>
    </article>
  )
}
