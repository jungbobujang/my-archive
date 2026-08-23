// 파일 첨부 점검 (jsdom + 가짜 Supabase). check-modals.mjs 와 같은 방식이다 —
// 테스트 러너가 없는 저장소라 의존성 없이 도는 단일 스크립트로 둔다:
//
//   npm install --no-save jsdom
//   node scripts/check-files.mjs
//
// 확인하는 것: 확장자 화이트리스트, 10MB 상한, 개당·항목당 상한, 한글 파일명 왕복,
// 저장하지 않고 닫았을 때 고아 파일이 남지 않는지, 영구 삭제 뒤 고아가 없는지,
// files 열이 없는 DB 에서도 나머지 저장이 되는지.
//
// 실제 Supabase 에 붙지 않는다. '@supabase/supabase-js' 자리에 scripts/fake-supabase.mjs
// 를 끼워 넣고, 그 안의 in-memory 버킷을 세어 판정한다.
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
const outfile = path.join(rootDir, 'node_modules', '.cache', 'check-files.mjs')
fs.mkdirSync(path.dirname(outfile), { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(here, 'check-files.body.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  // supabase.js 가 클라이언트를 만들려면 두 값이 있어야 한다(없으면 supabase 가 null 이다)
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
