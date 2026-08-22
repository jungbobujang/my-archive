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

async function shot(name, url, width, height) {
  const page = await browser.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 2 })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.modal', { timeout: 15000 })
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
      anchorOverlapsX: (() => {
        const row = document.querySelector('.link-row')
        if (!row) return null
        const a = row.querySelector('a').getBoundingClientRect()
        const x = row.querySelector('.link-x').getBoundingClientRect()
        return a.right > x.left + 1
      })(),
      linkTexts: [...document.querySelectorAll('.link-row a')].map((a) => a.textContent.trim())
    }
  })
  await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: true })
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

const d = await shot('modal-375-dark', `${base}?mode=edit&theme=dark`, 375, 812)
check('375px 다크: 가로 스크롤 없음', d.docScrollW <= 375, d.docScrollW)

const w = await shot('modal-1280-edit', `${base}?mode=edit`, 1280, 900)
check('1280px: 가로 스크롤 없음', w.docScrollW <= 1280, w.docScrollW)
check('1280px: 저장된 링크 3줄', w.linkRows === 3, w.linkRows)

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
