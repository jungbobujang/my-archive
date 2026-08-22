// 모달 동작 점검 (jsdom). 이 저장소에는 테스트 러너가 없어서, 의존성 없이 도는
// 단일 스크립트로 두었다. 도구는 필요할 때만 깔면 된다:
//
//   npm install --no-save jsdom
//   node scripts/check-modals.mjs
//
// 확인하는 것: 링크 담기/빼기, 임시본 저장·복원, 배경 클릭으로 닫히지 않기,
// 다른 창에 갔다 와도 유지, Esc 확인창.
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

// 소스가 JSX 라 그대로는 못 읽는다. vite 가 데리고 있는 esbuild 로 한 덩어리로 묶어 돌린다.
const esbuild = require('esbuild')
const outfile = path.join(rootDir, 'node_modules', '.cache', 'check-modals.mjs')
fs.mkdirSync(path.dirname(outfile), { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(here, 'check-modals.body.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
  external: ['react', 'react-dom', 'jsdom'],
  outfile,
  absWorkingDir: rootDir
})
execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
