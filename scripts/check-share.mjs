// 공유 링크 점검 (jsdom + 가짜 Supabase). check-files.mjs 와 같은 방식이다:
//
//   npm install --no-save jsdom
//   node scripts/check-share.mjs
//
// 확인하는 것: 유효 링크 열람 / 만료 뒤 차단 / 회수 뒤 차단 — 셋 다 **화면 가림이
// 아니라 응답 자체**로 본다(비로그인 상태에서 항목 내용이 응답에 실리는지). 그리고
// 서명 주소의 수명이 유효기간과 같은지, 자리비움 잠금과 무관하게 공유 페이지가
// 열리는지, 설정의 회수가 실제로 열람을 끊는지.
//
// 실제 Supabase 에 붙지 않는다. '@supabase/supabase-js' 자리에 scripts/fake-supabase.mjs
// 를 끼워 넣고, 그 안의 shares/items 와 share_view 흉내로 판정한다.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(here, '..')

try {
  require.resolve('jsdom')
} catch {
  console.error('jsdom 이 없습니다.  npm install --no-save jsdom  뒤에 다시 실행해 주세요.')
  process.exit(2)
}

const esbuild = require('esbuild')
const outfile = path.join(rootDir, 'node_modules', '.cache', 'check-share.mjs')
fs.mkdirSync(path.dirname(outfile), { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(here, 'check-share.body.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  define: {
    'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://fake.local',
      VITE_SUPABASE_ANON_KEY: 'fake-anon-key'
    })
  },
  alias: { '@supabase/supabase-js': path.join(here, 'fake-supabase.mjs') },
  external: ['react', 'react-dom', 'jsdom'],
  outfile,
  absWorkingDir: rootDir
})
execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
