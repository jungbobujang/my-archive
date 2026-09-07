// 공유 링크로 들어온 사람이 보는 화면. 로그인도, PIN 도, 앱의 다른 화면도 없다.
//
// 여기서 그리는 것은 전부 share_view(token) 이 돌려준 값이다. items 를 직접 읽지
// 않는다 — 읽어도 RLS 때문에 0행이다. 만료·회수 판정도 DB 안에서 끝났으므로,
// 이 컴포넌트가 하는 일은 '받은 것을 그리는 것' 뿐이다. 무엇을 가리는 코드가
// 여기에 없다는 것이 이 화면의 요점이다 (src/share.js 머리말 참고).
import { useEffect, useState } from 'react'
import { fetchShare, deadTextFor, VIEW_ONLY_NOTE, isMissingShareSchema, SHARE_SETUP_MESSAGE } from '../share.js'
import { parseImages, fileIcon, formatBytes, extractUrls, downloadAsBlob } from '../supabase.js'

export default function SharePage({ token }) {
  const [state, setState] = useState({ loading: true })
  const [zoom, setZoom] = useState(null)

  useEffect(() => {
    // 토큰 모양이 아니면 물어볼 것도 없다. 그래도 화면은 '찾을 수 없는 링크' 로 —
    // 로그인 화면으로 보내면 받은 사람은 자기가 뭘 잘못했는지 알 수 없다.
    if (!token) { setState({ loading: false, res: { ok: false, reason: 'not_found' } }); return }
    let alive = true
    ;(async () => {
      try {
        const res = await fetchShare(token)
        if (alive) setState({ loading: false, res })
      } catch (err) {
        console.error('[공유] 열지 못했습니다:', err)
        if (alive) {
          setState({
            loading: false,
            failed: isMissingShareSchema(err)
              ? SHARE_SETUP_MESSAGE
              : '지금은 열 수 없어요. 잠시 뒤 다시 시도해 주세요.'
          })
        }
      }
    })()
    return () => { alive = false }
  }, [token])

  useEffect(() => {
    if (!zoom) return
    function onKey(e) { if (e.key === 'Escape') setZoom(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  if (state.loading) {
    return <div className="center-page"><div className="spinner" aria-label="불러오는 중" /></div>
  }

  if (state.failed) {
    return <ShareDead title="열 수 없는 링크입니다" sub={state.failed} />
  }

  if (!state.res?.ok) {
    const { title, sub } = deadTextFor(state.res?.reason)
    return <ShareDead title={title} sub={sub} />
  }

  const item = state.res.item ?? {}
  const files = Array.isArray(state.res.files) ? state.res.files : []
  const images = parseImages(item.image_url)
  const links = extractUrls(item.link_url ?? '')
  const tags = Array.isArray(item.tags) ? item.tags : []

  return (
    <div className="archive share-page">
      <header className="topbar">
        {/* 로고는 글자만. 누르면 앱으로 가는 버튼이 아니다 — 이 사람에게 앱은 없다. */}
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-name">나의 아카이브</span>
        </div>
        <span className="badge badge-teal">열람 전용</span>
      </header>

      <article className="share-card">
        <h1 className="share-title">{item.title}</h1>

        {tags.length > 0 && (
          <div className="tag-row">
            {tags.map((t) => <span className="chip chip-static" key={t}>#{t}</span>)}
          </div>
        )}

        {images.length > 0 && (
          <div className="share-images">
            {images.map((url, i) => (
              <button
                type="button"
                className="share-image"
                key={url}
                onClick={() => setZoom(url)}
                aria-label={`${i + 1}번째 이미지 크게 보기`}
              >
                <img src={url} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}

        {item.content && <div className="share-body">{item.content}</div>}

        {links.length > 0 && (
          <ul className="link-list share-links">
            {links.map((u) => (
              <li className="link-row" key={u}>
                <a href={u} target="_blank" rel="noopener noreferrer nofollow" title={u}>🔗 {u}</a>
              </li>
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <ul className="file-list share-files">
            {files.map((f) => (
              <li className="file-row" key={f.url}>
                {/* 🔴 주소를 그냥 열지 않고 받아서 blob 으로 저장한다. 서명 주소는 다른
                    출처라 download 속성이 무시되고 서버 헤더가 이름을 정하는데, 그 헤더가
                    한글·괄호가 든 이름에서 깨져 '%EC%96%91....hwp' 로 저장됐다
                    (supabase.js 의 downloadAsBlob 주석에 실제 응답을 적어 두었다).
                    a 태그는 그대로 둔다 — 자바스크립트가 막힌 환경에서도, 새 탭으로 열
                    때도 길이 남아 있어야 한다. 우리가 가로챌 때만 blob 으로 간다. */}
                <a
                  className="file-open"
                  href={f.url}
                  rel="noopener noreferrer"
                  download={f.name}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                    e.preventDefault()
                    downloadAsBlob(f.url, f.name)
                  }}
                >
                  <span className="file-icon" aria-hidden="true">{fileIcon(f.name)}</span>
                  <span className="file-name">{f.name}</span>
                  <span className="file-size">{formatBytes(f.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>

      <p className="share-foot">{VIEW_ONLY_NOTE}</p>

      {zoom && (
        <div
          className="img-zoom"
          role="dialog"
          aria-modal="true"
          aria-label="이미지 크게 보기"
          onMouseDown={() => setZoom(null)}
        >
          <img src={zoom} alt="" />
          <button className="img-zoom-x" onClick={() => setZoom(null)} aria-label="닫기">✕</button>
        </div>
      )}
    </div>
  )
}

// 만료·회수·없는 토큰이 닿는 자리. 여기에는 항목 내용이 아예 오지 않았다 —
// 서버가 실어 주지 않았기 때문이다.
function ShareDead({ title, sub }) {
  return (
    <div className="center-page">
      <div className="share-dead">
        <span className="share-dead-mark" aria-hidden="true">🔗</span>
        <h1>{title}</h1>
        <p>{sub}</p>
        <p className="share-dead-sub">필요하면 링크를 보낸 사람에게 새 링크를 부탁해 주세요.</p>
      </div>
    </div>
  )
}
