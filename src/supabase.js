import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anonKey ? createClient(url, anonKey) : null

export const CATEGORIES = [
  { key: 'idea', label: '아이디어', icon: '💡' },
  { key: 'script', label: '유튜브 대본', icon: '🎬' },
  { key: 'image', label: '이미지', icon: '🖼️' },
  { key: 'memo', label: '기타 메모', icon: '📝' }
]

export const PAGE_SIZE = 24
export const BUCKET = 'archive-images'
