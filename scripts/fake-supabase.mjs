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
  // 업로드를 거부할 경로 조건. (path) => 오류 메시지 | null
  uploadGuard: null,
  calls: { upload: [], remove: [], signed: [] }
}

export function resetStore() {
  store.buckets = { 'archive-images': new Map(), 'archive-files': new Map() }
  store.rows = { items: [], item_categories: [], categories: [], time_slots: [] }
  store.missingFilesColumn = false
  store.uploadGuard = null
  store.calls = { upload: [], remove: [], signed: [] }
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
      store.calls.signed.push({ bucket: bucketId, path, download: opts?.download ?? null })
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

let seq = 0
const newId = () => `row-${++seq}`

function matches(row, filters) {
  return filters.every(([kind, col, a, b]) => {
    if (kind === 'eq') return row[col] === a
    // .not('deleted_at', 'is', null) -> deleted_at 이 null 이 아닌 행
    if (kind === 'not' && a === 'is' && b === null) return row[col] != null
    if (kind === 'is' && a === null) return row[col] == null
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
    order() { return q },
    range() { return q },
    single() { q._single = true; return q },
    then(onOk, onErr) { return Promise.resolve().then(() => run(table, q)).then(onOk, onErr) }
  }
  return q
}

function run(table, q) {
  const rows = (store.rows[table] ??= [])

  if (q._op === 'insert') {
    const list = Array.isArray(q._payload) ? q._payload : [q._payload]
    if (table === 'items' && store.missingFilesColumn && list.some((r) => 'files' in r)) {
      return { data: null, error: MISSING_FILES }
    }
    const made = list.map((r) => ({ id: r.id ?? newId(), created_at: new Date(0).toISOString(), ...r }))
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

export function createClient() {
  return {
    from: (table) => makeQuery(table),
    storage: { from: (bucketId) => storageApi(bucketId) },
    auth: { getSession: async () => ({ data: { session: null }, error: null }) }
  }
}
