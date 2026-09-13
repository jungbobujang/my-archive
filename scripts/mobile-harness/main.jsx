// scripts/check-mobile.mjs 가 띄우는 점검용 화면. 앱 빌드에는 들어가지 않는다
// (vite build 는 index.html 만 진입점으로 삼는다).
import React from 'react'
import { createRoot } from 'react-dom/client'
import ItemModal from '../../src/components/ItemModal.jsx'
import LockScreen from '../../src/components/LockScreen.jsx'
import ItemCard from '../../src/components/ItemCard.jsx'
import SpaceSwitcher from '../../src/components/SpaceSwitcher.jsx'
import PlanGrid from '../../src/components/PlanGrid.jsx'
import { buildGrid } from '../../src/plan.js'
import { useFlip, staggerDelay } from '../../src/motion.js'
import '../../src/styles.css'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') || 'edit'

const categories = [
  { id: 'c1', name: '유튜브', icon: '🎬', color: 'coral', parent_id: null, position: 0 },
  { id: 'c2', name: '기획', icon: '💡', color: 'teal', parent_id: null, position: 1 }
]
const slots = [{ id: 's1', name: '아침', icon: '🌅', position: 0 }]

// 공간(서랍). 375px 에서 칩 줄이 옆으로 넘치지 않는지 함께 재려고 최대치(5개)를 준다.
const spaces = [
  { key: 'personal', name: '개인', icon: '🏠', position: 1 },
  { key: 'class', name: '수업', icon: '🏫', position: 2 },
  { key: 'space-3', name: '연구회', icon: '🔬', position: 3 },
  { key: 'space-4', name: '동아리', icon: '🎨', position: 4 },
  { key: 'space-5', name: '개인 기록보관함', icon: '🗂', position: 5 }
]

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

/* 계획 격자 — 375px 에서 4칸짜리 표가 어떻게 접히는지 보는 화면.
   🔴 Plan 을 통째로 띄우지 않는다. 그것은 뜨자마자 Supabase 에 묻는데, 여기서 재려는 것은
      **레이아웃 하나**다 — DB 사정으로 흔들리면 안 된다. 그래서 조회를 하지 않는
      PlanGrid(순수)에 고정 자료를 얹는다 (src/components/PlanGrid.jsx 머리말).
   🔴 영역은 최대치(8개)를 준다. 세로축이 길어질수록 좁은 화면이 힘들어지므로,
      되면 그때 된다.
   제목을 일부러 길게 둔 줄이 있다: 110px 남짓한 칸에서 이름이 칸 밖으로 새는지가
   이 화면으로 재려는 것 중 하나다. */
if (mode === 'plan') {
  const planDomains = [
    { key: 'income', name: '수입', color: 'amber', position: 1 },
    { key: 'growth', name: '성장', color: 'purple', position: 2 },
    { key: 'health', name: '건강', color: 'green', position: 3 },
    { key: 'create', name: '창작', color: 'coral', position: 4 },
    { key: 'relation', name: '관계', color: 'pink', position: 5 },
    { key: 'life', name: '생활', color: 'teal', position: 6 },
    { key: 'domain-7', name: '봉사', color: 'blue', position: 7 },
    { key: 'domain-8', name: '아주 긴 영역 이름', color: 'gray', position: 8 }
  ]
  const mkPlan = (id, title, domain, horizon, plan_status, related_ids = []) => ({
    id, title, domain, horizon, plan_status, related_ids,
    plan_status_at: new Date(2026, 0, 1).toISOString(),
    created_at: new Date(2026, 0, 1).toISOString()
  })
  const planItems = [
    mkPlan('p1', '온라인 강의 하나 만들기', 'income', 'short', 'doing', ['x', 'y']),
    mkPlan('p2', '부수입 20만원', 'income', 'short', 'planned'),
    mkPlan('p3', '3년 안에 책 한 권', 'growth', 'long', 'planned'),
    mkPlan('p4', '주 3회 달리기 습관 들이기', 'health', 'short', 'doing'),
    mkPlan('p5', '올해 안에 개인전', 'create', 'mid', 'planned'),
    mkPlan('p6', '끝난 것', 'life', 'short', 'done')
  ]
  createRoot(document.getElementById('root')).render(
    <div className="archive">
      <div className="plan">
        <div className="plan-head">
          <h2 className="plan-title">🧭 계획</h2>
          <span className="plan-sum">진행 중 2 · 이번 주 완료 1</span>
          <button className="btn-ghost btn-sm plan-review-btn">📋 주간 리뷰</button>
        </div>
        <PlanGrid
          grid={buildGrid(planItems, planDomains)}
          domains={planDomains}
          onStatus={() => {}}
          onOpen={() => {}}
        />
      </div>
    </div>
  )
} else

/* 상단 헤더의 공간 전환기 — 375px 에서 헤더가 옆으로 밀리는지 보는 화면.
   🔴 Archive 를 통째로 띄우지 않는다(로그인·Supabase 를 흉내 내야 한다). 대신
      **전환기 컴포넌트 자체**를 헤더 자리에 그대로 얹는다 — 재려는 것은
      '로고 + 전환기 + 버튼들' 이 한 줄에 들어가는가 하나뿐이다.
   이름이 가장 긴 공간을 고른 상태로 띄운다: 밀린다면 그때 밀린다. */
if (mode === 'space') {
  function TopbarDemo() {
    const [cur, setCur] = React.useState('space-5')
    return (
      <div className="archive">
        <header className="topbar">
          <button type="button" className="brand">
            <span className="brand-mark" aria-hidden="true">A</span>
            <span className="brand-name">나의 아카이브</span>
          </button>
          <SpaceSwitcher spaces={spaces} current={cur} onSelect={setCur} onManage={() => {}} />
          <div className="topbar-actions">
            <button className="btn-primary">+ 새 항목</button>
            <button className="btn-ghost more-toggle">⋯</button>
          </div>
        </header>
      </div>
    )
  }
  createRoot(document.getElementById('root')).render(<TopbarDemo />)
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
    spaces={spaces}
    space="personal"
    userId="u1"
    onClose={() => {}}
    onSaved={() => {}}
  />
)

}
