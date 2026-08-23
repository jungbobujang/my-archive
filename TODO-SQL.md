# TODO-SQL

Supabase 에서 사람이 직접 실행해야 하는 SQL 을 모아 두는 파일입니다.

---

## ✅ 1. setup.sql 따라잡기 — 처리 완료

**상태: 검토·실행 완료 (사용자 확인), 이후 `supabase/setup.sql` 자체를 최신화했습니다.**

`supabase/setup.sql` 이 v1.0 시점 그대로여서 `categories` · `item_categories` · `time_slots`
테이블과 `items` 의 컬럼 6개가 빠져 있던 문제였습니다.

지금은 **`supabase/setup.sql` 하나만 실행하면 새 프로젝트가 완전히 동작**합니다.
따로 붙여넣을 따라잡기 SQL 은 더 이상 없습니다. 여기에 있던 마이그레이션 본문은
setup.sql 안으로 흡수했으므로 중복을 피하려고 삭제했습니다.

setup.sql 이 하는 일:

- 테이블 4개 (categories / time_slots / items / item_categories)
- RLS 정책 (본인 데이터만), 인덱스, 이미지 버킷 `archive-images`
- `updated_at` 자동 갱신 트리거
- **기본 카테고리 4종 + 시간대 5종 시드** — 가입 트리거로 새 계정에 자동 적용,
  기존 계정에는 실행 시 채워 넣음. 그 사용자에게 이미 있으면 통째로 건너뜁니다.
- 여러 번 다시 실행해도 안전 (`if not exists` / `drop policy if exists` / 시드 존재 검사)

### 남아 있는 선택 사항

- `items.category` (v1.0 의 고정 카테고리 문자열)는 코드가 더 이상 읽지 않습니다.
  setup.sql 이 `not null` 제약은 풀어 두었지만 **열 자체는 남겨 두었습니다** —
  옛 백업 JSON 을 복원할 때 이 열이 없으면 실패하기 때문입니다.
  옛 백업을 더 쓸 일이 없다고 판단되면 그때 지우세요.

  ```sql
  -- 백업 JSON 을 먼저 받아 둔 뒤에 실행하세요. 되돌릴 수 없습니다.
  alter table public.items drop column if exists category;
  drop index if exists public.items_category_idx;   -- v1.0 이 만들던 인덱스
  ```

---

## 2. 아직 필요한 DB 변경

**없습니다.**

밤샘 작업(PWA · 모바일 · 다크 모드 · 에러 처리 · 성능 · 코드 정리 · 디자인 폴리싱 ·
요금제 초안)과 이후 모바일 재점검에서 추가로 필요한 스키마 변경은 나오지 않았습니다.
테마 설정은 `localStorage('archive-theme')` 에, 보기·탭 선택도 기존대로 `localStorage` 에 둡니다.

요금제 화면은 정적 초안이라 결제·구독 테이블을 만들지 않았습니다.
실제 유료화를 진행할 때 `subscriptions` 같은 테이블이 필요해지면 여기에 이어서 적습니다.

---

## 참고: 코드에서 발견했지만 DB 변경은 아닌 것

- ~~백업에 `time_slots` 가 빠져 있습니다.~~ **처리 완료.**
  내보내기에 `time_slots` 를 추가하고, 가져오기도
  카테고리 → **시간대** → 항목 → 카테고리 소속 순서로 복원합니다
  (`items.slot_id` 가 `time_slots` 를 참조하므로 항목보다 먼저 들어가야 합니다).
  시간대가 없는 옛 백업 파일도 그대로 복원됩니다.

---

## ⚠ 2. 파일 첨부 — **실행 필요** (2026-08-23)

항목에 문서·압축파일을 붙이는 기능(`file-attach` 브랜치)이 쓰는 스키마입니다.
**아래를 Supabase SQL Editor 에 붙여넣고 Run 하기 전까지는 파일 첨부가 동작하지 않습니다.**

무엇이 생기는가:

- `items.files` — jsonb 배열. 첨부 파일의 **메타만** 담습니다(이름·경로·용량).
  `[{ "name": "보고서.hwp", "path": "<항목id>/1724..._보고서.hwp", "size": 12345, "type": "", "at": "..." }]`
- `files` 버킷 — 파일 **실체**. 이미지 버킷(`archive-images`)과 분리했고,
  **비공개**입니다. 이미지는 카드 썸네일이 `<img>` 로 바로 떠야 해서 공개지만,
  문서는 주소만 알면 누구나 받을 수 있으면 안 됩니다. 화면에서는 누를 때마다
  60초짜리 서명 주소를 받아 내려받습니다.

정책은 **올린 사람만** 읽고 지웁니다(`auth.uid() = owner`). 이미지 버킷의 읽기 정책이
"버킷이면 누구나" 인 것과 다른 점입니다.

```sql
-- ============================================================
-- 파일 첨부 (items.files + files 버킷)
-- 여러 번 다시 실행해도 안전합니다.
-- ============================================================

-- 1) 항목에 첨부 파일 메타를 담을 열
alter table public.items
  add column if not exists files jsonb not null default '[]'::jsonb;

-- 옛 행에 null 이 들어 있으면 화면에서 매번 방어해야 한다 → 여기서 한 번에 정리
update public.items set files = '[]'::jsonb where files is null;

-- 2) 파일 버킷 (비공개 — 이미지 버킷과 분리)
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

-- 이미 만들어 둔 적이 있다면 공개로 열려 있지 않게 못박는다
update storage.buckets set public = false where id = 'files';

-- 3) 정책 — 올린 사람만 읽고/올리고/지운다
drop policy if exists "archive files read" on storage.objects;
create policy "archive files read" on storage.objects
  for select using (
    bucket_id = 'files' and auth.uid() = owner
  );

drop policy if exists "archive files upload" on storage.objects;
create policy "archive files upload" on storage.objects
  for insert with check (
    bucket_id = 'files' and auth.role() = 'authenticated'
  );

drop policy if exists "archive files delete" on storage.objects;
create policy "archive files delete" on storage.objects
  for delete using (
    bucket_id = 'files' and auth.uid() = owner
  );
```

확인용:

```sql
select column_name, data_type, column_default
  from information_schema.columns
 where table_name = 'items' and column_name = 'files';

select id, public from storage.buckets where id = 'files';
```

### 곁들여 알아 둘 것

- **개당 10MB · 항목당 5개 · 확장자 화이트리스트**(hwp hwpx pdf docx xlsx pptx txt zip)는
  화면에서 막습니다. 서버에서도 막고 싶으면 버킷의 `file_size_limit` /
  `allowed_mime_types` 를 설정하면 되는데, hwp 의 MIME 이 브라우저마다 제각각이라
  (`application/x-hwp` · `application/haansofthwp` · 빈 값) MIME 목록으로 막으면
  정상 파일이 거부됩니다. 그래서 확장자 기준으로 화면에서만 막습니다.
- 항목을 **영구 삭제**(휴지통 → 영구 삭제 / 전부 비우기)하면 앱이 스토리지의 파일도
  함께 지웁니다. DB 의 `on delete cascade` 는 스토리지까지 지워 주지 않습니다.
