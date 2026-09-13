// 계획 격자 점검 (jsdom + 가짜 Supabase). check-space.mjs 와 같은 방식이다 —
// 테스트 러너가 없는 저장소라 의존성 없이 도는 단일 스크립트로 둔다:
//
//   npm install --no-save jsdom
//   node scripts/check-plan.mjs
//
// 확인하는 것:
//   · 계획이 지평 × 영역의 **제 칸**에 놓이는지, 빈 칸이 빈 칸으로 그려지는지
//   · 카드 상태 전환이 plan_status 와 **plan_status_at 을 함께** 쓰는지
//   · 완료는 격자 아래 접힌 목록으로, 접음은 격자에서 빠지는지
//   · 주간 리뷰의 세 목록(이번 주 완료·정체·빈 칸)이 지표와 맞는지
//   · 격자가 **조회 단계에서** 공간을 가르는지 (화면만 가리는 것이 아니다)
//   · 항목 모달의 '계획으로' 가 꺼진 채 시작하고, 끄면 열이 null 로 비워지는지
//   · 관련 항목 검색이 자기 자신과 이미 걸린 것을 빼는지
//   · 계획 열이 아직 없는 DB 에서도 탭이 접히고 목록·저장이 예전 그대로 도는지
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
const outfile = path.join(rootDir, 'node_modules', '.cache', 'check-plan.mjs')
fs.mkdirSync(path.dirname(outfile), { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(here, 'check-plan.body.mjs')],
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
