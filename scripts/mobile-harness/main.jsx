// scripts/check-mobile.mjs 가 띄우는 점검용 화면. 앱 빌드에는 들어가지 않는다
// (vite build 는 index.html 만 진입점으로 삼는다).
import React from 'react'
import { createRoot } from 'react-dom/client'
import ItemModal from '../../src/components/ItemModal.jsx'
import '../../src/styles.css'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') || 'edit'

const categories = [
  { id: 'c1', name: '유튜브', icon: '🎬', color: 'coral', parent_id: null, position: 0 },
  { id: 'c2', name: '기획', icon: '💡', color: 'teal', parent_id: null, position: 1 }
]
const slots = [{ id: 's1', name: '아침', icon: '🌅', position: 0 }]

const item = (mode === 'new' || mode === 'multi') ? null : {
  id: 'it1',
  title: '쇼츠 대본 - AI 활용법 3가지',
  content: '대본 초안입니다.',
  link_url: [
    'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    'https://example.com/very/long/path/that/goes/on/and/on/for/a/while?x=1&y=2',
    'https://naver.com'
  ].join(String.fromCharCode(10)),
  image_url: null,
  tags: ['유튜브', '쇼츠'],
  status: 'none',
  due_date: null,
  slot_id: null,
  category_id: 'c1'
}

if (mode === 'multi') {
  sessionStorage.setItem('ma:draft:new', JSON.stringify({
    title: '',
    content: '',
    links: [
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      'https://www.youtube.com/watch?v=bbbbbbbbbbb',
      'https://example.com/long/path/here'
    ],
    linkInput: '',
    tagsText: '',
    categoryIds: ['c1'],
    status: 'none',
    dueDate: '',
    slotId: null,
    images: [],
    splitMode: true
  }))
}

createRoot(document.getElementById('root')).render(
  <ItemModal
    item={item}
    categories={categories}
    slots={slots}
    userId="u1"
    onClose={() => {}}
    onSaved={() => {}}
  />
)
