# TripWatch

JariDash(내부 코드명 TripWatch)는 개인용 여행·예약 조회 대시보드입니다. v0.1은 Next.js App Router, SQLite/Prisma, 조회 helper, 관심 조건과 조회 결과 저장을 사용합니다.

## 범위

- 포함: 기본 페이지 5개, 공통 UI, `WatchItem`/`QueryResult` 저장, 항공권·버스·공연 조회 API, 관심 조건 CRUD·단건 재조회·수동 배치 재조회, 대시보드 요약
- 수동 배치 재조회: 활성 항목 최대 10개, 순차 실행, 공연 기본 제외, 최근 실패 후 1분 재조회 제한
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

- `/dashboard`: 관심 조건 수, 수동 재조회, 최근 결과와 실패 결과
- `/flights`: 항공권 검색과 월별 비교
- `/buses`: 고속버스/시외버스 조회
- `/tickets`: 공연 일정/잔여석 조회
- `/watchlist`: 관심 조건 CRUD와 항목별 다시 조회

## 안전 원칙

TripWatch의 외부 연동은 조회 전용 helper만 사용합니다. 자동 예약·결제·취소·좌석 선택·반복 polling은 구현하지 않으며, 모든 예약/결제는 공식 페이지에서 사용자가 직접 진행합니다.
