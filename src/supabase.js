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

// ---------- 파일 첨부 ----------
//
// 이미지와 나란히, 문서·압축파일 같은 '그냥 파일'을 항목에 붙인다.
// 이미지와 갈라 놓은 이유가 셋 있다.
//   · 버킷이 다르다 — 이미지는 공개 읽기(카드 썸네일이 <img> 로 바로 뜬다),
//     파일은 비공개다. 한글 문서를 주소만 알면 누구나 받을 수 있으면 안 된다.
//   · 담는 값이 다르다 — 이미지는 URL 한 줄이면 되지만 파일은 원본 이름·용량이
//     함께 있어야 목록에 "보고서.hwp · 1.2MB" 로 보여 줄 수 있다.
//   · 다루는 방법이 다르다 — 리사이즈하지 않고, 붙여넣기로 들어오지도 않는다.
//
// 그래서 items.files 에 jsonb 배열로 담는다. 표(item_files)를 새로 두지 않은 이유는
// 위 image_url 설명과 같다 — 목록 조회와 백업이 그대로다. items 를 select('*') 로
// 받는 모든 화면(Archive·Today·Trash·MindMap)이 자동으로 따라온다.
//   [{ name: '보고서.hwp', path: '<항목id>/1724...._보고서.hwp', size: 1234, type: '', at: ISO }]
export const FILE_BUCKET = 'files'
export const MAX_FILES = 5
export const MAX_FILE_BYTES = 10 * 1024 * 1024      // 개당 10MB
export const FILE_QUOTA_BYTES = 1024 * 1024 * 1024  // Supabase 무료 한도 1GB
export const FILE_QUOTA_WARN = 0.8                  // 80% 넘으면 주황

// 실행파일(exe·bat·sh…)을 막는 것이 목적이라 '허용 목록' 으로 간다.
// 금지 목록은 새 확장자가 생길 때마다 뚫린다.
export const ALLOWED_FILE_EXTS = ['hwp', 'hwpx', 'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'zip']

const FILE_ICONS = {
  hwp: '📄', hwpx: '📄', pdf: '📕', docx: '📘', xlsx: '📗', pptx: '📙', txt: '📃', zip: '🗜'
}

// 이미지로 볼 확장자. 드롭 한 번으로 이미지/파일을 갈라 보낼 때 쓴다.
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'heif']

export function fileExt(name) {
  const m = String(name ?? '').match(/\.([^.\\/]+)$/)
  return m ? m[1].toLowerCase() : ''
}

export function fileIcon(name) {
  return FILE_ICONS[fileExt(name)] ?? '📎'
}

export function isAllowedFile(file) {
  return ALLOWED_FILE_EXTS.includes(fileExt(file?.name))
}

// 이미지인지 아닌지. MIME 을 먼저 믿고, 비어 있으면(일부 브라우저·드롭) 확장자로 본다.
export function isImageFile(file) {
  if (file?.type) return file.type.startsWith('image/')
  return IMAGE_EXTS.includes(fileExt(file?.name))
}

// 한 번의 드롭/고르기를 이미지와 파일로 나눈다. 드롭존을 둘로 나눠 놓고
// "여기엔 이미지만" 이라고 요구하면, 잘못 떨어뜨린 파일이 그냥 사라진다.
// 어느 쪽에 떨어뜨리든 확장자를 보고 알아서 보낸다.
export function splitByKind(files) {
  const images = []
  const others = []
  for (const f of [...(files ?? [])]) (isImageFile(f) ? images : others).push(f)
  return { images, files: others }
}

export function formatBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b}B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)}KB`
  const mb = b / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`
}

// jsonb 는 무엇이든 들어올 수 있다(옛 행은 null, 손으로 고친 백업은 문자열).
// 화면에서 .map 을 돌리기 전에 여기서 한 번 걸러 배열을 보장한다.
export function parseFiles(value) {
  let raw = value
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue
    const path = String(f.path ?? '')
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push({
      name: String(f.name ?? path.split('/').pop() ?? '파일'),
      path,
      size: Number(f.size) || 0,
      type: String(f.type ?? ''),
      at: f.at ?? null
    })
  }
  return out
}

// 저장 키에 그대로 못 쓰는 글자만 바꾼다. 한글은 건드리지 않는다 —
// 키에도 원본 이름이 보여야 나중에 대시보드에서 무엇인지 알아볼 수 있다.
// (그래도 이름의 정본은 files[].name 이다. 키가 어떻게 되든 내려받을 때는 이 이름을 쓴다)
function safeKeyName(name) {
  return String(name ?? 'file')
    // 경로로 읽히거나(/ \) 주소에서 뜻을 갖는 글자(? % #)와 제어문자만 바꾼다.
    // 한글·공백은 그대로 둔다 — 키에도 원본 이름이 보여야 나중에 알아볼 수 있다.
    .replace(/[/\\?%#*:|"<>]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .replace(/^\.+/, '_') // 앞의 점: 숨김파일·상위경로(..)로 읽히는 것을 막는다
    .slice(-120)
}

// 항목 하나에 딸린 파일은 그 항목 id 폴더에 모은다. 항목을 지울 때
// 폴더째 지우면 되고, 이름이 같은 파일을 다시 올려도 타임스탬프로 갈린다.
export async function uploadFile(file, itemId) {
  const path = `${itemId}/${Date.now()}_${safeKeyName(file.name)}`
  const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false
  })
  if (error) throw error
  return {
    name: file.name,          // 원본 이름 그대로 (한글·공백 포함) — 내려받을 때 이 이름이 쓰인다
    path,
    size: file.size,
    type: file.type || '',
    at: new Date().toISOString()
  }
}

// 비공개 버킷이라 주소를 바로 못 준다. 누를 때마다 60초짜리 서명 주소를 받아 쓴다.
// download 옵션이 Content-Disposition 을 붙여 준다 → 한글 이름 그대로 저장된다.
export async function fileDownloadUrl(f) {
  const { data, error } = await supabase.storage
    .from(FILE_BUCKET)
    .createSignedUrl(f.path, 60, { download: f.name })
  if (error) throw error
  return data.signedUrl
}

// 스토리지에서 지운다. 한 번에 여러 개. 실패해도 던지지 않는다 —
// 항목을 지우는 흐름에서 파일 정리가 실패했다고 항목 삭제까지 막으면 곤란하다.
// (남은 것은 고아 파일이 되지만, 설정의 사용량 게이지에서 티가 난다)
export async function removeFiles(paths) {
  const list = [...new Set((paths ?? []).filter(Boolean))]
  if (list.length === 0) return { removed: 0, error: null }
  const { error } = await supabase.storage.from(FILE_BUCKET).remove(list)
  if (error) console.warn('[files] 스토리지 삭제 실패(고아 파일이 남습니다):', error.message)
  return { removed: error ? 0 : list.length, error: error ?? null }
}

// 사용량은 items.files 메타의 합으로 잰다. 스토리지를 훑는 것보다 훨씬 싸고,
// 휴지통에 있는 항목의 파일도 자리를 차지하므로 살아 있는 것만 세면 안 된다.
export async function fileUsageBytes() {
  const rows = await fetchAllRows('items', 'files')
  let bytes = 0
  let count = 0
  for (const r of rows) {
    for (const f of parseFiles(r.files)) { bytes += f.size; count += 1 }
  }
  return { bytes, count }
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
