// 공간(서랍) 점검 (jsdom + 가짜 Supabase). check-files.mjs 와 같은 방식이다 —
// 테스트 러너가 없는 저장소라 의존성 없이 도는 단일 스크립트로 둔다:
//
//   npm install --no-save jsdom
//   node scripts/check-space.mjs
//
// 확인하는 것:
//   · A 공간에서 만든 항목이 B 공간에 **조회 단계에서** 안 나오는지 (화면만 가리는 것이 아니다)
//   · 카테고리·태그·검색·오늘 탭이 공간마다 갈리는지
//   · 저장소 게이지의 공간별 합이 전체와 맞는지
//   · 항목을 다른 공간으로 옮기면 space 가 바뀌고 소속이 따라오지 않는지
//   · 휴지통은 전 공간 통합이고 어느 서랍의 것인지 적는지
//   · space 열이 아직 없는 DB 에서도 목록·저장이 예전 그대로 도는지
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
const outfile = path.join(rootDir, 'node_modules', '.cache', 'check-space.mjs')
fs.mkdirSync(path.dirname(outfile), { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(here, 'check-space.body.mjs')],
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
