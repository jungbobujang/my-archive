// scripts/check-mobile.mjs 가 띄우는 점검용 화면. 앱 빌드에는 들어가지 않는다
// (vite build 는 index.html 만 진입점으로 삼는다).
import React from 'react'
import { createRoot } from 'react-dom/client'
import ItemModal from '../../src/components/ItemModal.jsx'
import LockScreen from '../../src/components/LockScreen.jsx'
import ItemCard from '../../src/components/ItemCard.jsx'
import { useFlip, staggerDelay } from '../../src/motion.js'
import Archive from '../../src/components/Archive.jsx'
import { ToastProvider } from '../../src/components/Toast.jsx'
import { store } from '../fake-supabase.mjs'
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

// 순서 바꾸기 점검용 — 이미지 3장 + 파일 3개. 이미지는 바깥으로 나가지 않게
// data: URL 을 쓴다 (점검이 연결 상태에 따라 흔들리면 안 된다).
const px = (fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="${fill}"/></svg>`
)
const reorderImages = [px('#c33'), px('#3c3'), px('#33c')]

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
  files: (mode === 'files' || mode === 'reorder') ? attachedFiles : []
}
if (mode === 'reorder') item.image_url = reorderImages.join(String.fromCharCode(10))

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

/* 레이아웃 점검용 — **진짜 Archive** 를 가짜 Supabase 위에 띄운다.
   🔴 카드만 따로 그려서는 '첫 화면에 몇 장 보이나' 를 잴 수 없다. 그 숫자는 위에 쌓인
      탭·검색·빠른 저장·카테고리 줄이 자리를 얼마나 먹느냐로 정해지기 때문이다.
   이미지 카드는 비율을 일부러 섞어 둔다(세로·가로·정사각) — 메이슨리가 그 차이를
   살리는지 보려는 것이다. */
if (mode === 'layout') {
  const svg = (w, h, fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
    + '<rect width="' + w + '" height="' + h + '" fill="' + fill + '"/></svg>')
  const shapes = [[400, 700, '#c9d6c9'], [700, 400, '#d6c9c9'], [500, 500, '#c9c9d6'],
    [400, 900, '#d6d3c9'], [800, 450, '#c9d6d6']]
  const names = ['아이디어', '유튜브 대본', '수업 자료', '링크 모음', '읽을 것', '사진', '할 일', '기타']
  const icons = ['💡', '🎬', '📚', '🔗', '📖', '🖼', '✅', '🗂']
  const colors = ['purple', 'coral', 'teal', 'blue', 'amber', 'pink', 'green', 'gray']
  const cats = names.map((name, i) => ({
    id: 'c' + (i + 1), user_id: 'u1', name, icon: icons[i], color: colors[i],
    parent_id: null, position: i
  }))
  store.rows.categories.push(...cats)
  const titles = ['짧은 제목', '조금 더 긴 제목이 붙은 항목이라 두 줄까지 갈 수 있다', '제목']
  for (let i = 0; i < 49; i++) {
    const textOnly = i % 3 === 2
    const shape = shapes[i % shapes.length]
    store.rows.items.push({
      id: 'it' + (i + 1), user_id: 'u1',
      title: '항목 ' + (i + 1) + ' — ' + titles[i % 3],
      content: textOnly ? '텍스트만 있는 카드입니다. '.repeat((i % 4) + 1) : '',
      tags: i % 4 === 0 ? ['태그'] : [],
      link_url: null,
      image_url: textOnly ? null : svg(shape[0], shape[1], shape[2]),
      files: [], status: 'none', starred: i % 7 === 0, deleted_at: null,
      created_at: new Date(2026, 0, 1 + (i % 28)).toISOString(),
      updated_at: new Date(2026, 0, 1 + (i % 28)).toISOString()
    })
    store.rows.item_categories.push({ item_id: 'it' + (i + 1), category_id: cats[i % cats.length].id })
  }
  localStorage.setItem('archive-tab', 'archive')
  localStorage.setItem('archive-view', params.get('view') || 'grid')
  createRoot(document.getElementById('root')).render(
    <ToastProvider>
      <Archive session={{ user: { id: 'u1', email: 'a@b.c' } }} onNavigate={() => {}} />
    </ToastProvider>
  )
} else

/* 모션 점검용 화면 — 카드 49장.
   🔴 Archive 를 통째로 띄우지 않는다. 그러려면 로그인·Supabase 를 흉내 내야 하고, 그건
      모션과 아무 상관이 없다. 여기서 재려는 것은 **카드 목록이 어떻게 움직이는가** 뿐이라
      ItemCard(순수 컴포넌트)와 같은 규칙(등장·스태거·FLIP)을 그대로 얹어 그린다.
   49장인 이유: 성능 가드 기준이 그 수다 (스태거는 12장까지만 걸리는 것도 여기서 본다). */
if (mode === 'motion') {
  const cards = Array.from({ length: 49 }, (_, i) => ({
    id: `m${i + 1}`, title: `카드 ${i + 1}`, content: '모션 점검용 항목입니다.',
    link_url: null, image_url: null, tags: i % 3 === 0 ? ['태그'] : [],
    status: 'none', created_at: new Date(2026, 0, 1).toISOString(), starred: false
  }))
  function MotionDemo() {
    const [list, setList] = React.useState(cards)
    const [savedId, setSavedId] = React.useState(null)
    const [fresh, setFresh] = React.useState(true)
    const gridRef = useFlip([list.map((c) => c.id).join(',')])
    // 점검 스크립트가 부를 손잡이 — 필터 전환(FLIP)·저장 강조·삭제를 흉내 낸다
    React.useEffect(() => {
      window.__motion = {
        shuffle: () => setList((cur) => [...cur].reverse()),
        filter: (n) => setList(cards.slice(0, n)),
        all: () => setList(cards),
        save: (id) => setSavedId(id),
        settle: () => setFresh(false)
      }
    }, [])
    return (
      <div className="archive" style={{ padding: 16 }}>
        <div className="item-grid" ref={gridRef}>
          {list.map((it, i) => (
            <ItemCard
              key={it.id} item={it} categories={[]} categoryIds={[]} view="grid"
              onOpen={() => {}} onStar={() => {}} onDone={() => {}} onTag={() => {}}
              enter={fresh} delay={staggerDelay(i)} saved={it.id === savedId}
            />
          ))}
        </div>
      </div>
    )
  }
  createRoot(document.getElementById('root')).render(<MotionDemo />)
} else

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
