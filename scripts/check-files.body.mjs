// scripts/check-files.mjs 가 esbuild 로 묶어 실행한다. 직접 node 로 돌리면 JSX 때문에 실패한다.
import { JSDOM, VirtualConsole } from 'jsdom'
import {
  fileRejectReason, storageKeyFor, originalNameFromKey, parseFiles, joinFiles,
  formatBytes, fileIcon, filePathsOf, totalFileBytes, splitByKind,
  imagePathFromUrl, MAX_FILES, FILE_MAX_BYTES,
  stripInvisible, saveErrorMessage, byteLength,
  SESSION_EXPIRED_MESSAGE, SAVE_FALLBACK_MESSAGE, DRAFT_DEBOUNCE_MS, DRAFT_MAX_BYTES
} from '../src/supabase.js'
import { store, resetStore } from './fake-supabase.mjs'

// a.click() 으로 내려받기를 흉내 낼 때 jsdom 이 '이동은 구현 안 됨' 을 찍는다. 판정과 무관하다.
const vc = new VirtualConsole()
vc.on('jsdomError', () => {})

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc
})
const { window } = dom
for (const k of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent',
  'KeyboardEvent', 'FocusEvent', 'Node', 'File', 'Blob', 'FileList', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage', 'localStorage']) {
  try { globalThis[k] = window[k] } catch { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }) }
}
globalThis.window = window
globalThis.IS_REACT_ACT_ENVIRONMENT = true
process.on('unhandledRejection', () => {})

// 점검은 네트워크 없이 돌아야 한다. 제목 자동 생성(noembed)이 바깥으로 나가면 판정이
// 연결 상태에 따라 흔들리고, 응답을 기다리는 동안 저장이 끝나지 않아 헛스침이 난다.
// fetchLinkTitle 은 실패하면 null 을 주고, 부르는 쪽은 주소나 본문으로 제목을 짓는다.
globalThis.fetch = async () => { throw new Error('점검 중에는 바깥으로 나가지 않는다') }

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const act = React.act ?? (await import('react-dom/test-utils')).act
const ItemModal = (await import('../src/components/ItemModal.jsx')).default
const Trash = (await import('../src/components/Trash.jsx')).default
const Settings = (await import('../src/components/Settings.jsx')).default
const { ToastProvider } = await import('../src/components/Toast.jsx')

// 초안 디바운스가 한 번 돌 만큼 기다린다. 링크가 늘어 효과가 한 번 더 도는 경우까지 본다.
const settle = (times = 2) => act(async () => {
  await new Promise((r) => setTimeout(r, DRAFT_DEBOUNCE_MS * times + 200))
})

let confirmAnswer = true
let lastConfirm = null
window.confirm = (m) => { lastConfirm = m; return confirmAnswer }

const checks = []
const check = (name, cond, extra) => checks.push({ name, ok: !!cond, extra })

const mk = (name, size, type = '') => ({ name, size, type })
const realFile = (name, bytes = 8, type = 'application/octet-stream') =>
  new window.File([new Uint8Array(bytes)], name, { type })

// ── 1. 확장자 화이트리스트 ───────────────────────────────────
{
  for (const ext of ['hwp', 'hwpx', 'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'zip']) {
    check(`허용: .${ext}`, fileRejectReason(mk(`보고서.${ext}`, 1024)) === null)
  }
  for (const bad of ['exe', 'sh', 'bat', 'js', 'dmg', 'msi']) {
    const why = fileRejectReason(mk(`무언가.${bad}`, 1024))
    check(`거부: .${bad}`, typeof why === 'string' && why.includes(`.${bad}`), why)
  }
  check('거부: 확장자 없음', fileRejectReason(mk('README', 10)) !== null)
  check('허용: 대문자 확장자(.PDF)', fileRejectReason(mk('보고서.PDF', 10)) === null)
  check('허용: 점이 여러 개인 이름', fileRejectReason(mk('2026.1학기.기말.hwp', 10)) === null)
  // 이미지는 파일 칸이 아니라 이미지 칸으로 간다(splitByKind). 파일 검증에서는 거부가 맞다.
  check('거부: 이미지 확장자', fileRejectReason(mk('screenshot.png', 10)) !== null)
}

// ── 2. 10MB 상한 ────────────────────────────────────────────
{
  const under = fileRejectReason(mk('딱맞음.pdf', FILE_MAX_BYTES))
  check('10MB 정확히는 통과', under === null, under)
  const over = fileRejectReason(mk('큰파일.pdf', FILE_MAX_BYTES + 1))
  check('10MB + 1바이트는 거부', over !== null, over)
  const big = fileRejectReason(mk('큰파일.pdf', Math.round(12.3 * 1024 * 1024)))
  check('거부 문구에 현재 용량', big === '10MB 이하만 첨부할 수 있습니다 (현재 12.3MB)', big)
  // 확장자를 용량보다 먼저 본다 — 100MB 짜리 exe 에 "10MB 이하만" 은 엉뚱한 안내다
  const exeBig = fileRejectReason(mk('설치.exe', 100 * 1024 * 1024))
  check('큰 exe 는 용량이 아니라 확장자로 거부', exeBig.includes('.exe'), exeBig)
}

// ── 3. 항목당 5개 ───────────────────────────────────────────
{
  check('4개 담긴 상태에서 1개 더 = 통과', fileRejectReason(mk('다섯.pdf', 10), 4) === null)
  const full = fileRejectReason(mk('여섯.pdf', 10), MAX_FILES)
  check('5개 담긴 상태에서 1개 더 = 거부', full === `파일은 최대 ${MAX_FILES}개까지예요`, full)
}

// ── 4. 한글 파일명 왕복 ─────────────────────────────────────
{
  const names = ['2026학년도 계획서.hwp', '학생 명단(최종).xlsx', '보고서 v2 – 수정.pdf', 'ㄱㄴㄷ.txt']
  for (const name of names) {
    const key = storageKeyFor('item-1', name, 1700000000000)
    check(`저장 키 모양: ${name}`, key === `item-1/1700000000000_${name}`, key)
    check(`평문 키 → 원본 이름: ${name}`, originalNameFromKey(key) === name, originalNameFromKey(key))
    const enc = storageKeyFor('item-1', name, 1700000000000, true)
    check(`인코딩 키에 비ASCII 없음: ${name}`, /^[\x20-\x7e]+$/.test(enc), enc)
    check(`인코딩 키 → 원본 이름: ${name}`, originalNameFromKey(enc) === name, originalNameFromKey(enc))
  }
  const slashy = storageKeyFor('item-1', '폴더/이름.pdf', 1)
  check('이름 속 / 는 폴더가 되지 않는다', slashy === 'item-1/1_폴더_이름.pdf', slashy)
  check('한글 이름의 아이콘', fileIcon('계획서.hwp') === '📘' && fileIcon('표.xlsx') === '📊')
}

// ── 5. 메타 파싱·합계 ───────────────────────────────────────
{
  const rows = [
    { path: 'a/1_가.pdf', name: '가.pdf', size: 100 },
    { path: 'a/1_가.pdf', name: '가.pdf', size: 100 }, // 중복 경로는 하나로
    { path: 'a/2_나.hwp', name: '나.hwp', size: 200 }
  ]
  const parsed = parseFiles(rows)
  check('중복 경로는 한 번만', parsed.length === 2, parsed.length)
  check('왕복해도 같다', JSON.stringify(joinFiles(parsed)) === JSON.stringify(parsed))
  check('문자열로 온 jsonb 도 읽는다', parseFiles(JSON.stringify(rows)).length === 2)
  check('열이 없으면 빈 목록', parseFiles(undefined).length === 0 && parseFiles(null).length === 0)
  check('이름이 없으면 키에서 되찾는다', parseFiles([{ path: 'a/3_다.txt' }])[0].name === '다.txt')
  check('용량 합계', totalFileBytes([{ files: rows }, { files: [{ path: 'b/4.txt', size: 5 }] }]) === 305)
  check('경로 목록', filePathsOf({ files: rows }).join() === 'a/1_가.pdf,a/2_나.hwp')
  check('용량 표기', formatBytes(0) === '0B' && formatBytes(2048) === '2KB' && formatBytes(12.3 * 1024 * 1024) === '12.3MB')
}

// ── 6. 이미지/파일 자동 라우팅 ──────────────────────────────
{
  const { images, docs } = splitByKind([
    mk('a.png', 1, 'image/png'), mk('b.hwp', 1), mk('c.HEIC', 1), mk('d.pdf', 1), mk('e', 1, 'image/webp')
  ])
  check('이미지 쪽: png·heic·type만 있는 것', images.map((f) => f.name).join() === 'a.png,c.HEIC,e', images.map((f) => f.name).join())
  check('파일 쪽: hwp·pdf', docs.map((f) => f.name).join() === 'b.hwp,d.pdf', docs.map((f) => f.name).join())
}

// ── 모달을 띄워 실제로 올리고 지워 본다 ──────────────────────
const q = (host, sel) => host.querySelector(sel)
const qa = (host, sel) => [...host.querySelectorAll(sel)]
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return { host, root }
}

async function attach(host, files, sel = '.file-input') {
  const input = q(host, sel)
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })) })
}

const filesBucket = () => store.buckets['archive-files']
const imagesBucket = () => store.buckets['archive-images']

// ── 7. 한글 이름 파일을 올리고 저장한다 ─────────────────────
{
  resetStore()
  window.sessionStorage.clear()
  let savedWarn = 'NOT CALLED'
  const { host, root } = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => {}, onSaved: (w) => { savedWarn = w ?? null }
  }))

  await attach(host, [realFile('2026학년도 계획서.hwp', 1234)])

  check('올린 파일이 1개', filesBucket().size === 1, filesBucket().size)
  const key = [...filesBucket().keys()][0]
  check('키가 {폴더}/{시각}_{원본명}', /^new-[^/]+\/\d+_2026학년도 계획서\.hwp$/.test(key), key)
  check('키에서 원본 이름이 되돌아온다', originalNameFromKey(key) === '2026학년도 계획서.hwp')
  check('화면에 원본 이름', q(host, '.file-name')?.textContent === '2026학년도 계획서.hwp', q(host, '.file-name')?.textContent)
  check('화면에 용량', q(host, '.file-size')?.textContent === '1KB', q(host, '.file-size')?.textContent)
  check('화면에 아이콘', q(host, '.file-icon')?.textContent === '📘')

  // 초안에는 파일이 들어가지 않는다 (파일은 임시 보존 대상 제외)
  // 초안은 입력이 멈춘 뒤에 쓰이므로 한 박자 기다린다
  await settle()
  const draft = JSON.parse(window.sessionStorage.getItem('ma:draft:new') || 'null')
  check('초안이 남는다(파일도 바뀜으로 친다)', !!draft)
  check('초안에 files 키가 없다', draft && !('files' in draft), draft && Object.keys(draft).join())

  // 내려받기: 서명 주소를 원본 이름으로 받는다
  await act(async () => { click(q(host, '.file-open')) })
  const signed = store.calls.signed.at(-1)
  check('내려받기가 서명 주소를 만든다', signed?.bucket === 'archive-files' && signed?.path === key)
  check('원본 이름으로 저장되게 요청한다', signed?.download === '2026학년도 계획서.hwp', signed?.download)

  // 제목을 비운 채 저장 → 첫 파일 이름이 제목이 된다
  await act(async () => { click(q(host, '.btn-primary')) })
  const row = store.rows.items[0]
  check('저장된 항목이 1개', store.rows.items.length === 1, store.rows.items.length)
  // 제목 자동 생성에 파일 이름은 쓰지 않는다(사양 밖이라 뺐다).
  // 링크도 내용도 이미지도 없으면 예전처럼 '메모 YYYY-MM-DD' 다.
  check('제목에 파일 이름을 쓰지 않는다', /^메모 \d{4}-\d{2}-\d{2}$/.test(row?.title ?? ''), row?.title)
  check('files 에 메타 3가지만', JSON.stringify(row?.files) === JSON.stringify([{ path: key, name: '2026학년도 계획서.hwp', size: 1234 }]), JSON.stringify(row?.files))
  check('저장 뒤에도 스토리지에 남아 있다', filesBucket().has(key))
  check('저장 뒤 초안은 지워진다', window.sessionStorage.getItem('ma:draft:new') === null)
  check('경고 없이 저장됐다', savedWarn === null, savedWarn)
  act(() => { root.unmount() })
}

// ── 8. 저장하지 않고 닫으면 고아가 남지 않는다 ──────────────
{
  resetStore()
  window.sessionStorage.clear()
  const { host, root } = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => {}, onSaved: () => {}
  }))

  await attach(host, [
    realFile('계획서.hwp', 100),
    realFile('붙임.png', 50, 'image/png') // 같은 칸에 떨어뜨려도 이미지는 이미지 쪽으로
  ])
  check('파일 1개 · 이미지 1장으로 갈렸다', filesBucket().size === 1 && imagesBucket().size === 1,
    `${filesBucket().size}/${imagesBucket().size}`)
  check('이미지는 이미지 목록에 들어간다', qa(host, '.img-thumb-open').length === 1)

  await act(async () => { click(q(host, '.modal-head .btn-ghost')) }) // ✕ 로 닫기
  check('닫으면 파일 고아 0', filesBucket().size === 0, [...filesBucket().keys()].join())
  check('닫으면 이미지 고아 0', imagesBucket().size === 0, [...imagesBucket().keys()].join())
  check('항목은 만들어지지 않았다', store.rows.items.length === 0)

  const draft = JSON.parse(window.sessionStorage.getItem('ma:draft:new') || 'null')
  check('초안이 지워진 파일을 가리키지 않는다', !draft || (draft.images ?? []).length === 0,
    draft && JSON.stringify(draft.images))
  act(() => { root.unmount() })
}

// ── 8-b. 닫기 확인 문구가 첨부도 사라진다고 알린다 ──────────
{
  // ① 첨부가 있을 때
  resetStore()
  window.sessionStorage.clear()
  lastConfirm = null
  let closed = 0
  let m = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => { closed++ }, onSaved: () => {}
  }))
  await attach(m.host, [realFile('계획서.hwp', 10)])

  confirmAnswer = false
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })) })
  check('Esc: 첨부가 사라진다고 적는다', (lastConfirm ?? '').includes('첨부한 이미지/파일도 함께 삭제됩니다'), lastConfirm)
  check('Esc: 취소하면 안 닫힌다', closed === 0, closed)
  check('Esc: 취소하면 첨부도 그대로', filesBucket().size === 1, filesBucket().size)

  confirmAnswer = true
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })) })
  check('Esc: 그렇다고 하면 닫힌다', closed === 1, closed)
  check('Esc: 그때 첨부가 지워진다', filesBucket().size === 0, filesBucket().size)
  act(() => { m.root.unmount() })

  // ② 첨부가 없을 때는 예전 문구 그대로
  resetStore()
  window.sessionStorage.clear()
  lastConfirm = null
  m = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => {}, onSaved: () => {}
  }))
  const titleInput = m.host.querySelector('input')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(titleInput, '글만 씀')
    titleInput.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  confirmAnswer = true
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })) })
  check('Esc: 첨부가 없으면 첨부 이야기를 하지 않는다', !(lastConfirm ?? '').includes('첨부한'), lastConfirm)
  check('Esc: 그래도 물어보기는 한다', (lastConfirm ?? '').includes('작성 중인 내용이 있습니다'), lastConfirm)
  act(() => { m.root.unmount() })
}

// ── 9. ✕ 로 뺀 새 파일은 그 자리에서 지워진다 ───────────────
{
  resetStore()
  window.sessionStorage.clear()
  const { host, root } = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => {}, onSaved: () => {}
  }))
  await attach(host, [realFile('가.pdf', 10), realFile('나.pdf', 10)])
  check('두 개 올라감', filesBucket().size === 2, filesBucket().size)
  await act(async () => { click(qa(host, '.file-row .link-x')[0]) })
  check('✕ 로 뺀 것은 스토리지에서도 사라진다', filesBucket().size === 1, filesBucket().size)
  check('화면에는 한 줄만 남는다', qa(host, '.file-row').length === 1)
  act(() => { root.unmount() })
}

// ── 9-b. '새로 쓰기' 로 초안을 버려도 고아가 남지 않는다 ────
{
  resetStore()
  window.sessionStorage.clear()
  // 되살릴 초안을 미리 심어 둔다(새로고침 흉내). 그래야 '새로 쓰기' 버튼이 뜬다.
  window.sessionStorage.setItem('ma:draft:new', JSON.stringify({
    title: '쓰던 제목', content: '', links: [], linkInput: '', tagsText: '',
    categoryIds: [], status: 'none', dueDate: '', slotId: null, images: [], splitMode: false
  }))
  const { host, root } = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => {}, onSaved: () => {}
  }))
  check('되살렸다는 안내가 뜬다', host.textContent.includes('작성 중이던 내용을 되살렸어요'))
  await attach(host, [realFile('가.pdf', 10), realFile('나.png', 10, 'image/png')])
  check('준비: 파일 1 · 이미지 1', filesBucket().size === 1 && imagesBucket().size === 1)
  await act(async () => { click(q(host, '.draft-note button')) }) // 새로 쓰기
  check('새로 쓰기: 파일 고아 0', filesBucket().size === 0, [...filesBucket().keys()].join())
  check('새로 쓰기: 이미지 고아 0', imagesBucket().size === 0, [...imagesBucket().keys()].join())
  check('새로 쓰기: 화면에서도 비었다', qa(host, '.file-row').length === 0)
  act(() => { root.unmount() })
}

// ── 10. 이미 붙어 있던 파일은 취소하면 지워지지 않는다 ──────
{
  resetStore()
  window.sessionStorage.clear()
  const kept = { path: 'it1/1_기존.pdf', name: '기존.pdf', size: 7 }
  filesBucket().set(kept.path, { size: 7 })
  const item = {
    id: 'it1', title: '기존 항목', content: '', link_url: null, image_url: null,
    tags: [], status: 'none', due_date: null, slot_id: null, category_id: null, files: [kept]
  }
  const { host, root } = mount(React.createElement(ItemModal, {
    item, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  check('기존 파일이 목록에 뜬다', q(host, '.file-name')?.textContent === '기존.pdf')
  await act(async () => { click(q(host, '.file-row .link-x')) })
  check('✕ 를 눌러도 아직 스토리지에 있다', filesBucket().has(kept.path))
  confirmAnswer = true
  await act(async () => { click(q(host, '.modal-foot-right .btn-ghost')) }) // 취소
  check('취소하면 기존 파일은 그대로', filesBucket().has(kept.path))
  act(() => { root.unmount() })
}

// ── 11. 저장하면 뺀 기존 파일이 그때 지워진다 ───────────────
{
  resetStore()
  window.sessionStorage.clear()
  const kept = { path: 'it1/1_기존.pdf', name: '기존.pdf', size: 7 }
  filesBucket().set(kept.path, { size: 7 })
  store.rows.items.push({ id: 'it1', title: '기존 항목', files: [kept] })
  const item = {
    id: 'it1', title: '기존 항목', content: '', link_url: null, image_url: null,
    tags: [], status: 'none', due_date: null, slot_id: null, category_id: null, files: [kept]
  }
  const { host, root } = mount(React.createElement(ItemModal, {
    item, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  await act(async () => { click(q(host, '.file-row .link-x')) })
  await act(async () => { click(q(host, '.btn-primary')) })
  check('저장하면 뺀 파일이 지워진다', filesBucket().size === 0, [...filesBucket().keys()].join())
  check('항목의 files 도 비었다', JSON.stringify(store.rows.items[0].files) === '[]', JSON.stringify(store.rows.items[0].files))
  act(() => { root.unmount() })
}

// ── 12. files 열이 없는 DB (setup.sql 미실행) ───────────────
{
  resetStore()
  window.sessionStorage.clear()
  store.missingFilesColumn = true
  let warn = 'NOT CALLED'
  const { host, root } = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => {}, onSaved: (w) => { warn = w ?? null }
  }))
  await attach(host, [realFile('계획서.hwp', 10)])
  await act(async () => { click(q(host, '.btn-primary')) })
  check('열이 없어도 항목은 저장된다', store.rows.items.length === 1, store.rows.items.length)
  check('files 없이 저장됐다', store.rows.items[0] && !('files' in store.rows.items[0]))
  check('사람에게 setup.sql 실행을 알린다', typeof warn === 'string' && warn.includes('setup.sql'), warn)
  act(() => { root.unmount() })
}

// ── 13. 영구 삭제 뒤 고아가 남지 않는다 ─────────────────────
{
  resetStore()
  const pub = (p) => `https://fake.local/storage/v1/object/public/archive-images/${encodeURI(p)}`
  const mkItem = (id, n) => {
    const files = [
      { path: `${id}/1_가${n}.pdf`, name: `가${n}.pdf`, size: 10 },
      { path: `${id}/2_나${n}.hwp`, name: `나${n}.hwp`, size: 20 }
    ]
    for (const f of files) filesBucket().set(f.path, { size: f.size })
    const imgPath = `u1/${n}-shot.png`
    imagesBucket().set(imgPath, { size: 5 })
    return {
      id,
      title: `항목 ${n}`,
      deleted_at: '2026-08-20T00:00:00.000Z',
      files,
      // 우리 버킷 이미지 한 장 + 유튜브 썸네일 한 장. 뒤엣것은 지울 대상이 아니다.
      image_url: [pub(imgPath), 'https://img.youtube.com/vi/abc/hqdefault.jpg'].join('\n')
    }
  }
  store.rows.items.push(mkItem('itA', 1), mkItem('itB', 2), mkItem('itC', 3))
  check('준비: 파일 6개 · 이미지 3장', filesBucket().size === 6 && imagesBucket().size === 3,
    `${filesBucket().size}/${imagesBucket().size}`)

  const { host, root } = mount(React.createElement(Trash, { onClose: () => {}, onChanged: () => {} }))
  await act(async () => {}) // 목록 불러오기

  check('휴지통에 3줄', qa(host, '.trash-row').length === 3, qa(host, '.trash-row').length)

  confirmAnswer = true
  await act(async () => { click(qa(host, '.trash-row')[1].querySelector('.cm-del')) })
  check('한 건 영구 삭제 → 그 항목 파일만 사라진다', filesBucket().size === 4, filesBucket().size)
  check('지운 항목의 파일이 없다', ![...filesBucket().keys()].some((k) => k.startsWith('itB/')))
  check('남은 항목의 파일은 그대로', ['itA/1_가1.pdf', 'itA/2_나1.hwp', 'itC/1_가3.pdf', 'itC/2_나3.hwp']
    .every((k) => filesBucket().has(k)))
  check('한 건 영구 삭제 → 그 항목 이미지도 사라진다', imagesBucket().size === 2, imagesBucket().size)
  check('지운 항목의 이미지가 없다', !imagesBucket().has('u1/2-shot.png'))
  check('남은 항목의 이미지는 그대로', imagesBucket().has('u1/1-shot.png') && imagesBucket().has('u1/3-shot.png'))

  await act(async () => { click(q(host, '.trash-top .btn-danger')) }) // 전부 비우기
  check('전부 비우기 → 파일 고아 0', filesBucket().size === 0, [...filesBucket().keys()].join())
  check('전부 비우기 → 이미지 고아 0', imagesBucket().size === 0, [...imagesBucket().keys()].join())
  check('행도 남지 않는다', store.rows.items.length === 0, store.rows.items.length)
  // 유튜브 썸네일은 우리 버킷 밖이라 지울 목록에 들지 않는다
  const removedImages = store.calls.remove.filter((c) => c.bucket === 'archive-images').flatMap((c) => c.paths)
  check('바깥 주소(유튜브 썸네일)는 지우려 들지 않는다',
    !removedImages.some((p) => p.includes('youtube')), removedImages.join(' '))
  act(() => { root.unmount() })
}

// ── 14. 저장소 사용량 게이지 ────────────────────────────────
{
  const GB = 1024 * 1024 * 1024
  const settings = (onClose) => React.createElement(Settings, {
    email: 'a@b.c', themePref: 'system', onThemeChange: () => {}, onOpenPricing: () => {}, onClose
  })

  // ① 조금 썼을 때
  resetStore()
  store.rows.items.push({ id: 'i1', files: [{ path: 'a/1_가.pdf', name: '가.pdf', size: 12.3 * 1024 * 1024 }] })
  let m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: 쓴 용량을 보여 준다', q(m.host, '.set-value')?.textContent.includes('파일 12.3MB / 1GB'),
    q(m.host, '.set-value')?.textContent)
  check('게이지: 80% 아래는 주황이 아니다', !q(m.host, '.gauge-fill')?.classList.contains('gauge-warn'))
  act(() => { m.root.unmount() })

  // ② 80% 를 넘었을 때
  resetStore()
  store.rows.items.push({ id: 'i1', files: [{ path: 'a/1_큰.zip', name: '큰.zip', size: Math.round(GB * 0.85) }] })
  m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: 80% 넘으면 주황', q(m.host, '.gauge-fill')?.classList.contains('gauge-warn'))
  check('게이지: 넘었다고 적는다', m.host.textContent.includes('80% 를 넘었어요'))
  act(() => { m.root.unmount() })

  // ③ files 열이 없는 DB 면 게이지를 숨긴다 (0MB 로 보이면 '아직 안 썼다' 로 읽힌다)
  resetStore()
  store.missingFilesColumn = true
  m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: files 열이 없으면 숨는다', q(m.host, '.gauge') === null)
  check('게이지: 그래도 나머지 설정은 그대로 뜬다', m.host.textContent.includes('화면 테마'))
  act(() => { m.root.unmount() })
  resetStore()
}

// ── 15. 공개 URL ↔ 스토리지 경로 ────────────────────────────
{
  check('우리 이미지 URL 에서 경로를 되찾는다',
    imagePathFromUrl('https://x.co/storage/v1/object/public/archive-images/u1/1-ab.png') === 'u1/1-ab.png')
  check('유튜브 썸네일은 우리 것이 아니다',
    imagePathFromUrl('https://img.youtube.com/vi/abc/hqdefault.jpg') === null)
  check('한글이 든 경로도 되돌린다',
    imagePathFromUrl('https://x.co/storage/v1/object/public/archive-images/u1/%EA%B0%80.png') === 'u1/가.png')
}

// ── 16. 제목 없이 글만 있는 항목 ────────────────────────────
// 제목을 비운 채 저장하면 본문에서 제목을 지어 준다. 그 본문이 빈 줄이나 공백으로
// 시작해도 제목이 비면 안 된다 — 목록에서 그 줄을 다시 알아볼 길이 없어진다.
{
  const setText = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  const 날짜꼴 = /^메모 \d{4}-\d{2}-\d{2}$/

  // 본문만 넣고 저장한 뒤 저장된 행을 돌려준다
  async function saveWithBody(body, attachFile = null) {
    resetStore()
    window.sessionStorage.clear()
    const { host, root } = mount(React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1',
      onClose: () => {}, onSaved: () => {}
    }))
    await act(async () => { setText(q(host, 'textarea'), body) })
    if (attachFile) await attach(host, [attachFile])
    const disabled = !!q(host, '.btn-primary')?.disabled
    await act(async () => { click(q(host, '.btn-primary')) })
    const row = store.rows.items[0] ?? null
    act(() => { root.unmount() })
    return { row, disabled }
  }

  // ① 빈 줄 두 개로 시작하는 본문
  {
    const { row } = await saveWithBody('\n\n텍스트가 여기서 시작합니다\n둘째 줄')
    check('빈 줄로 시작: 저장된다', !!row, row?.title)
    check('빈 줄로 시작: 제목이 비지 않는다', (row?.title ?? '').trim().length > 0, JSON.stringify(row?.title))
    check('빈 줄로 시작: 첫 글자부터 제목', row?.title === '텍스트가 여기서 시작합니다', row?.title)
    check('빈 줄로 시작: 제목에 개행이 없다', !(row?.title ?? '').includes('\n'), JSON.stringify(row?.title))
    check('빈 줄로 시작: 본문은 원문 그대로', row?.content === '\n\n텍스트가 여기서 시작합니다\n둘째 줄')
  }

  // ② 공백·탭이 앞에 붙은 본문. 첫 줄이 짧아 20자가 줄바꿈을 넘어가는 경우이기도 하다.
  {
    const { row } = await saveWithBody('   \t 들여쓴 첫 줄\n다음 줄은 제목에 들어오면 안 된다')
    check('공백으로 시작: 저장된다', !!row, row?.title)
    check('공백으로 시작: 제목이 비지 않는다', (row?.title ?? '').trim().length > 0, JSON.stringify(row?.title))
    check('공백으로 시작: 앞 공백이 떨어진다', row?.title === '들여쓴 첫 줄', JSON.stringify(row?.title))
    check('공백으로 시작: 다음 줄을 끌어오지 않는다', !(row?.title ?? '').includes('다음 줄'), row?.title)
  }

  // ③ 본문이 통째로 공백. 이것만으로는 저장 자체가 막히는 것이 사양이라(제목·링크·내용·
  //    이미지·파일 중 하나는 있어야 한다), 파일을 하나 붙여 저장이 되는 상태로 만든 뒤
  //    제목이 다음 후보로 넘어가는지 본다.
  {
    // 담긴 게 하나도 없으면 저장 버튼 자체가 눌리지 않는다(handleSave 의 같은 검사는 예비다)
    const { row, disabled } = await saveWithBody('   \n\n \t \n  ')
    check('공백뿐: 저장 버튼이 잠긴다', disabled, disabled)
    check('공백뿐: 저장되지 않는다', row === null, JSON.stringify(row?.title))
  }
  {
    const { row } = await saveWithBody('   \n\n \t \n  ', realFile('붙임.pdf', 10))
    check('공백뿐 + 파일: 저장된다', !!row, row?.title)
    check('공백뿐 + 파일: 제목이 비지 않는다', (row?.title ?? '').trim().length > 0, JSON.stringify(row?.title))
    check('공백뿐 + 파일: 메모 날짜로 넘어간다', 날짜꼴.test(row?.title ?? ''), JSON.stringify(row?.title))
  }

  // ④ 제목 칸에 공백만 쳐 둔 경우도 그 공백이 제목이 되면 안 된다
  {
    resetStore()
    window.sessionStorage.clear()
    const { host, root } = mount(React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1',
      onClose: () => {}, onSaved: () => {}
    }))
    const titleInput = q(host, '.field input') // 모달에서 첫 번째로 나오는 입력칸이 제목이다
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      setter.call(titleInput, '   ')
      titleInput.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await act(async () => { setText(q(host, 'textarea'), '\n  본문 첫 줄') })
    await act(async () => { click(q(host, '.btn-primary')) })
    const row = store.rows.items[0]
    check('제목 칸이 공백뿐: 본문에서 지어 준다', row?.title === '본문 첫 줄', JSON.stringify(row?.title))
    act(() => { root.unmount() })
  }

  resetStore()
}

// ── 17. 저장 실패 문구: 원인마다 다르게 ─────────────────────
// "네트워크와 Supabase 설정을 확인해 주세요" 한 줄로 뭉뚱그리면, 실제로는 로그인이
// 풀린 것이어도 사람은 와이파이를 쳐다본다. 포괄 문구는 최후 폴백으로만 나와야 한다.
{
  const rls = { code: '42501', message: 'new row violates row-level security policy for table "items"' }
  check('오류 문구: RLS 거부 = 로그인 만료', saveErrorMessage(rls) === SESSION_EXPIRED_MESSAGE, saveErrorMessage(rls))
  check('오류 문구: 401', saveErrorMessage({ status: 401, message: 'Unauthorized' }) === SESSION_EXPIRED_MESSAGE)
  check('오류 문구: JWT 만료', saveErrorMessage({ code: 'PGRST301', message: 'JWT expired' }) === SESSION_EXPIRED_MESSAGE)
  check('오류 문구: 만료 문구가 작성 내용은 남는다고 말한다', SESSION_EXPIRED_MESSAGE.includes('작성 내용은 유지'))

  const nul = saveErrorMessage({ code: '22P05', message: 'unsupported Unicode escape sequence' })
  check('오류 문구: 22P05 는 문자 문제로 말한다', nul.includes('보이지 않는 문자'), nul)
  check('오류 문구: 22P05 에 포괄 문구를 쓰지 않는다', !nul.includes('네트워크'), nul)

  const empty = saveErrorMessage({ code: '23502', message: 'null value in column "title" violates not-null constraint' })
  check('오류 문구: 빈 제목', empty.includes('제목'), empty)

  const unknown = saveErrorMessage({ code: 'XX999', message: 'something odd happened' })
  check('오류 문구: 모르는 오류는 원문과 코드를 붙인다',
    unknown.includes('something odd happened') && unknown.includes('XX999'), unknown)
  check('오류 문구: 연결 실패', saveErrorMessage({ message: 'Failed to fetch' }).includes('연결 상태'),
    saveErrorMessage({ message: 'Failed to fetch' }))
  check('오류 문구: 포괄 문구는 코드도 메시지도 없을 때만', saveErrorMessage({}) === SAVE_FALLBACK_MESSAGE,
    saveErrorMessage({}))
}

// ── 18. 로그인이 풀린 채로 저장 → 토스트로 그렇게 말한다 ────
{
  resetStore()
  window.sessionStorage.clear()
  // 로그인이 풀리면 Supabase 는 RLS 거부(42501)로 답한다. 로그인하지 않은 채 저장해도 같다.
  store.itemsError = { code: '42501', message: 'new row violates row-level security policy for table "items"' }

  let savedCalls = 0
  const { host, root } = mount(React.createElement(ToastProvider, null,
    React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1',
      onClose: () => {}, onSaved: () => { savedCalls++ }
    })
  ))
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  await act(async () => { setInput(q(host, '.field input'), '로그인 풀린 채로 쓴 메모') })
  await settle(1) // 초안이 한 번 저장될 시간을 준다
  await act(async () => { click(q(host, '.btn-primary')) })

  const toasts = qa(host, '.toast-text').map((n) => n.textContent).join(' | ')
  check('비로그인 저장: 토스트가 뜬다', qa(host, '.toast').length > 0, toasts)
  check('비로그인 저장: 로그인이 만료됐다고 말한다', toasts.includes('로그인이 만료됐습니다'), toasts)
  check('비로그인 저장: 작성 내용은 유지된다고 말한다', toasts.includes('작성 내용은 유지'), toasts)
  check('비로그인 저장: 포괄 문구를 쓰지 않는다', !toasts.includes('네트워크와 Supabase'), toasts)
  check('비로그인 저장: 모달 안에도 같은 줄', (q(host, '.form-error')?.textContent ?? '').includes('로그인이 만료됐습니다'),
    q(host, '.form-error')?.textContent)
  check('비로그인 저장: 모달이 닫히지 않는다', savedCalls === 0 && !!q(host, '.modal'), savedCalls)
  check('비로그인 저장: 아무 것도 저장되지 않았다', store.rows.items.length === 0, store.rows.items.length)
  check('비로그인 저장: 쓰던 제목이 화면에 남아 있다', q(host, '.field input')?.value === '로그인 풀린 채로 쓴 메모',
    q(host, '.field input')?.value)
  const draft = JSON.parse(window.sessionStorage.getItem('ma:draft:new') || 'null')
  check('비로그인 저장: 초안도 남아 있다', draft?.title === '로그인 풀린 채로 쓴 메모', JSON.stringify(draft?.title))
  check('비로그인 저장: 저장 버튼이 다시 눌린다', q(host, '.btn-primary')?.disabled === false)

  act(() => { root.unmount() })
  store.itemsError = null
}

// ── 18-b. 링크 분리 모드: 실패한 링크를 화면에 적는다 ───────
{
  resetStore()
  window.sessionStorage.clear()
  const { host, root } = mount(React.createElement(ToastProvider, null,
    React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1',
      onClose: () => {}, onSaved: () => {}
    })
  ))
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  const linkInput = q(host, 'input[aria-label="링크 추가"]')
  await act(async () => { setInput(linkInput, 'https://a.example/1 https://b.example/2') })
  await act(async () => { click(qa(host, '.link-add button')[0]) })
  check('분리 모드 준비: 링크 2개', qa(host, '.link-row').length === 2, qa(host, '.link-row').length)
  // '링크마다 개별 항목' 을 고른다 (두 번째 라디오)
  await act(async () => { click(qa(host, '.split-opt input')[1]) })

  // 두 건 다 실패시킨다 → 한 건도 못 만들었으므로 모달은 열린 채 이유를 말해야 한다
  store.itemsError = { code: '42501', message: 'row-level security' }
  await act(async () => { click(q(host, '.btn-primary')) })
  let toasts = qa(host, '.toast-text').map((n) => n.textContent).join(' | ')
  check('분리 모드: 전부 실패하면 이유를 말한다', toasts.includes('로그인이 만료됐습니다'), toasts)
  check('분리 모드: 전부 실패하면 모달이 닫히지 않는다', !!q(host, '.modal'))
  check('분리 모드: 전부 실패하면 "한 건도" 같은 뭉뚱그린 말만 남지 않는다',
    (q(host, '.form-error')?.textContent ?? '').includes('로그인이 만료됐습니다'), q(host, '.form-error')?.textContent)

  act(() => { root.unmount() })
  store.itemsError = null
}

// ── 18-c. 분리 모드에서 한 건만 실패하면 그 링크를 적는다 ───
{
  resetStore()
  window.sessionStorage.clear()
  let warn = 'NOT CALLED'
  const { host, root } = mount(React.createElement(ToastProvider, null,
    React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1',
      onClose: () => {}, onSaved: (w) => { warn = w ?? null }
    })
  ))
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  await act(async () => { setInput(q(host, 'input[aria-label="링크 추가"]'), 'https://ok.example/1 https://bad.example/2') })
  await act(async () => { click(qa(host, '.link-add button')[0]) })
  await act(async () => { click(qa(host, '.split-opt input')[1]) })

  // 두 번째 링크로 만든 행만 튕긴다
  store.itemsError = (row) => (
    String(row?.link_url ?? '').includes('bad.example')
      ? { code: '22P05', message: 'unsupported Unicode escape sequence' }
      : null
  )
  await act(async () => { click(q(host, '.btn-primary')) })
  store.itemsError = null

  const toasts = qa(host, '.toast-text').map((t) => t.textContent).join(' | ')
  check('분리 모드: 한 건 실패도 화면에 뜬다', toasts.includes('1개 실패'), toasts)
  check('분리 모드: 실패한 링크 주소를 적는다', toasts.includes('bad.example'), toasts)
  check('분리 모드: 실패 이유도 적는다', toasts.includes('보이지 않는 문자'), toasts)
  check('분리 모드: 성공한 한 건은 저장됐다', store.rows.items.length === 1, store.rows.items.length)
  check('분리 모드: 성공했으므로 모달은 닫힌다', warn === null, warn)
  act(() => { root.unmount() })
}

// ── 19. 보이지 않는 문자 정리 ───────────────────────────────
{
  // ① 순수 함수
  const plain = '보통 글\n둘째 줄\t탭'
  check('정리: 멀쩡한 글은 그대로', stripInvisible(plain).text === plain && stripInvisible(plain).removed === 0)
  check('정리: 탭과 줄바꿈은 남는다', stripInvisible('가\t나\n다\r라').removed === 0)
  const dirty = stripInvisible('가\u0000나\u0001다\u001F라')
  check('정리: NUL·제어문자를 턴다', dirty.text === '가나다라' && dirty.removed === 3, `${dirty.text}/${dirty.removed}`)
  const pair = stripInvisible('웃음 🙂 유지')
  check('정리: 이모지(서로게이트 짝)는 살린다', pair.text === '웃음 🙂 유지' && pair.removed === 0, pair.text)
  const lone = stripInvisible('앞 \ud800 뒤')
  check('정리: 짝 없는 서로게이트는 턴다', lone.text === '앞  뒤' && lone.removed === 1, `${lone.text}/${lone.removed}`)
  check('정리: 빈 값도 견딘다', stripInvisible(null).text === '' && stripInvisible(undefined).removed === 0)
  check('바이트 세기: 한글은 3바이트', byteLength('가') === 3 && byteLength('a') === 1)

  // ② 실제 저장 경로 — NUL 이 섞인 글을 붙여넣고 저장한다
  resetStore()
  window.sessionStorage.clear()
  const { host, root } = mount(React.createElement(ToastProvider, null,
    React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1',
      onClose: () => {}, onSaved: () => {}
    })
  ))
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  const setArea = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  // NUL + 제어문자 + 짝 없는 서로게이트 = 본문 3개, 태그 1개
  await act(async () => { setArea(q(host, 'textarea'), '\u0000첫 줄\u0001입니다 🙂\n둘째 줄\ud800') })
  await act(async () => { setInput(qa(host, '.field input')[2], '태그\u0007A, 태그B') })
  await act(async () => { click(q(host, '.btn-primary')) })

  const row = store.rows.items[0]
  const toasts = qa(host, '.toast-text').map((t) => t.textContent).join(' | ')
  check('NUL: 저장된다', !!row, JSON.stringify(row?.title))
  check('NUL: 몇 개를 정리했는지 알린다', toasts.includes('보이지 않는 문자 4개를 정리했습니다'), toasts)
  check('NUL: 본문에 제어문자가 남지 않는다', !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(row?.content ?? ''),
    JSON.stringify(row?.content))
  check('NUL: 짝 없는 서로게이트도 없다',
    !/[\ud800-\udfff]/.test((row?.content ?? '').replace(/[\ud800-\udbff][\udc00-\udfff]/g, '')), JSON.stringify(row?.content))
  check('NUL: 이모지는 살아남는다', (row?.content ?? '').includes('🙂'), JSON.stringify(row?.content))
  check('NUL: 본문 글자는 그대로', row?.content === '첫 줄입니다 🙂\n둘째 줄', JSON.stringify(row?.content))
  check('NUL: 자동 제목도 깨끗하다', row?.title === '첫 줄입니다 🙂', JSON.stringify(row?.title))
  check('NUL: 태그도 턴다', (row?.tags ?? []).join() === '태그A,태그B', JSON.stringify(row?.tags))
  act(() => { root.unmount() })
}

// ── 20. 초안 디바운스와 1MB 상한 ────────────────────────────
{
  resetStore()
  window.sessionStorage.clear()
  const { host, root } = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1',
    onClose: () => {}, onSaved: () => {}
  }))
  const ta = q(host, 'textarea')
  const setArea = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }

  // 초안 쓰기 횟수를 센다.
  // jsdom 의 sessionStorage 는 Proxy 라 인스턴스에 setItem 을 덮어써 봐야 'setItem' 이라는
  // 항목이 하나 저장될 뿐이다. 프로토타입 쪽 메서드를 갈아 끼워야 실제로 가로채진다.
  let writes = 0
  const storageProto = Object.getPrototypeOf(window.sessionStorage)
  const realSet = storageProto.setItem
  storageProto.setItem = function (k, v) {
    if (String(k).startsWith('ma:draft')) writes++
    return realSet.call(this, k, v)
  }

  // ① 10만 자를 이어 치는 동안에는 한 번도 쓰지 않는다
  const base = '가'.repeat(100000)
  const t0 = Date.now()
  for (let i = 0; i < 20; i++) await act(async () => { setArea(ta, base + '나'.repeat(i + 1)) })
  const typingMs = Date.now() - t0
  check('디바운스: 치는 동안에는 초안을 쓰지 않는다', writes === 0, writes)
  check('디바운스: 10만 자에 20번 입력이 3초 안에 끝난다', typingMs < 3000, `${typingMs}ms`)

  await settle(1)
  check('디바운스: 멈추면 그때 한 번 쓴다', writes === 1, writes)
  const draft = JSON.parse(window.sessionStorage.getItem('ma:draft:new') || 'null')
  check('디바운스: 마지막으로 친 값이 담긴다', draft?.content === base + '나'.repeat(20), draft?.content?.length)

  // ② 본문에 적은 URL 도 같은 박자로 링크 목록에 오른다
  await act(async () => { setArea(ta, '본문에 붙여넣은 https://late.example/z 링크') })
  check('디바운스: 치는 순간에는 아직 링크가 안 뜬다', qa(host, '.link-row').length === 0, qa(host, '.link-row').length)
  await settle(2)
  check('디바운스: 멈추면 본문의 URL 이 링크 목록에 오른다', qa(host, '.link-row').length === 1, qa(host, '.link-row').length)

  // ②-b 멈추기 전에 저장을 눌러도 본문의 링크를 잃지 않는다
  {
    resetStore()
    window.sessionStorage.clear() // 같은 초안 키('ma:draft:new')를 쓰므로 앞 단계와 섞이지 않게 비운다
    const m = mount(React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1',
      onClose: () => {}, onSaved: () => {}
    }))
    const area = q(m.host, 'textarea')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(area, '급히 적고 바로 저장 https://hurry.example/9')
      area.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await act(async () => { click(q(m.host, '.btn-primary')) }) // 디바운스 전에 저장
    check('디바운스: 멈추기 전에 저장해도 본문의 링크가 담긴다',
      (store.rows.items[0]?.link_url ?? '').includes('hurry.example/9'), store.rows.items[0]?.link_url)
    act(() => { m.root.unmount() })
  }

  // ②-c ✕ 로 뺀 링크는 저장할 때 본문에서 되살아나지 않는다
  {
    resetStore()
    window.sessionStorage.clear()
    const m = mount(React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1',
      onClose: () => {}, onSaved: () => {}
    }))
    const area = q(m.host, 'textarea')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(area, '본문에 남겨 둔 https://unwanted.example/1 주소')
      area.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await settle(2)
    check('준비: 본문의 링크가 목록에 올랐다', qa(m.host, '.link-row').length === 1, qa(m.host, '.link-row').length)
    await act(async () => { click(q(m.host, '.link-row .link-x')) })
    await act(async () => { click(q(m.host, '.btn-primary')) })
    check('뺀 링크는 저장 때 되살아나지 않는다', store.rows.items[0]?.link_url === null, store.rows.items[0]?.link_url)
    check('본문은 그대로 남는다', (store.rows.items[0]?.content ?? '').includes('unwanted.example'), '')
    act(() => { m.root.unmount() })
    window.sessionStorage.clear()
  }

  // ③ 50만 자(1MB 초과) 는 초안을 건너뛰고 그 사실을 알린다
  const huge = '가'.repeat(500000)
  check('상한: 50만 자는 1MB 를 넘는다', byteLength(huge) > DRAFT_MAX_BYTES, byteLength(huge))
  const before = writes
  const t1 = Date.now()
  await act(async () => { setArea(ta, huge) })
  for (let i = 0; i < 10; i++) await act(async () => { setArea(ta, huge + '나'.repeat(i + 1)) })
  const hugeMs = Date.now() - t1
  await settle(2)
  check('상한: 1MB 를 넘으면 초안을 건너뛴다', writes === before, writes - before)
  check('상한: 건너뛴다고 화면에 한 줄 적는다', host.textContent.includes('임시 보존을 건너뜁니다'), '')
  check('50만 자: 붙여넣기 + 이어 친 10번이 3초 안에 끝난다', hugeMs < 3000, `${hugeMs}ms`)

  // ④ 그래도 닫을 때는 한 번 더 시도한다 (사람이 쓴 글을 그냥 버리지 않는다)
  const beforeClose = writes
  await act(async () => { click(q(host, '.modal-head .btn-ghost')) })
  check('상한: 닫을 때는 마지막으로 한 번 더 시도한다', writes > beforeClose, writes - beforeClose)

  storageProto.setItem = realSet
  act(() => { root.unmount() })
  window.sessionStorage.clear()
  resetStore()
}

// ── 요약 ────────────────────────────────────────────────────
let bad = 0
for (const c of checks) {
  if (!c.ok) bad++
  console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.extra !== undefined ? '  (' + c.extra + ')' : ''))
}
console.log(bad === 0 ? 'ALL PASS (' + checks.length + ')' : bad + ' FAILED of ' + checks.length)
process.exit(bad === 0 ? 0 : 1)
