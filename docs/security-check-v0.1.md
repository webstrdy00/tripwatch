# JariDash v0.1 보안 점검

- 점검 기준일: 2026-07-10
- 범위: 저장소의 JariDash UI/API와 TripWatch 내부 호환 계층, 격리된 mock 서버 read-only smoke 및 OS 임시 SQLite mutation smoke. 실제 외부 helper·공식 사이트·사용자 데이터는 실행하거나 조회하지 않았다.
- 상태 표기: **PASS**는 아래에 적은 현재 소스 근거를 확인한 관찰, **FAIL**은 확인된 위반, **NOT_RUN**은 실행하지 않은 검사 또는 외부 실행 검증, **BLOCKED**는 검증을 막는 조건을 뜻한다. 이 문서에서 관찰 결과에는 이 네 값만 사용한다.
- 중요한 한계: 정적 키워드 스캔만으로는 호출 경로, 동적으로 만든 값, 외부 helper의 실제 동작, 배포 환경을 증명할 수 없다. 따라서 정적 스캔은 후보 탐지와 회귀 방지 보조 수단이며, 동적 격리 smoke와 코드 검토를 대체하지 않는다.
- 실행 근거: `npm run security:scan`은 `HIGH=0`, `REVIEW=0`, `INFO=44`, `ALLOWED=3`으로 통과했다.
- 동적 근거: 격리 mock read-only smoke는 `PASS=8`, `FAIL=0`; 임시 DB mutation smoke는 `PASS=24`, `FAIL=0`, `BLOCKED=0`으로 통과했고 실제 helper opt-in은 **NOT_RUN**이었다.
- 정리 근거: 관리형 mutation 서버와 임시 DB는 `finally`에서 제거했고, 별도 read-only 서버와 임시 DB도 종료·삭제 후 경로 부재를 확인했다.
## 필수 항목별 판정표

아래 표는 각 필수 항목의 점검 대상·정적 검사 방법·동적 검사 방법·근거·결과·남은 리스크를 항목별로 분리한 요약이다. 상세 근거는 뒤 절에서 보충한다.

| 점검 대상 | 정적 검사 방법 | 동적 검사 방법 | 확인 파일 또는 근거 | 결과 | 남은 리스크 |
| --- | --- | --- | --- | --- | --- |
| 자동 결제 코드 없음 | transaction action/keyword와 route/service 호출 검토 | 격리 smoke에서 결제 action/인수 부재 확인 | `scripts/security-scan.ts`, `app/api/**`, `lib/services/**` | **PASS**(소스·mock), **NOT_RUN**(live) | 새 helper/route 추가 시 재검토 |
| 자동 예약 확정 코드 없음 | 예약 확정 action과 helper args 검토 | 조회 요청 뒤 외부 상태 변경 부재 확인 | service args builder, `AGENTS.md` | **PASS**(소스·mock), **NOT_RUN**(live) | 외부 helper 내부 동작은 별도 경계 |
| 자동 취소 코드 없음 | cancel action/endpoint 후보 검토 | 격리 조회에서 취소 요청 부재 확인 | route/service 소스, scan 규칙 | **PASS**(소스·mock), **NOT_RUN**(live) | 간접 의존성 호출 |
| 자동 좌석 선택 코드 없음 | seat selection action과 UI/API 검토 | 버스·공연 조회에서 선택 요청 부재 확인 | bus/ticket route·service·component | **PASS**(소스·mock), **NOT_RUN**(live) | `seats` 조회 용어와 action 구분 필요 |
| 좌석 선점 코드 없음 | `--hold-seat`, hold action 검토 | helper argv에 hold 인수 부재 확인 | service args builder, `scripts/security-scan.ts` | **PASS**(소스·mock), **NOT_RUN**(live) | helper 자체 옵션은 앱 allowlist 밖이어야 함 |
| CAPTCHA 우회 코드 없음 | CAPTCHA/bypass 후보 검토 | 외부 우회 동작 없이 실패하는지 확인 | source scan, 안전 정책 | **PASS**(소스·mock), **NOT_RUN**(live) | 난독화된 외부 의존성 |
| fingerprint/bot-block 우회 코드 없음 | fingerprint/bot-block 후보 검토 | 차단 시 우회 대신 안전 실패 확인 | source scan, 안전 정책 | **PASS**(소스·mock), **NOT_RUN**(live) | 외부 helper 버전 변경 |
| aggressive polling 없음 | `setInterval`, timer refetch, cron 검토 | Network에서 자동 반복 요청 부재 확인 | source scan, batch route의 수동 POST | **PASS**(소스·단발 smoke), **NOT_RUN**(장시간 브라우저 관찰) | 사용자 반복 클릭과 향후 알림 |
| secret 화면 노출 없음 | component가 raw/error secret을 렌더링하는지 검토 | sentinel이 UI HTML에 없는지 확인 | components, `lib/errors.ts`, smoke sentinel | **PASS**(소스·동적) | 비정형 secret 값 |
| secret API 응답 노출 없음 | response/error 변환과 raw 경로 검토 | sentinel이 API body에 없는지 확인 | `lib/api-response.ts`, `lib/errors.ts`, smoke | **PASS**(소스·동적) | `error.raw` 소비자와 새 route |
| secret 로그 노출 없음 | console/process.env/stderr sink 검토 | sentinel stderr와 서버 로그 마스킹 확인 | `lib/secrets.ts`, `lib/shell.ts`, scan | **PASS**(소스), **NOT_RUN**(동적) | 라이브러리 자체 로그 |
| shell command string 조립 없음 | `exec`, interpolation, concatenation 검토 | metacharacter 입력에서 process 미실행 확인 | `lib/shell.ts`, service args builder, scan | **PASS**(소스), **NOT_RUN**(동적) | wrapper 밖 새 child process |
| `execFile`/`spawn` args 배열 사용 | child-process 호출 형식 검토 | argv spy/격리 helper 확인 | `runHelperCommand`, `scripts/helper-smoke.ts` | **PASS**(소스), **NOT_RUN**(동적) | 자유 형식 command API는 caller 검토 필요 |
| helper timeout 있음 | 모든 service timeout 상수와 wrapper 검사 | 지연 helper로 `HELPER_TIMEOUT` 확인 | `lib/shell.ts`, 각 service | **PASS**(소스), **NOT_RUN**(동적) | SIGTERM 무시/자식 process |
| stdout 최대 길이 제한 있음 | byte limit·overflow branch 검사 | 큰 stdout fixture로 종료 확인 | `lib/shell.ts` | **PASS**(소스), **NOT_RUN**(동적) | helper 별 override 상한 정책 |
| stderr 원문 전체 노출 없음 | capture/500자 summary/masking 검사 | 긴 stderr와 sentinel로 잘림 확인 | `lib/shell.ts`, `lib/secrets.ts` | **PASS**(소스), **NOT_RUN**(동적) | 알려지지 않은 secret 형태 |
| QueryResult에 raw stderr 저장 없음 | DB field mapping 검사 | 격리 DB row에서 raw 부재 확인 | `lib/result-store.ts`, Prisma schema | **PASS**(소스), **NOT_RUN**(동적) | 다른 직접 DB write 경로 |
| 공식 URL HTTPS/hostname allowlist | URL parser의 scheme/userinfo/host 검사 | 정상·HTTP·credential·lookalike 경계값 요청 | `lib/official-urls.ts`, `lib/validation/ticket-schema.ts` | **PASS**(소스·동적) | 허용 상위 도메인의 서브도메인 범위 |
| lookalike hostname 차단 | 정확 일치/점 경계 suffix 검사 | `tickets.interpark.com.evil.example` 거부 확인 | ticket schema, smoke invalid URL cases | **PASS**(소스·동적) | 국제화 도메인/정책 변경 |
| `resultJson`에 envelope/raw error 없음 | `response.data ?? {}` 직렬화 mapping 검사 | 격리 DB JSON key 검사 | `lib/result-store.ts`, smoke DB inspector | **PASS**(소스·동적) | data payload 자체의 민감 값/크기 |

## 1. 예약·결제·좌석 조작 및 우회 자동화 금지

### 점검 대상

자동 결제, 예약 확정, 취소, 좌석 선택, 좌석 선점(hold), CAPTCHA/fingerprint/bot-block 우회, 공격적 polling, 자동 알림이 API·서비스·helper 인수로 추가되지 않는지 점검한다.

### 정적 검사 방법

- `scripts/security-scan.ts`가 `app/`, `components/`, `lib/`, `scripts/`를 재귀 검사하도록 구성되어 있으며 결제·예약·취소·좌석 액션/`--hold-seat`, 우회 관련 표현, 반복 또는 짧은 refetch timer를 후보로 보고한다. 문서와 README의 일치 항목은 INFO로 분리한다.
- 현재 라우트는 조회와 watchlist 관리 범위다: `app/api/flights/search/route.ts`, `app/api/flights/compare-month/route.ts`, `app/api/buses/express/search/route.ts`, `app/api/buses/intercity/search/route.ts`, `app/api/tickets/schedule/route.ts`, `app/api/tickets/seats/route.ts`, `app/api/watchlist/route.ts`, `app/api/watchlist/[id]/route.ts`, `app/api/watchlist/[id]/run/route.ts`, `app/api/watchlist/run-batch/route.ts`, `app/api/dashboard/summary/route.ts`.
- 서비스의 helper 인수는 조회 명령으로 제한된다. 예를 들어 `lib/services/ticket-service.ts`의 `argsForSchedule`/`argsForSeats`는 `schedule` 또는 `seats`와 정규화된 공연 식별자만 전달한다. 항공·고속버스·시외버스도 `lib/services/flight-service.ts`, `lib/services/express-bus-service.ts`, `lib/services/intercity-bus-service.ts`의 조회 서비스 계층을 통해서만 helper를 호출한다.

### 동적 검사 방법

- 격리 환경에서 `scripts/helper-smoke.ts`의 usage, 정상 조회, 잘못된 입력 실패 case를 실행하고, 출력 요약에 결제·예약·취소·좌석 조작이 없는지 확인한다.
- 외부 helper는 독립 코드이므로 `--help`와 실제 조회 전용 invocation을 검토하되, 결제/예약/취소/좌석 조작을 유발하는 인수는 실행하지 않는다.

### 확인 파일/근거

- `AGENTS.md`의 안전 원칙 및 helper 원칙.
- 위 API route 파일들, `lib/services/watchlist-run-service.ts`, `lib/services/flight-service.ts`, `lib/services/express-bus-service.ts`, `lib/services/intercity-bus-service.ts`, `lib/services/ticket-service.ts`.
- `scripts/security-scan.ts`, `scripts/helper-smoke.ts`.

### 결과

- **PASS**: 확인한 애플리케이션 route/service 소스에 자동 결제·예약 확정·취소·좌석 선택·좌석 선점·CAPTCHA/fingerprint/bot-block 우회·공격적 polling·자동 알림 호출은 확인되지 않았다.
- **PASS**: `npm run security:scan` 실행 결과 `HIGH=0`, `REVIEW=0`이었다. `scripts/helper-smoke.ts` 실행은 **NOT_RUN**이다.
- **NOT_RUN**: 외부 live helper의 실제 네트워크 동작은 확인하지 않았다.

### 남은 리스크

외부 helper와 향후 추가 route가 읽기 전용 계약을 깨뜨릴 수 있다. watchlist 재조회는 자동 알림은 아니지만, 호출 빈도 제한의 런타임 동작은 별도 동적 검증이 필요하다.

## 2. Secret의 UI·API·로그 노출 금지

### 점검 대상

secret, token, password, API key, credential, auth/session/cookie 값과 stderr 원문이 UI, API 응답, 콘솔/로그 또는 저장 데이터에 노출되지 않는지 점검한다.

### 정적 검사 방법

- `lib/secrets.ts`의 `maskSecrets`는 환경변수 키 패턴과 `extraSecrets` 값을 긴 값 우선으로 `[REDACTED]` 처리하고, `key=value`/`key: value` 형태도 마스킹한다.
- `lib/errors.ts`는 `TripWatchError.raw` 생성 시와 `summarizeError`에서 `maskSecrets`를 적용한다.
- `scripts/security-scan.ts`는 secret·raw response·stderr의 콘솔/API 노출 후보를 검사하며 `lib/shell.ts`와 `scripts/helper-smoke.ts`의 제한·마스킹 경로는 허용 근거로 취급한다.

### 동적 검사 방법

- 격리된 임의 secret을 포함한 helper stderr를 발생시켜 API 응답, 서버 로그, smoke 출력에서 원문 대신 `[REDACTED]`가 보이는지 확인한다.
- 실제 개발자 credential, `.env`, SQLite 실데이터는 사용하거나 출력하지 않는다.

### 확인 파일/근거

- `lib/secrets.ts`, `lib/errors.ts`, `lib/shell.ts`, `lib/result-store.ts`, `scripts/helper-smoke.ts`, `scripts/security-scan.ts`.

### 결과

- **PASS**: 소스 경로와 focused check에서 custom env secret 및 `Authorization: Bearer` credential이 `[REDACTED]`로 치환됨을 확인했다.
- **NOT_RUN**: 실제 secret을 포함한 stderr/API/log end-to-end 검증은 수행하지 않았다.

### 남은 리스크

키 이름이 탐지 패턴 밖에 있거나 4자 미만인 secret, 구조화된 JSON의 비정형 credential, stderr 이외의 외부 라이브러리 로그는 누락될 수 있다. 마스킹은 secret 저장 자체를 정당화하지 않는다.

## 3. Shell 문자열 조립 금지 및 args 배열 실행

### 점검 대상

사용자 입력을 shell command 문자열로 조립하지 않고 `execFile` 또는 `spawn`에 명령과 args 배열을 분리해 넘기는지 점검한다.

### 정적 검사 방법

- `lib/shell.ts`의 `runHelperCommand(command, args, options)`는 `spawn(command, [...args], { shell: false, ... })`를 사용한다.
- `lib/services/ticket-service.ts`의 `argsForSchedule`, `argsForSeats`와 `runTicketHelper`는 식별자·고정 subcommand를 배열로 전달한다.
- `lib/validation/ticket-schema.ts`의 `parseTicketInput`은 `platform:id` 또는 HTTPS 공식 티켓 URL만 정규화하며, ID는 `[A-Za-z0-9_-]+`로 제한한다.
- `scripts/security-scan.ts`는 `exec`, `shell:true`, 명령 문자열 결합을 후보로 검사한다.

### 동적 검사 방법

- shell metacharacter가 포함된 ticket 입력을 API schema에 전달해 validation 실패를 확인하고, helper process가 시작되지 않았는지 격리 harness로 확인한다.
- `spawn`/`execFile` spy 또는 격리 helper로 command와 args가 분리된 상태인지 확인한다.

### 확인 파일/근거

- `lib/shell.ts`, `lib/services/ticket-service.ts`, `lib/validation/ticket-schema.ts`, `scripts/security-scan.ts`.

### 결과

- **PASS**: 공통 helper wrapper의 `spawn` args 배열 및 `shell: false`를 확인했다.
- **PASS**: ticket 입력의 공식 HTTPS host와 식별자 형식 제한을 확인했다.
- **NOT_RUN**: shell metacharacter 입력에 대한 route/service 동적 검증은 수행하지 않았다.

### 남은 리스크

공통 wrapper 밖에서 새 child-process 호출을 추가하면 이 보장이 적용되지 않는다. 플랫폼별 argument parsing과 외부 helper 내부 실행은 별도 검토 대상이다.

## 4. Helper timeout·출력 제한·잘린 마스킹 stderr

### 점검 대상

helper 실행마다 timeout, stdout 최대 크기, 제한된 stderr 수집, 잘림 표기 및 secret 마스킹이 적용되는지 점검한다.

### 정적 검사 방법

- `lib/shell.ts`는 양수 `timeoutMs`와 양의 정수 stdout/stderr limit을 강제하고, timeout 시 `SIGTERM` 후 `HELPER_TIMEOUT`을 반환한다.
- 같은 파일의 `appendWithLimit`은 stdout 기본 1 MiB, stderr 기본 64 KiB를 넘는 출력을 제한한다. stdout 초과는 helper 실패로 처리하며, stderr summary는 500자로 제한하고 stderr 초과 시 `[stderr truncated]`을 붙인 뒤 `maskSecrets`를 적용한다.
- `lib/services/ticket-service.ts`는 일정 20초, 좌석 조회 60초 및 stdout 1 MiB/stderr 64 KiB를 명시적으로 전달한다.
- `scripts/helper-smoke.ts`도 case별 timeout, stdout/stderr byte limit, truncation flag 및 마스킹 preview를 정의한다.

### 동적 검사 방법

- 격리 helper가 timeout보다 오래 대기, stdout limit 초과, stderr limit 초과 및 secret 포함 stderr를 각각 출력하도록 하여 종료·오류 코드·잘림·마스킹을 확인한다.

### 확인 파일/근거

- `lib/shell.ts`, `lib/secrets.ts`, `lib/services/ticket-service.ts`, `scripts/helper-smoke.ts`, `scripts/security-scan.ts`.

### 결과

- **PASS**: 공통 wrapper의 timeout, stdout/stderr 제한, stderr 잘림·마스킹 순서를 소스에서 확인했고, 0-byte stdout limit이 process 시작 전에 `VALIDATION_ERROR`로 거부됨을 focused check로 확인했다.
- **NOT_RUN**: timeout/대용량 출력/secret stderr의 실제 프로세스 동적 검증은 수행하지 않았다.

### 남은 리스크

`SIGTERM`을 무시하는 하위 프로세스, 멀티바이트 경계의 preview, wrapper를 우회한 호출은 별도 검증이 필요하다. stderr summary 자체는 내부 오류 객체에 존재하므로 이후 소비자가 이를 노출하지 않는지 계속 점검해야 한다.

## 5. QueryResult에 raw stderr를 저장하지 않음

### 점검 대상

`QueryResult` 저장 시 helper raw stderr나 API 응답 envelope 전체가 저장되지 않는지 점검한다.

### 정적 검사 방법

- `lib/result-store.ts`의 `createQueryResultFromResponse`는 `resultJson`에 `JSON.stringify(response.data ?? {})`만 저장한다.
- 같은 함수의 `errorText`는 `response.error.message`를 `summarizeError`로 요약하며 `response.error.raw`를 저장하지 않는다.
- `lib/errors.ts`의 `toApiError` type에는 `raw`가 존재하므로, 저장소 외 API serialization 경로는 별도로 검토해야 한다.

### 동적 검사 방법

- 격리 SQLite에 raw stderr를 포함한 `TripWatchApiResponse`를 저장한 뒤 `QueryResult.resultJson`과 `errorText`를 조회하여 raw 값 부재 및 data-only JSON을 확인한다. 실제 사용자/개발 DB에는 쓰지 않는다.

### 확인 파일/근거

- `lib/result-store.ts`, `lib/errors.ts`, `lib/api-response.ts`, `lib/db.ts`, `scripts/helper-smoke.ts`.

### 결과

- **PASS**: `resultJson`이 `response.data ?? {}`만 직렬화하고 raw stderr 필드가 저장 매핑에 없는 것을 확인했다.
- **NOT_RUN**: 격리 SQLite 저장·재조회 smoke는 수행하지 않았다.

### 남은 리스크

`errorText`는 public message를 저장하므로 message 작성자가 민감 정보를 넣으면 마스킹 패턴의 한계가 남는다. 다른 직접 DB write 경로가 추가되면 이 함수의 보장이 적용되지 않는다.

## 6. 공식 HTTPS host allowlist 및 lookalike 차단

### 점검 대상

공식 링크가 HTTPS이고 credential URL이 아니며, 타입별 allowlist host 또는 정상 서브도메인만 허용하여 lookalike host를 거부하는지 점검한다.

### 정적 검사 방법

- `lib/official-urls.ts`의 `isAllowedOfficialUrl`은 `https:`만 허용하고 URL username/password를 거부한다.
- `OFFICIAL_HOSTS`는 flight `google.com`, express bus `kobus.co.kr`, intercity bus `tmoney.co.kr`, ticket `tickets.interpark.com`/`ticket.yes24.com`을 타입별로 제한한다. host 비교는 정확 일치 또는 `.${allowedHost}` suffix만 허용하므로 `google.com.evil.example` 같은 lookalike suffix는 불허된다.
- `getSafeOfficialUrl`은 candidate/fallback이 불허되면 타입별 기본 공식 URL만 반환한다.
- `lib/validation/ticket-schema.ts`는 ticket URL을 HTTPS·무credential으로 확인하고 정확한 Interpark/YES24 hostname 및 예상 path에서만 ID를 추출한다.

### 동적 검사 방법

- `http:`, username/password URL, `google.com.evil.example`, `evil-google.com`, 허용 서브도메인, 정상 ticket URL을 `getSafeOfficialUrl`과 `parseTicketInput`에 각각 넣어 허용/거부와 fallback을 확인한다.

### 확인 파일/근거

- `lib/official-urls.ts`, `lib/validation/ticket-schema.ts`, `lib/result-store.ts`, 각 service의 official URL 생성 호출.

### 결과

- **PASS**: HTTPS, credential URL 거부, 타입별 host allowlist, suffix 경계 비교, ticket exact-host parsing을 소스에서 확인했다.
- **PASS**: 임시 DB mutation smoke에서 malformed, lookalike, HTTP, credential URL이 모두 HTTP 400/`VALIDATION_ERROR`로 차단되고 안전한 공식 URL만 반환됨을 확인했다.

### 남은 리스크

허용된 상위 도메인의 모든 서브도메인을 허용하는 타입은 해당 공식 도메인의 서브도메인 위임 위험을 상속한다. 공식 도메인 정책 변경과 리디렉션 최종 목적지는 주기적으로 재검토해야 한다.

## 7. resultJson은 data-only이며 envelope/raw error를 포함하지 않음

### 점검 대상

DB의 `resultJson`이 공통 envelope(`status`, `checkedAt`, `source`, `officialUrl`, `summary`, `error`)나 raw error가 아니라 조회 data만 보관하는지 점검한다.

### 정적 검사 방법

- 공통 envelope 형식은 `lib/api-response.ts`의 `TripWatchApiResponse<T>`에 정의되어 있다.
- `lib/result-store.ts`는 이 envelope 전체가 아닌 `response.data ?? {}`만 `resultJson`으로 `JSON.stringify`한다. status/source/checkedAt/summary/officialUrl/errorCode/errorText는 별도 컬럼 매핑이다.

### 동적 검사 방법

- 성공·실패 response를 격리 SQLite에 저장해 `resultJson`의 key가 data payload로만 구성되고 `error`, `raw`, `stderr`, `status` 등의 envelope key가 포함되지 않는지 확인한다.

### 확인 파일/근거

- `lib/api-response.ts`, `lib/result-store.ts`, `lib/errors.ts`, Prisma `QueryResult` schema/migration, `scripts/smoke-test.ts`의 격리 mutation smoke.

### 결과

- **PASS**: 현재 `createQueryResultFromResponse`의 data-only 직렬화와 별도 메타데이터 컬럼 매핑을 확인했다.
- **PASS**: 임시 SQLite mutation smoke에서 성공·실패 `QueryResult.resultJson`을 직접 파싱해 envelope·`raw`·`stderr` key가 없음을 확인했다.

### 남은 리스크

data payload 자체에 민감 정보가 들어오면 data-only 저장만으로는 보호되지 않는다. schema 변경이나 다른 persistence 경로는 재점검해야 한다.

## 8. 정적 scan과 격리 smoke의 판정 및 false-positive 검토

### 점검 대상

보안 scan 결과가 안전한 구현과 설명 문구를 혼동하지 않으며, smoke가 실사용 데이터나 외부 상태 변경 없이 실행되도록 점검한다.

### 정적 검사 방법

- `scripts/security-scan.ts`는 실행 코드 대상과 README/docs INFO 대상을 분리한다. 따라서 안전 정책 문서 안의 `payment`, `reservation`, `cancel`, `seat` 같은 금지어는 실행 코드 위반으로 자동 판정하지 않는다.
- `lib/shell.ts`의 `spawn(..., { shell: false })` 및 `scripts/helper-smoke.ts`의 `spawn(command, args, ...)`, timeout/출력 제한/마스킹은 금지된 exec/shell 또는 raw stderr 노출과 구별해야 하는 허용 근거다.
- false positive 후보는 발견 위치의 실행 가능성, 실제 API/서비스 호출 여부, args 의미, URL host 검증 및 실제 데이터 sink를 사람이 재검토한 뒤에만 제외한다. 단순 키워드 일치만으로 PASS나 FAIL을 확정하지 않는다.

### 동적 검사 방법

- `scripts/helper-smoke.ts`는 도움말·정상 조회·입력 실패 case를 분리한다. external case는 live helper 검증이므로 명시적 실행 결과가 있을 때만 판정한다.
- DB mutation smoke가 추가된 경우에만 `DATABASE_URL`을 임시 SQLite 경로로 분리하고 `TRIPWATCH_SMOKE_ALLOW_DB_MUTATION=true`를 명시하여 실행한다. 그 외에는 mutation smoke를 실행하지 않는다.

### 확인 파일/근거

- `scripts/security-scan.ts`, `scripts/helper-smoke.ts`, `scripts/smoke-test.ts`, `lib/shell.ts`, `lib/secrets.ts`, `lib/result-store.ts`.

### 결과

- **PASS**: 정적 scan은 `HIGH=0`, `REVIEW=0`, `INFO=44`, `ALLOWED=3`으로 통과했다. helper smoke는 **NOT_RUN**이다.
- **NOT_RUN**: 외부 live-helper 검증은 실행하지 않았으며, 이 문서의 현재 소스 관찰만으로 외부 동작을 PASS로 올리지 않는다.
- **PASS**: OS 임시 SQLite mutation smoke는 `PASS=24`, `FAIL=0`, `BLOCKED=0`으로 통과했고 관리형 서버와 DB를 정리했다.

### 남은 리스크

정적 규칙은 난독화·간접 호출·새 의존성의 동작을 포착하지 못할 수 있고, smoke 표본은 모든 공식 사이트 상태와 오류 경로를 대표하지 않는다. false positive를 무비판적으로 allowlist 처리하면 탐지 공백이 생기므로 제외 사유와 해당 코드 근거를 함께 유지해야 한다.

## 결론

현재 소스 검토, 정적 scan, 격리 mock read-only smoke, 임시 SQLite mutation smoke에서 금지 기능 실행 코드, unsafe shell 사용, 공식 URL 검증 위반, response sentinel 노출, `resultJson` envelope/raw 저장은 확인되지 않았다. 실제 외부 helper와 `scripts/helper-smoke.ts`는 **NOT_RUN**이므로 live 동작을 PASS로 올리지 않는다. 마스킹·timeout·대용량 출력의 전용 동적 fixture와 외부 helper 내부 계약은 남은 검증 범위다.
