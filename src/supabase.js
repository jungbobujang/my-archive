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

// ---------- 일반 파일 첨부 ----------
//
// 이미지와 버킷을 나눈다(archive-files). 이미지는 공개 버킷이지만 파일은 비공개다 —
// 한글 문서·표·압축본이 들어오는 자리라, 주소만 알면 누구나 받을 수 있는 상태로 두지 않는다.
// 대신 받을 때마다 짧은 서명 주소를 만들어 준다(signedFileUrl).
//
// 메타(이름·경로·용량)는 items.files 한 열에 jsonb 배열로 담는다. 이미지처럼 표를 나누지
// 않은 이유는 같지만, 파일은 이미지와 달리 '이름'과 '용량'을 함께 보여 줘야 해서
// 줄바꿈 문자열로는 담을 수 없다. jsonb 한 열이면 select('*') 도, 백업 내보내기/가져오기도
// 지금 코드 그대로 돌아간다(열 하나가 늘 뿐이다).
export const FILE_BUCKET = 'archive-files'
export const MAX_FILES = 5
export const FILE_MAX_BYTES = 10 * 1024 * 1024
export const FILE_EXTS = ['hwp', 'hwpx', 'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'zip']
// 무료 플랜 기준. 게이지 표시에만 쓰고, 넘는다고 막지는 않는다 (실제 상한은 Supabase 가 건다).
export const STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024
export const STORAGE_WARN_RATIO = 0.8

const FILE_ICONS = {
  pdf: '📕', hwp: '📘', hwpx: '📘', docx: '📄',
  xlsx: '📊', pptx: '📽', txt: '📃', zip: '🗜'
}

export function extOfName(name) {
  const m = /\.([^.]+)$/.exec(String(name ?? ''))
  return m ? m[1].toLowerCase() : ''
}

export function fileIcon(name) {
  return FILE_ICONS[extOfName(name)] ?? '📎'
}

// 사람이 읽는 용량. 오류 문구("현재 12.3MB")와 사용량 게이지가 같은 함수를 쓴다.
export function formatBytes(n) {
  const v = Number(n) || 0
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)}MB`
  if (v >= 1024) return `${Math.round(v / 1024)}KB`
  return `${v}B`
}

// 붙일 수 있는 파일인지. 붙일 수 없으면 그 이유를 문장으로 돌려준다(없으면 null).
// 확장자를 먼저 본다 — 100MB 짜리 exe 에 "10MB 이하만" 이라고 답하면 엉뚱한 안내가 된다.
export function fileRejectReason(file, currentCount = 0) {
  const name = file?.name ?? ''
  if (!FILE_EXTS.includes(extOfName(name))) {
    const ext = extOfName(name)
    return `${FILE_EXTS.join('·')} 만 첨부할 수 있습니다${ext ? ` (.${ext})` : ''}`
  }
  if ((file?.size ?? 0) > FILE_MAX_BYTES) {
    return `10MB 이하만 첨부할 수 있습니다 (현재 ${formatBytes(file.size)})`
  }
  if (currentCount >= MAX_FILES) return `파일은 최대 ${MAX_FILES}개까지예요`
  return null
}

// 저장 키: {항목id}/{타임스탬프}_{원본명}. 원본명을 그대로 둔다 — 나중에 스토리지를
// 직접 열어 봤을 때 무엇인지 알아볼 수 있어야 한다. 폴더가 생기지 않게 / \ 만 바꾼다.
// encoded 는 서버가 키를 거부했을 때 쓰는 물러설 자리다(uploadFile 참고).
export function storageKeyFor(itemId, name, stamp = Date.now(), encoded = false) {
  const base = String(name || 'file').replace(/[\/]/g, '_').trim() || 'file'
  return `${itemId}/${stamp}_${encoded ? encodeURIComponent(base) : base}`
}

// 키에서 원본 이름을 되찾는다. 퍼센트 인코딩된 키도 같은 이름으로 돌아온다.
export function originalNameFromKey(key) {
  const last = String(key ?? '').split('/').pop() ?? ''
  const raw = last.replace(/^\d+_/, '')
  try { return decodeURIComponent(raw) } catch { return raw }
}

// items.files 값을 { path, name, size } 목록으로 고른다.
// jsonb 배열이 정본이지만, 열이 아직 없는 DB(‑> undefined)나 문자열로 온 값도 견딘다.
export function parseFiles(value) {
  let rows = value
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows) } catch { return [] }
  }
  if (!Array.isArray(rows)) return []
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const path = typeof r === 'string' ? r : r?.path
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push({
      path,
      name: (typeof r === 'object' && r?.name) || originalNameFromKey(path),
      size: Number(typeof r === 'object' ? r?.size : 0) || 0
    })
  }
  return out
}

export function joinFiles(list) {
  return parseFiles(list ?? [])
}

export function filePathsOf(item) {
  return parseFiles(item?.files).map((f) => f.path)
}

export function totalFileBytes(items) {
  let sum = 0
  for (const it of items ?? []) for (const f of parseFiles(it?.files)) sum += f.size
  return sum
}

// 파일 한 개 올리기. 원본명이 그대로 들어간 키를 먼저 쓰고, 서버가 키를 거부하면
// (한글 등 비ASCII 를 막는 배포본이 있다) 퍼센트 인코딩한 키로 한 번만 물러선다.
// 어느 쪽이든 화면에 보이는 이름(name)은 원본 그대로다.
export async function uploadFile(file, itemId) {
  const stamp = Date.now()
  const opts = { contentType: file.type || 'application/octet-stream', upsert: false }
  let path = storageKeyFor(itemId, file.name, stamp)
  let { error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, opts)
  if (error && /invalid key/i.test(error.message ?? '')) {
    path = storageKeyFor(itemId, file.name, stamp, true)
    ;({ error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, opts))
  }
  if (error) throw error
  return { path, name: file.name, size: file.size }
}

// 비공개 버킷이라 받을 때마다 짧은 주소를 만든다. download 를 주면 원본 이름으로 저장된다.
export async function signedFileUrl(path, name) {
  const { data, error } = await supabase.storage
    .from(FILE_BUCKET)
    .createSignedUrl(path, 60, name ? { download: name } : undefined)
  if (error) throw error
  return data.signedUrl
}

// 스토리지에서 지운다. 지우기 실패는 화면 흐름을 막지 않는다 — 남은 것은 고아일 뿐이고,
// 그 때문에 저장이나 삭제가 실패한 것처럼 보이면 사용자가 같은 일을 반복하게 된다.
export async function removeStorageFiles(paths) {
  const list = [...new Set((paths ?? []).filter(Boolean))]
  if (list.length === 0) return
  try {
    await supabase.storage.from(FILE_BUCKET).remove(list)
  } catch (err) {
    console.warn('[storage] 파일 삭제 실패:', err)
  }
}

// 공개 URL 에서 버킷 안 경로를 되찾는다. 우리가 올린 것이 아니면(유튜브 썸네일 등) null.
export function imagePathFromUrl(url) {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const at = String(url ?? '').indexOf(marker)
  if (at < 0) return null
  try { return decodeURIComponent(String(url).slice(at + marker.length)) } catch { return null }
}

export async function removeStorageImages(urls) {
  const paths = (urls ?? []).map(imagePathFromUrl).filter(Boolean)
  if (paths.length === 0) return
  try {
    await supabase.storage.from(BUCKET).remove([...new Set(paths)])
  } catch (err) {
    console.warn('[storage] 이미지 삭제 실패:', err)
  }
}

// 고른 파일 뭉치를 이미지와 그 밖의 파일로 가른다.
// 확장자가 이미지면 이미지 쪽으로 보낸다 — 사람이 스크린샷을 파일 칸에 떨어뜨렸다고
// "이미지는 안 됩니다" 라고 답하는 것은 도움이 되지 않는다.
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'heif']

export function isImageFile(file) {
  if (file?.type?.startsWith('image/')) return true
  return IMAGE_EXTS.includes(extOfName(file?.name))
}

export function splitByKind(files) {
  const images = []
  const docs = []
  for (const f of [...(files ?? [])]) (isImageFile(f) ? images : docs).push(f)
  return { images, docs }
}

// 붙여넣기·드롭에서 이미지 파일만 골라낸다.
// 모달의 드롭은 이미지와 파일을 함께 받아 splitByKind 로 가르므로 이것을 쓰지 않는다.
// 목록 화면의 '빠른 저장'(Archive)은 이미지만 받으므로 그대로 쓴다.
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

// ---------- 보이지 않는 문자 ----------
//
// 눈에는 안 보이지만 저장을 통째로 깨뜨리는 문자들이 있다.
//   · NUL 문자 — Postgres 의 text 는 이것을 담지 못한다. 22P05 로 튕긴다.
//   · 짝 없는 서로게이트 — 붙여넣기나 잘린 복사로 생긴다. JSON 인코딩부터 깨진다.
//   · 그 밖의 제어문자 — 화면에는 아무것도 아닌데 글자 수만 늘린다.
// 탭(\t)과 줄바꿈(\n·\r)은 사람이 일부러 넣은 서식이라 남긴다.
//
// 몇 개를 털었는지 함께 돌려준다 — 사람에게 "정리했습니다" 라고 알려야, 저장된 글이
// 붙여넣은 것과 다르다는 사실을 나중에 혼자 발견하지 않는다.
const RISKY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uD800-\uDFFF]/

function isControlCode(c) {
  return (c <= 0x08) || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)
}

export function stripInvisible(text) {
  const src = String(text ?? '')
  // 대부분의 글에는 하나도 없다. 한 번 훑어 없으면 원본을 그대로 돌려준다 (긴 글에서 값싸다).
  if (!RISKY.test(src)) return { text: src, removed: 0 }

  let out = ''
  let removed = 0
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = src.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { out += src[i] + src[i + 1]; i++; continue }
      removed++ // 짝 없는 상위 서로게이트
      continue
    }
    if (c >= 0xdc00 && c <= 0xdfff) { removed++; continue } // 짝 없는 하위 서로게이트
    if (isControlCode(c)) { removed++; continue }
    out += src[i]
  }
  return { text: out, removed }
}

// 저장에 쓸 값 여럿을 한 번에 턴다. { values, removed } 로 돌려준다 —
// 안내 문구는 "3개를 정리했습니다" 처럼 칸을 가리지 않고 합쳐서 말한다.
export function stripInvisibleAll(map) {
  const values = {}
  let removed = 0
  for (const [k, v] of Object.entries(map ?? {})) {
    const one = stripInvisible(v)
    values[k] = one.text
    removed += one.removed
  }
  return { values, removed }
}

export function byteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length
}

// ---------- 저장 실패 문구 ----------
//
// 저장이 실패했을 때 "네트워크와 Supabase 설정을 확인해 주세요" 한 줄만 띄우면,
// 실제로는 로그인이 풀린 것이어도 사람은 와이파이를 쳐다본다. 원인마다 다음에 할 일이
// 다르므로 문구도 달라야 한다. 알아보지 못한 오류는 코드와 원문을 그대로 붙여 준다 —
// 포괄 문구는 코드도 메시지도 없을 때의 최후 폴백으로만 쓴다.
export const SAVE_FALLBACK_MESSAGE = '저장에 실패했어요. 네트워크와 Supabase 설정을 확인해 주세요.'
export const SESSION_EXPIRED_MESSAGE = '로그인이 만료됐습니다. 다시 로그인하면 작성 내용은 유지됩니다'

export function saveErrorMessage(err) {
  const code = String(err?.code ?? err?.status ?? '')
  const msg = String(err?.message ?? '')

  // 세션 만료·권한(RLS). 로그인하지 않은 채로 저장해도 여기로 온다.
  if (code === '401' || code === '403' || code === '42501' || code === 'PGRST301' ||
      /jwt|row-level security|not authenticated|permission denied/i.test(msg)) {
    return SESSION_EXPIRED_MESSAGE
  }
  // NUL 등 Postgres 가 담지 못하는 문자 (정리를 거치고도 남았을 때)
  if (code === '22P05' || /untranslatable|0x00/i.test(msg)) {
    return '저장할 수 없는 보이지 않는 문자가 남아 있어요. 내용을 다시 붙여넣어 주세요'
  }
  // 제목이 빈 채로 DB 에 닿았을 때 (열 제약)
  if ((code === '23502' || code === '23514') && /title|제목/i.test(msg)) {
    return '제목이 비어 저장하지 못했어요. 제목을 한 줄 적어 주세요'
  }
  if (code === '23502') {
    return `${msg.match(/column "([^"]+)"/)?.[1] ?? '어떤 값'} 이(가) 비어 저장하지 못했어요`
  }
  if (code === '23503') return '연결된 카테고리나 시간대가 이미 지워졌어요. 다시 골라 주세요'
  if (code === '23505') return '같은 항목이 이미 저장돼 있어요'
  if (code === '22001') return '글이 너무 길어 저장하지 못했어요. 조금 나눠서 저장해 주세요'
  if (code === '42P01' || code === 'PGRST205') {
    return 'DB 표를 찾지 못했어요 — supabase/setup.sql 을 실행해 주세요'
  }
  if (code === 'PGRST204' || code === '42703') {
    return `DB 에 없는 열이에요 — supabase/setup.sql 을 실행해 주세요 (${code})`
  }
  if (/failed to fetch|networkerror|fetch failed|load failed/i.test(msg)) {
    return '서버에 닿지 못했어요. 연결 상태를 확인해 주세요'
  }
  if (msg) return `저장하지 못했어요: ${msg}${code ? ` (${code})` : ''}`
  return SAVE_FALLBACK_MESSAGE
}

// 초안(임시 보존) 조절값. 모달과 점검 스크립트가 같은 값을 본다.
export const DRAFT_DEBOUNCE_MS = 500
export const DRAFT_MAX_BYTES = 1024 * 1024
