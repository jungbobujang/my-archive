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

- **백업에 `time_slots` 가 빠져 있습니다.** `Archive.exportBackup()` 은
  `items` / `categories` / `item_categories` 만 내보냅니다.
  기기를 옮기거나 복원할 때 시간대는 다시 만들어야 합니다.
  스키마 변경 없이 프론트엔드만 고치면 되는 일이라 여기서는 손대지 않았습니다.
