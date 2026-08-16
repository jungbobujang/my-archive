import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anonKey ? createClient(url, anonKey) : null

export const COLOR_KEYS = ['purple', 'coral', 'teal', 'gray', 'blue', 'amber', 'pink', 'green']
export const ICON_CHOICES = ['💡', '🎬', '🖼️', '📝', '📚', '🏋️', '✍️', '🔬', '🎨', '📌']

export const PAGE_SIZE = 24
export const BUCKET = 'archive-images'

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

export function extractUrl(text) {
  if (!text) return null
  const m = text.match(/https?:\/\/[^\s"'<>]+/)
  return m ? m[0] : null
}

export async function fetchLinkTitle(url) {
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`)
    const data = await res.json()
    return data.title || null
  } catch { return null }
}

export function extractUrls(text) {
  if (!text) return []
  return [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) || [])]
}

export function youtubeThumb(url) {
  if (!url) return null
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null
}
