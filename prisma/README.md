# Prisma

이 디렉터리는 SQLite와 Prisma schema를 관리합니다.

v0.2.1 schema는 `WatchItem`, `QueryResult`, 그리고 `WatchItem`당 선택적인 하나의 `AlertRule`을 모델링합니다. `AlertRule`은 Telegram 알림 설정과 최신 상태만 보관하는 추가 경계이며, 실제 데이터베이스 마이그레이션은 별도 운영자 절차입니다.
