# AGENTS.md

## Project

You are working on EVGaply, a public-data web application for EV charging infrastructure analysis in Korea.

EVGaply provides:

1. A driver-facing EV charger map.
2. An infrastructure analysis dashboard.
3. An admin management mode.

The service uses Korean public data APIs to show near-real-time EV charger status, charger availability, infrastructure gaps, congestion possibility, and installation priority rankings.

## Source of truth

Before making changes, always read these documents:

- docs/00\_문서 Index.md
- docs/01\_서비스 기획안.md
- docs/02\_화면 설계 및 운영자 모드.md
- docs/03\_데이터 소스 및 분석 지표.md
- docs/04\_기술 스택 DB API 설계.md
- docs/05_MVP 개발 계획.md
- docs/06_API 명세 및 샘플 응답.md
- docs/07\_충전기 상태 코드 매핑표.md
- docs/08\_분석 점수 정규화 기준.md
- docs/09\_보안 개인정보 운영 정책.md

If a document and existing code conflict, ask for clarification or propose the smallest safe correction.

## Development priorities

Build in this order:

1. MVP 0 first.
2. MVP 1 second.
3. Production hardening last.

MVP 0 includes:

- EV charger map.
- Charger status display.
- Available-only filter.
- Fast-charger-only filter.
- Station detail panel.
- Region summary.
- Admin dashboard showing data collection status.
- Manual collection trigger.

MVP 1 includes:

- Status history.
- Congestion possibility analysis.
- Grid-based gap analysis.
- Installation priority ranking.
- User reports.
- Analysis config management.

Do not implement excluded features unless explicitly requested:

- Payment.
- Reservation.
- Native mobile app.
- Push notifications.
- Route recommendation.
- Price comparison.
- User favorites.

## Tech stack

Use this stack unless explicitly changed:

- Frontend: Next.js + TypeScript
- Backend: FastAPI + Python
- Database: PostgreSQL + PostGIS
- Cache: Redis
- Data validation: Pydantic
- DB migration: Alembic
- Frontend package manager: pnpm
- Backend dependency management: uv or pip-tools
- Containerization: Docker Compose

## Coding rules

- Keep changes scoped to the current goal.
- Do not rewrite unrelated files.
- Prefer small, reviewable commits or diffs.
- Use clear names: station, charger, status, region, gap, priority.
- Separate public API, admin API, data collection, and analysis modules.
- Never expose public data API service keys to the frontend.
- Store API keys only in environment variables.
- Do not store user location permanently in MVP.
- Add tests for status mapping, score calculation, API parsing, and key backend endpoints.
- Always update docs/IMPLEMENTATION_STATUS.md after each goal.

## Validation rules

After each implementation goal, run the relevant checks:

Backend:

- python -m pytest
- ruff check .
- mypy app || true if mypy is not configured yet

Frontend:

- pnpm lint
- pnpm typecheck
- pnpm build

Docker:

- docker compose config
- docker compose up -d db redis
- run migrations if available

If a check fails, fix it before moving to the next goal.

## Output format after each goal

When done, summarize:

1. What changed.
2. Files modified.
3. How to run it.
4. Validation commands run.
5. Known issues.
6. Next recommended goal.
