# JariDash v0.1 수동 QA 체크리스트

> 대상: JariDash(서비스명) / TripWatch(내부 코드명) 로컬 v0.1
>
> 이 문서는 `docs/08_테스트 시나리오.md`, `docs/02_MVP PRD.md` 및 현재 Route Handler를 기준으로 한다. 예약·결제·취소·좌석 선택·좌석 선점·CAPTCHA 우회·자동 알림은 시험 대상이 아니며, 어떤 테스트에서도 실행하지 않는다.

## 공통 기록 규칙

- **PASS**: 사전 조건을 만족한 상태에서 실행했고, 모든 기대 HTTP/API/UI/DB 조건이 관찰값으로 확인되었다. 외부 helper를 실행하는 정상 조회는 실제 응답이 `success` 또는 `partial`이고 기대 데이터/공식 링크가 확인된 경우에만 PASS다.
- **FAIL**: 실행했으나 기대 조건과 하나라도 다르거나, 금지된 예약·결제·좌석 선점 동작 또는 secret/raw stderr 노출을 발견했다.
- **NOT_RUN**: 명시적 opt-in 또는 유효한 공연 입력처럼 선택 실행 조건이 없어 의도적으로 실행하지 않았다. 실행하지 않은 항목은 PASS로 기록하지 않는다.
- **BLOCKED**: 실행을 시도했지만 helper 미설치, credential 부족, 로컬 서버/격리 DB 준비 실패, 외부 제공자 장애 등으로 완료할 수 없었다. 차단 사유와 관찰한 안전한 오류 요약만 기록한다. secret 또는 raw stderr는 기록하지 않는다.

### 공통 API 확인법

- 모든 API 응답은 `{status, checkedAt, source, officialUrl?, summary?, data?, error?}` envelope인지 확인한다. `status`는 `success`/`partial`/`failed` 중 하나다.
- `failed` 입력 검증 응답의 기대 API status는 `failed`, `error.code`는 `VALIDATION_ERROR`다. 이 경우 HTTP 400이어야 한다.
- 실제 HTTP/API 결과, 화면 문구, DB 식별자·개수만 기록한다. credential, token, 비밀번호, secret, raw stderr 전체는 기록하지 않는다.
- UI 확인은 해당 페이지에서 수행하고, API 확인은 브라우저 개발자 도구 Network의 응답 body로 수행한다. 조회형 API는 결과 저장이 구현되어 있으므로 `QueryResult`의 `type`, `status`, `checkedAt`, `source`, `summary`, `officialUrl`, `resultJson`을 격리 DB에서 확인한다.

### 격리 DB 및 변경 경계

- `WatchItem` 생성·수정·삭제와 조회 API의 `QueryResult` 저장 검증은 **반드시 임시 SQLite 파일을 가리키는 `DATABASE_URL`** 및 `TRIPWATCH_SMOKE_ALLOW_DB_MUTATION=true`가 설정된 로컬 프로세스에서만 수행한다.
- 실제 사용자 DB, 개발자가 사용 중인 SQLite 파일, 공유 DB에는 연결·정리·삭제하지 않는다. 관리형 smoke는 `finally`에서 테스트 행, 소유한 테스트 서버, 검증된 임시 디렉터리와 DB를 정리한다. 수동 QA도 생성한 `SMOKE_TEST_` 데이터와 전용 임시 DB만 정리하고 사용자 DB cleanup은 수행하지 않는다.
- 위 경계가 증명되지 않으면 DB를 변경하는 모든 항목은 BLOCKED로 기록한다. 읽기 전용 UI/API 확인만 수행한다.

---

## 1. 항공권 왕복 정상 조회

- **목적**: `ICN → NRT` 왕복 가격·항공편 요약, Google Flights 공식 링크, 조회 결과 저장을 확인한다.
- **사전 조건**: 오늘 기준 출발일은 30~60일 후, 귀국일은 출발일 +3~4일로 계산한다. 항공 helper와 필요한 환경 설정이 준비되었고, DB 기록 확인 시 격리 DB 경계를 충족한다.
- **입력값**: `POST /api/flights/search` — `{ "from":"ICN", "to":"NRT", "date":"<오늘 기준 30~60일 후>", "returnDate":"<출발일+3~4일>", "adults":1, "seat":"economy", "mode":"roundtrip", "limit":5 }`.
- **실행 단계**: 1) `/flights`에서 동일 조건으로 왕복 검색한다. 2) Network에서 요청/응답을 확인한다. 3) 가격 요약·항공편 목록·공식 링크·조회 시각을 확인한다. 4) 격리 DB에서 새 `QueryResult(type=flight)`를 확인한다.
- **기대 HTTP status**: `200`.
- **기대 API status**: `success` 또는 `partial`; envelope에 `checkedAt`, `source`, `officialUrl`이 있고 `data` 또는 `summary`에 조회 내용이 있다.
- **기대 UI**: 최저가/평균가/가격대 중 제공 가능한 값, 항공편 목록, Google Flights 링크, 조회 시각, 공식 페이지에서 결제 확인 안내가 보인다.
- **기대 DB 기록**: 격리 DB에 새 `QueryResult` 1건 이상. `type=flight`, 응답과 같은 `status`/`checkedAt`/`source`/`summary`/`officialUrl`, 데이터만 담긴 `resultJson`이 저장된다.
- **실제 결과 기록란**: HTTP: ____ / API status·code: ____ / UI: ____ / DB(id·건수): ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 2. 항공권 잘못된 IATA 검증 및 helper 미호출

- **목적**: 잘못된 IATA가 helper 실행 전에 차단되고 안전한 검증 오류와 공식 링크가 반환되는지 확인한다.
- **사전 조건**: helper 실행 관찰 수단(안전한 호출 횟수/테스트 double/서버 이벤트)이 있으며 raw stderr나 secret을 출력하지 않는다. DB 기록 확인 시 격리 DB 경계를 충족한다.
- **입력값**: `POST /api/flights/search` — `{ "from":"IC", "to":"NRT", "date":"<오늘 기준 30~60일 후>", "returnDate":"<출발일+3일>", "adults":1, "seat":"economy", "mode":"roundtrip" }`.
- **실행 단계**: 1) helper 호출 횟수 관찰을 시작한다. 2) API 요청을 1회 전송한다. 3) 응답과 fallback Google Flights 링크를 확인한다. 4) helper 호출 횟수가 증가하지 않았는지 확인한다. 5) 격리 DB에서 실패 `QueryResult`를 확인한다.
- **기대 HTTP status**: `400`.
- **기대 API status**: `failed`, `error.code=VALIDATION_ERROR`, `source=google-flights-link`, `officialUrl` 존재.
- **기대 UI**: 이해 가능한 입력 오류와 Google Flights 직접 확인 링크가 보이며, secret/raw stderr는 보이지 않는다.
- **기대 DB 기록**: 격리 DB에 `type=flight`, `status=failed`, 검증 오류 요약과 fallback `officialUrl`을 가진 새 `QueryResult`; `resultJson`에는 API 데이터만 저장된다.
- **실제 결과 기록란**: HTTP: ____ / API status·code: ____ / helper 호출: ____ / UI: ____ / DB(id·건수): ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 3. 고속버스 정상 조회

- **목적**: 서울경부→부산 고속버스의 배차·등급·잔여석·요금 및 KOBUS 링크를 조회 전용으로 표시하는지 확인한다.
- **사전 조건**: 오늘 기준 7~30일 후 날짜와 `09:00` 이후 시각을 정하고 helper가 준비되었다. DB 확인 시 격리 DB 경계를 충족한다.
- **입력값**: `POST /api/buses/express/search` — `{ "departName":"서울경부", "arriveName":"부산", "date":"<오늘 기준 7~30일 후>", "time":"09:00", "passengers":1 }`.
- **실행 단계**: 1) `/buses` 고속버스 탭에서 같은 값을 조회한다. 2) API envelope를 확인한다. 3) 배차·등급·잔여석·요금과 KOBUS 링크를 확인한다. 4) 링크는 공식 페이지 이동 용도만인지, 좌석 선점/결제 진입이 없는지 확인한다. 5) 격리 DB의 결과를 확인한다.
- **기대 HTTP status**: `200`.
- **기대 API status**: `success` 또는 `partial`, `officialUrl` 존재.
- **기대 UI**: 배차 시간, 등급, 잔여석, 요금, KOBUS 공식 링크 및 조회 시각이 보이고 좌석 선점·결제 UI가 없다.
- **기대 DB 기록**: 격리 DB에 `type=express_bus` 새 `QueryResult`; 응답 status와 연계된 summary/officialUrl 및 데이터 전용 `resultJson`.
- **실제 결과 기록란**: HTTP: ____ / API status·code: ____ / UI: ____ / DB(id·건수): ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 4. 시외버스 정상 조회

- **목적**: 동서울→속초 시외버스의 배차·운수사·등급·잔여석·총 좌석·요금 및 티머니 링크를 확인한다.
- **사전 조건**: 오늘 기준 7~30일 후 날짜와 `08:00` 이후 시각을 정하고 helper가 준비되었다. DB 확인 시 격리 DB 경계를 충족한다.
- **입력값**: `POST /api/buses/intercity/search` — `{ "departName":"동서울", "arriveName":"속초", "date":"<오늘 기준 7~30일 후>", "time":"08:00", "passengers":1 }`.
- **실행 단계**: 1) `/buses` 시외버스 탭에서 조회한다. 2) envelope를 확인한다. 3) 요구 필드와 티머니 공식 링크를 확인한다. 4) `--hold-seat` 등 좌석 선점 호출이 없는지 관찰한다. 5) 격리 DB의 결과를 확인한다.
- **기대 HTTP status**: `200`.
- **기대 API status**: `success` 또는 `partial`, `officialUrl` 존재.
- **기대 UI**: 배차 시간, 운수사, 등급, 잔여석, 총 좌석, 요금, 티머니 시외버스 링크가 보이며 좌석 선점·결제 UI가 없다.
- **기대 DB 기록**: 격리 DB에 `type=intercity_bus` 새 `QueryResult`; 응답 status/summary/officialUrl 및 데이터 전용 `resultJson`.
- **실제 결과 기록란**: HTTP: ____ / API status·code: ____ / seat-hold 관찰: ____ / UI: ____ / DB(id·건수): ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 5. 공연 schedule 및 seats 정상 조회

- **목적**: 유효한 공연 입력에서 일정과 잔여석 조회가 분리되고 공식 예매 링크만 제공하는지 확인한다.
- **사전 조건**: 오늘 기준 실제 유효한 YES24 또는 인터파크 URL 1개, 또는 검증된 `interpark:<id>`/`yes24:<id>`가 있다. helper/credential이 준비되었다. 없으면 실행하지 않고 NOT_RUN으로 기록한다. DB 확인 시 격리 DB 경계를 충족한다.
- **입력값**: `POST /api/tickets/schedule` — `{ "input":"<유효한 https URL 또는 platform:id>", "mode":"schedule" }`; 이어서 `POST /api/tickets/seats` — `{ "input":"<동일 입력>", "mode":"seats" }`.
- **실행 단계**: 1) `/tickets`에서 입력 후 일정 조회를 실행한다. 2) 같은 입력으로 잔여석 조회를 실행한다. 3) 두 API envelope와 각 `checkedAt`을 확인한다. 4) 회차 날짜·시간, 등급별 잔여 수, 공식 링크를 확인한다. 5) 예매·결제·좌석 선택 자동화가 없는지 확인한다. 6) 격리 DB에서 두 결과를 확인한다.
- **기대 HTTP status**: 각 요청 `200`.
- **기대 API status**: 각 요청 `success` 또는 `partial`, `officialUrl` 존재.
- **기대 UI**: 일정과 잔여석이 분리되어 보이고 회차별 날짜/시간 및 등급별 잔여 수, 조회 시각, 공식 예매 페이지 링크가 보인다. 자동 예매·결제·좌석 선택은 없다.
- **기대 DB 기록**: 격리 DB에 각 요청별 `type=ticket` 새 `QueryResult`; 각각 응답 상태 및 데이터 전용 `resultJson`이 저장된다.
- **실제 결과 기록란**: schedule HTTP/API: ____ / seats HTTP/API: ____ / UI: ____ / DB(id·건수): ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 6. 공연 malformed·lookalike·HTTP·credential URL 검증

- **목적**: 허용하지 않는 공연 입력이 helper 전에 거부되고 credential URL이 허용되지 않는지 확인한다.
- **사전 조건**: helper 호출 관찰 수단이 있으며 secret/raw stderr를 기록하지 않는다. DB 기록 확인 시 격리 DB 경계를 충족한다.
- **입력값**: 각 입력을 `/api/tickets/schedule`과 `/api/tickets/seats`에 각각 전송한다. `not-a-url`(malformed), `https://tickets.interpark.com.evil.example/goods/123`(lookalike), `http://tickets.interpark.com/goods/123`(HTTP), `https://user:password@tickets.interpark.com/goods/123`(credential URL).
- **실행 단계**: 1) 각 입력·각 endpoint를 1회씩 전송한다. 2) 모든 응답과 helper 호출 횟수를 확인한다. 3) UI 오류 안내와 fallback 공식 링크를 확인한다. 4) 격리 DB에서 실패 기록을 확인한다.
- **기대 HTTP status**: 모든 요청 `400`.
- **기대 API status**: 모두 `failed`, `error.code=VALIDATION_ERROR`, `source=ticket-official-link`, 안전한 `officialUrl`만 존재.
- **기대 UI**: URL 또는 `platform:id` 확인 안내가 보이고, 사용자명·비밀번호·secret·raw stderr가 표시되지 않는다.
- **기대 DB 기록**: 격리 DB에 요청별 `type=ticket`, `status=failed` `QueryResult`; credential 원문이나 secret이 `summary`/`resultJson`에 저장되지 않는다.
- **실제 결과 기록란**: 입력별 HTTP/API: ____ / helper 호출: ____ / UI: ____ / DB(id·건수): ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 7. 관심 조건 CRUD: 생성·목록·메모·enabled·삭제

- **목적**: 관심 조건의 생성, 목록, 메모, 활성 여부, 삭제와 화면 반영을 임시 DB에서만 확인한다.
- **사전 조건**: 임시 SQLite `DATABASE_URL`과 `TRIPWATCH_SMOKE_ALLOW_DB_MUTATION=true`가 현재 로컬 프로세스에 적용되었음을 확인한다. 미확인 시 BLOCKED다.
- **입력값**: `POST /api/watchlist` — `{ "type":"flight", "title":"SMOKE_TEST_QA_ICN_NRT", "params":{ "from":"ICN", "to":"NRT", "date":"<오늘 기준 30~60일 후>", "returnDate":"<출발일+3일>", "adults":1, "seat":"economy", "mode":"roundtrip", "limit":5 }, "memo":"QA 메모", "enabled":true }`; 생성 ID를 `<id>`로 하여 `GET /api/watchlist`, `PATCH /api/watchlist/<id>` — `{ "memo":"수정 QA 메모", "enabled":false }`, `DELETE /api/watchlist/<id>`.
- **실행 단계**: 1) 생성 응답의 `<id>`를 기록한다. 2) `/watchlist`와 GET 목록에서 제목·조건·메모·enabled를 확인한다. 3) PATCH 후 수정 메모와 disabled 상태를 확인한다. 4) DELETE 후 목록/DB에서 `<id>`가 사라졌는지 확인한다.
- **기대 HTTP status**: 생성 `201`, 목록 `200`, 수정 `200`, 삭제 `200`.
- **기대 API status**: 모두 `success`; 생성/수정은 `data.item`, 목록은 `data.items`, 삭제는 `data.id`를 포함한다.
- **기대 UI**: `/watchlist`에 유형·제목·조건 요약·메모·활성 상태·마지막 결과가 표시되고 수정과 삭제가 반영된다.
- **기대 DB 기록**: 임시 DB에서 WatchItem이 생성·수정되고 삭제 후 제거된다. 사용자/개발 DB에는 어떤 기록도 만들거나 지우지 않는다.
- **실제 결과 기록란**: create/list/patch/delete HTTP: ____ / API: ____ / id: ____ / UI: ____ / 임시 DB: ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 8. 단일 재조회: enabled·disabled 및 결과 저장

- **목적**: enabled 항목은 재조회하고 disabled 항목은 실행하지 않으며 새 결과가 항목에 연결되는지 확인한다.
- **사전 조건**: 격리 DB에서 enabled flight WatchItem `<enabled-id>`와 disabled WatchItem `<disabled-id>`를 준비한다. helper 미준비로 enabled 조회를 시도했으나 완료할 수 없으면 BLOCKED로 기록한다.
- **입력값**: `POST /api/watchlist/<enabled-id>/run`, `POST /api/watchlist/<disabled-id>/run`.
- **실행 단계**: 1) enabled 항목의 기존 결과 수를 기록한다. 2) enabled 재조회를 1회 실행해 응답과 결과 수 증가를 확인한다. 3) disabled 재조회를 1회 실행해 거부 응답과 helper 미호출을 확인한다. 4) `/watchlist`와 `/dashboard`에서 마지막 결과 연결을 확인한다.
- **기대 HTTP status**: enabled는 결과에 따라 `200`/`400`/`404`/`502`/`504`/`500`; disabled는 `409`.
- **기대 API status**: enabled는 실제 조회 상태(`success`/`partial`/`failed`); disabled는 `failed`, `error.code=DISABLED_WATCH_ITEM`.
- **기대 UI**: enabled 결과의 상태·요약·공식 링크가 표시되고, disabled 항목은 재조회되지 않았다는 안전한 안내가 보인다.
- **기대 DB 기록**: enabled와 disabled 실행 모두 새 `QueryResult` 1건이 각 WatchItem에 연결된다. disabled 결과는 `status=failed`, `errorCode=DISABLED_WATCH_ITEM`이며 helper 결과 데이터가 없다. 각 `resultJson`은 API `data`만 담는다.
- **실제 결과 기록란**: enabled HTTP/API·결과수: ____ / disabled HTTP/API·helper: ____ / UI: ____ / DB 연결: ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 9. QueryResult 상태·data-only·연결·요약·공식 링크

- **목적**: 성공·부분 성공·실패가 각각 `QueryResult`로 저장되고 결과 JSON이 data-only이며 WatchItem 링크, summary, officialUrl이 보존되는지 확인한다.
- **사전 조건**: 격리 DB와 mutation opt-in이 확인되었다. 성공/부분 성공/실패를 각각 재현할 수 있는 안전한 helper fixture 또는 실제 조회 조건이 있다. 재현 불가 상태는 실행하지 않고 NOT_RUN으로 기록한다.
- **입력값**: WatchItem을 통한 단일 또는 batch 재조회로 `success`, `partial`, `failed` 응답을 각각 1개 이상 만든다.
- **실행 단계**: 1) 각 상태의 API envelope를 보관한다. 2) 임시 DB에서 대응 `QueryResult`를 찾는다. 3) `status`, `checkedAt`, `source`, `summary`, `officialUrl`, `watchItemId`를 응답/항목과 대조한다. 4) `resultJson`이 `data` payload만 저장하며 envelope의 `status`, `error`, `summary`, `officialUrl`을 중복 저장하지 않는지 확인한다.
- **기대 HTTP status**: 각 실행 응답의 상태 매핑과 일치(성공·부분 성공은 `200`; 실패는 오류 코드에 따라 `400`/`404`/`502`/`504`/`500`).
- **기대 API status**: `success`, `partial`, `failed`가 각각 관찰된다. 실패는 사용자용 summary/error와 공식 확인 링크를 유지한다.
- **기대 UI**: 상태 배지, 마지막 확인 시각, 요약, 공식 링크가 해당 WatchItem/대시보드에 일치하게 표시된다.
- **기대 DB 기록**: 각 상태별 새 `QueryResult`; `watchItemId` 연결, 응답과 일치하는 metadata, 데이터 전용 `resultJson`.
- **실제 결과 기록란**: success: ____ / partial: ____ / failed: ____ / resultJson 대조: ____ / UI: ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 10. 실패 재조회 1분 cooldown

- **목적**: 마지막 실패 후 1분이 지나지 않은 항목을 batch 재조회에서 건너뛰는지 확인한다.
- **사전 조건**: 격리 DB에 마지막 `QueryResult.status=failed`의 `checkedAt`이 현재 시각 기준 1분 미만인 enabled 비공연 WatchItem이 있다. 이 상태를 안전하게 만들 수 없으면 NOT_RUN이다.
- **입력값**: `POST /api/watchlist/run-batch` — `{ "failedOnly":true, "limit":10 }`.
- **실행 단계**: 1) 대상의 마지막 실패 시각을 기록한다. 2) batch를 1회 실행한다. 3) 응답의 `results`, `executedCount`, `skippedCount`를 확인한다. 4) 대상의 새 QueryResult가 추가되지 않았고 helper가 호출되지 않았는지 확인한다.
- **기대 HTTP status**: `200`.
- **기대 API status**: 실행 결과가 없으면 `failed`(NO_RESULTS)일 수 있고, 다른 실행 항목/skip이 있으면 `partial`; 대상 결과는 `skipped=true`, `skipReason=FAILED_RERUN_COOLDOWN`.
- **기대 UI**: 실패 직후 재조회 제한 또는 건너뜀 안내가 보이며 자동 반복 조회는 없다.
- **기대 DB 기록**: cooldown으로 건너뛴 대상에는 새 `QueryResult`가 없다.
- **실제 결과 기록란**: HTTP/API: ____ / skipped·reason: ____ / helper: ____ / UI: ____ / DB 결과수: ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 11. batch cap·순차 실행·공연 제외·includeTickets·failedOnly

- **목적**: 수동 batch 재조회가 최대 10개, 순차 실행이며 기본 공연 제외와 명시적 공연 포함·실패 전용 필터를 지키는지 확인한다.
- **사전 조건**: 격리 DB와 mutation opt-in이 확인되었다. enabled flight/express_bus/intercity_bus 11개 이상, ticket 1개 이상, 실패 최신 결과와 비실패 최신 결과가 섞인 항목을 준비한다. helper는 안전한 fixture 또는 호출 순서 관찰 수단을 사용한다.
- **입력값**: A. `POST /api/watchlist/run-batch` — `{ "limit":99 }`; B. 같은 endpoint — `{ "type":"ticket", "limit":10 }`; C. `{ "includeTickets":true, "limit":10 }`; D. `{ "failedOnly":true, "includeTickets":true, "limit":10 }`.
- **실행 단계**: 1) A의 `requested.limit=10`, `results.length≤10`, ticket 제외, 시작/종료 시각 또는 fixture 로그로 순차 실행을 확인한다. 2) B에서 ticket이 `includeTickets=true`일 때만 실행 가능하다는 요약과 후보 수를 확인한다. 3) C에서 ticket이 후보에 포함되는지 확인한다. 4) D에서 최신 결과가 failed인 항목만 후보인지 확인한다. 5) 실행·건너뜀마다 새 결과 기록 여부를 대조한다.
- **기대 HTTP status**: 모든 유효 요청 `200`.
- **기대 API status**: A/C/D는 실행 결과에 따라 `success`/`partial`/`failed`; B는 `failed`이며 공연 포함 안내를 반환한다. `requested`에 `limit`, `includeTickets`, `failedOnly`이 정확히 반영된다.
- **기대 UI**: 전체 재조회는 사용자 수동 동작으로만 시작되고, 실행/건너뜀/실패 요약과 공식 링크가 안전하게 표시된다. 자동 알림이나 공격적 polling은 없다.
- **기대 DB 기록**: 실행된 항목만 새 `QueryResult`가 각 WatchItem에 연결된다. cap 밖·ticket 제외·cooldown skip 항목에는 새 기록이 없다.
- **실제 결과 기록란**: A(cap/순차/ticket 제외): ____ / B: ____ / C(includeTickets): ____ / D(failedOnly): ____ / DB: ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 12. 대시보드 요약·목록·실패 재조회·공식 링크·공연 확인

- **목적**: `/dashboard`와 `/api/dashboard/summary`가 날짜/마지막 확인/카운트/목록 제한/실패 재조회/공식 링크/공연 확인을 일관되게 제공하는지 확인한다.
- **사전 조건**: 격리 DB에 서로 다른 상태의 WatchItem 및 QueryResult를 10건 초과로 준비하고, 실패 항목과 ticket 항목을 포함한다. 생성이 불가하면 이미 격리 DB에 있는 데이터만 읽어 확인하고 부족한 조건은 NOT_RUN/BLOCKED로 기록한다.
- **입력값**: `GET /api/dashboard/summary`, `/dashboard` 로드, 실패 WatchItem의 재조회 버튼 1회. ticket 항목은 공식 링크/수동 확인만 수행한다.
- **실행 단계**: 1) summary envelope를 확인한다. 2) 화면의 오늘 표시 날짜가 API `generatedAt`을 기준으로 표시되고, 각 WatchItem의 마지막 확인 시각과 상태별 카운트가 API와 일치하는지 대조한다. 3) 최근 결과·관심 조건·실패 결과 목록이 각각 최대 10개인지 확인한다. 4) 실패 항목의 수동 재조회 결과/새 QueryResult를 확인한다. 5) 공식 링크가 표시되는지 확인한다. 6) ticket은 자동 조회/예매가 아니라 공식 페이지 수동 확인 링크만 제공하는지 확인한다.
- **기대 HTTP status**: summary `200`; 실패 항목 재조회는 실제 결과 매핑(성공·부분 성공 `200`, 실패는 해당 오류 HTTP status).
- **기대 API status**: summary `success`; 재조회는 실제 `success`/`partial`/`failed`. 모든 응답은 공통 envelope다.
- **기대 UI**: API `generatedAt` 기준 오늘 날짜, 마지막 확인, success/partial/failed 카운트, 최근 결과·관심 조건·실패 결과 각 최대 10개, 실패 재조회 버튼, 공식 링크가 보인다. 공연은 좌석 선택/예약/결제 대신 공식 페이지에서 수동 확인하도록 안내한다.
- **기대 DB 기록**: summary 조회만으로는 새 DB 기록이 없다. 실패 재조회가 실행되면 격리 DB에 해당 WatchItem과 연결된 새 `QueryResult` 1건이 생긴다.
- **실제 결과 기록란**: summary HTTP/API: ____ / 날짜·last check·counts: ____ / 목록 수: ____ / 실패 재조회: ____ / ticket 확인: ____ / DB: ____ / 비고: ____
- **결과 선택**: [ ] PASS [ ] FAIL [ ] NOT_RUN [ ] BLOCKED

## 최종 판정

- [ ] 정상 조회를 실제로 실행한 항목 중 최소 1개가 PASS다.
- [ ] 실행하지 않은 helper 정상 조회는 모두 NOT_RUN 또는 BLOCKED로 기록했고 PASS로 표시하지 않았다.
- [ ] 실패 검증은 UI와 격리 DB에 안전하게 기록되었거나, 격리 경계 미충족 사유로 BLOCKED 처리되었다.
- [ ] 예약·결제·취소·좌석 선택·좌석 선점·우회 자동화·자동 알림을 실행하거나 발견하지 않았다.
- [ ] 실제 결과 기록란에 secret, credential, token, 비밀번호, raw stderr가 없다.
