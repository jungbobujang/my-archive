import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer')
const { createServer } = await import('vite')
const rootDir = process.cwd()
const server = await createServer({ root: rootDir, logLevel: 'warn', server: { port: 0 },
  resolve: { alias: { '@supabase/supabase-js': path.join(rootDir, 'scripts/fake-supabase.mjs') } } })
await server.listen()
const { port } = server.httpServer.address()
const base = `http://localhost:${port}/scripts/mobile-harness/modal.html?mode=layout`
const browser = await puppeteer.launch({ headless: 'new' })
const tag = process.argv[2] || 'before'
for (const [label, w, h] of [['1280px', 1280, 900], ['375px', 375, 812]]) {
  const p = await browser.newPage()
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  await p.goto(base, { waitUntil: 'networkidle0' })
  await p.waitForSelector('.card', { timeout: 20000 })
  await new Promise((r) => setTimeout(r, 700))
  const info = await p.evaluate(() => {
    const vh = window.innerHeight
    const cards = [...document.querySelectorAll('.card')]
    const fully = cards.filter((c) => c.getBoundingClientRect().bottom <= vh).length
    const partly = cards.filter((c) => c.getBoundingClientRect().top < vh).length
    const gridTop = document.querySelector('.item-grid, .item-masonry')?.getBoundingClientRect().top
    return { total: cards.length, fully, partly, gridTop: Math.round(gridTop ?? -1),
      docW: document.documentElement.scrollWidth, vh,
      catCards: document.querySelectorAll('.cat-card').length,
      rows: ['.tabs', '.search-row', '.quick-row', '.quick-hint', '.tag-row', '.category-grid', '.list-head']
        .map((s) => { const e = document.querySelector(s); const r = e?.getBoundingClientRect()
          return s + '=' + (r ? Math.round(r.height) : 0) }).join(' ') }
  })
  console.log(`${tag} ${label}: 전체 ${info.total}장 · 첫 화면 완전 ${info.fully}장 · 일부라도 ${info.partly}장`)
  console.log(`   목록 시작 y=${info.gridTop}px (뷰포트 ${info.vh}) · 카테고리 카드 ${info.catCards}개 · 가로스크롤 ${info.docW > w ? '있음' : '없음'}`)
  console.log(`   위 영역 높이: ${info.rows}`)
  await p.screenshot({ path: `node_modules/.cache/mobile-shots/layout-${tag}-${w}.png` })
  await p.close()
}
await browser.close(); await server.close()
