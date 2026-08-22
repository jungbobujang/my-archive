// Supabase 클라이언트와, 화면 여러 곳에서 함께 쓰는 순수 함수들.
// 컴포넌트에 흩어져 있던 같은 로직(전체 조회 페이징, 태그 파싱, 날짜 포맷)을 여기로 모았다.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anonKey ? createClient(url, anonKey) : null

export const COLOR_KEYS = ['purple', 'coral', 'teal', 'gray', 'blue', 'amber', 'pink', 'green']
// 카테고리·시간대 아이콘 고르개. 뒤쪽 10개는 카테고리 시드
// (supabase/category-seed.sql)에서 쓰는 것들이라, 시드로 만든 카테고리도
// 화면에서 아이콘을 다시 고를 수 있게 목록에 넣어 둔다.
// 기존 10개의 순서는 그대로 두고 뒤에 붙였다 — 앞자리가 밀리면 손이 기억하는 자리가 바뀐다.
export const ICON_CHOICES = [
  '💡', '🎬', '🖼️', '📝', '📚', '🏋️', '✍️', '🔬', '🎨', '📌',
  '📺', '🏫', '⚙️', '🧠', '📊', '🌍', '🗂', '✅', '🔧', '💎',
  '💪', '🍜', '💰', '✨', '🥗', '🍚', '🛒', '🗺', '📈', '💵', '🤖', '📖',
  '🏠', '✈️'
]

export const PAGE_SIZE = 24
export const BUCKET = 'archive-images'
export const MAX_TAGS = 10

// ---------- 이미지 ----------
//
// 여러 장을 items.image_url 한 열에 줄바꿈으로 담는다. 별도 표(item_images)를 두지 않은 이유:
//   · 같은 표의 link_url 이 이미 같은 방식이다 — 짧은 URL 목록, 순서만 있고 부가 정보가 없다.
//   · 옮길 데이터가 없다. 기존 한 줄짜리 값이 그대로 '1장짜리 목록'이다.
//   · 목록 조회가 그대로다. Archive 는 items 를 24개씩 select('*') 로 받는데,
//     표를 나누면 페이지마다 조회가 한 번 더 붙고(item_categories 처럼) 그 매핑을
//     Today·Trash·MindMap 에도 따로 만들어야 한다.
//   · 백업이 그대로다. 내보내기/가져오기가 표 목록을 훑는 구조라 표가 늘면 양쪽을 다 고쳐야
//     하는데, 이 저장소는 예전에 time_slots 를 백업에서 빠뜨린 적이 있다(bf13b2b).
// 한 장당 캡션 같은 부가 정보가 필요해지면 그때 표로 정규화한다.
export const MAX_IMAGES = 10
export const IMAGE_MAX_EDGE = 1600 // 긴 변이 이보다 크면 줄여서 올린다

export function parseImages(text) {
  if (!text) return []
  const seen = new Set()
  const out = []
  for (const line of String(text).split('\n')) {
    const url = line.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function joinImages(list) {
  const clean = parseImages((list ?? []).join('\n'))
  return clean.length > 0 ? clean.join('\n') : null
}

const extOf = (type) => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg')

// 긴 변을 maxEdge 로 줄인다(비율 유지). 이미 작으면 원본을 그대로 돌려준다.
// GIF 는 건드리지 않는다 — 캔버스로 다시 그리면 첫 장만 남아 움직임이 죽는다.
export async function resizeImage(file, maxEdge = IMAGE_MAX_EDGE) {
  if (!file?.type?.startsWith('image/')) return file
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // 디코딩 못 하면 원본을 그대로 올린다
  }

  const long = Math.max(bitmap.width, bitmap.height)
  if (long <= maxEdge) {
    bitmap.close?.()
    return file
  }

  const scale = maxEdge / long
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  // webp 가 같은 화질에 더 작다. 인코더가 없으면(구형 사파리) jpeg 로 물러선다.
  const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q))
  let blob = await toBlob('image/webp', 0.9)
  let type = 'image/webp'
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob('image/jpeg', 0.85)
    type = 'image/jpeg'
  }
  if (!blob) return file
  // 줄였는데 오히려 커지는 경우(작은 png 등)는 원본을 쓴다
  if (blob.size >= file.size) return file

  const base = (file.name || 'image').replace(/\.[^.]+$/, '')
  return new File([blob], `${base}.${extOf(type)}`, { type })
}

// 리사이즈 → 업로드 → 공개 URL. 같은 밀리초에 여러 장을 올려도 겹치지 않게 뒤에 난수를 붙인다.
export async function uploadImage(file, userId) {
  const ready = await resizeImage(file)
  const ext = (ready.name?.split('.').pop() || extOf(ready.type)).toLowerCase()
  const rand = Math.random().toString(36).slice(2, 8)
  const path = `${userId}/${Date.now()}-${rand}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, ready, {
    contentType: ready.type || 'image/jpeg'
  })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// 붙여넣기·드롭에서 이미지 파일만 골라낸다
export function imageFilesFromPaste(e) {
  const items = e.clipboardData?.items ?? []
  const files = []
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  return files
}

export function imageFilesFromDrop(e) {
  return [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
}

// ---------- 카테고리 트리 ----------

// 자기 자신 + 모든 자손의 id. 순환 참조가 있어도 방문 집합으로 멈춘다.
export function subtreeIds(categories, rootId) {
  if (!rootId) return []
  const ids = [rootId]
  const seen = new Set([rootId])
  for (let i = 0; i < ids.length; i++) {
    for (const c of categories) {
      if (c.parent_id === ids[i] && !seen.has(c.id)) {
        seen.add(c.id)
        ids.push(c.id)
      }
    }
  }
  return ids
}

export function childrenOf(categories, parentId) {
  return categories.filter((c) => (c.parent_id ?? null) === parentId)
}

// 트리 차례대로 [{ cat, depth }] 로 펼친다 (최상위 0, 그 아래 1, 2 …).
// DB 는 position 으로만 정렬해 주므로 부모와 자식이 뒤섞여 온다. 3단이 되면
// 어느 것이 누구 밑인지 목록만 보고는 알 수 없어서, 화면에서 쓸 순서를 여기서 만든다.
//
// 고아(부모가 지워졌거나 못 찾는 행)도 반드시 한 번은 내보낸다 — 화면에서 사라지면
// 이름을 고치거나 지울 방법조차 없어진다. 순환 참조가 있어도 방문 집합으로 멈춘다.
export function treeOrder(categories) {
  const rows = categories ?? []
  const out = []
  const seen = new Set()

  const walk = (parentId, depth) => {
    for (const c of rows) {
      if ((c.parent_id ?? null) !== parentId) continue
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push({ cat: c, depth })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)

  for (const c of rows) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      out.push({ cat: c, depth: 0 })
    }
  }
  return out
}

// "생활 › 맛집·음식" — 자기 위쪽 조상들의 이름. 3단부터는 이름만으로 구분이 안 된다
// ('국내'·'기타' 처럼 짧은 이름이 그렇다).
export function categoryPath(categories, id) {
  const byId = new Map((categories ?? []).map((c) => [c.id, c]))
  const names = []
  let cur = byId.get(id)
  const guard = new Set()
  while (cur?.parent_id && !guard.has(cur.parent_id)) {
    guard.add(cur.parent_id)
    cur = byId.get(cur.parent_id)
    if (!cur) break
    names.unshift(cur.name)
  }
  return names
}

// ---------- 조회 ----------

// PostgREST 는 한 번에 돌려주는 행 수에 상한이 있어 끝까지 나눠 받는다.
// tweak 으로 필터/정렬을 얹을 수 있다: (q) => q.is('deleted_at', null)
const CHUNK = 1000

export async function fetchAllRows(table, columns = '*', tweak) {
  const rows = []
  for (let from = 0; ; from += CHUNK) {
    let q = supabase.from(table).select(columns)
    if (tweak) q = tweak(q)
    const { data, error } = await q.range(from, from + CHUNK - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < CHUNK) break
  }
  return rows
}

// ---------- 링크 ----------

export function extractUrls(text) {
  if (!text) return []
  return [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) || [])]
}

// 사람이 손으로 치거나 앱에서 복사한 링크는 스킴이 빠져 있기 일쑤다("youtu.be/abc").
// extractUrls 는 http(s) 로 시작하는 것만 잡으므로, 그 앞에 스킴을 붙여 준 뒤 넘긴다.
// 공백·쉼표·줄바꿈 아무거나로 나눠도 되게 했다 — 여러 개를 한 번에 붙여넣는 자리다.
const BARE_DOMAIN = /^(?:[\w-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i

export function parseLinks(text) {
  if (!text) return []
  const out = []
  for (const raw of String(text).split(/[\s,]+/)) {
    if (!raw) continue
    const withScheme = /^https?:\/\//i.test(raw) ? raw : (BARE_DOMAIN.test(raw) ? `https://${raw}` : null)
    if (!withScheme) continue
    const [found] = extractUrls(withScheme)
    if (found && !out.includes(found)) out.push(found)
  }
  return out
}

export async function fetchLinkTitle(url) {
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`)
    const data = await res.json()
    return data.title || null
  } catch { return null }
}

export function youtubeThumb(url) {
  if (!url) return null
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null
}

// ---------- 입력 파싱 ----------

// "유튜브, #쇼츠, 쇼츠" -> ['유튜브', '쇼츠'] (중복 제거, # 제거, 최대 10개)
export function parseTags(text) {
  return [...new Set(
    (text ?? '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
  )].slice(0, MAX_TAGS)
}

// Date -> 'YYYY-MM-DD'. toISOString 은 UTC 라 날짜가 하루 밀릴 수 있어 직접 만든다.
export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
