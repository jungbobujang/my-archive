// 설정 모달. 지금 담긴 것은 화면 테마, 저장소 사용량, 플랜 표시(자리만)다.
// 플랜은 하드코딩된 '무료' — 구독 상태를 읽어 오는 곳이 아직 없다.
import { useEffect, useState } from 'react'
import { THEME_ICON, THEME_LABEL, THEME_ORDER } from '../theme.js'
import { useEscapeKey } from '../hooks.js'
import {
  supabase, fetchAllRows, totalFileBytes, totalImageBytes, formatBytes, ICON_CHOICES,
  COLOR_KEYS, STORAGE_QUOTA_BYTES, STORAGE_QUOTA_LABEL, STORAGE_WARN_RATIO
} from '../supabase.js'
import {
  MAX_SPACES, SPACE_ICON_FALLBACK, spaceOf, createSpace, updateSpace
} from '../spaces.js'
import {
  MAX_DOMAINS, DOMAIN_COLOR_FALLBACK, createDomain, updateDomain, swapDomainPosition
} from '../plan.js'
import {
  PIN_LENGTH, IDLE_CHOICES, cryptoReady, isValidPin,
  savePin, clearPin, readLockConfig, writeEnabled, writeIdleMinutes
} from '../lock.js'
import {
  listShares, revokeShare, shareUrlFor, formatWhen, remainingLabel, copyText,
  isMissingShareSchema
} from '../share.js'

export default function Settings({
  email, userId, themePref, onThemeChange,
  spaces, space, onSpacesChanged,
  domains, onDomainsChanged,
  onOpenPricing, onLockChanged, onClose
}) {
  useEscapeKey(onClose)

  // 저장소 사용량은 **두 갈래를 더해서** 본다. Supabase 의 1GB 는 프로젝트 전체
  // 스토리지 합계에 걸리는 값이라, 파일만 세면 게이지가 실제보다 적게 나온다.
  //  · 파일: items.files 의 size 합 (표에 크기가 적혀 있어 요청이 안 든다)
  //  · 이미지: archive-images 버킷을 직접 물어본다 (DB 에 크기가 없다. 키가 사용자당
  //    폴더 하나라 요청 한 번이면 끝난다 — supabase.js 의 totalImageBytes 참고)
  // 🔴 둘을 따로 담는다. 한쪽만 실패해도 아는 쪽은 보여 줘야 한다 — '못 읽었다' 와
  //    '0바이트다' 는 다른 말이고, 게이지가 그 둘을 같게 그리면 안 된다.
  const [used, setUsed] = useState(null)
  const [imageUsed, setImageUsed] = useState(null)
  // 공간별 파일 용량 { 열쇠: 바이트 }. 공간 열이 없는 DB 에서는 늘 null 이다.
  const [perSpace, setPerSpace] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let alive = true
    ;(async () => {
      try {
        // 공간 열이 없는 DB 에서 'space' 를 고르면 조회가 통째로 실패한다 — 있을 때만 묻는다
        const rows = await fetchAllRows('items', spaces ? 'files, space' : 'files')
        if (!alive) return
        setUsed(totalFileBytes(rows))
        if (spaces) {
          const next = {}
          for (const s of spaces) next[s.key] = 0
          for (const r of rows) {
            const key = spaceOf(r)
            next[key] = (next[key] ?? 0) + totalFileBytes([r])
          }
          setPerSpace(next)
        }
      } catch (err) {
        // files 열이 아직 없는 DB(setup.sql 미실행)면 여기로 온다. 게이지만 숨긴다.
        console.warn('[설정] 저장소 사용량을 읽지 못했습니다:', err)
      }
    })()
    ;(async () => {
      try {
        const bytes = await totalImageBytes(userId)
        if (alive) setImageUsed(bytes)
      } catch (err) {
        // 버킷 목록을 못 읽는 경우(정책·연결). 파일 쪽 숫자는 그대로 살린다.
        console.warn('[설정] 이미지 사용량을 읽지 못했습니다:', err)
      }
    })()
    return () => { alive = false }
  }, [userId, spaces])

  const known = used !== null || imageUsed !== null
  const total = (used ?? 0) + (imageUsed ?? 0)
  const ratio = !known ? 0 : Math.min(1, total / STORAGE_QUOTA_BYTES)
  const warn = ratio > STORAGE_WARN_RATIO

  return (
    // 배경을 눌러도 닫지 않는다. 닫는 길은 ✕ · Esc 뿐이다 (모달 공통 규칙).
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="설정">
        <div className="modal-head">
          <h2>설정</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <section className="set-section">
          <h3 className="set-head">화면 테마</h3>
          <div className="cat-select" role="group" aria-label="화면 테마">
            {THEME_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                className={`chip ${themePref === key ? 'chip-on' : ''}`}
                onClick={() => onThemeChange(key)}
                aria-pressed={themePref === key}
              >{THEME_ICON[key]} {THEME_LABEL[key]}</button>
            ))}
          </div>
          <p className="set-hint">
            시스템으로 두면 폰이나 컴퓨터의 밝게/어둡게 설정을 그대로 따라갑니다.
          </p>
        </section>

        {known && (
          <section className="set-section">
            <h3 className="set-head">저장소</h3>
            <div
              className="gauge"
              role="meter"
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="저장소 사용량 (첨부 파일 + 이미지)"
            >
              {/* 0 이어도 눈에 보이게 최소 폭을 준다 — 빈 막대는 '아직 못 읽었다' 로도 읽힌다 */}
              <span
                className={`gauge-fill ${warn ? 'gauge-warn' : ''}`}
                style={{ width: `${Math.max(ratio * 100, total > 0 ? 2 : 0)}%` }}
              />
            </div>
            <p className="set-value">
              {/* 🔴 합계를 앞에 두고 내역을 괄호로 붙인다. 한도와 견주는 값은 합계 하나뿐이고,
                  내역은 '무엇을 줄이면 되나' 를 알려 주는 자리다. 한쪽을 못 읽었으면
                  0 으로 적지 않고 그렇게 말한다 — 0 은 사실 주장이다. */}
              저장소 {formatBytes(total)} / {STORAGE_QUOTA_LABEL}
              {' ('}
              파일 {used === null ? '확인 못 함' : formatBytes(used)}
              {' · '}
              이미지 {imageUsed === null ? '확인 못 함' : formatBytes(imageUsed)}
              {')'}
              {warn && <span className="gauge-note"> · 80% 를 넘었어요</span>}
            </p>

            {/* 공간별 내역. 🔴 **파일만** 나눌 수 있다 — 이미지는 계정 폴더 하나
                (`{userId}/…`)에 담겨 있어 어느 서랍의 것인지 버킷이 알지 못한다.
                모르는 것을 아는 척 나누느니 나눌 수 없다고 적는다. */}
            {perSpace && spaces && spaces.length > 0 && (
              <>
                <ul className="space-usage">
                  {spaces.map((s) => (
                    <li key={s.key} className={s.key === space ? 'space-usage-on' : ''}>
                      <span>{s.icon ?? SPACE_ICON_FALLBACK} {s.name}</span>
                      <span>파일 {formatBytes(perSpace[s.key] ?? 0)}</span>
                    </li>
                  ))}
                </ul>
                <p className="set-hint">
                  공간별로는 첨부 파일만 나눌 수 있어요. 이미지는 계정 단위 폴더에 담겨 있어
                  위 합계에만 들어갑니다.
                </p>
              </>
            )}

            <p className="set-hint">
              Supabase 무료 플랜 기준입니다. 80%를 넘으면 정리하거나 확장을 검토하세요.
            </p>
          </section>
        )}

        <SpaceSettings
          spaces={spaces}
          userId={userId}
          onChanged={onSpacesChanged}
        />

        <DomainSettings
          domains={domains}
          userId={userId}
          onChanged={onDomainsChanged}
        />

        <LockSettings userId={userId} onChanged={onLockChanged} />

        <ShareList />

        <section className="set-section">
          <h3 className="set-head">플랜</h3>
          <div className="set-row">
            <span className="set-plan">
              <span className="badge badge-teal">무료</span>
              <span className="set-plan-note">모든 기능을 쓰고 있어요</span>
            </span>
            <button className="btn-ghost btn-sm" onClick={onOpenPricing}>요금제 보기</button>
          </div>
          {/* 구독 상태를 읽어 오는 곳이 아직 없다. 유료화할 때 이 자리를 채우면 된다. */}
        </section>

        <section className="set-section">
          <h3 className="set-head">계정</h3>
          <p className="set-value">{email}</p>
          <p className="set-hint">
            계정 정보 변경은 Supabase 대시보드의 Authentication 에서 합니다.
          </p>
        </section>
      </div>
    </div>
  )
}

/* 공간(서랍) 설정 — 이름·아이콘 고치기와 새로 만들기.
 *
 * 🔴 **지우기는 두지 않았다.** 공간을 지우면 그 안의 항목이 갈 곳을 잃는다. 같이 지우면
 *    되돌릴 수 없는 대량 삭제가 버튼 하나가 되고, 남겨 두면 어느 목록에도 안 나오는
 *    유령 항목이 된다. 둘 다 이 기능이 감당할 값이 아니다 — 안 쓰는 서랍은 이름만
 *    바꿔 두면 되고, 정말 필요해지면 '항목을 옮긴 뒤에 지운다' 를 따로 설계한다.
 *    (REPORT-SPACE.md 에 남겨 두었다)
 *
 * spaces 가 null 이면 공간 열·표가 아직 없는 DB 다. 그때는 칸을 통째로 숨긴다 —
 * 공유 링크 목록·저장소 게이지와 같은 규칙이다(빈 목록은 '없다' 로 잘못 읽힌다).
 */
function SpaceSettings({ spaces, userId, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [iconOpen, setIconOpen] = useState(null)
  const [newName, setNewName] = useState('')

  if (!spaces) return null

  const full = spaces.length >= MAX_SPACES

  async function rename(s, value) {
    const clean = String(value ?? '').trim()
    if (!clean || clean === s.name) return
    try {
      await updateSpace(s.key, { name: clean })
      setError('')
      onChanged?.()
    } catch (err) {
      console.error('[설정] 공간 이름을 바꾸지 못했습니다:', err)
      setError('이름을 저장하지 못했어요')
    }
  }

  async function setIcon(s, icon) {
    setIconOpen(null)
    try {
      await updateSpace(s.key, { icon })
      setError('')
      onChanged?.()
    } catch (err) {
      console.error('[설정] 공간 아이콘을 바꾸지 못했습니다:', err)
      setError('아이콘을 저장하지 못했어요')
    }
  }

  async function add(e) {
    e.preventDefault()
    const clean = newName.trim()
    if (!clean || busy || full) return
    setBusy(true)
    try {
      await createSpace({ userId, spaces, name: clean, icon: SPACE_ICON_FALLBACK })
      setNewName('')
      setError('')
      onChanged?.()
    } catch (err) {
      console.error('[설정] 공간을 만들지 못했습니다:', err)
      setError(err?.message || '공간을 만들지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="set-section">
      <h3 className="set-head">공간</h3>
      <ul className="cm-list">
        {spaces.map((s) => (
          <li key={s.key} className="cm-row">
            <div className="cm-line">
              <button
                type="button"
                className="cm-icon cat-gray"
                onClick={() => setIconOpen(iconOpen === s.key ? null : s.key)}
                aria-label={`${s.name} 아이콘 변경`}
              >{s.icon ?? SPACE_ICON_FALLBACK}</button>
              <input
                className="cm-name"
                defaultValue={s.name}
                onBlur={(e) => rename(s, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                aria-label={`${s.name} 이름`}
              />
            </div>
            {iconOpen === s.key && (
              <div className="cm-icons">
                {ICON_CHOICES.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    className={`chip ${s.icon === ic ? 'chip-on' : ''}`}
                    onClick={() => setIcon(s, ic)}
                  >{ic}</button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="set-error">{error}</p>}

      <form className="cm-add" onSubmit={add}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={full ? `공간은 최대 ${MAX_SPACES}개까지예요` : '새 공간 이름'}
          aria-label="새 공간 이름"
          disabled={full}
        />
        <button type="submit" className="btn-primary btn-sm" disabled={busy || full || !newName.trim()}>
          + 새 공간
        </button>
      </form>
      <p className="set-hint">
        항목·카테고리·태그·검색·오늘 탭이 공간마다 따로 나뉩니다. 테마와 잠금 PIN,
        휴지통은 공간과 상관없이 계정 전체에 하나입니다.
        공간은 지울 수 없어요 — 안에 든 항목이 갈 곳을 잃기 때문입니다.
      </p>
    </section>
  )
}

/* 계획 영역 설정 — 격자의 세로축. 이름·색·순서를 고치고 새로 만든다 (요구사항 2).
 *
 * 🔴 **지우기는 두지 않았다.** 공간과 같은 이유다: 영역을 지우면 그 영역에 있던 계획이
 *    갈 곳을 잃는다. 다만 공간과 달리 여기서는 잃어도 조용히 사라지지 않는다 —
 *    격자가 모르는 열쇠를 '미지정' 줄로 모아 주기 때문이다(src/plan.js domainOf).
 *    그래도 버튼은 안 둔다. 여덟 줄짜리 축에서 지우기가 필요한 일은 드물고,
 *    안 쓰는 줄은 이름을 바꿔 두면 그만이다.
 * 🔴 순서는 ▲▼ 버튼으로 바꾼다. 격자의 세로 차례가 곧 position 이라 바꾸면 화면이
 *    그대로 따라온다. 끌기를 쓰지 않은 이유는 모달 안 파일 목록과 같다 —
 *    세로 목록에서는 한 칸씩 옮기는 일이 대부분이고 버튼이 더 정확하다.
 *
 * domains 가 null 이면 계획 열·표가 아직 없는 DB 다. 그때는 칸을 통째로 숨긴다.
 */
function DomainSettings({ domains, userId, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [colorOpen, setColorOpen] = useState(null)
  const [newName, setNewName] = useState('')

  if (!domains) return null

  const full = domains.length >= MAX_DOMAINS
  const sorted = [...domains].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  async function run(job, whenFailed) {
    try {
      await job()
      setError('')
      onChanged?.()
    } catch (err) {
      console.error(`[설정] ${whenFailed}:`, err)
      setError(`${whenFailed}`)
    }
  }

  async function rename(d, value) {
    const clean = String(value ?? '').trim()
    if (!clean || clean === d.name) return
    await run(() => updateDomain(d.key, { name: clean }), '이름을 저장하지 못했어요')
  }

  async function setColor(d, color) {
    setColorOpen(null)
    await run(() => updateDomain(d.key, { color }), '색을 저장하지 못했어요')
  }

  async function move(i, dir) {
    const a = sorted[i]
    const b = sorted[i + dir]
    if (!a || !b) return
    await run(() => swapDomainPosition(a, b), '순서를 바꾸지 못했어요')
  }

  async function add(e) {
    e.preventDefault()
    const clean = newName.trim()
    if (!clean || busy || full) return
    setBusy(true)
    try {
      await createDomain({ userId, domains, name: clean, color: DOMAIN_COLOR_FALLBACK })
      setNewName('')
      setError('')
      onChanged?.()
    } catch (err) {
      console.error('[설정] 영역을 만들지 못했습니다:', err)
      setError(err?.message || '영역을 만들지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="set-section">
      <h3 className="set-head">계획 영역</h3>
      <ul className="cm-list">
        {sorted.map((d, i) => (
          <li key={d.key} className="cm-row">
            <div className="cm-line">
              <button
                type="button"
                className={`cm-icon cat-${d.color ?? DOMAIN_COLOR_FALLBACK}`}
                onClick={() => setColorOpen(colorOpen === d.key ? null : d.key)}
                aria-label={`${d.name} 색 변경`}
              >●</button>
              <input
                className="cm-name"
                defaultValue={d.name}
                onBlur={(e) => rename(d, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                aria-label={`${d.name} 이름`}
              />
              <span className="file-move">
                <button
                  type="button"
                  className="file-move-btn"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`${d.name} 위로`}
                  title="위로"
                >▲</button>
                <button
                  type="button"
                  className="file-move-btn"
                  onClick={() => move(i, 1)}
                  disabled={i === sorted.length - 1}
                  aria-label={`${d.name} 아래로`}
                  title="아래로"
                >▼</button>
              </span>
            </div>
            {colorOpen === d.key && (
              <div className="cm-icons">
                {COLOR_KEYS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip chip-dot-${c} ${d.color === c ? 'chip-on' : ''}`}
                    onClick={() => setColor(d, c)}
                    aria-label={`${d.name} 색을 ${c} 로`}
                  >●</button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="set-error">{error}</p>}

      <form className="cm-add" onSubmit={add}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={full ? `영역은 최대 ${MAX_DOMAINS}개까지예요` : '새 영역 이름'}
          aria-label="새 영역 이름"
          disabled={full}
        />
        <button type="submit" className="btn-primary btn-sm" disabled={busy || full || !newName.trim()}>
          + 새 영역
        </button>
      </form>
      <p className="set-hint">
        계획 격자의 세로축입니다. 여기 순서가 격자의 위아래 차례가 돼요.
        영역은 계정에 하나뿐이라 공간(서랍)을 바꿔도 같은 축을 씁니다 — 나뉘는 것은 계획 자체입니다.
        영역은 지울 수 없어요 — 그 안에 든 계획이 갈 곳을 잃기 때문입니다.
      </p>
    </section>
  )
}

// 공유 중인 링크.
//
// 살아 있는 것만 보여 준다(회수·만료된 것은 뺀다) — '지금 누가 볼 수 있는가' 를
// 한눈에 보는 자리라, 죽은 링크가 섞이면 그 목적이 흐려진다.
// 회수는 여기서 즉시 반영한다. 되돌릴 수 없으므로 한 번 물어본다.
//
// 표가 아직 없는 DB(setup.sql 미실행)에서는 이 칸을 통째로 숨긴다 — 저장소 게이지와
// 같은 규칙이다. 빈 목록으로 보이면 '공유한 적 없음' 으로 잘못 읽힌다.
function ShareList() {
  const [rows, setRows] = useState(null)   // null = 아직/쓸 수 없음
  const [busyId, setBusyId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let alive = true
    ;(async () => {
      try {
        const list = await listShares()
        if (alive) setRows(list)
      } catch (err) {
        // 표가 없으면 조용히 숨긴다. 그 밖의 오류는 한 줄로 알린다.
        if (!isMissingShareSchema(err)) {
          console.warn('[설정] 공유 링크 목록을 읽지 못했습니다:', err)
          if (alive) { setRows([]); setError('공유 링크 목록을 읽지 못했어요') }
        }
      }
    })()
    return () => { alive = false }
  }, [])

  if (rows === null) return null

  async function revoke(row) {
    if (!window.confirm(`"${row.title}" 링크를 회수할까요? 받은 사람은 바로 볼 수 없게 됩니다.`)) return
    setBusyId(row.id)
    try {
      await revokeShare(row.id)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      setError('')
    } catch (err) {
      console.error('[설정] 회수하지 못했습니다:', err)
      setError('회수하지 못했어요. 연결 상태를 확인해 주세요')
    } finally {
      setBusyId(null)
    }
  }

  async function copy(row) {
    const ok = await copyText(shareUrlFor(row.id))
    setCopiedId(ok ? row.id : null)
    if (!ok) setError('복사하지 못했어요')
  }

  return (
    <section className="set-section">
      <h3 className="set-head">공유 중인 링크</h3>
      {rows.length === 0 ? (
        <p className="set-hint">
          공유 중인 링크가 없어요. 항목을 열고 <b>🔗 공유 링크</b> 를 누르면 만들 수 있습니다.
        </p>
      ) : (
        <ul className="share-list">
          {rows.map((r) => (
            <li className="share-row" key={r.id}>
              <span className="share-row-main">
                <span className="share-row-title">{r.title}</span>
                <span className="share-row-when">
                  {formatWhen(r.expires_at)} 까지 · {remainingLabel(r.expires_at)}
                </span>
              </span>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => copy(r)}
                aria-label={`${r.title} 링크 복사`}
              >{copiedId === r.id ? '복사됨 ✓' : '복사'}</button>
              <button
                type="button"
                className="btn-ghost btn-sm cm-del"
                onClick={() => revoke(r)}
                disabled={busyId === r.id}
                aria-label={`${r.title} 링크 회수`}
              >회수</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="set-error">{error}</p>}
      <p className="set-hint">
        회수하면 그 주소는 즉시 열리지 않습니다. 유효기간이 지난 링크는 목록에서 사라집니다.
      </p>
    </section>
  )
}

// 자리비움 잠금 설정.
//
// PIN 은 이 기기에만 저장된다(계정이 아니라). 그래서 폰에서 건 PIN 이 컴퓨터에는 없고,
// 기기마다 따로 걸어야 한다 — 잠금을 쓰고 싶은 기기가 보통 하나뿐이라 이 편이 낫다.
// 자세한 이유는 src/lock.js 머리말에 적어 두었다.
function LockSettings({ userId, onChanged }) {
  const [cfg, setCfg] = useState(() => readLockConfig(userId))
  const [mode, setMode] = useState('idle')   // idle | new (등록·변경 입력 중)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 설정을 바꾸면 화면(잠금 감시)도 같이 다시 읽어야 한다.
  function sync() {
    setCfg(readLockConfig(userId))
    onChanged?.()
  }

  function reset() {
    setMode('idle'); setPin(''); setPin2(''); setError('')
  }

  const digits = (v) => v.replace(/\D/g, '').slice(0, PIN_LENGTH)

  async function register(e) {
    e.preventDefault()
    if (busy) return
    if (!isValidPin(pin)) { setError(`PIN 은 숫자 ${PIN_LENGTH}자리여야 해요`); return }
    if (pin !== pin2) { setError('두 번 넣은 PIN 이 서로 달라요'); return }
    setBusy(true)
    try {
      await savePin(userId, pin)
      reset()
      sync()
    } catch (err) {
      setError(err.message || 'PIN 을 저장하지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  // 보안 컨텍스트가 아니면 PIN 을 안전하게 둘 수가 없다. 반쪽으로 열어 두지 않는다.
  if (!cryptoReady()) {
    return (
      <section className="set-section">
        <h3 className="set-head">자리비움 잠금</h3>
        <p className="set-hint">
          이 브라우저에서는 PIN 을 안전하게 저장할 수 없어 잠금을 쓸 수 없어요
          (https 로 열면 됩니다).
        </p>
      </section>
    )
  }

  return (
    <section className="set-section">
      <h3 className="set-head">자리비움 잠금</h3>

      {!cfg.pinSet && mode === 'idle' && (
        <>
          <p className="set-hint">
            PIN 을 걸어 두면 자리를 뜬 사이 화면을 가릴 수 있어요. 걸기 전에는 꺼져 있습니다.
          </p>
          <button className="btn-ghost btn-sm" onClick={() => setMode('new')}>PIN 등록</button>
        </>
      )}

      {mode === 'new' && (
        <form className="lock-form" onSubmit={register}>
          <label className="lock-field">
            <span>새 PIN ({PIN_LENGTH}자리)</span>
            <input
              type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
              maxLength={PIN_LENGTH} value={pin}
              onChange={(e) => { setPin(digits(e.target.value)); setError('') }}
              aria-label="새 PIN"
            />
          </label>
          <label className="lock-field">
            <span>한 번 더</span>
            <input
              type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
              maxLength={PIN_LENGTH} value={pin2}
              onChange={(e) => { setPin2(digits(e.target.value)); setError('') }}
              aria-label="새 PIN 확인"
            />
          </label>
          {error && <p className="set-error">{error}</p>}
          <div className="lock-form-actions">
            <button type="submit" className="btn-primary btn-sm" disabled={busy}>
              {busy ? '저장 중...' : '저장'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={reset}>취소</button>
          </div>
        </form>
      )}

      {cfg.pinSet && mode === 'idle' && (
        <>
          <label className="set-row lock-toggle">
            <span>
              이 기기에서 자리비움 잠금 사용
              <span className="set-plan-note">기기마다 따로 켭니다</span>
            </span>
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => { writeEnabled(userId, e.target.checked); sync() }}
              aria-label="이 기기에서 자리비움 잠금 사용"
            />
          </label>

          <div className="cat-select" role="group" aria-label="잠기기까지 기다리는 시간">
            {IDLE_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${cfg.minutes === m ? 'chip-on' : ''}`}
                onClick={() => { writeIdleMinutes(userId, m); sync() }}
                aria-pressed={cfg.minutes === m}
                disabled={!cfg.enabled}
              >{m}분</button>
            ))}
          </div>
          <p className="set-hint">
            이만큼 아무 입력이 없으면 잠깁니다. 한 번 풀면 2시간 동안은 다시 잠기지 않아요.
            스위치를 꺼 두어도 헤더의 🔒 버튼(Ctrl+Shift+L)은 언제나 씁니다.
          </p>

          <div className="lock-form-actions">
            <button className="btn-ghost btn-sm" onClick={() => setMode('new')}>PIN 변경</button>
            <button
              className="btn-ghost btn-sm cm-del"
              onClick={() => {
                if (!window.confirm('PIN 을 지우면 자리비움 잠금이 꺼집니다. 지울까요?')) return
                clearPin(userId)
                sync()
              }}
            >PIN 지우기</button>
          </div>
        </>
      )}
    </section>
  )
}
