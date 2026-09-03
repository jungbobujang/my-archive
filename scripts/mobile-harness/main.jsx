// scripts/check-mobile.mjs 가 띄우는 점검용 화면. 앱 빌드에는 들어가지 않는다
// (vite build 는 index.html 만 진입점으로 삼는다).
import React from 'react'
import { createRoot } from 'react-dom/client'
import ItemModal from '../../src/components/ItemModal.jsx'
import LockScreen from '../../src/components/LockScreen.jsx'
import '../../src/styles.css'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') || 'edit'

const categories = [
  { id: 'c1', name: '유튜브', icon: '🎬', color: 'coral', parent_id: null, position: 0 },
  { id: 'c2', name: '기획', icon: '💡', color: 'teal', parent_id: null, position: 1 }
]
const slots = [{ id: 's1', name: '아침', icon: '🌅', position: 0 }]

// 첨부 파일이 붙은 항목. 이름을 일부러 길게 두었다 —
// 375px 에서 이름이 용량·✕ 를 밀어내는지가 이 화면으로 재려는 것이다.
const attachedFiles = [
  { path: 'it1/1700000000001_2026학년도 3학년 과학과 교육과정 운영 계획서(최종본).hwp',
    name: '2026학년도 3학년 과학과 교육과정 운영 계획서(최종본).hwp', size: 2411724 },
  { path: 'it1/1700000000002_학생 명단.xlsx', name: '학생 명단.xlsx', size: 18432 },
  { path: 'it1/1700000000003_실험 안전 수칙.pdf', name: '실험 안전 수칙.pdf', size: 940 }
]

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
  category_id: 'c1',
  files: mode === 'files' ? attachedFiles : []
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

// 잠금 화면은 모달이 아니라 화면 전체를 덮는 것이라 따로 그린다.
// 뒤에 글자를 한 무더기 깔아 두고 그린다 — 가림막이 정말 불투명한지,
// 뒤엣것이 한 글자라도 비치는지를 스크린샷으로 보려는 것이다.
if (mode === 'lock') {
  const behind = document.createElement('div')
  behind.className = 'archive'
  behind.style.padding = '16px'
  behind.textContent = '가려져야 할 내용 '.repeat(120)
  document.body.insertBefore(behind, document.getElementById('root'))

  createRoot(document.getElementById('root')).render(
    <LockScreen userId="u1" onUnlock={() => {}} />
  )
} else {

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

}
