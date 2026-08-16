// PWA 아이콘 생성기 — 의존성 없이 Node 내장 zlib 으로 PNG 를 직접 쓴다.
// 실행: node scripts/generate-icons.mjs  (결과: public/icons/*.png)
//
// 로고는 브랜드 마크와 같은 "A" 글자다. 폰트 없이 그려야 하므로
// 획을 사각형(사변형) 3개로 정의하고 점-다각형 판정으로 래스터화한다.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const INK = [34, 38, 31]      // --ink  #22261f
const CREAM = [244, 244, 241] // --bg   #f4f4f1

// 100x100 글리프 좌표계로 정의한 "A" 의 획 3개
const GLYPH = [
  [[42, 8], [58, 8], [28, 92], [10, 92]],   // 왼쪽 사선
  [[42, 8], [58, 8], [90, 92], [72, 92]],   // 오른쪽 사선
  [[26, 59], [74, 59], [74, 75], [26, 75]]  // 가로획
]

function inPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// 둥근 사각형 안쪽인지. r=0 이면 그냥 사각형.
function inRoundRect(x, y, size, r) {
  if (x < 0 || y < 0 || x > size || y > size) return false
  if (r <= 0) return true
  const cx = Math.min(Math.max(x, r), size - r)
  const cy = Math.min(Math.max(y, r), size - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

// 3x3 슈퍼샘플링으로 가장자리를 부드럽게 만든다
const SS = 3

function renderIcon(size, { radiusRatio, glyphRatio }) {
  const radius = size * radiusRatio
  const glyphSize = size * glyphRatio
  const glyphOffset = (size - glyphSize) / 2
  const px = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0
      let inkHits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = x + (sx + 0.5) / SS
          const py0 = y + (sy + 0.5) / SS
          if (!inRoundRect(px0, py0, size, radius)) continue
          bgHits++
          // 글리프 좌표계(0~100)로 환산
          const gx = ((px0 - glyphOffset) / glyphSize) * 100
          const gy = ((py0 - glyphOffset) / glyphSize) * 100
          if (GLYPH.some((poly) => inPolygon(gx, gy, poly))) inkHits++
        }
      }
      const total = SS * SS
      const alpha = Math.round((bgHits / total) * 255)
      const inkMix = bgHits === 0 ? 0 : inkHits / bgHits
      const o = (y * size + x) * 4
      for (let c = 0; c < 3; c++) {
        px[o + c] = Math.round(INK[c] * (1 - inkMix) + CREAM[c] * inkMix)
      }
      px[o + 3] = alpha
    }
  }
  return px
}

// ---- 최소 PNG 인코더 ----

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // RGBA
  // 10~12: compression / filter / interlace = 0

  // 각 행 앞에 필터 바이트(0 = None)를 붙인다
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const TARGETS = [
  // 일반 아이콘: 자체 라운드 코너
  { file: 'icon-192.png', size: 192, radiusRatio: 0.22, glyphRatio: 0.6 },
  { file: 'icon-512.png', size: 512, radiusRatio: 0.22, glyphRatio: 0.6 },
  // maskable: 런처가 잘라내므로 배경을 꽉 채우고 글리프는 안전 영역(60%) 안에
  { file: 'maskable-192.png', size: 192, radiusRatio: 0, glyphRatio: 0.46 },
  { file: 'maskable-512.png', size: 512, radiusRatio: 0, glyphRatio: 0.46 },
  // iOS 홈 화면: iOS 가 알아서 둥글게 자른다
  { file: 'apple-touch-icon.png', size: 180, radiusRatio: 0, glyphRatio: 0.58 },
  { file: 'favicon-32.png', size: 32, radiusRatio: 0.22, glyphRatio: 0.66 }
]

mkdirSync(OUT_DIR, { recursive: true })
for (const t of TARGETS) {
  const png = encodePng(t.size, renderIcon(t.size, t))
  writeFileSync(join(OUT_DIR, t.file), png)
  console.log(`${t.file.padEnd(24)} ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)} kB`)
}
