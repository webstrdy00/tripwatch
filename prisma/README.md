# Prisma

이 디렉터리는 SQLite와 Prisma schema를 관리합니다.

v0.2.1 schema는 `WatchItem`, `QueryResult`, 그리고 `WatchItem`당 선택적인 하나의 `AlertRule`을 모델링한다. `prisma/migrations/20260718000000_add_alert_rule/migration.sql`에 AlertRule migration이 존재한다. 사용자 DB에 이 migration을 적용하는 일은 별도 운영자 절차이며, 자동 검증이나 개발 도구가 사용자 DB에 적용하지 않는다.

자동 테스트와 smoke에서 DB mutation이 필요하면 `scripts/with-owned-temp-db.ts` wrapper를 사용한다. Wrapper가 자신이 만든 temp 디렉터리와 marker, 강제 SQLite URL을 검증하고 migration을 적용한 뒤 child에만 mutation capability를 전달한다. 기존 사용자 DB와 `prisma/dev.db`에는 자동으로 migrate하거나 cleanup하지 않는다.
