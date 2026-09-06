// scripts/check-files.mjs 가 '@supabase/supabase-js' 자리에 끼워 넣는 가짜 클라이언트.
// 실제 Supabase 계정 없이도 '올렸다/지웠다/저장했다' 를 눈으로가 아니라 자료로 확인하려고 둔다.
// 앱 코드는 이 파일의 존재를 모른다 — esbuild 의 alias 로만 바뀐다.
//
// 담는 것은 두 가지뿐이다.
//   buckets: 버킷 이름 -> Map(경로 -> { size, type })   ← 고아 파일이 남았는지 여기서 센다
//   rows:    표 이름   -> 행 배열
export const store = {
  buckets: {},
  rows: {},
  // 다음 items insert/update 를 'files 열이 없다' 로 실패시킨다 (setup.sql 미실행 흉내)
  missingFilesColumn: false,
  // items 에 쓰려고 하면 이 오류를 돌려준다. 로그인이 풀린 상태(RLS 거부)나
  // NUL 거부(22P05)처럼 '저장 자체가 튕기는' 경우를 흉내 낼 때 쓴다.
  // 오류 객체를 그대로 두면 모든 쓰기가 실패하고, 함수를 두면 (행) => 오류|null 로
  // 어떤 행만 튕길지 고를 수 있다 (링크 분리 모드에서 한 건만 실패시킬 때 쓴다).
  itemsError: null,
  // 업로드를 거부할 경로 조건. (path) => 오류 메시지 | null
  uploadGuard: null,
  // 로그인하지 않은 상태 흉내. 참이면 표 조회가 RLS 로 막힌 것처럼 **빈 결과**가 되고
  // 쓰기는 42501 로 튕긴다. 공유 링크 점검에서 '받는 사람' 을 흉내 낼 때 쓴다.
  // rpc(share_view) 는 이 스위치와 무관하다 — security definer 함수라 RLS 를 넘어서
  // 서버가 직접 판정하기 때문이다. 그 판정을 여기서도 그대로 흉내 낸다.
  anon: false,
  // 서버 시각. share_view 의 만료 판정은 이 값으로 한다 (받는 사람 시계가 아니다).
  now: () => Date.now(),
  calls: { upload: [], remove: [], signed: [], rpc: [] }
}

export function resetStore() {
  store.buckets = { 'archive-images': new Map(), 'archive-files': new Map() }
  store.rows = { items: [], item_categories: [], categories: [], time_slots: [], shares: [] }
  store.missingFilesColumn = false
  store.itemsError = null
  store.uploadGuard = null
  store.anon = false
  store.now = () => Date.now()
  store.calls = { upload: [], remove: [], signed: [], rpc: [] }
}
resetStore()

const bucketOf = (id) => (store.buckets[id] ??= new Map())

function storageApi(bucketId) {
  return {
    async upload(path, file, opts) {
      store.calls.upload.push({ bucket: bucketId, path })
      const why = store.uploadGuard?.(path)
      if (why) return { data: null, error: { message: why } }
      bucketOf(bucketId).set(path, { size: file?.size ?? 0, type: opts?.contentType ?? '' })
      return { data: { path }, error: null }
    },
    getPublicUrl(path) {
      return {
        data: {
          publicUrl: `https://fake.local/storage/v1/object/public/${bucketId}/${encodeURI(path)}`
        }
      }
    },
    async createSignedUrl(path, expires, opts) {
      store.calls.signed.push({
        bucket: bucketId, path, expires, download: opts?.download ?? null
      })
      if (!bucketOf(bucketId).has(path)) {
        return { data: null, error: { message: 'Object not found' } }
      }
      const q = opts?.download ? `&download=${encodeURIComponent(opts.download)}` : ''
      return {
        data: { signedUrl: `https://fake.local/sign/${bucketId}/${encodeURI(path)}?exp=${expires}${q}` },
        error: null
      }
    },
    async remove(paths) {
      store.calls.remove.push({ bucket: bucketId, paths: [...paths] })
      for (const p of paths) bucketOf(bucketId).delete(p)
      return { data: null, error: null }
    }
  }
}

const MISSING_FILES = {
  code: 'PGRST204',
  message: "Could not find the 'files' column of 'items' in the schema cache"
}

// setup.sql 의 default 중, 앱이 보내지 않아 DB 가 채우는 값들.
const COLUMN_DEFAULTS = {
  shares: { revoked: false, files: [] }
}

let seq = 0
const newId = () => `row-${++seq}`

// shares.id 는 DB 에서 gen_random_uuid() 다. 주소(/s/{토큰})가 uuid 모양인지 보고
// 갈리므로, 여기서도 uuid 모양으로 만들어야 라우팅까지 함께 점검된다.
const uuidLike = () => {
  const n = String(++seq).padStart(12, '0')
  return `${n.slice(0, 8)}-0000-4000-8000-${n}`
}

const newIdFor = (table) => (table === 'shares' ? uuidLike() : newId())

function matches(row, filters) {
  return filters.every(([kind, col, a, b]) => {
    if (kind === 'eq') return row[col] === a
    // .not('deleted_at', 'is', null) -> deleted_at 이 null 이 아닌 행
    if (kind === 'not' && a === 'is' && b === null) return row[col] != null
    if (kind === 'is' && a === null) return row[col] == null
    if (kind === 'in') return Array.isArray(a) && a.includes(row[col])
    return true
  })
}

function makeQuery(table) {
  const q = {
    _op: null, _payload: null, _filters: [], _single: false,
    insert(rows) { q._op = 'insert'; q._payload = rows; return q },
    update(row) { q._op = 'update'; q._payload = row; return q },
    upsert(rows) { q._op = 'insert'; q._payload = rows; return q },
    delete() { q._op = 'delete'; return q },
    select() { q._op ??= 'select'; return q },
    eq(col, val) { q._filters.push(['eq', col, val]); return q },
    not(col, op, val) { q._filters.push(['not', col, op, val]); return q },
    is(col, val) { q._filters.push(['is', col, val]); return q },
    in(col, vals) { q._filters.push(['in', col, vals]); return q },
    order() { return q },
    range() { return q },
    single() { q._single = true; return q },
    then(onOk, onErr) { return Promise.resolve().then(() => run(table, q)).then(onOk, onErr) }
  }
  return q
}

const RLS_DENIED = {
  code: '42501',
  message: 'new row violates row-level security policy'
}

function run(table, q) {
  const rows = (store.rows[table] ??= [])

  // 비로그인 상태. 실제 RLS 와 같은 모양으로 답한다 — 조회는 '오류 없이 0행',
  // 쓰기는 42501. 토큰을 알아도 shares 에서 한 줄도 못 읽는 것이 요점이다.
  if (store.anon) {
    if (q._op === 'insert' || q._op === 'update' || q._op === 'delete') {
      return { data: null, error: RLS_DENIED }
    }
    return { data: q._single ? null : [], error: null }
  }

  // 쓰기(insert/update)만 튕긴다. 조회까지 막으면 모달을 띄우는 것부터 실패해서
  // '저장할 때 무엇이 보이는지' 를 볼 수 없다.
  if (store.itemsError && table === 'items' && (q._op === 'insert' || q._op === 'update')) {
    const list = Array.isArray(q._payload) ? q._payload : [q._payload]
    const err = typeof store.itemsError === 'function'
      ? list.map((r) => store.itemsError(r, q._op)).find(Boolean)
      : store.itemsError
    if (err) return { data: null, error: err }
  }

  if (q._op === 'insert') {
    const list = Array.isArray(q._payload) ? q._payload : [q._payload]
    if (table === 'items' && store.missingFilesColumn && list.some((r) => 'files' in r)) {
      return { data: null, error: MISSING_FILES }
    }
    // 표의 default 를 흉내 낸다. shares.revoked 는 앱이 넣지 않고 DB 가 false 로 채우는
    // 값이라, 여기서 채우지 않으면 '회수되지 않은 링크' 를 골라내지 못한다.
    const defaults = COLUMN_DEFAULTS[table] ?? {}
    const made = list.map((r) => ({
      id: r.id ?? newIdFor(table), created_at: new Date(0).toISOString(), ...defaults, ...r
    }))
    rows.push(...made)
    return { data: q._single ? made[0] : made, error: null }
  }

  if (q._op === 'update') {
    if (table === 'items' && store.missingFilesColumn && 'files' in q._payload) {
      return { data: null, error: MISSING_FILES }
    }
    const hit = rows.filter((r) => matches(r, q._filters))
    for (const r of hit) Object.assign(r, q._payload)
    return { data: q._single ? (hit[0] ?? null) : hit, error: null }
  }

  if (q._op === 'delete') {
    const keep = rows.filter((r) => !matches(r, q._filters))
    store.rows[table] = keep
    return { data: null, error: null }
  }

  // select 도 막는다. 실제 PostgREST 도 없는 열을 고르면 오류를 준다 —
  // 설정 화면의 사용량 게이지가 그 경우에 숨는지 보려면 여기서도 실패해야 한다.
  if (table === 'items' && store.missingFilesColumn) {
    return { data: null, error: MISSING_FILES }
  }
  const found = rows.filter((r) => matches(r, q._filters))
  return { data: q._single ? (found[0] ?? null) : found, error: null }
}

// supabase/setup.sql 의 share_view(p_token) 를 그대로 옮긴 것.
//
// **store.anon 을 보지 않는다** — security definer 함수라 RLS 를 넘어서 서버가 직접
// 판정하기 때문이다. 그래서 이 함수가 곧 '서버가 거부하는가' 를 재는 자리다:
// 만료·회수된 토큰에는 item 이 응답에 실리지 않는다(화면을 가리는 것이 아니다).
function shareView(token) {
  const s = (store.rows.shares ?? []).find((r) => r.id === token)
  if (!s) return { ok: false, reason: 'not_found' }
  if (s.revoked) return { ok: false, reason: 'revoked' }
  if (Date.parse(s.expires_at) <= store.now()) return { ok: false, reason: 'expired' }

  const it = (store.rows.items ?? []).find((r) => r.id === s.item_id && r.deleted_at == null)
  if (!it) return { ok: false, reason: 'not_found' }

  return {
    ok: true,
    expires_at: s.expires_at,
    files: s.files ?? [],
    item: {
      title: it.title,
      content: it.content,
      tags: it.tags ?? [],
      link_url: it.link_url ?? null,
      image_url: it.image_url ?? null,
      created_at: it.created_at,
      updated_at: it.updated_at
    }
  }
}

const RPC = { share_view: (params) => shareView(params?.p_token) }

export function createClient() {
  return {
    from: (table) => makeQuery(table),
    rpc: async (name, params) => {
      store.calls.rpc.push({ name, params })
      const fn = RPC[name]
      if (!fn) {
        return {
          data: null,
          error: { code: 'PGRST202', message: `Could not find the function public.${name}` }
        }
      }
      return { data: fn(params), error: null }
    },
    storage: { from: (bucketId) => storageApi(bucketId) },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      // App.jsx 가 마운트되자마자 구독한다. 점검에서는 아무 일도 하지 않는다.
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  }
}
