// scripts/check-files.mjs 가 esbuild 로 묶어 실행한다. 직접 node 로 돌리면 JSX 때문에 실패한다.
import { JSDOM, VirtualConsole } from 'jsdom'
import {
  fileRejectReason, storageKeyFor, originalNameFromKey, parseFiles, joinFiles,
  formatBytes, fileIcon, filePathsOf, totalFileBytes, splitByKind,
  imagePathFromUrl, MAX_FILES, FILE_MAX_BYTES
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

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const act = React.act ?? (await import('react-dom/test-utils')).act
const ItemModal = (await import('../src/components/ItemModal.jsx')).default
const Trash = (await import('../src/components/Trash.jsx')).default

let confirmAnswer = true
window.confirm = () => confirmAnswer

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
  check('제목이 파일 이름', row?.title === '2026학년도 계획서.hwp', row?.title)
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
  const mkItem = (id, n) => {
    const files = [
      { path: `${id}/1_가${n}.pdf`, name: `가${n}.pdf`, size: 10 },
      { path: `${id}/2_나${n}.hwp`, name: `나${n}.hwp`, size: 20 }
    ]
    for (const f of files) filesBucket().set(f.path, { size: f.size })
    return { id, title: `항목 ${n}`, deleted_at: '2026-08-20T00:00:00.000Z', files }
  }
  store.rows.items.push(mkItem('itA', 1), mkItem('itB', 2), mkItem('itC', 3))
  check('준비: 파일 6개', filesBucket().size === 6, filesBucket().size)

  const { host, root } = mount(React.createElement(Trash, { onClose: () => {}, onChanged: () => {} }))
  await act(async () => {}) // 목록 불러오기

  check('휴지통에 3줄', qa(host, '.trash-row').length === 3, qa(host, '.trash-row').length)

  confirmAnswer = true
  await act(async () => { click(qa(host, '.trash-row')[1].querySelector('.cm-del')) })
  check('한 건 영구 삭제 → 그 항목 파일만 사라진다', filesBucket().size === 4, filesBucket().size)
  check('지운 항목의 파일이 없다', ![...filesBucket().keys()].some((k) => k.startsWith('itB/')))
  check('남은 항목의 파일은 그대로', ['itA/1_가1.pdf', 'itA/2_나1.hwp', 'itC/1_가3.pdf', 'itC/2_나3.hwp']
    .every((k) => filesBucket().has(k)))

  await act(async () => { click(q(host, '.trash-top .btn-danger')) }) // 전부 비우기
  check('전부 비우기 → 고아 0', filesBucket().size === 0, [...filesBucket().keys()].join())
  check('행도 남지 않는다', store.rows.items.length === 0, store.rows.items.length)
  act(() => { root.unmount() })
}

// ── 14. 공개 URL ↔ 스토리지 경로 ────────────────────────────
{
  check('우리 이미지 URL 에서 경로를 되찾는다',
    imagePathFromUrl('https://x.co/storage/v1/object/public/archive-images/u1/1-ab.png') === 'u1/1-ab.png')
  check('유튜브 썸네일은 우리 것이 아니다',
    imagePathFromUrl('https://img.youtube.com/vi/abc/hqdefault.jpg') === null)
  check('한글이 든 경로도 되돌린다',
    imagePathFromUrl('https://x.co/storage/v1/object/public/archive-images/u1/%EA%B0%80.png') === 'u1/가.png')
}

// ── 요약 ────────────────────────────────────────────────────
let bad = 0
for (const c of checks) {
  if (!c.ok) bad++
  console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.extra !== undefined ? '  (' + c.extra + ')' : ''))
}
console.log(bad === 0 ? 'ALL PASS (' + checks.length + ')' : bad + ' FAILED of ' + checks.length)
process.exit(bad === 0 ? 0 : 1)
