// scripts/check-files.mjs 가 esbuild 로 묶어 실행한다. 직접 node 로 돌리면 JSX 때문에 실패한다.
import { JSDOM, VirtualConsole } from 'jsdom'
import {
  fileRejectReason, storageKeyFor, originalNameFromKey, parseFiles, joinFiles,
  formatBytes, fileIcon, filePathsOf, totalFileBytes, splitByKind,
  imagePathFromUrl, parseImages, MAX_FILES, FILE_MAX_BYTES,
  BLOCKED_EXTS, BLOCKED_FILE_MESSAGE, isBlockedFileName, randomKeyToken, safeExtOf,
  stripInvisible, saveErrorMessage, byteLength, totalImageBytes,
  STORAGE_QUOTA_BYTES, STORAGE_QUOTA_LABEL,
  SESSION_EXPIRED_MESSAGE, SAVE_FALLBACK_MESSAGE, DRAFT_DEBOUNCE_MS, DRAFT_MAX_BYTES
} from '../src/supabase.js'
import { moveItem, LONG_PRESS_MS, DRAG_THRESHOLD_PX, CANCEL_MOVE_PX } from '../src/reorder.js'
import { store, resetStore } from './fake-supabase.mjs'
import { DUR_MS, STAGGER_MS, STAGGER_MAX, staggerDelay, playOnce } from '../src/motion.js'

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
/* jsdom 에는 matchMedia 가 없다. theme.js 는 뜨자마자 그것을 부르고(다크 모드 판정),
   모션 코드도 reduced-motion 을 그것으로 묻는다. 기본값(안 켬)을 깔아 둔다 —
   모션 점검이 잠깐 바꿔서 'reduce 를 켠 사람' 을 흉내 낸 뒤 이 값으로 되돌린다. */
const NO_MATCH = (qq) => ({ matches: false, media: String(qq),
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
if (!window.matchMedia) window.matchMedia = NO_MATCH
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
const Archive = (await import('../src/components/Archive.jsx')).default

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

// ── 1. 확장자 차단 목록(허용 목록 폐지) ─────────────────────
{
  // 예전 화이트리스트 8종은 물론, 그 바깥의 흔한 것들도 이제 통과한다.
  const passing = [
    'hwp', 'hwpx', 'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'zip',
    'csv', 'md', 'json', 'xml', 'yml', 'log', 'psd', 'ai', 'dwg', 'epub', 'sh', 'dmg', 'iso'
  ]
  for (const ext of passing) {
    check(`허용: .${ext}`, fileRejectReason(mk(`보고서.${ext}`, 1024)) === null,
      fileRejectReason(mk(`보고서.${ext}`, 1024)))
  }
  // 차단은 '받는 쪽에서 두 번 눌리면 실행되는 것' 만이다.
  for (const bad of BLOCKED_EXTS) {
    const why = fileRejectReason(mk(`무언가.${bad}`, 1024))
    check(`차단: .${bad}`, typeof why === 'string' && why.startsWith(BLOCKED_FILE_MESSAGE), why)
    check(`차단 문구에 어느 확장자인지: .${bad}`, typeof why === 'string' && why.includes(`.${bad}`), why)
  }
  check('차단 안내 문구', fileRejectReason(mk('설치.exe', 10)) === `${BLOCKED_FILE_MESSAGE} (.exe)`,
    fileRejectReason(mk('설치.exe', 10)))
  check('차단은 대문자 확장자도 잡는다(.EXE)', fileRejectReason(mk('설치.EXE', 10)) !== null,
    fileRejectReason(mk('설치.EXE', 10)))
  check('허용: 확장자 없음(README)', fileRejectReason(mk('README', 10)) === null,
    fileRejectReason(mk('README', 10)))
  check('허용: 확장자 없음(Makefile)', fileRejectReason(mk('Makefile', 10)) === null)
  check('허용: 점으로 시작하는 이름(.gitignore)', fileRejectReason(mk('.gitignore', 10)) === null,
    fileRejectReason(mk('.gitignore', 10)))
  check('허용: 대문자 확장자(.PDF)', fileRejectReason(mk('보고서.PDF', 10)) === null)
  check('허용: 점이 여러 개인 이름', fileRejectReason(mk('2026.1학기.기말.hwp', 10)) === null)
  // 이미지는 파일 칸에 떨어져도 splitByKind 가 이미지 칸으로 보낸다. 파일 검증까지 오면
  // 그것은 이미 이미지가 아니라는 뜻이므로, 여기서 굳이 막지 않는다(차단 목록에 없다).
  check('이미지 확장자는 차단 목록이 아니다', fileRejectReason(mk('screenshot.png', 10)) === null)
  check('isBlockedFileName: exe 는 참', isBlockedFileName('설치.exe') === true)
  check('isBlockedFileName: csv 는 거짓', isBlockedFileName('표.csv') === false)
  check('차단 목록이 요청한 11종 그대로',
    BLOCKED_EXTS.join(',') === 'exe,msi,bat,cmd,scr,com,pif,vbs,js,jar,apk', BLOCKED_EXTS.join(','))
}

// ── 2. 10MB 상한 ────────────────────────────────────────────
{
  const under = fileRejectReason(mk('딱맞음.pdf', FILE_MAX_BYTES))
  check('10MB 정확히는 통과', under === null, under)
  const over = fileRejectReason(mk('큰파일.pdf', FILE_MAX_BYTES + 1))
  check('10MB + 1바이트는 거부', over !== null, over)
  const big = fileRejectReason(mk('큰파일.pdf', Math.round(12.3 * 1024 * 1024)))
  check('거부 문구에 현재 용량', big === '10MB 이하만 첨부할 수 있습니다 (현재 12.3MB)', big)
  // 차단 확장자를 용량보다 먼저 본다 — 100MB 짜리 exe 에 "10MB 이하만" 은 엉뚱한 안내다
  const exeBig = fileRejectReason(mk('설치.exe', 100 * 1024 * 1024))
  check('큰 exe 는 용량이 아니라 확장자로 거부', exeBig.startsWith(BLOCKED_FILE_MESSAGE), exeBig)
  // 확장자 없는 큰 파일은 용량으로 거부된다(확장자로 거부될 이유가 없다)
  const noExtBig = fileRejectReason(mk('DUMP', FILE_MAX_BYTES + 1))
  check('확장자 없는 큰 파일은 용량으로 거부', noExtBig.includes('10MB 이하만'), noExtBig)
}

// ── 3. 항목당 5개 ───────────────────────────────────────────
{
  check('4개 담긴 상태에서 1개 더 = 통과', fileRejectReason(mk('다섯.pdf', 10), 4) === null)
  const full = fileRejectReason(mk('여섯.pdf', 10), MAX_FILES)
  check('5개 담긴 상태에서 1개 더 = 거부', full === `파일은 최대 ${MAX_FILES}개까지예요`, full)
}

// ── 4. 저장 키는 ASCII 안전 문자만 ──────────────────────────
//   Supabase Storage 의 키 허용 문자는 ASCII 뿐이다. 한글이 그대로 들어가면 400 InvalidKey 고,
//   퍼센트 인코딩한 키도 '%' 가 허용 문자가 아니라 **똑같이 거부된다**(그래서 옛 폴백은
//   발동해도 소용이 없었다). 이름은 키가 아니라 메타(files[].name)가 지고 다닌다.
const KEY_SAFE = /^[A-Za-z0-9._\-/]+$/
{
  const names = [
    '2026학년도 계획서.hwp',
    '학생 명단(최종).xlsx',
    '보고서 v2 – 수정.pdf',
    'ㄱㄴㄷ.txt',
    '2026 지능형과학실 운영 계획(최종본).xlsx',
    '회의록 🎉 정리.docx',
    '이름만',
    '표.한글확장자',
    'a'.repeat(300) + '.pdf'
  ]
  for (const name of names) {
    const key = storageKeyFor('item-1', name, 1700000000000, 'ab12cd34')
    check(`키에 ASCII 안전 문자만: ${name.slice(0, 24)}`, KEY_SAFE.test(key), key)
    check(`키에 원본명이 들어가지 않는다: ${name.slice(0, 24)}`,
      !key.includes(name) && !key.includes(name.slice(0, 6)), key)
    check(`키 모양 {항목id}/{시각}_{랜덤8}.{확장자}: ${name.slice(0, 24)}`,
      new RegExp('^item-1/1700000000000_ab12cd34(\\.[a-z0-9]{1,12})?$').test(key), key)
  }
  check('한글 확장자는 키에서 떨어진다',
    storageKeyFor('i', '표.한글확장자', 1, 'aaaaaaaa') === 'i/1_aaaaaaaa', storageKeyFor('i', '표.한글확장자', 1, 'aaaaaaaa'))
  check('확장자 없는 이름은 확장자 없는 키',
    storageKeyFor('i', 'README', 1, 'aaaaaaaa') === 'i/1_aaaaaaaa', storageKeyFor('i', 'README', 1, 'aaaaaaaa'))
  check('대문자 확장자는 소문자로', storageKeyFor('i', 'A.PDF', 1, 'aaaaaaaa') === 'i/1_aaaaaaaa.pdf')
  check('키 길이가 짧게 유지된다',
    storageKeyFor('item-1', 'a'.repeat(300) + '.pdf', 1700000000000, 'ab12cd34').length < 60,
    storageKeyFor('item-1', 'a'.repeat(300) + '.pdf', 1700000000000, 'ab12cd34').length)
  const slashy = storageKeyFor('item-1', '폴더/이름.pdf', 1, 'aaaaaaaa')
  check('이름 속 / 는 폴더가 되지 않는다', slashy === 'item-1/1_aaaaaaaa.pdf', slashy)
  check('항목 id 도 안전 문자로 좁힌다',
    KEY_SAFE.test(storageKeyFor('항목 1', 'a.pdf', 1, 'aaaaaaaa')), storageKeyFor('항목 1', 'a.pdf', 1, 'aaaaaaaa'))

  // 랜덤 토큰 — 같은 밀리초에 같은 이름을 올려도 키가 갈린다(예전에는 이름이 갈라 주었다)
  const tokens = new Set(Array.from({ length: 200 }, () => randomKeyToken()))
  check('랜덤 토큰이 8자', [...tokens][0].length === 8, [...tokens][0])
  check('랜덤 토큰은 소문자+숫자만', [...tokens].every((t) => /^[a-z0-9]{8}$/.test(t)))
  check('200번 뽑아도 겹치지 않는다', tokens.size === 200, tokens.size)
  check('같은 시각·같은 이름도 키가 갈린다',
    storageKeyFor('i', 'a.pdf', 1) !== storageKeyFor('i', 'a.pdf', 1))

  check('한글 이름의 아이콘', fileIcon('계획서.hwp') === '📘' && fileIcon('표.xlsx') === '📊')
  // 확장자가 자유로워진 뒤로는 '모르는 확장자' 가 정상 입력이다 —
  // 아이콘이 없어 줄이 비어 보이는 일이 없어야 한다.
  check('모르는 확장자도 아이콘이 있다', fileIcon('무언가.qqq') === '📄', fileIcon('무언가.qqq'))
  check('확장자 없는 파일도 아이콘이 있다', fileIcon('README') === '📄', fileIcon('README'))
  check('아는 형식은 기존 아이콘 그대로',
    fileIcon('a.pdf') === '📕' && fileIcon('a.pptx') === '📽' && fileIcon('a.zip') === '🗜'
    && fileIcon('a.txt') === '📃' && fileIcon('a.docx') === '📄')
  check('새로 아는 형식: csv 는 표 아이콘', fileIcon('표.csv') === '📊', fileIcon('표.csv'))
  check('새로 아는 형식: md 는 글 아이콘', fileIcon('메모.md') === '📃', fileIcon('메모.md'))
  check('이미지 확장자 아이콘', fileIcon('사진.png') === '🖼', fileIcon('사진.png'))
  for (const n of ['README', '무언가.qqq', '표.csv', '계획.hwp', '', '이름만']) {
    check(`아이콘이 빈칸이 아니다: ${n || '(빈 이름)'}`, typeof fileIcon(n) === 'string' && fileIcon(n).length > 0)
  }
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
  check('키가 {폴더}/{시각}_{랜덤8}.{확장자}', /^new-[^/]+\/\d+_[a-z0-9]{8}\.hwp$/.test(key), key)
  check('키에 ASCII 안전 문자만', KEY_SAFE.test(key), key)
  check('키에 한글이 없다', !/[^\x20-\x7e]/.test(key), key)
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

  // 제목을 비운 채 저장 → 첫 파일 이름이 제목이 된다(확장자를 뗀다)
  await act(async () => { click(q(host, '.btn-primary')) })
  const row = store.rows.items[0]
  check('저장된 항목이 1개', store.rows.items.length === 1, store.rows.items.length)
  check('파일만 있으면 파일 이름이 제목', row?.title === '2026학년도 계획서', JSON.stringify(row?.title))
  check('제목에서 확장자를 뗀다', !(row?.title ?? '').includes('.hwp'), row?.title)
  check('files 에 메타 3가지만', JSON.stringify(row?.files) === JSON.stringify([{ path: key, name: '2026학년도 계획서.hwp', size: 1234 }]), JSON.stringify(row?.files))
  check('저장 뒤에도 스토리지에 남아 있다', filesBucket().has(key))
  check('저장 뒤 초안은 지워진다', window.sessionStorage.getItem('ma:draft:new') === null)
  check('경고 없이 저장됐다', savedWarn === null, savedWarn)
  act(() => { root.unmount() })
}

// ── 7-a. 한글·공백·괄호·이모지 이름 왕복 (InvalidKey 버그) ──
//   키에는 한 글자도 새어 나가면 안 되고, 이름은 메타 → 화면 → 내려받기까지 원본 그대로여야 한다.
{
  resetStore()
  window.sessionStorage.clear()
  const names = [
    '2026 지능형과학실 운영 계획(최종본).xlsx',
    '회의록 🎉 정리 (2026-09-04).docx',
    'ㄱㄴㄷ 목록 [초안] & 참고.pdf',
    '이름만'
  ]
  const { host, root } = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  await attach(host, names.map((n) => realFile(n, 321)))

  check('네 개 모두 올라갔다', filesBucket().size === names.length, filesBucket().size)
  const keys = [...filesBucket().keys()]
  check('모든 키가 ASCII 안전 문자', keys.every((k) => KEY_SAFE.test(k)), keys)
  check('어느 키에도 원본명 조각이 없다',
    keys.every((k) => !/[^\x20-\x7e]/.test(k) && !/[()\[\]&🎉]/.test(k)), keys)
  check('키가 서로 겹치지 않는다', new Set(keys).size === names.length, keys.length)

  const shown = qa(host, '.file-name').map((el) => el.textContent)
  check('화면에는 원본 이름 그대로', JSON.stringify(shown) === JSON.stringify(names), shown)

  // 내려받기 — 서명 주소에 원본 이름을 실어 보낸다(다른 출처라 <a download> 만으로는 안 된다)
  for (let i = 0; i < names.length; i += 1) {
    await act(async () => { click(qa(host, '.file-open')[i]) })
    const signed = store.calls.signed.at(-1)
    check(`서명 주소 download 가 원본명: ${names[i].slice(0, 20)}`, signed?.download === names[i], signed?.download)
    check(`서명 주소가 그 파일의 키를 가리킨다: ${names[i].slice(0, 20)}`,
      keys.includes(signed?.path), signed?.path)
  }
  const anchors = qa(host, '.file-open')
  check('내려받기 자리가 네 개', anchors.length === names.length, anchors.length)

  await act(async () => { click(q(host, '.btn-primary')) })
  const saved = store.rows.items[0]
  check('저장된 메타에 원본 이름이 그대로',
    JSON.stringify((saved?.files ?? []).map((f) => f.name)) === JSON.stringify(names),
    (saved?.files ?? []).map((f) => f.name))
  check('저장된 메타의 경로가 스토리지 키와 같다',
    (saved?.files ?? []).every((f) => filesBucket().has(f.path)), (saved?.files ?? []).map((f) => f.path))
  check('다시 읽어도 이름이 원본',
    JSON.stringify(parseFiles(saved?.files).map((f) => f.name)) === JSON.stringify(names),
    parseFiles(saved?.files).map((f) => f.name))
  act(() => { root.unmount() })
}

// ── 7-a-2. 옛 키 형식 호환 — 이미 올라간 파일은 메타의 경로로 그대로 읽는다 ──
{
  const legacy = [
    { path: 'item-9/1700000000000_report.pdf', name: 'report.pdf', size: 10 },
    { path: 'item-9/1700000000001_2026 계획.hwp', name: '2026 계획.hwp', size: 20 }
  ]
  const parsed = parseFiles(legacy)
  check('옛 키도 경로 그대로 읽는다',
    parsed.map((f) => f.path).join() === legacy.map((f) => f.path).join(), parsed.map((f) => f.path))
  check('옛 줄의 이름은 메타에서 온다', parsed.map((f) => f.name).join() === 'report.pdf,2026 계획.hwp')
  check('옛 키 목록도 삭제 대상으로 잡힌다',
    filePathsOf({ files: legacy }).length === 2, filePathsOf({ files: legacy }))
  // 이름이 없는 옛 줄(경로 문자열만)은 예전처럼 키에서 이름을 되찾는다
  check('이름 없는 옛 줄은 키에서 이름을 되찾는다',
    parseFiles(['item-9/1700000000001_2026 계획.hwp'])[0].name === '2026 계획.hwp',
    parseFiles(['item-9/1700000000001_2026 계획.hwp'])[0].name)
}

// ── 7-b. 화이트리스트 폐지: csv·md·json·확장자 없는 파일이 실제로 올라간다 ──
//   함수 판정만이 아니라 모달 → 업로드 → 저장까지 한 줄로 통과하는지 본다.
//   같은 뭉치에 exe 를 섞어 넣어, 나머지는 올라가고 그것만 걸리는지도 함께 본다.
{
  resetStore()
  window.sessionStorage.clear()
  const { host, root } = mount(React.createElement(ItemModal, {
    item: null, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))

  await attach(host, [
    realFile('명단.csv', 100), realFile('메모.md', 100),
    realFile('설정.json', 100), realFile('README', 100),
    realFile('설치.exe', 100)
  ])

  check('예전 화이트리스트 밖 4종이 모두 올라간다', filesBucket().size === 4, filesBucket().size)
  const names = qa(host, '.file-name').map((el) => el.textContent)
  check('네 파일 이름이 화면에 있다',
    JSON.stringify(names) === JSON.stringify(['명단.csv', '메모.md', '설정.json', 'README']), names)
  check('exe 는 올라가지 않았다', !names.includes('설치.exe'), names)
  const err = q(host, '.form-error')?.textContent ?? ''
  check('exe 차단 안내가 화면에 뜬다', err.startsWith(BLOCKED_FILE_MESSAGE), err)
  const icons = qa(host, '.file-icon').map((el) => el.textContent)
  check('네 줄 모두 아이콘이 있다', icons.length === 4 && icons.every((s) => s && s.length > 0), icons)
  check('확장자 없는 파일은 범용 문서 아이콘', icons[3] === '📄', icons[3])
  check('csv 는 표 아이콘', icons[0] === '📊', icons[0])

  await act(async () => { click(q(host, '.btn-primary')) })
  const row = store.rows.items[0]
  check('저장된 files 에 네 건이 담긴다', (row?.files ?? []).length === 4, (row?.files ?? []).length)
  check('저장된 files 에 exe 가 없다',
    !(row?.files ?? []).some((f) => /\.exe$/i.test(f.name)), JSON.stringify(row?.files))
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
  const MB = 1024 * 1024
  // 🔴 userId 를 넘긴다 — 이미지 용량은 `${userId}/…` 폴더를 물어서 세기 때문이다.
  //    안 넘기면 이미지 쪽은 '확인 못 함' 이 된다 (그 경우도 아래 ④에서 따로 본다).
  const settings = (onClose, userId = 'u1') => React.createElement(Settings, {
    email: 'a@b.c', userId, themePref: 'system',
    onThemeChange: () => {}, onOpenPricing: () => {}, onClose
  })

  // ① 조금 썼을 때 — 파일과 이미지를 **더해서** 보여 준다.
  //    🔴 Supabase 의 1GB 는 프로젝트 전체 스토리지에 걸리는 값이다. 파일만 세면
  //       게이지가 실제보다 적게 나오고, 적게 나오는 게이지는 없느니만 못하다.
  resetStore()
  store.rows.items.push({ id: 'i1', files: [{ path: 'a/1_가.pdf', name: '가.pdf', size: 12.3 * MB }] })
  imagesBucket().set('u1/1-a.png', { size: 2 * MB })
  imagesBucket().set('u1/2-b.png', { size: 3 * MB })
  imagesBucket().set('u2/9-남.png', { size: 500 * MB })   // 남의 폴더는 세지 않는다
  let m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: 파일+이미지 합계를 보여 준다',
    q(m.host, '.set-value')?.textContent.includes('저장소 17.3MB / 1GB'),
    q(m.host, '.set-value')?.textContent)
  check('게이지: 내역을 괄호로 적는다',
    q(m.host, '.set-value')?.textContent.includes('(파일 12.3MB · 이미지 5.0MB)'),
    q(m.host, '.set-value')?.textContent)
  check('게이지: 남의 폴더는 세지 않는다',
    !q(m.host, '.set-value')?.textContent.includes('500'), q(m.host, '.set-value')?.textContent)
  check('게이지: 이미지 버킷을 한 번만 물어본다',
    store.calls.list.filter((c) => c.bucket === 'archive-images').length === 1,
    store.calls.list.length)
  check('게이지: 안내가 무료 플랜 기준을 말한다',
    m.host.textContent.includes('Supabase 무료 플랜 기준입니다'))
  check('게이지: 80% 아래는 주황이 아니다', !q(m.host, '.gauge-fill')?.classList.contains('gauge-warn'))
  act(() => { m.root.unmount() })

  // ② 80% 를 넘었을 때 — 🔴 이미지를 합쳐야 넘는 경우다. 파일만 세던 때는
  //    이 상태에서 게이지가 '아직 45%' 라고 말했다.
  resetStore()
  store.rows.items.push({ id: 'i1', files: [{ path: 'a/1_큰.zip', name: '큰.zip', size: Math.round(GB * 0.45) }] })
  imagesBucket().set('u1/1-큰.png', { size: Math.round(GB * 0.4) })
  m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: 합쳐서 80% 넘으면 주황', q(m.host, '.gauge-fill')?.classList.contains('gauge-warn'))
  check('게이지: 넘었다고 적는다', m.host.textContent.includes('80% 를 넘었어요'))
  act(() => { m.root.unmount() })

  // ②-2 이미지만 있어도 센다 (파일 첨부가 하나도 없는 사용자)
  resetStore()
  imagesBucket().set('u1/1-a.png', { size: 7 * MB })
  m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: 파일이 없어도 이미지는 센다',
    q(m.host, '.set-value')?.textContent.includes('저장소 7.0MB / 1GB'),
    q(m.host, '.set-value')?.textContent)
  act(() => { m.root.unmount() })

  // ②-3 이미지 목록을 못 읽으면 0 이라고 하지 않는다 — '못 읽었다' 와 '0바이트' 는 다르다
  resetStore()
  store.rows.items.push({ id: 'i1', files: [{ path: 'a/1_가.pdf', name: '가.pdf', size: 2 * MB }] })
  store.listError = 'bucket list denied'
  m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: 이미지를 못 읽으면 그렇게 적는다',
    q(m.host, '.set-value')?.textContent.includes('이미지 확인 못 함'),
    q(m.host, '.set-value')?.textContent)
  check('게이지: 아는 쪽(파일)은 그대로 보여 준다',
    q(m.host, '.set-value')?.textContent.includes('파일 2.0MB'),
    q(m.host, '.set-value')?.textContent)
  act(() => { m.root.unmount() })
  store.listError = null

  // ③ 양쪽 다 못 읽으면 게이지를 숨긴다 (0MB 로 보이면 '아직 안 썼다' 로 읽힌다)
  //    files 열이 없는 DB(setup.sql 미실행) + 이미지도 못 읽는 상태.
  resetStore()
  store.missingFilesColumn = true
  store.listError = 'bucket list denied'
  m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: 양쪽 다 못 읽으면 숨는다', q(m.host, '.gauge') === null)
  check('게이지: 그래도 나머지 설정은 그대로 뜬다', m.host.textContent.includes('화면 테마'))
  act(() => { m.root.unmount() })
  store.listError = null

  // ③-2 files 열만 없고 이미지는 읽히면 — 숨기지 않는다.
  //     🔴 아는 절반을 감추면 사용자는 자기가 얼마나 썼는지 알 길이 없다.
  resetStore()
  store.missingFilesColumn = true
  imagesBucket().set('u1/1-a.png', { size: 4 * MB })
  m = mount(settings(() => {}))
  await act(async () => {})
  check('게이지: 이미지만 읽혀도 보여 준다', q(m.host, '.gauge') !== null)
  check('게이지: 파일 쪽은 확인 못 함으로 적는다',
    q(m.host, '.set-value')?.textContent.includes('파일 확인 못 함'),
    q(m.host, '.set-value')?.textContent)
  act(() => { m.root.unmount() })
  resetStore()

  // ④ 한도 문구는 상수에서 나온다 — 화면에 손으로 적은 '1GB' 가 없어야 한다
  check('한도 문구가 상수에서 나온다', STORAGE_QUOTA_LABEL === '1GB', STORAGE_QUOTA_LABEL)
  check('한도 상수가 1GB 다', STORAGE_QUOTA_BYTES === GB, STORAGE_QUOTA_BYTES)
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
    // 본문이 공백뿐이면 다음 후보로 넘어간다 — 이제 그 자리에 파일 이름이 있다.
    check('공백뿐 + 파일: 파일 이름으로 넘어간다', row?.title === '붙임', JSON.stringify(row?.title))
    check('공백뿐 + 파일: 메모 날짜가 아니다', !날짜꼴.test(row?.title ?? ''), JSON.stringify(row?.title))
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

// ── 16-b. 제목 자동 생성 우선순위 ───────────────────────────
//   ① 본문 첫 줄 → ② 링크 제목 → ③ 첫 파일 이름(확장자 제외) → ④ 이미지 날짜 → ⑤ 메모 날짜.
//   점검에서는 fetch 가 막혀 있어 ②(noembed)는 늘 실패한다 — 그때는 다음 후보로 넘어가고,
//   끝까지 남으면 링크 주소 자체가 제목이 된다(예전 그대로).
{
  const 날짜꼴 = /^메모 \d{4}-\d{2}-\d{2}$/
  const setText = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }

  // body·link·file·image 를 골라 넣고 제목 없이 저장한 뒤 저장된 행을 돌려준다
  async function titleOf({ body = '', link = '', file = null, image = false } = {}) {
    resetStore()
    window.sessionStorage.clear()
    const { host, root } = mount(React.createElement(ItemModal, {
      item: null, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
    }))
    if (body) await act(async () => { setText(q(host, 'textarea'), body) })
    if (link) {
      const box = q(host, '.link-add input')
      await act(async () => { setInput(box, link) })
      await act(async () => {
        box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
    }
    if (file) await attach(host, [file])
    if (image) await attach(host, [realFile('사진.png', 20, 'image/png')], '.img-file')
    const hint = q(host, '.field input')?.placeholder ?? ''
    await act(async () => { click(q(host, '.btn-primary')) })
    const row = store.rows.items[0] ?? null
    act(() => { root.unmount() })
    return { title: row?.title ?? null, hint }
  }

  // ① 본문이 있으면 본문이 최우선 — 링크·파일·이미지가 함께 있어도
  {
    const r = await titleOf({
      body: '\n\n연구부 협의 정리\n둘째 줄', link: 'https://youtube.com/watch?v=abc',
      file: realFile('첨부자료.pdf', 10)
    })
    check('① 본문 + 링크 + 파일 → 본문 첫 줄', r.title === '연구부 협의 정리', JSON.stringify(r.title))
    check('① 자리말도 본문을 가리킨다', r.hint === '비우면 본문 첫 줄로 지어요', r.hint)
  }
  {
    const r = await titleOf({ body: '\n\n텍스트가 여기서 시작합니다\n둘째 줄' })
    check('① 빈 줄로 시작하는 본문', r.title === '텍스트가 여기서 시작합니다', JSON.stringify(r.title))
  }
  {
    const long = '가'.repeat(50)
    const r = await titleOf({ body: long })
    check('① 본문은 앞 30자까지', r.title === '가'.repeat(30), (r.title ?? '').length)
  }

  // ①-대 ② 이 개편의 핵심: **링크 제목을 실제로 가져와도** 본문이 이긴다.
  //   위의 다른 경우들은 noembed 가 막혀 있어 옛 차례로도 같은 답이 나온다 —
  //   옛 차례와 갈리는 자리는 여기뿐이므로, 그 한 자리를 위해 fetch 를 잠깐 바꿔 끼운다.
  //   (바깥으로 나가지 않는다. noembed 주소를 가로채 고정 응답을 돌려줄 뿐이다.)
  {
    const realFetch = globalThis.fetch
    let asked = 0
    globalThis.fetch = async (u) => {
      if (String(u).includes('noembed.com')) {
        asked += 1
        return { json: async () => ({ title: 'YouTube' }) }
      }
      throw new Error('점검 중에는 바깥으로 나가지 않는다')
    }
    try {
      const withBody = await titleOf({
        body: '연구부 협의 정리', link: 'https://youtube.com/watch?v=abc'
      })
      check('①>② 본문이 있으면 링크 제목("YouTube")을 쓰지 않는다',
        withBody.title === '연구부 협의 정리', JSON.stringify(withBody.title))
      check('①>② 본문이 있으면 noembed 를 부르지도 않는다', asked === 0, asked)

      const linkOnly = await titleOf({ link: 'https://youtube.com/watch?v=abc' })
      check('② 본문이 없으면 링크 제목을 가져와 쓴다', linkOnly.title === 'YouTube', JSON.stringify(linkOnly.title))
      check('② 그때는 noembed 를 부른다', asked > 0, asked)

      const linkAndFile = await titleOf({
        link: 'https://youtube.com/watch?v=abc', file: realFile('회의자료.hwp', 10)
      })
      check('②>③ 링크 제목을 가져오면 파일 이름보다 먼저',
        linkAndFile.title === 'YouTube', JSON.stringify(linkAndFile.title))
    } finally {
      globalThis.fetch = realFetch
    }
  }

  // ② 링크만 — noembed 가 막혀 있으므로 주소 자체가 제목이 된다(종전 동작 유지)
  {
    const r = await titleOf({ link: 'https://example.com/a' })
    check('② 링크만 → 링크 주소', r.title === 'https://example.com/a', JSON.stringify(r.title))
    check('② 링크만: 메모 날짜가 아니다', !날짜꼴.test(r.title ?? ''), r.title)
    check('② 자리말은 링크를 가리킨다', r.hint === '비우면 링크 제목을 가져옵니다', r.hint)
  }

  // ③ 파일만 — 확장자를 뗀 원본 이름
  {
    const r = await titleOf({ file: realFile('2026 지능형과학실 운영 계획(최종본).xlsx', 10) })
    check('③ 파일만 → 확장자 뗀 파일명',
      r.title === '2026 지능형과학실 운영 계획(최종본)', JSON.stringify(r.title))
    check('③ 자리말은 파일을 가리킨다', r.hint === '비우면 첨부 파일 이름으로 지어요', r.hint)
  }
  {
    const r = await titleOf({ file: realFile('README', 10) })
    check('③ 확장자 없는 파일명은 통째로', r.title === 'README', JSON.stringify(r.title))
  }
  {
    const r = await titleOf({ file: realFile('.gitignore', 10) })
    check('③ 점으로 시작하는 이름은 자르지 않는다', r.title === '.gitignore', JSON.stringify(r.title))
  }
  {
    const r = await titleOf({ file: realFile(`${'나'.repeat(50)}.pdf`, 10) })
    check('③ 파일명도 앞 30자까지', r.title === '나'.repeat(30), (r.title ?? '').length)
  }
  {
    // 링크가 있어도 링크 제목을 못 가져오면 파일 이름이 주소보다 먼저다
    const r = await titleOf({ link: 'https://example.com/b', file: realFile('회의자료.hwp', 10) })
    check('③ 링크 제목을 못 가져오면 파일 이름이 먼저', r.title === '회의자료', JSON.stringify(r.title))
  }

  // ④ 이미지만 — 파일보다 뒤, 메모 날짜보다 앞
  {
    const r = await titleOf({ image: true })
    check('④ 이미지만 → 이미지 날짜', /^이미지 \d{4}-\d{2}-\d{2}$/.test(r.title ?? ''), JSON.stringify(r.title))
  }
  {
    const r = await titleOf({ image: true, file: realFile('붙임자료.pdf', 10) })
    check('④ 파일이 이미지보다 먼저', r.title === '붙임자료', JSON.stringify(r.title))
  }
  {
    const r = await titleOf({ image: true, body: '사진 설명 한 줄' })
    check('④ 본문이 이미지보다 먼저', r.title === '사진 설명 한 줄', JSON.stringify(r.title))
  }

  // ⑤ 전부 빈 경우 — 담긴 것이 없으면 저장 버튼 자체가 잠긴다(사양 유지).
  //    최종 폴백 '메모 YYYY-MM-DD' 는 withSafeTitle 이 지킨다.
  {
    const r = await titleOf({})
    check('⑤ 전부 비면 저장되지 않는다', r.title === null, JSON.stringify(r.title))
    check('⑤ 자리말은 예시 문구', r.hint === '쇼츠 대본 - AI 활용법 3가지', r.hint)
  }
  {
    // 공백뿐인 본문 + 파일 → 본문은 건너뛰고 파일 이름으로 (①이 빈 값이면 멈추지 않는다)
    const r = await titleOf({ body: '   \n\n \t \n  ', file: realFile('붙임.pdf', 10) })
    check('공백뿐인 본문은 건너뛴다', r.title === '붙임', JSON.stringify(r.title))
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

// ── 13. 순서 바꾸기 — 이미지·파일 ────────────────────────────
//   배열 순서가 곧 표시 순서다(스키마 변경 없음). 여기서 재는 것은 셋:
//   ① moveItem 이 정확히 한 칸씩 옮기는가 ② 화면에서 바꾼 순서가 저장까지 가는가
//   ③ 순서만 바꿔도 '바뀜'(dirty)으로 잡히는가.
{
  const base = ['a', 'b', 'c', 'd']
  check('moveItem: 앞으로', moveItem(base, 2, 0).join() === 'c,a,b,d', moveItem(base, 2, 0).join())
  check('moveItem: 뒤로', moveItem(base, 0, 3).join() === 'b,c,d,a', moveItem(base, 0, 3).join())
  check('moveItem: 제자리는 그대로', moveItem(base, 1, 1).join() === base.join())
  check('moveItem: 범위를 넘으면 끝으로 붙인다', moveItem(base, 0, 99).join() === 'b,c,d,a', moveItem(base, 0, 99).join())
  check('moveItem: 원본을 건드리지 않는다', base.join() === 'a,b,c,d', base.join())
  check('moveItem: 잘못된 자리는 그대로', moveItem(base, -1, 2).join() === base.join())
  check('길게 누르기 300ms', LONG_PRESS_MS === 300, LONG_PRESS_MS)
  check('마우스는 4px 움직여야 끌기', DRAG_THRESHOLD_PX === 4, DRAG_THRESHOLD_PX)
  check('터치는 10px 먼저 움직이면 스크롤', CANCEL_MOVE_PX === 10, CANCEL_MOVE_PX)
}

// ── 13-a. 이미지 3장 순서 뒤집기 → 저장 → 재열람 → 카드 표지 ──
{
  resetStore()
  window.sessionStorage.clear()
  const item = {
    id: 'i-order', title: '순서', content: '', link_url: '', tags: [],
    image_url: 'https://x/1.png\nhttps://x/2.png\nhttps://x/3.png', files: []
  }
  // 수정 저장은 update 라 행이 미리 있어야 한다 (11번 검사와 같은 방식)
  store.rows.items.push({ id: 'i-order', title: '순서', image_url: item.image_url, files: [] })
  const { host, root } = mount(React.createElement(ItemModal, {
    item, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))

  // 손잡이(⠿)는 없앴다 — 84px 칸의 왼쪽 위를 덮어 정작 사진이 안 보였다.
  // 키보드로 옮기는 자리는 썸네일 자체로 옮겼다.
  const thumbs = () => qa(host, '.img-thumb-open')
  check('손잡이(⠿)를 그리지 않는다', qa(host, '.img-grip').length === 0)
  check('이미지 3장 그대로', thumbs().length === 3, thumbs().length)

  // 방향키로 옮긴다 (끌기와 같은 moveImage 를 부른다 — jsdom 에는 레이아웃이 없어
  // elementFromPoint 로 하는 좌표 판정은 브라우저 점검(check:mobile)에서 본다)
  const key = (el, k) => act(() => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
  await key(thumbs()[2], 'ArrowLeft')   // 3 → 2번째
  await key(thumbs()[1], 'ArrowLeft')   // 3 → 1번째
  await key(thumbs()[2], 'ArrowLeft')   // 2 → 2번째... 아래에서 실제 배열로 확인한다

  const shown = () => qa(host, '.img-thumb-open img').map((i) => i.getAttribute('src'))
  check('화면 순서가 바뀌었다', shown().join() !== 'https://x/1.png,https://x/2.png,https://x/3.png', shown().join())

  /* PC(마우스)에서도 **같은 조작**이다 — 클릭해서 고르고 버튼으로 옮긴다.
     🔴 이 블록에는 matchMedia 를 심지 않았다. 즉 여기가 곧 '거친 포인터가 아닌 기기' 다.
        폰에서만 뜨던 옮기기 줄이 여기서도 떠야 조작이 기기 간에 같아진다. */
  await act(async () => { click(thumbs()[2]) })
  check('PC: 클릭하면 고른 표시가 붙는다', qa(host, '.img-thumb.img-picked').length === 1)
  check('PC: 옮기기 줄이 뜬다', q(host, '.img-pickbar') !== null)
  check('PC: 클릭이 확대창을 열지 않는다', q(host, '.img-zoom') === null)
  const pcShown = () => qa(host, '.img-thumb-open img').map((i) => i.getAttribute('src'))
  const pcBefore = pcShown()
  await act(async () => { click(q(host, '.img-pickbar-first')) })
  check('PC: 클릭 2번에 맨 앞으로 온다', pcShown()[0] === pcBefore[2], pcShown().join())
  check('PC: 크게 보기는 옮기기 줄에 있다',
    qa(host, '.img-pickbar .btn-sm').some((b) => b.textContent.includes('크게 보기')))
  // 그 버튼으로 확대창이 열리는지 (크게 보기 경로가 살아 있는가)
  await act(async () => {
    click(qa(host, '.img-pickbar .btn-sm').find((b) => b.textContent.includes('크게 보기')))
  })
  check('PC: [크게 보기] 로 확대창이 열린다', q(host, '.img-zoom') !== null)
  await act(async () => {
    q(host, '.img-zoom').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  })
  check('PC: 확대창을 닫을 수 있다', q(host, '.img-zoom') === null)
  /* 🔴 옮겨 본 것을 되돌린다. 이 블록은 아래(저장·재열람·카드 표지) 판정이 세워 둔
     배치를 빌려 쓴 것이라, 어지른 채로 넘기면 그쪽 판정이 엉뚱한 이유로 무너진다.
     되돌리는 길이 곧 [▶] 두 번이 제대로 도는지에 대한 판정이기도 하다. */
  const nextBtn = () => qa(host, '.img-pickbar .btn-sm')
    .find((b) => b.getAttribute('aria-label') === '한 칸 뒤로')
  await act(async () => { click(nextBtn()) })
  await act(async () => { click(nextBtn()) })
  check('PC: [▶] 두 번으로 제자리에 돌아온다', pcShown().join() === pcBefore.join(), pcShown().join())
  await act(async () => { click(q(host, '.img-pickbar-off')) })
  check('PC: 선택을 놓으면 줄이 사라진다', q(host, '.img-pickbar') === null)
  // 마우스에서는 끌기도 남아 있다 (주 경로는 아니지만 지우지 않았다)
  check('PC: 끌기 훅은 그대로 붙어 있다',
    qa(host, '.img-thumb[data-reorder-index]').length === 3,
    qa(host, '.img-thumb[data-reorder-index]').length)

  // 순서만 바꿔도 '바뀜' 으로 잡혀 닫기 확인이 뜬다
  confirmAnswer = false
  lastConfirm = null
  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  check('순서만 바꿔도 닫기 확인이 뜬다', typeof lastConfirm === 'string' && lastConfirm.length > 0, lastConfirm)
  confirmAnswer = true

  const before = shown()
  await act(async () => { click(q(host, '.btn-primary')) })
  const row = store.rows.items.find((r) => r.id === 'i-order')
  const saved = (row?.image_url ?? '').split('\n')
  check('저장된 순서가 화면 순서와 같다', saved.join() === before.join(), `${saved.join()} / ${before.join()}`)
  check('저장 뒤에도 3장 그대로', saved.length === 3, saved.length)

  // 재열람 — 저장된 값으로 다시 열면 그 순서로 나온다
  act(() => { root.unmount() })
  const again = mount(React.createElement(ItemModal, {
    item: { ...item, image_url: saved.join('\n') },
    categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  const reopened = qa(again.host, '.img-thumb-open img').map((i) => i.getAttribute('src'))
  check('재열람해도 순서가 유지된다', reopened.join() === saved.join(), reopened.join())
  check('맨 앞에 대표 표시', q(again.host, '.img-thumb .img-thumb-tag')?.textContent === '대표')

  // 카드 표지 = 첫 장. 순서를 바꿨으니 표지도 바뀐다.
  const cover = parseImages(saved.join('\n'))[0]
  check('카드 표지가 새 첫 장', cover === saved[0] && cover !== 'https://x/1.png', cover)
  act(() => { again.root.unmount() })
}

// ── 13-b. 파일 3개 ▲▼ → 저장 → 재열람 ────────────────────────
{
  resetStore()
  window.sessionStorage.clear()
  const files = [
    { path: 'p/1.pdf', name: '가.pdf', size: 10 },
    { path: 'p/2.pdf', name: '나.pdf', size: 20 },
    { path: 'p/3.pdf', name: '다.pdf', size: 30 }
  ]
  const item = {
    id: 'f-order', title: '파일 순서', content: '', link_url: '', tags: [],
    image_url: null, files
  }
  store.rows.items.push({ id: 'f-order', title: '파일 순서', image_url: null, files })
  const { host, root } = mount(React.createElement(ItemModal, {
    item, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))

  const names = (h = host) => qa(h, '.file-name').map((n) => n.textContent)
  check('파일 3줄', names().length === 3, names().join())
  check('줄마다 ▲▼ 가 있다', qa(host, '.file-move-btn').length === 6, qa(host, '.file-move-btn').length)
  const ups = () => qa(host, '.file-move-btn').filter((b) => b.getAttribute('aria-label')?.endsWith('위로'))
  const downs = () => qa(host, '.file-move-btn').filter((b) => b.getAttribute('aria-label')?.endsWith('아래로'))
  check('첫 줄 ▲ 는 못 누른다', ups()[0].disabled === true)
  check('끝 줄 ▼ 는 못 누른다', downs()[2].disabled === true)

  await act(async () => { click(ups()[2]) })          // 다 → 2번째
  check('▲ 한 번: 가,다,나', names().join() === '가.pdf,다.pdf,나.pdf', names().join())
  await act(async () => { click(downs()[0]) })        // 가 → 2번째
  check('▼ 한 번: 다,가,나', names().join() === '다.pdf,가.pdf,나.pdf', names().join())

  await act(async () => { click(q(host, '.btn-primary')) })
  const row = store.rows.items.find((r) => r.id === 'f-order')
  const savedNames = parseFiles(row?.files).map((f) => f.name)
  check('저장된 파일 순서가 화면과 같다', savedNames.join() === '다.pdf,가.pdf,나.pdf', savedNames.join())

  act(() => { root.unmount() })
  const again = mount(React.createElement(ItemModal, {
    item: { ...item, files: parseFiles(row?.files) },
    categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  check('재열람해도 파일 순서가 유지된다', names(again.host).join() === '다.pdf,가.pdf,나.pdf', names(again.host).join())
  act(() => { again.root.unmount() })
}

// ── 13-c. 한 장/한 개면 순서 UI 를 아예 안 그린다 ──────────────
{
  resetStore()
  const one = mount(React.createElement(ItemModal, {
    item: { id: 'one', title: 'x', content: '', link_url: '', tags: [],
      image_url: 'https://x/only.png', files: [{ path: 'p/a.pdf', name: 'a.pdf', size: 1 }] },
    categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  check('이미지 1장이면 순서 UI 없음',
    qa(one.host, '.img-grip').length === 0 && q(one.host, '.img-pickbar') === null)
  check('파일 1개면 ▲▼ 없음', qa(one.host, '.file-move-btn').length === 0)
  act(() => { one.root.unmount() })
}

/* ── 13-d. 터치 기기: 탭으로 고르고 버튼으로 옮긴다 ──────────────
   끌기는 폰에서 실사용 불가 판정이 나서 버렸다. 여기서 재는 것은 하나다:
   **맨 끝 사진을 표지로 만드는 데 탭 두 번이면 되는가** (고르기 → 맨 앞).
   🔴 matchMedia 를 손으로 심는다. jsdom 에는 없고, 우리 코드는 그것으로 입력 장치를
      가른다 — 심지 않으면 이 화면을 영영 데스크톱으로만 검사하게 된다. */
{
  resetStore()
  window.sessionStorage.clear()
  const realMM = window.matchMedia
  window.matchMedia = (q2) => ({
    matches: String(q2).includes('pointer: coarse'),
    media: q2, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
  })

  const item = {
    id: 'i-touch', title: '터치 순서', content: '', link_url: '', tags: [],
    image_url: 'https://x/1.png\nhttps://x/2.png\nhttps://x/3.png', files: []
  }
  store.rows.items.push({ id: 'i-touch', title: '터치 순서', image_url: item.image_url, files: [] })
  const { host, root } = mount(React.createElement(ItemModal, {
    item, categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  const shown = () => qa(host, '.img-thumb-open img').map((i) => i.getAttribute('src'))
  const thumbs = () => qa(host, '.img-thumb-open')

  check('터치: 시작 순서 1,2,3', shown().join() === 'https://x/1.png,https://x/2.png,https://x/3.png', shown().join())
  check('터치: 고르기 전에는 옮기기 줄이 없다', q(host, '.img-pickbar') === null)

  // ① 맨 끝(3번째) 썸네일을 탭 → 고른다
  await act(async () => { click(thumbs()[2]) })
  check('터치 ①: 탭하면 고른 표시가 붙는다', qa(host, '.img-thumb.img-picked').length === 1)
  check('터치 ①: 고른 것이 3번째다', qa(host, '.img-thumb')[2].classList.contains('img-picked'))
  check('터치 ①: 옮기기 줄이 뜬다', q(host, '.img-pickbar') !== null)
  check('터치 ①: 몇 번째인지 적는다', q(host, '.img-pickbar-at')?.textContent.includes('3번째'),
    q(host, '.img-pickbar-at')?.textContent)
  check('터치 ①: 크게 보기가 아니라 고르기다 (확대창이 안 열린다)', q(host, '.img-zoom') === null)

  // ② [◀ 맨 앞] 한 번 → 표지가 된다. 여기까지 탭 두 번.
  await act(async () => { click(q(host, '.img-pickbar-first')) })
  check('터치 ②: 탭 2번에 맨 앞으로 온다',
    shown().join() === 'https://x/3.png,https://x/1.png,https://x/2.png', shown().join())
  check('터치 ②: 대표 뱃지가 그 사진에 붙는다',
    q(host, '.img-thumb')?.querySelector('.img-thumb-tag')?.textContent === '대표')
  check('터치 ②: 선택은 옮긴 사진을 따라간다',
    qa(host, '.img-thumb')[0].classList.contains('img-picked'))
  check('터치 ②: 맨 앞이면 [맨 앞]·[◀] 는 못 누른다',
    q(host, '.img-pickbar-first').disabled === true)

  // ③ 한 칸씩도 된다
  const pickBtns = () => qa(host, '.img-pickbar .btn-sm')
  const next = pickBtns().find((b) => b.getAttribute('aria-label') === '한 칸 뒤로')
  await act(async () => { click(next) })
  check('터치 ③: ▶ 한 칸', shown().join() === 'https://x/1.png,https://x/3.png,https://x/2.png', shown().join())
  const prev = pickBtns().find((b) => b.getAttribute('aria-label') === '한 칸 앞으로')
  await act(async () => { click(prev) })
  check('터치 ③: ◀ 한 칸(되돌아온다)', shown().join() === 'https://x/3.png,https://x/1.png,https://x/2.png', shown().join())

  // ④ 선택 해제
  await act(async () => { click(q(host, '.img-pickbar-off')) })
  check('터치 ④: 선택을 놓으면 줄이 사라진다', q(host, '.img-pickbar') === null)
  check('터치 ④: 고른 표시도 사라진다', qa(host, '.img-thumb.img-picked').length === 0)
  // 같은 썸네일을 다시 탭하면 놓아진다(토글)
  await act(async () => { click(thumbs()[1]) })
  await act(async () => { click(thumbs()[1]) })
  check('터치 ④: 같은 것을 두 번 탭하면 놓는다', q(host, '.img-pickbar') === null)

  // ⑤ 저장 — 바꾼 순서가 그대로 남고 표지도 그 사진이다
  const before = shown()
  await act(async () => { click(q(host, '.btn-primary')) })
  const row = store.rows.items.find((r) => r.id === 'i-touch')
  const saved = (row?.image_url ?? '').split('\n')
  check('터치 ⑤: 저장된 순서가 화면과 같다', saved.join() === before.join(), `${saved.join()} / ${before.join()}`)
  check('터치 ⑤: 카드 표지가 맨 앞으로 올린 사진',
    parseImages(saved.join('\n'))[0] === 'https://x/3.png', parseImages(saved.join('\n'))[0])

  act(() => { root.unmount() })

  // 터치에서는 끌기를 아예 안 건다 (data-reorder-index 가 붙지 않는다)
  const again = mount(React.createElement(ItemModal, {
    item: { ...item, image_url: saved.join('\n') },
    categories: [], slots: [], userId: 'u1', onClose: () => {}, onSaved: () => {}
  }))
  check('터치: 끌기 훅을 안 붙인다',
    qa(again.host, '.img-thumb[data-reorder-index]').length === 0,
    qa(again.host, '.img-thumb[data-reorder-index]').length)
  check('터치: 파일 줄도 끌기를 안 붙인다',
    qa(again.host, '.file-row[data-reorder-index]').length === 0)
  act(() => { again.root.unmount() })

  window.matchMedia = realMM || NO_MATCH
  resetStore()
}

// ── 14. 모션 배선 (jsdom) ───────────────────────────────────
//   브라우저 점검(check:mobile)이 '어떻게 움직이는가' 를 재고, 여기서는 '언제 걸리는가' 를 본다.
//   🔴 등장을 새 카드에만 거는 것이 요점이다. 목록을 다시 그릴 때마다 전부 떠오르면
//      그건 피드백이 아니라 소음이고, 검색어를 칠 때마다 화면이 출렁인다.
{
  resetStore()
  window.sessionStorage.clear()
  const mk = (n) => Array.from({ length: n }, (_, i) => ({
    id: `it${i + 1}`, user_id: 'u1', title: `항목 ${i + 1}`, content: '', tags: [],
    link_url: null, image_url: null, files: [], status: 'none', deleted_at: null,
    created_at: new Date(2026, 0, 1).toISOString(), updated_at: new Date(2026, 0, 1).toISOString()
  }))
  store.rows.items.push(...mk(15))
  // 🔴 기본 탭은 '오늘' 이다 — 카드 목록은 '보관함' 탭에 있다
  window.localStorage.setItem('archive-tab', 'archive')
  const m = mount(React.createElement(ToastProvider, null,
    React.createElement(Archive, { session: { user: { id: 'u1', email: 'a@b.c' } }, onNavigate: () => {} })))
  await act(async () => {})
  await act(async () => {})

  const cards = () => qa(m.host, '.card')
  check('모션: 카드가 그려진다', cards().length > 0, cards().length)
  check('모션: 첫 그림에는 등장이 걸린다', cards().every((c) => c.classList.contains('card-in')),
    cards().filter((c) => !c.classList.contains('card-in')).length + '개 빠짐')
  const delays = cards().map((c) => c.style.getPropertyValue('--i'))
  check('모션: 스태거가 25ms 씩', delays.slice(0, 12).every((d, i) => d === (i === 0 ? '' : `${i * 25}ms`)),
    delays.slice(0, 13).join('|'))
  check('모션: 12장 뒤로는 지연 없음', delays.slice(12).every((d) => d === ''), delays.slice(12).join('|'))
  check('모션: FLIP 열쇠가 붙는다', cards().every((c) => c.getAttribute('data-flip-key')))

  /* 다시 그려도 판정이 흔들리지 않는가.
     🔴 목록은 처음 뜬 뒤에도 여러 번 다시 그려진다(개수·소속을 뒤이어 받아 온다).
        그때마다 '새 카드' 판정을 다시 하면 등장 클래스가 붙었다 떨어졌다 하면서
        애니메이션이 중간에 잘린다 — 판정은 카드마다 한 번이어야 한다.
        (이 자리에서 실제로 그렇게 잘렸고, 그래서 판정을 기억하도록 고쳤다.) */
  const snap = () => cards().map((c) => c.getAttribute('data-flip-key') + ':'
    + (c.classList.contains('card-in') ? 'in' : '-') + ':' + c.style.getPropertyValue('--i')).join(',')
  const before = snap()
  /* 🔴 다시 그리게 만드는 방법으로 **목록이 안 바뀌는 것**을 고른다. '중요' 필터를 누르면
     목록 자체가 비어 버려서(중요 표시한 항목이 없다) 판정이 아니라 데이터가 바뀐다.
     보기 전환(갤러리↔리스트)은 같은 카드를 그대로 두고 다시 그린다. */
  await act(async () => { qa(m.host, '.view-toggle button')[1]?.click() })
  await act(async () => {})
  const after = snap()
  check('모션: 다시 그려도 등장 판정이 그대로다', after === before, after === before ? '' : after.slice(0, 120))

  /* 🔴 빠른 저장 펄스(⑤)는 여기서 재지 않는다 — 재는 방법이 없어서가 아니라,
     jsdom + React 제어 입력에서 **값 주입이 state 로 들어가지 않기** 때문이다
     (네이티브 setter 를 거쳐도 그렇다. 같은 트리의 버튼 클릭은 정상으로 돈다 —
     위 '중요' 칩이 그 증거다). 억지로 흉내 내면 재는 것은 화면이 아니라 우리 흉내다.
     클래스가 실제로 있고 규칙대로 도는지는 브라우저 점검(mode=motion)이 본다. */
  check('모션: 빠른 저장 줄이 있다', !!q(m.host, '.quick-row input'))
  check('모션: 저장 전에는 체크가 없다', q(m.host, '.quick-check') === null)
  act(() => { m.root.unmount() })
  resetStore()
}

// ── 14-b. 모션 규칙 자체 ────────────────────────────────────
{
  check('모션: 지속시간이 150~250ms 안', DUR_MS >= 150 && DUR_MS <= 250, DUR_MS)
  check('모션: 스태거 25ms · 12장', STAGGER_MS === 25 && STAGGER_MAX === 12, `${STAGGER_MS}/${STAGGER_MAX}`)
  check('모션: 12번째까지만 밀린다', staggerDelay(11) === 275 && staggerDelay(12) === 0,
    `${staggerDelay(11)} / ${staggerDelay(12)}`)
  // reduced-motion 이면 지연도 0 이고 playOnce 도 곧바로 끝난다(클래스를 붙이지 않는다)
  const realMM = window.matchMedia
  window.matchMedia = (qq) => ({ matches: String(qq).includes('reduced-motion'), media: qq,
    addEventListener() {}, removeEventListener() {} })
  check('reduced-motion: 스태거 0', staggerDelay(5) === 0, staggerDelay(5))
  const el = document.createElement('div')
  const t0 = Date.now()
  await playOnce(el, 'card-out')
  check('reduced-motion: 사라지는 모션도 안 건다',
    !el.classList.contains('card-out') && Date.now() - t0 < 50, el.className)
  window.matchMedia = realMM
}

// ── 요약 ────────────────────────────────────────────────────
let bad = 0
for (const c of checks) {
  if (!c.ok) bad++
  console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.extra !== undefined ? '  (' + c.extra + ')' : ''))
}
console.log(bad === 0 ? 'ALL PASS (' + checks.length + ')' : bad + ' FAILED of ' + checks.length)
process.exit(bad === 0 ? 0 : 1)
