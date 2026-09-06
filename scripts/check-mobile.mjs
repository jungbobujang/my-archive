// 좁은 화면(375px) 점검. 실제 크롬을 띄워 모달을 열고, 가로 스크롤·손가락 크기·
// 링크 줄 겹침을 재고 스크린샷을 남긴다. 도구는 필요할 때만 깔면 된다:
//
//   npm install --no-save puppeteer
//   node scripts/check-mobile.mjs [스크린샷 폴더]
//
// vite 개발 서버를 코드에서 직접 띄우므로 따로 npm run dev 를 켤 필요는 없다.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(here, '..')

try {
  require.resolve('puppeteer')
} catch {
  console.error('puppeteer 가 없습니다.  npm install --no-save puppeteer  뒤에 다시 실행해 주세요.')
  process.exit(2)
}

const puppeteer = require('puppeteer')
const { createServer } = await import('vite')

const outDir = process.argv[2] ?? path.join(rootDir, 'node_modules', '.cache', 'mobile-shots')
fs.mkdirSync(outDir, { recursive: true })

const server = await createServer({ root: rootDir, logLevel: 'warn', server: { port: 0 } })
await server.listen()
const { port } = server.httpServer.address()
const base = `http://localhost:${port}/scripts/mobile-harness/modal.html`

const checks = []
const check = (name, ok, extra) => checks.push({ name, ok: !!ok, extra })
const browser = await puppeteer.launch({ headless: 'new' })

// focusSel 을 주면 그 자리를 화면 안으로 굴린 뒤 찍는다. 모달은 스스로 세로 스크롤을
// 하므로, 아래쪽에 있는 파일 영역은 굴리지 않으면 스크린샷에 아예 담기지 않는다.
// fullPage 를 끄면 '사람이 실제로 보는 만큼' 만 찍는다. 잠금 화면이 그렇다 —
// 화면을 덮는 것이 일이므로, 문서 전체를 찍으면 덮을 필요가 없는 아래쪽까지 나와
// 스크린샷만 보고는 새는 줄로 읽힌다.
async function shot(name, url, width, height, focusSel, waitSel = '.modal', fullPage = true) {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForSelector(waitSel, { timeout: 15000 })
  if (focusSel) {
    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView({ block: 'center' })
    }, focusSel)
  }
  const info = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    }
    // ::after 로 넓힌 손가락 영역까지 재기
    const hit = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el, '::after')
      const num = (v) => (v === 'auto' ? 0 : parseFloat(v) || 0)
      const has = cs.content !== 'none'
      return {
        w: Math.round(r.width - (has ? num(cs.left) + num(cs.right) : 0)),
        h: Math.round(r.height - (has ? num(cs.top) + num(cs.bottom) : 0))
      }
    }
    return {
      docScrollW: document.documentElement.scrollWidth,
      modal: box('.modal'),
      linkRows: document.querySelectorAll('.link-row').length,
      linkX: hit('.link-x'),
      addBtn: box('.link-add button'),
      addInputFont: (() => {
        const el = document.querySelector('.link-add input')
        return el ? parseFloat(getComputedStyle(el).fontSize) : null
      })(),
      rowOverflow: [...document.querySelectorAll('.link-row')].some((r) => r.scrollWidth > r.clientWidth + 1),
      fileRows: document.querySelectorAll('.file-row').length,
      filePick: box('.file-pick'),
      fileDrop: box('.file-drop'),
      fileXHit: hit('.file-row .link-x'),
      // 기본 파일 위젯은 고른 파일명을 그대로 늘여 좁은 화면을 넘긴다. 숨겨져 있어야 한다.
      fileInputHidden: (() => {
        const el = document.querySelector('.file-input')
        return el ? getComputedStyle(el).display === 'none' : null
      })(),
      fileRowOverflow: [...document.querySelectorAll('.file-row')].some((r) => r.scrollWidth > r.clientWidth + 1),
      fileNameOverlapsX: (() => {
        const row = document.querySelector('.file-row')
        if (!row) return null
        const a = row.querySelector('.file-open').getBoundingClientRect()
        const x = row.querySelector('.link-x').getBoundingClientRect()
        return a.right > x.left + 1
      })(),
      // 지시대로 이미지 영역 '아래' 인지는 DOM 순서가 아니라 화면 좌표로 본다
      fileBelowImage: (() => {
        const img = document.querySelector('.img-drop')
        const f = document.querySelector('.file-drop')
        if (!img || !f) return null
        return f.getBoundingClientRect().top >= img.getBoundingClientRect().bottom - 1
      })(),
      fileNames: [...document.querySelectorAll('.file-name')].map((el) => el.textContent.trim()),
      fileSizes: [...document.querySelectorAll('.file-size')].map((el) => el.textContent.trim()),
      anchorOverlapsX: (() => {
        const row = document.querySelector('.link-row')
        if (!row) return null
        const a = row.querySelector('a').getBoundingClientRect()
        const x = row.querySelector('.link-x').getBoundingClientRect()
        return a.right > x.left + 1
      })(),
      linkTexts: [...document.querySelectorAll('.link-row a')].map((a) => a.textContent.trim()),

      // ── 잠금 화면 ──
      lockBox: box('.lock-box'),
      lockPin: box('.lock-pin'),
      lockPinFont: (() => {
        const el = document.querySelector('.lock-pin')
        return el ? parseFloat(getComputedStyle(el).fontSize) : null
      })(),
      // 가림막이 정말 불투명한가. 알파가 1 이 아니면 뒤엣것이 비친다.
      lockOpaque: (() => {
        const el = document.querySelector('.lock-screen')
        if (!el) return null
        const bg = getComputedStyle(el).backgroundColor
        const m = bg.match(/rgba?\(([^)]+)\)/)
        if (!m) return false
        const parts = m[1].split(',').map((s) => parseFloat(s))
        return parts.length < 4 || parts[3] === 1
      })(),
      // 화면 전체를 덮는가 (한 귀퉁이라도 남으면 그리로 보인다)
      lockCovers: (() => {
        const el = document.querySelector('.lock-screen')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return r.top <= 0 && r.left <= 0
          && r.width >= window.innerWidth && r.height >= window.innerHeight
      })(),
      // 손가락으로 뒤 페이지를 굴리지 못하게 막았는가.
      // (overflow:hidden 은 '사람이 굴리는 것' 만 막는다. scrollTo 같은 코드는 그래도 굴러가고,
      //  scrollHeight 도 내용 높이를 그대로 말한다. 그래서 이 값만 본다.)
      lockScrollLocked: (() => {
        if (!document.querySelector('.lock-screen')) return null
        return getComputedStyle(document.documentElement).overflow === 'hidden'
      })(),
      // 그리고 어떤 이유로든 굴러갔더라도 가림막은 여전히 화면을 덮어야 한다.
      // position: fixed 는 뷰포트를 따라다니므로 이것이 마지막 보루다.
      lockCoversAfterScroll: (() => {
        const el = document.querySelector('.lock-screen')
        if (!el) return null
        window.scrollTo(0, 5000)
        const r = el.getBoundingClientRect()
        const pts = [[10, 10], [window.innerWidth - 10, window.innerHeight - 10]]
        const ok = r.top <= 0 && r.left <= 0
          && r.width >= window.innerWidth && r.height >= window.innerHeight
          && pts.every(([x, y]) => document.elementFromPoint(x, y)?.closest('.lock-screen'))
        window.scrollTo(0, 0)
        return ok
      })(),
      // 가림막 위에서 실제로 집히는 것이 잠금 화면인지 — 뒤엣것이 집히면 덮은 게 아니다
      lockTopmost: (() => {
        if (!document.querySelector('.lock-screen')) return null
        const pts = [[10, 10], [window.innerWidth - 10, 10],
                     [10, window.innerHeight - 10], [window.innerWidth - 10, window.innerHeight - 10]]
        return pts.every(([x, y]) => document.elementFromPoint(x, y)?.closest('.lock-screen'))
      })()
    }
  })
  await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage })
  await page.close()
  return info
}

const m = await shot('modal-375-edit', `${base}?mode=edit`, 375, 812)
check('375px: 가로 스크롤 없음', m.docScrollW <= 375, m.docScrollW)
check('375px: 저장된 링크 3줄', m.linkRows === 3, m.linkRows)
check('375px: 빼기(✕) 손가락 영역 40px 급', m.linkX && m.linkX.h >= 40 && m.linkX.w >= 38, JSON.stringify(m.linkX))
check('375px: 담기 버튼 44px 이상', m.addBtn && m.addBtn.h >= 44, JSON.stringify(m.addBtn))
check('375px: 입력 글꼴 16px (iOS 확대 방지)', m.addInputFont >= 16, m.addInputFont)
check('375px: 링크 줄이 옆으로 넘치지 않는다', m.rowOverflow === false)
check('375px: 주소가 ✕ 를 덮지 않는다', m.anchorOverlapsX === false)
check('375px: 모달 폭이 화면 안', m.modal && m.modal.w <= 375, JSON.stringify(m.modal))

const n = await shot('modal-375-new', `${base}?mode=new`, 375, 812)
check('375px(새 항목): 가로 스크롤 없음', n.docScrollW <= 375, n.docScrollW)
check('375px(새 항목): 링크 줄 없음', n.linkRows === 0, n.linkRows)

const mu = await shot('modal-375-multi', `${base}?mode=multi`, 375, 900)
check('375px(링크 3개): 가로 스크롤 없음', mu.docScrollW <= 375, mu.docScrollW)
check('375px(링크 3개): 3줄', mu.linkRows === 3, mu.linkRows)
check('375px(링크 3개): 서로 다른 링크가 다르게 보인다', new Set(mu.linkTexts).size === 3, mu.linkTexts.join(' | '))

const f = await shot('modal-375-files', `${base}?mode=files`, 375, 900, '.file-drop')
check('375px(파일): 가로 스크롤 없음', f.docScrollW <= 375, f.docScrollW)
check('375px(파일): 3줄', f.fileRows === 3, f.fileRows)
check('375px(파일): 파일 영역이 이미지 영역 아래', f.fileBelowImage === true)
check('375px(파일): 파일 영역이 모달 폭 안', f.fileDrop && f.modal && f.fileDrop.w <= f.modal.w, JSON.stringify(f.fileDrop))
check('375px(파일): 줄이 옆으로 넘치지 않는다', f.fileRowOverflow === false)
check('375px(파일): 긴 이름이 ✕ 를 덮지 않는다', f.fileNameOverlapsX === false)
check('375px(파일): 빼기(✕) 손가락 영역 40px 급', f.fileXHit && f.fileXHit.h >= 40 && f.fileXHit.w >= 38, JSON.stringify(f.fileXHit))
check('375px(파일): 첨부 버튼 44px 이상', f.filePick && f.filePick.h >= 44, JSON.stringify(f.filePick))
check('375px(파일): 기본 파일 위젯은 숨어 있다', f.fileInputHidden === true)
check('375px(파일): 이름이 잘리지 않고 그대로', f.fileNames[1] === '학생 명단.xlsx', f.fileNames.join(' | '))
check('375px(파일): 용량이 붙어 있다', f.fileSizes.join(' ') === '2.3MB 18KB 940B', f.fileSizes.join(' '))

/* ── 순서 바꾸기: 375px 터치 ──────────────────────────────────────────
   여기서 재려는 것은 둘이다.
   ① 꾹 누른 뒤 끌면 순서가 바뀐다.
   ② 그냥 쓸어내리면 순서는 그대로이고 **화면이 스크롤된다**.
   🔴 ② 가 이 기능의 진짜 위험이다. 썸네일 줄에 touch-action:none 같은 것을 걸어 두면
      순서 바꾸기는 잘 되지만 그 위에서 화면을 못 넘기게 된다 — 순서를 바꿀 일이 없는
      사람에게는 그냥 고장이다. 그래서 스크롤이 되는지를 같이 잰다. */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  await page.goto(`${base}?mode=reorder`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.img-thumb', { timeout: 15000 })

  const cdp = await page.createCDPSession()
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 10, radiusY: 10, force: 1 }]
  })
  const centerOf = (sel, i = 0) => page.evaluate((s2, n) => {
    const el = document.querySelectorAll(s2)[n]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }, sel, i)
  const order = () => page.evaluate(
    () => [...document.querySelectorAll('.img-thumb-open img')].map((i) => i.getAttribute('src').slice(-30))
  )
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await page.evaluate(() => document.querySelector('.img-strip')?.scrollIntoView({ block: 'center' }))
  await sleep(120)

  const before = await order()
  check('375px(순서): 이미지 3장', before.length === 3, before.length)
  check('375px(순서): 손잡이가 폰에서 보인다', await page.evaluate(
    () => getComputedStyle(document.querySelector('.img-grip')).opacity === '1'
  ))
  const gripHit = await page.evaluate(() => {
    const el = document.querySelector('.img-grip')
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el, '::after')
    const num = (v) => (v === 'auto' ? 0 : parseFloat(v) || 0)
    const has = cs.content !== 'none'
    return { w: Math.round(r.width - (has ? num(cs.left) + num(cs.right) : 0)),
      h: Math.round(r.height - (has ? num(cs.top) + num(cs.bottom) : 0)) }
  })
  check('375px(순서): 손잡이 손가락 영역 38px 급', gripHit.h >= 38 && gripHit.w >= 38, JSON.stringify(gripHit))

  // ① 꾹 누르고(400ms) 3번째 자리로 끌기
  const a = await centerOf('.img-thumb', 0)
  const c = await centerOf('.img-thumb', 2)
  await touch('touchStart', a.x, a.y)
  await sleep(400)                                  // 롱프레스 300ms 를 넘긴다
  await touch('touchMove', a.x + 10, a.y)
  await touch('touchMove', c.x, c.y)
  await sleep(60)
  await touch('touchEnd', c.x, c.y)
  await sleep(150)
  const after = await order()
  check('375px(순서): 꾹 눌러 끌면 순서가 바뀐다',
    after.join() !== before.join() && after[after.length - 1] === before[0],
    `${before.join()} → ${after.join()}`)

  /* ② 스크롤을 방해하지 않는가.
     🔴 여기서 재는 방법을 한 번 바꿨다. 처음에는 실제로 굴려 보려고
        Input.synthesizeScrollGesture(touch) 를 썼는데, 이 환경에서는 **끌기를 한 적이
        없는 새 페이지에서도** 안쪽 스크롤 상자를 굴리지 못했다(마우스 제스처는 굴린다).
        즉 그 실패는 우리 코드가 아니라 합성 터치의 한계였고, 그걸 그대로 두면
        '멀쩡한데 빨간 줄' 이 남아 다음 사람이 진짜 고장과 구분하지 못한다.
     그래서 스크롤 그 자체 대신 **스크롤을 막는 두 가지 수단**을 직접 잰다:
        ㄱ. 평소에 touch-action 을 none 으로 묶어 두지 않았는가 (CSS 쪽)
        ㄴ. 끌기가 끝난 뒤 touchmove 차단이 풀렸는가 (JS 쪽)
     이 둘이 지켜지면 손가락은 평소처럼 화면을 넘길 수 있다. */
  const kept = await order()
  const ta = await page.evaluate(() => ({
    strip: getComputedStyle(document.querySelector('.img-strip')).touchAction,
    thumb: getComputedStyle(document.querySelector('.img-thumb')).touchAction,
    row: getComputedStyle(document.querySelector('.file-row')).touchAction
  }))
  check('375px(순서): 평소 touch-action 을 묶어 두지 않는다',
    ta.strip !== 'none' && ta.thumb !== 'none' && ta.row !== 'none', JSON.stringify(ta))

  // 끌기가 끝난 지금, document 의 touchmove 는 아무도 막지 않아야 한다
  const blockedAfter = await page.evaluate(() => {
    const ev = new TouchEvent('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  check('375px(순서): 끌기가 끝나면 스크롤 차단이 풀린다', blockedAfter === false, blockedAfter)

  // 끌기 중에는 막아야 한다 (그래야 끌면서 화면이 같이 밀리지 않는다)
  const a2 = await centerOf('.img-thumb', 0)
  await touch('touchStart', a2.x, a2.y)
  await sleep(400)
  const blockedDuring = await page.evaluate(() => {
    const ev = new TouchEvent('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  await touch('touchEnd', a2.x, a2.y)
  await sleep(120)
  check('375px(순서): 끌기 중에는 화면이 같이 밀리지 않는다', blockedDuring === true, blockedDuring)
  const blockedAgain = await page.evaluate(() => {
    const ev = new TouchEvent('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  check('375px(순서): 손을 떼면 다시 풀린다', blockedAgain === false, blockedAgain)
  check('375px(순서): 끌지 않고 떼면 순서는 그대로', (await order()).join() === kept.join())

  // 파일 줄의 ▲▼ 손가락 영역
  await page.evaluate(() => document.querySelector('.file-list')?.scrollIntoView({ block: 'center' }))
  await sleep(120)
  const moveHit = await page.evaluate(() => {
    const el = document.querySelector('.file-move-btn')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el, '::after')
    const num = (v) => (v === 'auto' ? 0 : parseFloat(v) || 0)
    const has = cs.content !== 'none'
    return { w: Math.round(r.width - (has ? num(cs.left) + num(cs.right) : 0)),
      h: Math.round(r.height - (has ? num(cs.top) + num(cs.bottom) : 0)) }
  })
  check('375px(순서): 파일 ▲▼ 가 있다', moveHit !== null, JSON.stringify(moveHit))
  check('375px(순서): 파일 ▲▼ 손가락 영역 24px 급',
    moveHit && moveHit.h >= 24 && moveHit.w >= 30, JSON.stringify(moveHit))

  // ▲ 를 눌러 실제로 옮겨진다
  const names0 = await page.evaluate(() => [...document.querySelectorAll('.file-name')].map((n) => n.textContent))
  await page.evaluate(() => {
    const ups = [...document.querySelectorAll('.file-move-btn')]
      .filter((b) => b.getAttribute('aria-label')?.endsWith('위로'))
    ups[2]?.click()
  })
  await sleep(150)
  const names1 = await page.evaluate(() => [...document.querySelectorAll('.file-name')].map((n) => n.textContent))
  check('375px(순서): ▲ 로 파일이 올라간다',
    names1[1] === names0[2] && names1[2] === names0[1], `${names0.join(' | ')} → ${names1.join(' | ')}`)

  check('375px(순서): 가로 스크롤 없음',
    (await page.evaluate(() => document.documentElement.scrollWidth)) <= 375)

  await page.screenshot({ path: path.join(outDir, 'modal-375-reorder.png'), fullPage: true })
  await page.close()
}

const fw = await shot('modal-1280-files', `${base}?mode=files`, 1280, 900, '.file-drop')
check('1280px(파일): 가로 스크롤 없음', fw.docScrollW <= 1280, fw.docScrollW)
check('1280px(파일): 긴 이름이 ✕ 를 덮지 않는다', fw.fileNameOverlapsX === false)

const fd = await shot('modal-375-files-dark', `${base}?mode=files&theme=dark`, 375, 900, '.file-drop')
check('375px(파일) 다크: 가로 스크롤 없음', fd.docScrollW <= 375, fd.docScrollW)
check('375px(파일) 다크: 3줄', fd.fileRows === 3, fd.fileRows)

const d = await shot('modal-375-dark', `${base}?mode=edit&theme=dark`, 375, 812)
check('375px 다크: 가로 스크롤 없음', d.docScrollW <= 375, d.docScrollW)

const w = await shot('modal-1280-edit', `${base}?mode=edit`, 1280, 900)
check('1280px: 가로 스크롤 없음', w.docScrollW <= 1280, w.docScrollW)
check('1280px: 저장된 링크 3줄', w.linkRows === 3, w.linkRows)

// 잠금 화면. 뒤에 글자를 잔뜩 깔아 둔 화면이라, 스크린샷에 그 글자가 한 자라도
// 보이면 안 된다 — 사람 눈으로 확인할 것은 그것이다 (lock-375.png / lock-375-dark.png).
const lk = await shot('lock-375', `${base}?mode=lock`, 375, 812, null, '.lock-screen', false)
check('375px(잠금): 가로 스크롤 없음', lk.docScrollW <= 375, lk.docScrollW)
check('375px(잠금): 화면 전체를 덮는다', lk.lockCovers === true)
check('375px(잠금): 가림막이 불투명하다', lk.lockOpaque === true)
check('375px(잠금): 네 귀퉁이 모두 가림막이 집힌다', lk.lockTopmost === true)
check('375px(잠금): 손가락으로 뒤를 굴릴 수 없다', lk.lockScrollLocked === true)
check('375px(잠금): 굴러가도 가림막은 그대로 덮는다', lk.lockCoversAfterScroll === true)
check('375px(잠금): PIN 칸이 화면 안', lk.lockPin && lk.lockPin.w <= 375, JSON.stringify(lk.lockPin))
check('375px(잠금): PIN 글꼴 16px 이상 (iOS 확대 방지)', lk.lockPinFont >= 16, lk.lockPinFont)
check('375px(잠금): PIN 칸 44px 이상', lk.lockPin && lk.lockPin.h >= 44, JSON.stringify(lk.lockPin))

const lkd = await shot('lock-375-dark', `${base}?mode=lock&theme=dark`, 375, 812, null, '.lock-screen', false)
check('375px(잠금) 다크: 가로 스크롤 없음', lkd.docScrollW <= 375, lkd.docScrollW)
check('375px(잠금) 다크: 가림막이 불투명하다', lkd.lockOpaque === true)

const lkw = await shot('lock-1280', `${base}?mode=lock`, 1280, 900, null, '.lock-screen', false)
check('1280px(잠금): 가로 스크롤 없음', lkw.docScrollW <= 1280, lkw.docScrollW)
check('1280px(잠금): 가림막이 불투명하다', lkw.lockOpaque === true)
check('1280px(잠금): 네 귀퉁이 모두 가림막이 집힌다', lkw.lockTopmost === true)

await browser.close()
await server.close()

let bad = 0
for (const c of checks) {
  if (!c.ok) bad++
  console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.extra !== undefined ? '  (' + c.extra + ')' : ''))
}
console.log('스크린샷: ' + outDir)
console.log(bad === 0 ? 'ALL PASS (' + checks.length + ')' : bad + ' FAILED of ' + checks.length)
process.exit(bad === 0 ? 0 : 1)
