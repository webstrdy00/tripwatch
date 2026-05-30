# TripWatch

TripWatch는 개인용 여행·예약 조회 대시보드입니다. v0.1 skeleton은 Next.js App Router 기반 화면 구조, 공통 UI, SQLite/Prisma 저장 기반을 먼저 준비합니다.

## 범위

- 포함: 기본 페이지 5개, 공통 레이아웃, placeholder UI, 안전 안내, 상태 배지, `WatchItem`/`QueryResult` Prisma 모델, 공통 API 타입, validation, 안전한 helper 실행 wrapper
- 보류: 실제 외부 조회 route, 관심 조건 CRUD 화면 연결
- v0.1 `WatchItem.type`: `flight`, `express_bus`, `intercity_bus`, `ticket`
- 향후 후보: `foresttrip`, `srt`, `ktx`는 문서 후보로만 남기고 v0.1 생성 schema에서는 허용하지 않음
- v0.2 예정: `AlertRule` 모델과 Telegram 알림
- 제외: 자동 예약, 자동 결제, 자동 취소, 자동 좌석 선택, CAPTCHA/fingerprint/bot-block 우회, aggressive polling

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000/dashboard`를 엽니다.

## 검증

```bash
npx prisma format
npx prisma generate
npx prisma migrate dev --name init
npm run lint
npm run typecheck
npm run build
```

## 페이지

- `/dashboard`: 관심 조건, 최근 조회, 실패 조회 placeholder
- `/flights`: 항공권 검색 placeholder
- `/buses`: 고속버스/시외버스 탭 placeholder
- `/tickets`: 공연 일정/잔여석 조회 placeholder
- `/watchlist`: 관심 조건 목록 placeholder

## 안전 원칙

TripWatch는 현재 skeleton 단계에서 실제 외부 사이트 호출을 구현하지 않습니다. 모든 예약/결제는 공식 페이지에서 사용자가 직접 진행합니다.
