# JariDash

JariDash는 개인용 여행 조회 대시보드입니다. `TripWatch`는 내부 코드명과 기존 경로·환경변수 호환명으로 유지합니다.

## v0.2 Foresttrip 범위

v0.2는 자연휴양림 빈 객실을 **한 번씩, 읽기 전용으로** 조회합니다.

- 화면/API 입력은 정확히 하나의 `{ forestName, date, category }`다.
  - `forestName`: trim+NFC한 공식 전체 휴양림명 1개. helper의 `--forest-name`은 먼저 부분 문자열로 후보를 고르므로, 축약명·별칭은 허용하지 않는다. runtime은 canonical 결과에서 `forests_scanned===1`을 요구한다.
  - `date`: KST 기준 오늘 또는 미래의 실제 `YYYY-MM-DD` 날짜 1개
  - `category`: `01`(숙박) 또는 `02`(캠핑) 1개
- API/화면: `/foresttrip`, `POST /api/foresttrip/search`
- 공식 확인 링크: `https://foresttrip.go.kr/index.jsp` 만 사용한다.
- mock source는 `mock-foresttrip-helper`, 실제 source는 `foresttrip-vacancy`다.
- 실제 helper는 요청 하나당 한 번만 실행하며 `--concurrency 1`, 60초 timeout, 재시도·polling이 없다.
- canonical 결과가 비어 있으면 조회 시점에 빈 객실이 없다는 뜻일 뿐, 그 결과만으로 target identity를 echo하거나 증명하지 않는다. 비어 있지 않으면 forest와 date가 요청의 trim+NFC 공식명 및 날짜와 정확히 일치해야 한다. started/ended KST metadata가 자정을 넘는 경우 `date_range`의 정확한 규칙을 만족하지 않으면 fail closed하며 retry하지 않는다.
- 결과는 조회 데이터와 안전한 요약/공식 링크만 보인다. 예약·결제·취소·좌석/객실 선점·CAPTCHA/대기열/봇 우회는 구현하거나 호출하지 않는다.

## 환경과 credential

실제 조회는 WSL/Linux에서만 지원한다. Windows PowerShell은 mock 서버를 시작하거나 WSL 서버에 접속하는 용도다. Windows `node_modules`와 WSL `node_modules`를 공유하지 않는다.

다음 credential 이름만 사용하며 값은 비어 있는 개인 환경 또는 `~/.config/k-skill/secrets.env`에 둔다. README, `.env.example`, 로그, API, DB, issue에 값은 적지 않는다.

```env
KSKILL_FORESTTRIP_ID=
KSKILL_FORESTTRIP_PASSWORD=
```

서버는 credential 누락 시 필요한 **변수 이름만** 알리고 helper를 시작하지 않아야 한다. helper 설치나 Playwright 설치를 문서 명령으로 자동 수행하지 않는다.

## 서버 시작: mock 우선

`TRIPWATCH_USE_MOCK_HELPERS`는 smoke client가 아니라 **서버 시작 시** 고정된다. 값을 바꾸면 같은 환경에서 서버를 종료 후 재시작한다.

WSL/bash:

```bash
TRIPWATCH_USE_MOCK_HELPERS=true npm run dev
```

PowerShell:

```powershell
$env:TRIPWATCH_USE_MOCK_HELPERS = "true"
npm run dev
```

mock은 credential, helper, provider, Playwright 없이 `/foresttrip` UI와 API 계약을 확인하는 기본 경로다.

실제 helper는 의도적인 WSL/Linux opt-in에서만 쓴다. `TRIPWATCH_USE_MOCK_HELPERS=false`는 서버를 live source로 시작할 뿐이며, live smoke opt-in 또는 credential/dependency 설치를 대신하지 않는다. live helper smoke는 정확한 `TRIPWATCH_SMOKE_REAL_HELPERS=true`, `--live`, pinned artifact/hash, 성공한 `--check-deps`, private credential, 그리고 아래의 singular fixture 환경변수 세 개가 모두 필요하다. name은 비어 있지 않은 공식 전체명, date는 KST 기준 오늘 또는 미래의 실제 `YYYY-MM-DD`, category는 `01` 또는 `02`다.

```bash
# WSL/Linux only; values remain in the private environment.
TRIPWATCH_SMOKE_REAL_HELPERS=true \
TRIPWATCH_SMOKE_FORESTTRIP_NAME='<official-full-name>' \
TRIPWATCH_SMOKE_FORESTTRIP_DATE='<YYYY-MM-DD>' \
TRIPWATCH_SMOKE_FORESTTRIP_CATEGORY='<01-or-02>' \
npx tsx scripts/helper-smoke.ts --only=foresttrip-vacancy --live
```

이 명령은 현재 Playwright dependency가 BLOCKED이므로 실행 가능한 정상 live 절차가 아니다. gate 하나라도 빠지거나 검증에 실패하면 harness는 provider를 호출하지 않고 명시적으로 `NOT_RUN` 또는 `BLOCKED`를 출력한다. 통과한 경우에만 한 번 `<pinned-script> --forest-name <official-full-name> --json --dates <YYYYMMDD> --categories <01|02> --concurrency 1`을 실행한다. helper의 부분 문자열 후보 선택은 full official name 요구를 대체하지 않으며, runtime canonical 검증을 통과해야 한다. timeout은 direct child에 `SIGTERM`을 보내지만 helper가 만든 descendant가 독립적으로 남는 것을 보장해 종료하지 못하는 residual risk가 있다; timeout 뒤에는 retry하지 않는다.

## 수동 watch/batch 경계

Foresttrip WatchItem은 같은 단일 조건만 저장하고, 단건 재조회는 사용자가 시작한다. batch는 자동 작업이 아니다.

```text
POST /api/watchlist/run-batch
{ "type": "foresttrip", "includeForesttrip": true }
```

`includeForesttrip: true`가 없으면 Foresttrip은 대상이 아니다. batch는 순차 실행, 최대 10개, 재시도 없음이며 cooldown 대상은 실행·새 결과 저장 없이 건너뛴다.

## Smoke 상태와 실행 순서

상태 의미는 다음과 같다.

| 상태 | 의미 |
| --- | --- |
| `PASS` | 사전 조건을 갖춰 실제로 실행했고 기대 결과를 관찰했다. |
| `FAIL` | 실행했으나 계약/안전 조건과 달랐다. |
| `NOT_RUN` | 명시적 opt-in이 없어 의도적으로 실행하지 않았다. |
| `BLOCKED` | 실행을 시도했으나 환경·helper·credential·의존성·외부 준비 상태 때문에 완료할 수 없었다. |

2026-07-18 non-live 재검증 관찰은 서로 구분한다: provider에 접속하지 않는 pure Foresttrip contract smoke는 `PASS=8`, `FAIL=0`, `NOT_RUN=0`, `BLOCKED=0`; Foresttrip safe helper cases는 `PASS=5`, `BLOCKED=1`, helper subprocess `6`건과 WSL path-resolution infrastructure subprocess `1`건이며 live/attempted/provider lookup은 모두 `0`이다. 소유한 임시 DB smoke는 `PASS=27`, `FAIL=0`, `NOT_RUN=0`, `BLOCKED=0`이고 temp directory cleanup도 `PASS`다. security scan은 `HIGH=0`, `REVIEW=0`, `INFO=43`, `ALLOWED=12`다. pinned helper artifact는 `PASS`; Playwright dependency probe는 `BLOCKED`; live는 `NOT_RUN`이다. 이 관찰값 어느 것도 live 정상 조회 PASS를 뜻하지 않는다.

안전한 helper artifact와 provider 비접속 입력·credential·dependency probe는 다음 명령으로 확인한다.

```bash
npx tsx scripts/helper-smoke.ts --only=foresttrip-vacancy
```

실행 가능한 전체 절차와 기록 양식은 [v0.2 수동 QA](docs/manual-test-v0.2.md), 보안 증적은 [v0.2 보안 점검](docs/security-check-v0.2.md), 기능별 완료·보류 구분은 [구현 상태](docs/IMPLEMENTATION_STATUS.md)를 따른다. live는 이들 문서의 마지막 opt-in 단계이며 자동 실행하지 않는다.

## 임시 DB 수동 확인

WatchItem/QueryResult를 바꾸는 검증은 사용자 DB가 아닌, 자신이 새로 만든 OS temp 디렉터리의 SQLite DB에서만 한다. `TRIPWATCH_SMOKE_ALLOW_DB_MUTATION=true`가 없는 DB mutation은 실행하지 않는다.

WSL/bash:

```bash
SMOKE_DIR="$(mktemp -d -t jaridash-smoke-XXXXXX)"
export DATABASE_URL="file:$SMOKE_DIR/smoke.db"
export TRIPWATCH_USE_MOCK_HELPERS=true
export TRIPWATCH_SMOKE_ALLOW_DB_MUTATION=true
npx prisma migrate deploy
npm run dev -- --hostname 127.0.0.1 --port 3100
```

PowerShell:

```powershell
$smokeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("jaridash-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $smokeDir | Out-Null
$smokeDb = (Join-Path $smokeDir "smoke.db") -replace "\\", "/"
$env:DATABASE_URL = "file:$smokeDb"
$env:TRIPWATCH_USE_MOCK_HELPERS = "true"
$env:TRIPWATCH_SMOKE_ALLOW_DB_MUTATION = "true"
npx prisma migrate deploy
npm run dev -- --hostname 127.0.0.1 --port 3100
```

서버 종료 후에는 생성한 temp 경로인지 확인한 뒤 그 디렉터리만 지운다. `dev.db`, `prisma/dev.db`, 기존 사용자 DB는 절대 삭제하지 않는다.

## 금지선

이 프로젝트는 예약, 결제, 취소, 객실/좌석 선택·선점, CAPTCHA/fingerprint/bot-block/대기열 우회, 자동 알림, 공격적 polling, 자동 retry를 수행하지 않는다. 실제 예약은 검증된 공식 Foresttrip 페이지에서 사용자가 직접 진행한다.
