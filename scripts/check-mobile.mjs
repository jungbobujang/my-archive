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

  /* 썸네일 위가 다시 사진으로 보이는가.
     🔴 예전에는 손잡이(⠿ 26px)와 ✕(28px)가 76px 칸의 윗변을 거의 다 덮었다.
        고를 대상이 사진인데 화면에는 단추만 보였다. 손잡이를 없애고 ✕ 를 줄였으므로,
        '덮인 넓이' 를 숫자로 재서 다시 커지면 여기서 걸리게 한다. */
  check('375px(순서): 손잡이(⠿)가 없다',
    (await page.$$('.img-grip')).length === 0)
  const cover = await page.evaluate(() => {
    const t = document.querySelector('.img-thumb')
    const r = t.getBoundingClientRect()
    let used = 0
    for (const b of t.querySelectorAll('button:not(.img-thumb-open), .reorder-grip')) {
      const br = b.getBoundingClientRect()
      used += br.width * br.height
    }
    return Math.round((used / (r.width * r.height)) * 100)
  })
  check('375px(순서): 단추가 썸네일의 15% 를 넘지 않는다', cover <= 15, cover + '%')

  /* ① 맨 끝 사진을 표지로 — **탭 두 번**에 끝나야 한다.
     🔴 이 시나리오가 이 화면의 존재 이유다. 순서를 바꾸는 이유는 열에 아홉이
        '표지를 이걸로' 이고, 예전 방식(꾹 누르고 끌기)은 폰에서 그걸 못 해냈다. */
  const tap = async (sel, i = 0) => {
    const at = await centerOf(sel, i)
    await touch('touchStart', at.x, at.y)
    await sleep(60)                     // 롱프레스 300ms 보다 훨씬 짧게 — 그냥 탭이다
    await touch('touchEnd', at.x, at.y)
    await sleep(140)
  }

  await tap('.img-thumb', 2)                          // 탭 1: 맨 끝 사진 고르기
  check('375px(순서): 탭하면 고른 표시가 붙는다',
    (await page.$$('.img-thumb.img-picked')).length === 1)
  check('375px(순서): 고른 것이 3번째',
    await page.evaluate(() => [...document.querySelectorAll('.img-thumb')][2].classList.contains('img-picked')))
  check('375px(순서): 옮기기 줄이 뜬다', (await page.$('.img-pickbar')) !== null)
  check('375px(순서): 탭이 확대창을 열지 않는다', (await page.$('.img-zoom')) === null)
  const barHit = await page.evaluate(() => {
    const el = document.querySelector('.img-pickbar-first')
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el, '::after')
    const num = (v) => (v === 'auto' ? 0 : parseFloat(v) || 0)
    const has = cs.content !== 'none'
    return { w: Math.round(r.width - (has ? num(cs.left) + num(cs.right) : 0)),
      h: Math.round(r.height - (has ? num(cs.top) + num(cs.bottom) : 0)) }
  })
  check('375px(순서): [맨 앞] 손가락 영역 44px 급', barHit.h >= 44, JSON.stringify(barHit))

  await tap('.img-pickbar-first')                     // 탭 2: 맨 앞으로
  const after = await order()
  check('375px(순서): 탭 2번에 맨 끝 사진이 대표가 된다',
    after[0] === before[2] && after.length === 3, before.join() + ' → ' + after.join())
  check('375px(순서): 대표 뱃지가 첫 칸에 있다', await page.evaluate(
    () => document.querySelector('.img-thumb .img-thumb-tag')?.textContent === '대표'
  ))
  check('375px(순서): 선택이 옮긴 사진을 따라간다', await page.evaluate(
    () => [...document.querySelectorAll('.img-thumb')][0].classList.contains('img-picked')
  ))

  // ② 꾹 눌러 끌어도 순서가 바뀌지 않는다 — 터치에서는 끌기를 버렸다
  const kept = await order()
  const a = await centerOf('.img-thumb', 0)
  const c = await centerOf('.img-thumb', 2)
  await touch('touchStart', a.x, a.y)
  await sleep(400)
  await touch('touchMove', a.x + 10, a.y)
  await touch('touchMove', c.x, c.y)
  await sleep(60)
  await touch('touchEnd', c.x, c.y)
  await sleep(150)
  check('375px(순서): 폰에서는 끌어도 순서가 안 바뀐다 (탭 방식만)',
    (await order()).join() === kept.join(), (await order()).join())

  /* ③ 스크롤을 방해하지 않는가.
     🔴 끌기를 버린 지금은 더 단순해졌다 — touchmove 를 막는 코드 자체가 안 걸린다.
        그래도 계속 잰다. 이 값이 다시 none 이 되거나 touchmove 가 막히는 날,
        사람은 '순서 바꾸기가 이상하다' 가 아니라 '화면이 안 넘어간다' 로 만난다. */
  const ta = await page.evaluate(() => ({
    strip: getComputedStyle(document.querySelector('.img-strip')).touchAction,
    thumb: getComputedStyle(document.querySelector('.img-thumb')).touchAction,
    row: getComputedStyle(document.querySelector('.file-row')).touchAction
  }))
  check('375px(순서): 평소 touch-action 을 묶어 두지 않는다',
    ta.strip !== 'none' && ta.thumb !== 'none' && ta.row !== 'none', JSON.stringify(ta))
  const blockedAfter = await page.evaluate(() => {
    const ev = new TouchEvent('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  check('375px(순서): 손가락으로 화면을 넘길 수 있다', blockedAfter === false, blockedAfter)

  // ④ 선택 해제
  await tap('.img-pickbar-off')
  check('375px(순서): 선택을 놓으면 줄이 사라진다', (await page.$('.img-pickbar')) === null)
  check('375px(순서): 놓아도 순서는 그대로', (await order()).join() === kept.join())

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

/* ── 순서 바꾸기: 1280px 마우스 끌기 ─────────────────────────────────
   마우스에서는 끌기가 제일 빠르므로 그대로 뒀다. 대신 **첫 자리에 놓기**를 잰다.
   🔴 사람은 맨 앞으로 보낼 때 커서를 1번 썸네일 **왼쪽 여백**으로 끌고 간다. 예전에는
      그 자리가 항목이 아니라 통이라 판정이 서지 않아, 왼쪽 끝까지 끌어도 순서가 안 바뀌었다
      ('가장자리 절반 폭' 으로 보고된 자리). 지금은 통 안이면 가장 가까운 칸으로 떨어진다. */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(`${base}?mode=reorder`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.img-thumb', { timeout: 15000 })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const order = () => page.evaluate(
    () => [...document.querySelectorAll('.img-thumb-open img')].map((i) => i.getAttribute('src').slice(-24))
  )
  const boxOf = (sel, i = 0) => page.evaluate((s2, n) => {
    const el = document.querySelectorAll(s2)[n]
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }
  }, sel, i)

  await page.evaluate(() => document.querySelector('.img-strip')?.scrollIntoView({ block: 'center' }))
  await sleep(120)
  const before = await order()
  check('1280px(순서): 마우스에서는 끌기가 살아 있다',
    (await page.$$('.img-thumb[data-reorder-index]')).length === 3)

  /* ① 주 경로는 **클릭-버튼**이다 — 폰과 완전히 같은 조작.
     🔴 여기가 이번 개정의 요점이다. 기기마다 조작이 다르면 '폰에서 되던 방법' 이 PC 에서
        안 먹고, 그때 사람은 기능이 없어진 줄 안다. 맨 끝 → 대표가 **클릭 두 번**이어야 한다. */
  const clickAt = async (sel, i = 0) => {
    const el = (await page.$$(sel))[i]
    await el.click()
    await sleep(140)
  }
  await clickAt('.img-thumb-open', 2)
  check('1280px(순서): 클릭하면 고른 표시가 붙는다',
    (await page.$$('.img-thumb.img-picked')).length === 1)
  check('1280px(순서): 옮기기 줄이 뜬다 (폰과 같은 줄)', (await page.$('.img-pickbar')) !== null)
  check('1280px(순서): 클릭이 확대창을 열지 않는다', (await page.$('.img-zoom')) === null)
  await clickAt('.img-pickbar-first')
  const clicked = await order()
  check('1280px(순서): 클릭 2번에 맨 끝이 대표가 된다',
    clicked[0] === before[2], `${before.join()} → ${clicked.join()}`)

  /* ② 크게 보기 경로가 살아 있는가 — 클릭이 '고르기' 가 되면서 옮긴 자리다 */
  const zoomBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.img-pickbar .btn-sm')].find((b) => b.textContent.includes('크게 보기')))
  await zoomBtn.asElement().click()
  await sleep(150)
  check('1280px(순서): [크게 보기] 로 확대창이 열린다', (await page.$('.img-zoom')) !== null)
  await page.evaluate(() => document.querySelector('.img-zoom-x')?.click())
  await sleep(150)
  check('1280px(순서): 확대창이 닫힌다', (await page.$('.img-zoom')) === null)
  await page.evaluate(() => document.querySelector('.img-pickbar-off')?.click())
  await sleep(150)

  // 되돌려 놓고 아래 끌기 판정으로 넘어간다 (끌기는 남겨 둔 곁길이다)
  await page.evaluate(() => {
    const thumbs = [...document.querySelectorAll('.img-thumb-open')]
    thumbs[0].click()
  })
  await sleep(140)
  for (let n = 0; n < 2; n++) {
    await page.evaluate(() => [...document.querySelectorAll('.img-pickbar .btn-sm')]
      .find((b) => b.getAttribute('aria-label') === '한 칸 뒤로')?.click())
    await sleep(120)
  }
  await page.evaluate(() => document.querySelector('.img-pickbar-off')?.click())
  await sleep(140)
  check('1280px(순서): [▶] 두 번으로 제자리', (await order()).join() === before.join(), (await order()).join())

  // 맨 끝 썸네일을 잡아 **첫 썸네일보다 왼쪽**(줄의 여백)으로 끌어다 놓는다
  const last = await boxOf('.img-thumb', 2)
  const strip = await boxOf('.img-strip')
  await page.mouse.move(last.cx, last.cy)
  await page.mouse.down()
  await page.mouse.move(last.cx - 20, last.cy, { steps: 4 })
  await page.mouse.move(strip.x + 2, last.cy, { steps: 8 })   // 첫 칸의 왼쪽 여백
  await sleep(60)
  await page.mouse.up()
  await sleep(150)
  const after = await order()
  check('1280px(순서): 왼쪽 여백에 놓아도 맨 앞으로 간다',
    after[0] === before[2], `${before.join()} → ${after.join()}`)

  // 오른쪽 끝 여백도 같다 — 맨 뒤로 보내기
  const first = await boxOf('.img-thumb', 0)
  const strip2 = await boxOf('.img-strip')
  await page.mouse.move(first.cx, first.cy)
  await page.mouse.down()
  await page.mouse.move(first.cx + 20, first.cy, { steps: 4 })
  await page.mouse.move(strip2.x + strip2.w - 2, first.cy, { steps: 8 })
  await sleep(60)
  await page.mouse.up()
  await sleep(150)
  const after2 = await order()
  check('1280px(순서): 오른쪽 여백에 놓으면 맨 뒤로 간다',
    after2[after2.length - 1] === after[0], `${after.join()} → ${after2.join()}`)

  // 고른 것이 없으면 줄도 없다 (있는 줄은 PC·폰 같은 줄이다 — 위 ①에서 확인했다)
  check('1280px(순서): 고른 것이 없으면 옮기기 줄이 없다', (await page.$('.img-pickbar')) === null)
  await page.screenshot({ path: path.join(outDir, 'modal-1280-reorder.png'), fullPage: true })
  await page.close()
}

/* ── 모션 ────────────────────────────────────────────────────────────
   카드 49장을 띄워 놓고 네 가지를 잰다.
     ① 등장이 스태거로 걸리는가 (25ms 씩, 12장까지만)
     ② 자리가 바뀔 때 FLIP 으로 미끄러지는가 (순간이동이 아닌가)
     ③ 49장이 움직이는 동안 프레임이 버티는가
     ④ prefers-reduced-motion: reduce 면 **전부** 꺼지는가
   🔴 ④ 가 이 묶음의 핵심이다. 나머지는 취향이지만 이건 접근성이고, 켜 둔 사람에게
      '조금 줄인 애니메이션' 은 여전히 어지럼증을 부른다. */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  await page.goto(`${base}?mode=motion`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.card', { timeout: 15000 })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // ① 스태거 — 카드마다 animation-delay 가 25ms 씩 늘고, 12장 뒤부터는 0
  const stag = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.card')]
    const ms = (v) => Math.round(parseFloat(v) * (v.includes('ms') ? 1 : 1000))
    return {
      count: els.length,
      inClass: els.filter((e) => e.classList.contains('card-in')).length,
      delays: els.slice(0, 14).map((e) => ms(getComputedStyle(e).animationDelay)),
      dur: ms(getComputedStyle(els[0]).animationDuration),
      name: getComputedStyle(els[0]).animationName,
      // 성능 가드: 움직이는 것이 transform·opacity 뿐인가
      keyframeProps: (() => {
        for (const sheet of document.styleSheets) {
          let rules; try { rules = sheet.cssRules } catch { continue }
          for (const r of rules || []) {
            if (r.type === CSSRule.KEYFRAMES_RULE && ['card-in', 'card-out', 'card-saved'].includes(r.name)) {
              for (const k of r.cssRules) {
                for (const prop of k.style) {
                  if (!['transform', 'opacity'].includes(prop)) return prop  // 레이아웃 속성이 섞였다
                }
              }
            }
          }
        }
        return 'ok'
      })()
    }
  })
  check('모션: 카드 49장', stag.count === 49, stag.count)
  check('모션: 등장이 걸린다', stag.inClass === 49, stag.inClass)
  check('모션: 150~250ms 안', stag.dur >= 150 && stag.dur <= 250, stag.dur + 'ms')
  check('모션: 스태거 25ms 씩', stag.delays.slice(0, 12).every((d, i) => d === i * 25),
    stag.delays.slice(0, 12).join(','))
  check('모션: 12장 뒤는 지연 없음', stag.delays.slice(12).every((d) => d === 0),
    stag.delays.slice(12).join(','))
  check('모션: transform·opacity 만 움직인다', stag.keyframeProps === 'ok', stag.keyframeProps)

  // ② hover — 2px 들림
  //    🔴 :hover 는 합성 이벤트로 안 걸린다. 스타일시트에서 규칙을 직접 읽는다.
  //    🔴 일치하는 규칙을 **전부** 모은다 — 뒤쪽 reduced-motion 블록에도 .card:hover 가 있어서
  //       마지막 하나만 보면 언제나 'none' 을 읽는다 (그 자리에서 한 번 헛짚었다).
  const hoverRules = await page.evaluate(() => {
    const out = []
    const walk = (rules, inMedia) => {
      for (const r of rules || []) {
        if (r.type === CSSRule.MEDIA_RULE) walk(r.cssRules, r.conditionText || '')
        else if (r.selectorText === '.card:hover' && r.style.transform) {
          out.push({ media: inMedia, transform: r.style.transform })
        }
      }
    }
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules } catch { continue }
      walk(rules, '')
    }
    return out
  })
  check('모션: hover 에 2px 들림 규칙이 있다',
    hoverRules.some((r) => /-2px/.test(r.transform) && /hover/.test(r.media)),
    JSON.stringify(hoverRules))
  check('모션: 터치 기기에는 hover 들림을 안 건다',
    hoverRules.filter((r) => /-2px/.test(r.transform)).every((r) => /hover: *hover/.test(r.media)),
    JSON.stringify(hoverRules.map((r) => r.media)))

  // ③ FLIP — 자리가 바뀌면 인라인 transform 이 잠깐 걸린다(=미끄러지는 중)
  await page.evaluate('window.__motion.settle()')
  await sleep(300)
  /* 🔴 한 프레임만 집으면 안 된다. FLIP 은 '되돌려 놓기(transition:none)' 와
     '놓아주기(transition:transform)' 가 연속된 두 프레임에 걸쳐 일어나서, 어느 한쪽을
     찍으면 다른 쪽을 못 본다. 20프레임을 훑어 그 둘이 다 있었는지를 본다. */
  const flip = await page.evaluate(async () => {
    const first = document.querySelector('[data-flip-key]')
    const key = first.getAttribute('data-flip-key')
    const y0 = first.getBoundingClientRect().top
    window.__motion.shuffle()
    const frames = []
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      const el = document.querySelector(`[data-flip-key="${key}"]`)
      if (!el) continue
      frames.push({ tr: el.style.transform, trans: el.style.transition,
        top: el.getBoundingClientRect().top })
    }
    await new Promise((r) => setTimeout(r, 400))
    const end = document.querySelector(`[data-flip-key="${key}"]`)
    return { y0, frames, endY: end.getBoundingClientRect().top, endTr: end.style.transform }
  })
  const inverted = flip.frames.find((f) => /translate/.test(f.tr || ''))
  check('FLIP: 이동 중 transform 이 걸린다', !!inverted, inverted && inverted.tr)
  check('FLIP: transform 만 트랜지션한다',
    flip.frames.some((f) => /^transform [0-9]+ms/.test(f.trans || '')),
    JSON.stringify([...new Set(flip.frames.map((f) => f.trans))]))
  check('FLIP: 되돌린 자리가 옛 자리다',
    inverted && Math.abs(inverted.top - flip.y0) < 3,
    inverted && `${Math.round(inverted.top)} vs ${Math.round(flip.y0)}`)
  check('FLIP: 끝나면 인라인 값이 걷힌다', !flip.endTr, JSON.stringify(flip.endTr))
  check('FLIP: 실제로 자리가 바뀌었다', Math.abs(flip.endY - flip.y0) > 20,
    `${Math.round(flip.y0)} → ${Math.round(flip.endY)}`)

  // ③-2 프레임 — 49장이 한꺼번에 움직이는 동안 긴 프레임이 몇 번인가
  const frames = await page.evaluate(async () => {
    const gaps = []
    let last = performance.now()
    let stop = false
    const tick = (t) => { gaps.push(t - last); last = t; if (!stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    window.__motion.shuffle()
    await new Promise((r) => setTimeout(r, 500))
    stop = true
    const long = gaps.filter((g) => g > 34).length      // 30fps 밑으로 떨어진 프레임
    return { n: gaps.length, long, worst: Math.round(Math.max(...gaps)) }
  })
  check('모션: 49장 이동에도 프레임이 버틴다', frames.long <= 2,
    `긴 프레임 ${frames.long}/${frames.n} · 최악 ${frames.worst}ms`)

  // ④ reduced-motion — 전부 꺼진다
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.card', { timeout: 15000 })
  const off = await page.evaluate(async () => {
    const el = document.querySelector('.card')
    const cs = getComputedStyle(el)
    const before = el.getBoundingClientRect().top
    window.__motion.settle()
    await new Promise((r) => setTimeout(r, 200))
    const first = document.querySelector('[data-flip-key]')
    const key = first.getAttribute('data-flip-key')
    window.__motion.shuffle()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const moved = document.querySelector(`[data-flip-key="${key}"]`)
    return {
      anim: cs.animationName, dur: cs.animationDuration, trans: cs.transitionDuration,
      inlineTr: moved.style.transform, before
    }
  })
  check('reduced-motion: 등장 애니메이션 0', off.anim === 'none' || off.dur === '0s',
    `${off.anim} / ${off.dur}`)
  check('reduced-motion: 트랜지션 0', /^0s(, 0s)*$/.test(off.trans), off.trans)
  check('reduced-motion: FLIP 도 안 건다', !off.inlineTr, JSON.stringify(off.inlineTr))
  await page.screenshot({ path: path.join(outDir, 'motion-1280.png') })
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
