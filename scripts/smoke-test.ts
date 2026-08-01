import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { getKstCalendarDate, isoDateToCompact } from "../lib/dates";
import { runHelperCommand } from "../lib/shell";
import { serializeWatchItem, summarizeWatchItemParams } from "../lib/watchlist";
import { normalizeForesttripPayload } from "../lib/normalize/normalize-foresttrip";
import { getOfficialUrl, getSafeOfficialUrl } from "../lib/official-urls";
import { searchForesttrip } from "../lib/services/foresttrip-service";
import { foresttripHelperPayloadSchema, foresttripSearchSchema } from "../lib/validation/foresttrip-schema";

type Status = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
type Envelope = {
  status?: string;
  checkedAt?: string;
  source?: string;
  officialUrl?: string;
  summary?: string;
  data?: unknown;
  error?: { code?: string; message?: string };
};
type SmokeResult = { name: string; status: Status; reason: string };
type ManagedServer = { baseUrl: string; tempDir: string; databaseUrl: string; child: ChildProcess };

const ROOT = resolve(process.cwd());
const PREFIX = `SMOKE_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const SENTINEL = `${PREFIX}_SECRET_${Math.random().toString(36).slice(2)}`;
const REQUEST_TIMEOUT_MS = 10_000;
const results: SmokeResult[] = [];
let responseBodies: string[] = [];
class BlockedError extends Error {}

function boundedReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replaceAll(SENTINEL, "[secret]").replace(/((?:token|password|secret|key))=\S+/gi, "$1=[redacted]").slice(0, 220);
}

function record(name: string, status: Status, reason: string): void {
  results.push({ name, status, reason: reason.replaceAll(SENTINEL, "[redacted]").slice(0, 220) });
  console.log(`${status.padEnd(7)} ${name}${reason ? ` - ${reason.replaceAll(SENTINEL, "[redacted]").slice(0, 220)}` : ""}`);
}

async function runCase(name: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
    record(name, "PASS", "");
  } catch (error) {
    record(name, error instanceof BlockedError ? "BLOCKED" : "FAIL", boundedReason(error));
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asEnvelope(value: unknown): Envelope {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "response is not an object");
  const envelope = value as Envelope;
  assert(typeof envelope.status === "string", "missing envelope status");
  assert(typeof envelope.checkedAt === "string", "missing envelope checkedAt");
  assert(typeof envelope.source === "string", "missing envelope source");
  return envelope;
}

function assertResponse(response: Response, expectedStatus: number, expectedCode?: string): Promise<Envelope> {
  return response.json().then((value: unknown) => {
    const envelope = asEnvelope(value);
    assert(response.status === expectedStatus, `expected HTTP ${expectedStatus}, got ${response.status}`);
    if (expectedCode) assert(envelope.error?.code === expectedCode, `expected ${expectedCode}`);
    return envelope;
  });
}

async function request(baseUrl: string, path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(init.method ?? "GET")) {
      if (!headers.has("origin")) headers.set("origin", "http://127.0.0.1:3000");
      if (!headers.has("sec-fetch-site")) headers.set("sec-fetch-site", "same-origin");
    }
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal, redirect: "error" });
    const clone = response.clone();
    const body = await clone.text();
    responseBodies.push(body);
    assert(!body.includes(SENTINEL), "generated secret sentinel appeared in a response body");
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) };
}

function patch(body: unknown): RequestInit {
  return { method: "PATCH", headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) };
}

function futureDate(days: number): string {
  const kstToday = getKstCalendarDate();
  const date = new Date(`${kstToday}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assertSafeOfficialUrl(value: unknown): void {
  if (value === undefined) return;
  assert(typeof value === "string", "officialUrl is not a string");
  const url = new URL(value);
  assert(url.protocol === "https:", "officialUrl must use HTTPS");
  assert(!url.username && !url.password, "officialUrl contains credentials");
  const allowedHosts = ["google.com", "kobus.co.kr", "tmoney.co.kr", "tickets.interpark.com", "ticket.yes24.com", "foresttrip.go.kr"];
  const host = url.hostname.toLowerCase();
  assert(allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)), "officialUrl host is not allowlisted");
}
async function foresttripReadOnlyPhase(): Promise<void> {
  const input = { forestName: "국립 용화산자연휴양림", date: futureDate(2), category: "01" as const };
  const compactDate = isoDateToCompact(input.date);
  const canonicalRoom = {
    forest_id: "forest-001",
    forest: "국립 용화산자연휴양림",
    use_dt: compactDate,
    day: null,
    name: "숲속의 집",
    area: "39.6",
    capacity: "4",
    category: "숙박",
    region: null,
    waiting_possible: null
  };
  const canonicalPayload = {
    forests_scanned: 1, filter_hits: 1, fetch_failures: 0, failures: [], concurrency: 1,
    date_range: { from: compactDate, to: compactDate },
    results: [{ forest: input.forestName, dates: [{ use_dt: compactDate, rooms: [canonicalRoom] }] }]
  };

  await runCase("foresttrip:strict-query-runtime-bounds", async () => {
    assert(foresttripSearchSchema.safeParse({ ...input, extra: true }).success === false, "unknown query key was accepted");
    assert(foresttripSearchSchema.safeParse({ ...input, date: `${input.date.slice(0, 4)}-02-30` }).success === false, "invalid calendar date was accepted");
    assert(foresttripHelperPayloadSchema.safeParse({ ...canonicalPayload, concurrency: 2 }).success === false, "non-sequential helper payload was accepted");
    let inconsistentMetricsRejected = false;
    try { normalizeForesttripPayload({ ...canonicalPayload, filter_hits: 0 }, input, { startedKstDate: input.date, endedKstDate: input.date }); } catch { inconsistentMetricsRejected = true; }
    assert(inconsistentMetricsRejected, "inconsistent metrics were accepted");
    assert(foresttripHelperPayloadSchema.safeParse({ ...canonicalPayload, results: [{ forest: input.forestName, dates: [{ use_dt: compactDate, rooms: [{ ...canonicalRoom, capacity: "100001" }] }] }] }).success === false, "capacity bound was accepted");
    assert(foresttripHelperPayloadSchema.safeParse({ ...canonicalPayload, results: [{ forest: input.forestName, dates: [{ use_dt: compactDate, rooms: [{ ...canonicalRoom, area: "1e2", waiting_possible: Number.POSITIVE_INFINITY }] }] }] }).success === false, "area or waiting bound was accepted");
  });
  await runCase("foresttrip:kst-date-and-midnight-metadata", async () => {
    assert(isoDateToCompact(input.date) === compactDate, "ISO date conversion changed");
    assert(getKstCalendarDate(new Date("2024-07-11T14:59:59.999Z")) === "2024-07-11", "KST pre-midnight date is wrong");
    assert(getKstCalendarDate(new Date("2024-07-11T15:00:00.000Z")) === "2024-07-12", "KST midnight date is wrong");
    const normalized = normalizeForesttripPayload(canonicalPayload, input, { startedKstDate: input.date, endedKstDate: input.date });
    assert(normalized.query.forestName === input.forestName && normalized.rooms[0]?.date === input.date, "normalization lost date metadata");
    assert(normalized.rooms[0]?.capacity === 4 && normalized.rooms[0]?.availability === "available", "canonical room did not normalize");
  });
  await runCase("foresttrip:canonical-empty-nonempty-and-id", async () => {
    const empty = { ...canonicalPayload, filter_hits: 0, results: [] };
    assert(normalizeForesttripPayload(empty, input, { startedKstDate: input.date, endedKstDate: input.date }).rooms.length === 0, "canonical empty payload did not normalize");
    const normalized = normalizeForesttripPayload(canonicalPayload, input, { startedKstDate: input.date, endedKstDate: input.date });
    const id = normalized.rooms[0]?.id ?? "";
    assert(/^[A-Za-z0-9_-]+$/.test(id), "room ID is not base64url");
    const duplicate = { ...canonicalPayload, filter_hits: 2, results: [{ forest: input.forestName, dates: [{ use_dt: compactDate, rooms: [canonicalRoom, canonicalRoom] }] }] };
    let rejected = false;
    try { normalizeForesttripPayload(duplicate, input, { startedKstDate: input.date, endedKstDate: input.date }); } catch { rejected = true; }
    assert(rejected, "duplicate room payload was accepted");
    const nfcInput = { ...input, forestName: "국립 용화산자연휴양림".normalize("NFD") };
    const nfcPayload = { ...canonicalPayload, results: [{ forest: input.forestName, dates: [{ use_dt: compactDate, rooms: [{ ...canonicalRoom, forest: input.forestName }] }] }] };
    assert(normalizeForesttripPayload(nfcPayload, foresttripSearchSchema.parse(nfcInput), { startedKstDate: input.date, endedKstDate: input.date }).query.forestName === input.forestName, "NFC query normalization changed");
  });
  await runCase("foresttrip:mock-first-exact-dto-source", async () => {
    const previous = process.env.TRIPWATCH_USE_MOCK_HELPERS;
    process.env.TRIPWATCH_USE_MOCK_HELPERS = "true";
    try {
      const response = await searchForesttrip(input);
      assert(response.status === "success" && response.source === "mock-foresttrip-helper", "mock branch was not selected first");
      assert(response.officialUrl === "https://foresttrip.go.kr/index.jsp", "mock official URL changed");
      const data = response.data;
      assert(data?.query.forestName === input.forestName && data.query.date === input.date && data.query.category === input.category, "mock DTO query changed");
      assert(data.rooms.length === 1 && data.rooms[0]?.id && data.rooms[0]?.capacity === 4, "mock DTO changed");
    } finally {
      if (previous === undefined) delete process.env.TRIPWATCH_USE_MOCK_HELPERS;
      else process.env.TRIPWATCH_USE_MOCK_HELPERS = previous;
    }
  });
  await runCase("foresttrip:helper-nonzero-and-timeout-classification", async () => {
    const expectErrorCode = async (args: string[], timeoutMs: number, code: string) => {
      try {
        await runHelperCommand(process.execPath, args, { timeoutMs });
      } catch (error) {
        assert((error as { code?: string }).code === code, `expected ${code} classification`);
        return;
      }
      throw new Error(`helper did not produce ${code}`);
    };
    await expectErrorCode(["-e", "process.exit(7)"], 1_000, "HELPER_FAILED");
    await expectErrorCode(["-e", "setTimeout(() => {}, 1_000)"], 50, "HELPER_TIMEOUT");
  });
  await runCase("foresttrip:watchlist-type-summary-round-trip", async () => {
    const item = serializeWatchItem({
      id: "foresttrip-watch",
      type: "foresttrip",
      title: input.forestName,
      paramsJson: JSON.stringify(input),
      memo: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    assert(item.type === "foresttrip", "Foresttrip WatchItem type was remapped");
    assert(summarizeWatchItemParams(item) === `${input.forestName} / ${input.date} / ${input.category}`, "Foresttrip WatchItem summary changed");
  });
  await runCase("foresttrip:canonical-url-attacks", async () => {
    assert(getOfficialUrl("foresttrip") === "https://foresttrip.go.kr/index.jsp", "canonical Foresttrip URL changed");
    for (const attack of ["http://foresttrip.go.kr/index.jsp", "https://user:pass@foresttrip.go.kr/", "https://foresttrip.go.kr.evil.example/", "https://evil.example/"]) {
      assert(getSafeOfficialUrl("foresttrip", attack) === "https://foresttrip.go.kr/index.jsp", `unsafe URL accepted: ${attack}`);
    }
  });
  await runCase("foresttrip:runtime-contract-source", async () => {
    const [service, form, dashboard] = await Promise.all([
      readFile(join(ROOT, "lib", "services", "foresttrip-service.ts"), "utf8"),
      readFile(join(ROOT, "components", "foresttrip", "ForesttripSearchForm.tsx"), "utf8"),
      readFile(join(ROOT, "components", "dashboard", "FailedResultsPanel.tsx"), "utf8")
    ]);
    for (const required of ["const TIMEOUT_MS = 60_000", '"--concurrency"', '"1"', 'env.TZ = "Asia/Seoul"', 'env.PYTHONIOENCODING = "utf-8"', 'TRIPWATCH_USE_MOCK_HELPERS === "true"', "runHelperCommand<unknown>", "timeoutMs: TIMEOUT_MS", "PARSE_ERROR"]) {
      assert(service.includes(required), `missing runtime contract: ${required}`);
    }
    assert(service.indexOf("if (useMockHelpers())") < service.indexOf("let configuration:"), "mock gate is not before real runtime gate");
    assert(!/setInterval|setTimeout|retry|for\s*\([^)]*attempt/.test(service), "service contains lifecycle, timer, or retry behavior");
    assert(!/useEffect|setInterval|setTimeout/.test(form), "Foresttrip UI contains lifecycle or timer behavior");
    assert(form.includes("부분 문자열") && form.includes("공식 전체 명칭") && form.includes("정규화된 빈 결과"), "Foresttrip residual disclosure changed");
    assert(dashboard.includes('foresttrip: "/foresttrip"'), "dashboard Foresttrip route mapping changed");
  });
}

const PUBLIC_ALERT_RULE_KEYS = [
  "id", "watchItemId", "channel", "condition", "enabled", "outboundOptIn", "configVersion",
  "latestOutcome", "latestOutcomeAt", "latestOutcomeCode", "baselineState", "baselineTransitionSeq",
  "baselineAt", "deliveryState", "lastAttemptAt", "terminalAt", "deliveryCode", "lastProviderRunAt",
  "createdAt", "updatedAt"
].sort();

function itemFromEnvelope(envelope: Envelope): Record<string, unknown> {
  const item = (envelope.data as { item?: unknown } | undefined)?.item;
  assert(item !== null && typeof item === "object" && !Array.isArray(item), "WatchItem DTO is missing");
  return item as Record<string, unknown>;
}

function ruleFromEnvelope(envelope: Envelope): Record<string, unknown> {
  const value = itemFromEnvelope(envelope).alertRule;
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "AlertRule DTO is missing");
  const rule = value as Record<string, unknown>;
  assert(JSON.stringify(Object.keys(rule).sort()) === JSON.stringify(PUBLIC_ALERT_RULE_KEYS), "AlertRule public DTO keys changed");
  return rule;
}

async function alertPurePhase(): Promise<void> {
  await runCase("alerts:pure-preflight-and-mock-zero-call", async () => {
    const preflight = await import("../lib/alerts/alert-preflight");
    assert(preflight.parseAlertArguments(["--send-telegram"]) === 5, "alert default limit is not five");
    assert(preflight.parseAlertArguments(["--send-telegram", "--limit", "10"]) === 10, "alert hard limit is not ten");
    let rejected = false;
    try {
      preflight.preflightAlertBootstrap(["--send-telegram"], {
        NODE_ENV: "test",
        TRIPWATCH_USE_MOCK_HELPERS: "true",
        TELEGRAM_BOT_TOKEN: SENTINEL,
        TELEGRAM_CHAT_ID: "1"
      }, { platform: "linux", getuid: () => 1, readProc: () => "microsoft" });
    } catch (error) {
      rejected = (error as { code?: string }).code === "MOCK_HELPERS_FORBIDDEN";
    }
    assert(rejected, "mock preflight was not rejected before credentials or provider work");
  });
  await runCase("alerts:pure-telegram-invalid-message-zero-call", async () => {
    const { sendTelegramMessage } = await import("../lib/alerts/telegram");
    let calls = 0;
    const result = await sendTelegramMessage(
      { botToken: SENTINEL, chatId: "1" },
      "x".repeat(3_001),
      async () => {
        calls += 1;
        throw new Error("transport must not be called");
      }
    );
    assert(result.outcome === "ambiguous" && calls === 0, "invalid Telegram payload reached transport");
  });
  await runCase("alerts:pure-worker-source-cap-and-fairness", async () => {
    const worker = await readFile(join(ROOT, "lib", "services", "alert-worker-service.ts"), "utf8");
    assert(worker.includes("const limit = input.limit ?? 5") && worker.includes("limit > 10"), "worker limit bounds changed");
    assert(worker.includes('orderBy: [{ lastProviderRunAt: "asc" }, { createdAt: "asc" }, { id: "asc" }]'), "worker fair ordering changed");
    assert(!/setInterval|setTimeout|cron|scheduler|polling|\bretry\s*\(/.test(worker), "worker contains lifecycle behavior");
  });
  await runCase("alerts:pure-fake-dispatch-cap-and-fairness", async () => {
    const { runAlertWorker } = await import("../lib/services/alert-worker-service");
    const dispatched: string[] = [];
    const now = new Date("2026-07-18T00:00:00.000Z");
    const makeRule = (index: number) => {
      const id = `rule-${String(index).padStart(2, "0")}`;
      const result = {
        id: `result-${id}`, type: "flight", status: "success", source: "flight-ticket-search", checkedAt: now, createdAt: now,
        resultJson: JSON.stringify({ query: { from: "ICN", to: "NRT", date: "2026-08-01" }, priceSummary: { currency: "KRW" }, flights: [] }),
        officialUrl: "https://google.com/travel/flights"
      };
      return {
        id, watchItemId: `watch-${id}`, configVersion: 1, updatedAt: now, lastProviderRunAt: null, enabled: true, outboundOptIn: true, channel: "telegram",
        deliveryState: "never", baselineState: "never", baselineFingerprint: null, baselineTransitionSeq: 0, conditionJson: JSON.stringify({ kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 1 }),
        watchItem: { enabled: true, type: "flight", paramsJson: JSON.stringify({ from: "ICN", to: "NRT", date: "2026-08-01" }), results: [result] }
      };
    };
    const rules = Array.from({ length: 11 }, (_, index) => makeRule(index));
    const fakeDb = {
      alertRule: {
        findMany: async (input: { where: { deliveryState?: unknown } }) => input.where.deliveryState ? [] : rules,
        findUnique: async ({ where }: { where: { id: string } }) => rules.find((rule) => rule.id === where.id) ?? null,
        updateMany: async () => ({ count: 1 })
      }
    };
    let telegramCalls = 0;
    const result = await runAlertWorker({
      db: fakeDb as never,
      limit: 10,
      credentials: { botToken: SENTINEL, chatId: "1" },
      runWatchItem: async (id) => {
        dispatched.push(id);
        const rule = rules.find((candidate) => candidate.watchItemId === id);
        return { providerDispatched: true, alertMode: "flight_search", storedResult: rule?.watchItem.results[0] } as never;
      },
      sendTelegram: async () => {
        telegramCalls += 1;
        return { outcome: "sent", code: "TELEGRAM_SENT" };
      },
      now: () => now
    });
    assert(result.providerDispatches === 10 && dispatched.length === 10, "worker did not enforce the actual dispatch cap");
    assert(JSON.stringify(dispatched) === JSON.stringify(rules.slice(0, 10).map((rule) => rule.watchItemId)), "worker did not preserve fair candidate order");
    assert(telegramCalls === 0, "no-match fake dispatch reached Telegram");
  });
}

async function alertPrismaPhase(): Promise<void> {
  if (process.env.TRIPWATCH_SMOKE_ALLOW_DB_MUTATION !== "true") {
    record("alerts:temp-db-opt-in", "BLOCKED", "TRIPWATCH_SMOKE_ALLOW_DB_MUTATION must be exactly true");
    return;
  }
  let managed: ManagedServer | undefined;
  try {
    managed = await startManagedServer(true);
    const baseUrl = managed.baseUrl;
    let ruleId = "";
    await runCase("alerts:ticket-schedule-unsupported", async () => {
      const watchItemId = await createWatch(baseUrl, "ticket", "alert_ticket", { input: "yes24:1", mode: "schedule" });
      await assertResponse(await request(baseUrl, "/api/alert-rules", json({ watchItemId, condition: { kind: "seats_at_or_above", minSeats: 1 } })), 422, "ALERT_SUBTYPE_UNSUPPORTED");
    });
    await runCase("alerts:strict-create-patch-public-dto", async () => {
      const watchItemId = await createWatch(baseUrl, "flight", "alert_flight", { from: "ICN", to: "NRT", date: futureDate(30), adults: 1, seat: "economy", mode: "oneway", limit: 1 });
      const missingHeader = await request(baseUrl, "/api/alert-rules", { method: "POST", headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ watchItemId, condition: { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 100000 } }) });
      assert(missingHeader.status >= 400, "AlertRule create accepted a missing JSON content-type");
      const created = await assertResponse(await request(baseUrl, "/api/alert-rules", json({ watchItemId, condition: { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 100000 } })), 201);
      const createdItem = itemFromEnvelope(created);
      const createdRule = ruleFromEnvelope(created);
      ruleId = String(createdRule.id);
      assert(createdRule.channel === "telegram" && createdRule.enabled === false && createdRule.outboundOptIn === false, "AlertRule secure defaults changed");
      assert(!("version" in (createdRule.condition as Record<string, unknown>)), "AlertRule condition leaked a version field");
      const mixedWatchPatch = await request(baseUrl, `/api/watchlist/${watchItemId}`, patch({ title: "must-not-persist", unexpected: true }));
      assert(mixedWatchPatch.status === 400, "WatchItem PATCH accepted a mixed unknown key");
      const afterMixedPatch = await assertResponse(await request(baseUrl, "/api/watchlist"), 200);
      const afterMixedItem = ((afterMixedPatch.data as { items?: Array<Record<string, unknown>> }).items ?? []).find((item) => item.id === watchItemId);
      assert(JSON.stringify(afterMixedItem) === JSON.stringify(createdItem), "mixed WatchItem PATCH did not roll back");
      const invalidPatch = await request(baseUrl, `/api/alert-rules/${ruleId}`, patch({ configVersion: createdRule.configVersion, unexpected: true }));
      assert(invalidPatch.status === 400, "AlertRule PATCH accepted an unknown key");
      const updated = await assertResponse(await request(baseUrl, `/api/alert-rules/${ruleId}`, patch({ configVersion: createdRule.configVersion, enabled: true, outboundOptIn: true, channel: "telegram" })), 200);
      const updatedRule = ruleFromEnvelope(updated);
      assert(updatedRule.enabled === true && updatedRule.outboundOptIn === true && updatedRule.configVersion === Number(createdRule.configVersion) + 1, "AlertRule enable/opt-in update failed");
      const disabled = await assertResponse(await request(baseUrl, `/api/alert-rules/${ruleId}`, patch({ configVersion: updatedRule.configVersion, enabled: false, outboundOptIn: false, channel: "telegram" })), 200);
      const disabledItem = itemFromEnvelope(disabled);
      assert(ruleFromEnvelope(disabled).enabled === false, "AlertRule disable failed");
      const watchlist = await assertResponse(await request(baseUrl, "/api/watchlist"), 200);
      const authoritativeItem = ((watchlist.data as { items?: Array<Record<string, unknown>> }).items ?? []).find((item) => item.id === watchItemId);
      assert(JSON.stringify(authoritativeItem) === JSON.stringify(disabledItem), "GET and PATCH WatchItem envelopes diverged");
    });
    await runCase("alerts:draft-delete-no-provider-or-telegram", async () => {
      assert(ruleId.length > 0, "AlertRule was not created");
      const deleted = await assertResponse(await request(baseUrl, `/api/alert-rules/${ruleId}`, { method: "DELETE", headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" } }), 200);
      assert(itemFromEnvelope(deleted).alertRule === null, "AlertRule delete did not return an authoritative parent");
      const listed = await assertResponse(await request(baseUrl, "/api/alert-rules"), 200);
      const rules = ((listed.data as { items?: unknown[] } | undefined)?.items ?? []) as Array<Record<string, unknown>>;
      assert(!rules.some((rule) => rule.id === ruleId), "draft AlertRule delete failed");
    });
  } catch (error) {
    record("alerts:temp-db-phase", "BLOCKED", boundedReason(error));
  } finally {
    await cleanup(managed);
    record("alerts:temp-db-cleanup", "PASS", "isolated AlertRule SQLite files and OS-temp directory were removed");
  }
}

async function defaultPhase(baseUrl: string): Promise<void> {
  responseBodies = [];
  for (const path of ["/dashboard", "/flights", "/buses", "/tickets", "/watchlist"]) {
    await runCase(`ui:${path}`, async () => {
      const response = await request(baseUrl, path);
      assert(response.status === 200, `expected HTTP 200, got ${response.status}`);
      const body = await response.text();
      assert(body.includes("JariDash"), "page does not display the JariDash service name");
    });
  }
  await runCase("api:dashboard-summary-envelope", async () => {
    const envelope = await assertResponse(await request(baseUrl, "/api/dashboard/summary"), 200);
    assert(envelope.status === "success", "dashboard summary did not succeed");
  });
  await runCase("api:missing-watch-run", async () => {
    await assertResponse(await request(baseUrl, "/api/watchlist/SMOKE_TEST_DOES_NOT_EXIST/run", { method: "POST" }), 404, "WATCH_ITEM_NOT_FOUND");
  });
  await runCase("security:response-secret-sentinel", async () => {
    assert(responseBodies.length > 0, "no responses were scanned");
    assert(responseBodies.every((body) => !body.includes(SENTINEL)), "generated secret sentinel appeared in a response body");
  });
}

function notRunMutationCases(reason: string): void {
  for (const name of [
    "validation:flight-invalid-json", "validation:flight-invalid-iata", "validation:ticket-malformed-url",
    "validation:ticket-lookalike-url", "validation:ticket-http-url", "validation:ticket-credential-url",
    "watchlist:create-list-patch-enable-disable-delete", "watchlist:single-run-and-rerun-status",
    "watchlist:batch-cap-ticket-filter-failed-only", "database:query-result-and-dashboard"
  ]) record(name, "NOT_RUN", reason);
}

function isSafeTempDirectory(directory: string): boolean {
  const temp = resolve(tmpdir());
  const candidate = resolve(directory);
  const insideTemp = relative(temp, candidate) !== "" && !relative(temp, candidate).startsWith(`..${sep}`) && !relative(temp, candidate).startsWith("..");
  const devPaths = [resolve(ROOT, "dev.db"), resolve(ROOT, "prisma", "dev.db")];
  return insideTemp && !devPaths.includes(candidate) && !devPaths.some((path) => candidate === path || candidate.startsWith(`${path}${sep}`));
}


function migrate(databaseUrl: string): void {
  const prismaCli = join(ROOT, "node_modules", "prisma", "build", "index.js");
  const outcome = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, shell: false, encoding: "utf8", timeout: 60_000, windowsHide: true
  });
  if (outcome.error || outcome.status !== 0) throw new Error("isolated database migration failed");
}

async function startManagedServer(mockHelpers: boolean): Promise<ManagedServer> {
  assert(existsSync(join(ROOT, ".next", "BUILD_ID")), "production build is required; managed server was not started");
  const tempDir = await mkdtemp(join(tmpdir(), `${PREFIX}_`));
  assert(isSafeTempDirectory(tempDir), "refusing a temporary database path outside the OS temp directory");
  const databaseUrl = `file:${join(tempDir, "smoke.db").replaceAll("\\", "/")}`;
  let managed: ManagedServer | undefined;
  try {
    migrate(databaseUrl);
    const port = 3000;
    const nextCli = join(ROOT, "node_modules", "next", "dist", "bin", "next");
    const serverEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      TRIPWATCH_USE_MOCK_HELPERS: mockHelpers ? "true" : "false",
      TRIPWATCH_SMOKE_SECRET_SENTINEL: SENTINEL,
      NODE_ENV: "production"
    };
    delete serverEnv.TELEGRAM_BOT_TOKEN;
    delete serverEnv.TELEGRAM_CHAT_ID;
    console.log(`managed server mode: ${mockHelpers ? "mock" : "real"}; DATABASE_URL is isolated`);
    const child = spawn(process.execPath, [nextCli, "start", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: ROOT,
      env: serverEnv,
      shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] as const
    });
    child.stderr.on("data", () => undefined);
    managed = { baseUrl: `http://127.0.0.1:${port}`, tempDir, databaseUrl, child };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise<void>((done) => setTimeout(done, 250));
      try {
        const response = await request(managed.baseUrl, "/dashboard");
        if (response.status === 200) return managed;
      } catch { /* readiness is the sole bounded retry loop */ }
    }
    throw new Error("managed production server did not become ready");
  } catch (error) {
    if (managed) await cleanup(managed);
    else await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function cleanup(managed: ManagedServer | undefined): Promise<void> {
  if (!managed) return;
  if (!isSafeTempDirectory(managed.tempDir)) throw new Error("refusing cleanup outside the verified OS temp directory");
  if (!managed.child.killed && managed.child.exitCode === null) {
    managed.child.kill();
    await new Promise<void>((done) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        done();
      };
      const timer = setTimeout(() => {
        if (managed.child.exitCode === null) managed.child.kill("SIGKILL");
        finish();
      }, 5_000);
      managed.child.once("exit", finish);
    });
  }
  try {
    const adapter = await import("@prisma/adapter-better-sqlite3");
    const prismaModule = await import("@prisma/client");
    const db = new prismaModule.PrismaClient({ adapter: new adapter.PrismaBetterSqlite3({ url: managed.databaseUrl }) });
    try {
      await db.queryResult.deleteMany();
      await (db as unknown as { alertRule: { deleteMany: () => Promise<unknown> } }).alertRule.deleteMany();
      await db.watchItem.deleteMany();
    } finally {
      await db.$disconnect();
    }
  } finally {
    await rm(managed.tempDir, { recursive: true, force: true });
  }
}

async function createWatch(baseUrl: string, type: string, suffix: string, params: unknown, enabled = true): Promise<string> {
  const envelope = await assertResponse(await request(baseUrl, "/api/watchlist", json({ type, title: `${PREFIX}_${suffix}`, enabled, params })), 201);
  const item = (envelope.data as { item?: { id?: string; title?: string } } | undefined)?.item;
  assert(item?.id && item.title?.startsWith(PREFIX), "watch item was not created with owned title");
  return item.id;
}

async function mutationPhase(): Promise<void> {
  let managed: ManagedServer | undefined;
  try {
    managed = await startManagedServer(true);
    const baseUrl = managed.baseUrl;
    await defaultPhase(baseUrl);
    await runCase("validation:flight-invalid-json", async () => {
      const response = await request(baseUrl, "/api/flights/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
      const envelope = await assertResponse(response, 400, "VALIDATION_ERROR"); assert(envelope.status === "failed", "invalid JSON must fail");
    });
    await runCase("validation:flight-invalid-iata", async () => {
      const envelope = await assertResponse(await request(baseUrl, "/api/flights/search", json({ from: "I", to: "NRT", date: futureDate(30), adults: 1, seat: "economy", mode: "oneway", limit: 1 })), 400, "VALIDATION_ERROR"); assert(envelope.status === "failed", "invalid IATA must fail");
    });
    for (const [name, input] of [["malformed-url", "not-a-ticket"], ["lookalike-url", "https://tickets.interpark.com.evil.example/goods/1"], ["http-url", "http://ticket.yes24.com/Perf/1"], ["credential-url", "https://user:pass@ticket.yes24.com/Perf/1"]]) {
      await runCase(`validation:ticket-${name}`, async () => {
        const envelope = await assertResponse(await request(baseUrl, "/api/tickets/schedule", json({ input, mode: "schedule" })), 400, "VALIDATION_ERROR");
        assert(envelope.status === "failed", "invalid ticket input must fail");
      });
    }
    await runCase("foresttrip:temp-db-page-and-post-contract", async () => {
      const page = await request(baseUrl, "/foresttrip");
      assert(page.status === 200, "Foresttrip page did not load");
      const invalid = await assertResponse(await request(baseUrl, "/api/foresttrip/search", json({ forestName: "x", date: `${futureDate(2).slice(0, 4)}-02-30`, category: "99", unexpected: true })), 400, "VALIDATION_ERROR");
      assert(invalid.source === "foresttrip-official-link" && invalid.data === undefined, "invalid Foresttrip response leaked data");
      const valid = await assertResponse(await request(baseUrl, "/api/foresttrip/search", json({ forestName: "국립 용화산자연휴양림", date: futureDate(2), category: "01" })), 200);
      assert(valid.source === "mock-foresttrip-helper" && valid.officialUrl === "https://foresttrip.go.kr/index.jsp", "Foresttrip mock source or URL changed");
      assert(valid.data !== undefined && !("raw" in (valid.data as Record<string, unknown>)), "Foresttrip response data contract changed");
    });
    const routeDate = futureDate(30);
    const mockRouteCases: Array<[string, string, unknown]> = [
      ["mock:flight-search", "/api/flights/search", { from: "ICN", to: "NRT", date: routeDate, adults: 1, seat: "economy", mode: "oneway", limit: 1 }],
      ["mock:flight-compare-month", "/api/flights/compare-month", { from: "ICN", to: "NRT", date: routeDate, yearMonth: routeDate.slice(0, 7), adults: 1, seat: "economy", mode: "oneway", limit: 1, sample: "weekly" }],
      ["mock:express-bus", "/api/buses/express/search", { departName: "서울경부", arriveName: "부산", date: routeDate, time: "09:00", passengers: 1 }],
      ["mock:intercity-bus", "/api/buses/intercity/search", { departName: "동서울", arriveName: "속초", date: routeDate, time: "08:00", passengers: 1 }],
      ["mock:ticket-schedule", "/api/tickets/schedule", { input: "yes24:1", mode: "schedule" }],
      ["mock:ticket-seats", "/api/tickets/seats", { input: "yes24:1", mode: "seats" }],
      ["mock:foresttrip-search", "/api/foresttrip/search", { forestName: "국립 용화산자연휴양림", date: routeDate, category: "01" }],
    ];
    for (const [name, path, body] of mockRouteCases) {
      await runCase(name, async () => {
        const envelope = await assertResponse(await request(baseUrl, path, json(body)), 200);
        assert(envelope.status === "success" || envelope.status === "partial", "mock route did not return success or partial");
        assert(envelope.data !== undefined, "mock route response data is missing");
        assertSafeOfficialUrl(envelope.officialUrl);
      });
    }
    let flightId = "";
    let foresttripId = "";
    await runCase("watchlist:create-list-patch-enable-disable-delete", async () => {
      flightId = await createWatch(baseUrl, "flight", "single", { from: "ICN", to: "NRT", date: futureDate(30), adults: 1, seat: "economy", mode: "oneway", limit: 1 });
      const list = await assertResponse(await request(baseUrl, "/api/watchlist"), 200);
      const items = (list.data as { items?: Array<{ id: string }> }).items ?? []; assert(items.some((item) => item.id === flightId), "created watch missing from list");
      await assertResponse(await request(baseUrl, `/api/watchlist/${flightId}`, patch({ memo: `${PREFIX}_memo` })), 200);
      await assertResponse(await request(baseUrl, `/api/watchlist/${flightId}`, patch({ enabled: false })), 200);
      await assertResponse(await request(baseUrl, `/api/watchlist/${flightId}`, patch({ enabled: true })), 200);
      const deleteId = await createWatch(baseUrl, "flight", "delete", { from: "ICN", to: "NRT", date: futureDate(35), adults: 1, seat: "economy", mode: "oneway", limit: 1 });
      await assertResponse(await request(baseUrl, `/api/watchlist/${deleteId}`, { method: "DELETE" }), 200);
      const foresttripDate = futureDate(2);
      foresttripId = await createWatch(baseUrl, "foresttrip", "foresttrip", { forestName: "국립 용화산자연휴양림", date: foresttripDate, category: "01" });
      const foresttripList = await assertResponse(await request(baseUrl, "/api/watchlist?type=foresttrip"), 200);
      const foresttripItems = (foresttripList.data as { items?: Array<{ id?: string; type?: string; paramsJson?: string }> }).items ?? [];
      assert(foresttripItems.length === 1 && foresttripItems[0]?.id === foresttripId && foresttripItems[0]?.type === "foresttrip", "Foresttrip WatchItem type was not preserved by create/list API");
      assert(foresttripItems[0]?.paramsJson === JSON.stringify({ forestName: "국립 용화산자연휴양림", date: foresttripDate, category: "01" }), "Foresttrip WatchItem params changed in create/list API");
      const forestWatch = await assertResponse(await request(baseUrl, `/api/watchlist/${foresttripId}/run`, { method: "POST" }), 200);
      assert(forestWatch.source === "mock-foresttrip-helper" && forestWatch.data !== undefined, "Foresttrip WatchItem run did not use the exact mock response");
      const forestRerun = await assertResponse(await request(baseUrl, `/api/watchlist/${foresttripId}/run`, { method: "POST" }), 200);
      assert(forestRerun.source === "mock-foresttrip-helper" && forestRerun.data !== undefined, "successful Foresttrip rerun did not remain eligible");
    });
    await runCase("watchlist:single-run-and-rerun-status", async () => {
      const success = await assertResponse(await request(baseUrl, `/api/watchlist/${flightId}/run`, { method: "POST" }), 200);
      assert(success.status === "success" || success.status === "partial", "mock single run did not return data"); assertSafeOfficialUrl(success.officialUrl);
      await assertResponse(await request(baseUrl, `/api/watchlist/${flightId}`, patch({ enabled: false })), 200);
      await assertResponse(await request(baseUrl, `/api/watchlist/${flightId}/run`, { method: "POST" }), 409, "DISABLED_WATCH_ITEM");
      await assertResponse(await request(baseUrl, `/api/watchlist/${flightId}`, patch({ enabled: true })), 200);
      await assertResponse(await request(baseUrl, `/api/watchlist/${flightId}/run`, { method: "POST" }), 429, "FAILED_RERUN_COOLDOWN");
    });
    await runCase("watchlist:batch-cap-ticket-filter-failed-only", async () => {
      for (let index = 0; index < 11; index += 1) await createWatch(baseUrl, "flight", `batch_${index}`, { from: "ICN", to: "NRT", date: futureDate(40 + index), adults: 1, seat: "economy", mode: "oneway", limit: 1 });
      await createWatch(baseUrl, "ticket", "ticket", { input: "yes24:1", mode: "schedule" });
      const defaultBatch = await assertResponse(await request(baseUrl, "/api/watchlist/run-batch", json({ failedOnly: false, includeTickets: false, limit: 99 })), 200);
      const defaultData = defaultBatch.data as {
        requested?: { limit?: number; includeTickets?: boolean; includeForesttrip?: boolean };
        totalCandidates?: number;
        executedCount?: number;
        results?: Array<{ type?: string }>;
      };
      assert(defaultData.requested?.limit === 10 && defaultData.requested.includeTickets === false && defaultData.requested.includeForesttrip === false, "batch cap/filter contract failed");
      assert((defaultData.totalCandidates ?? 0) > 10, "batch did not observe more than ten candidates");
      assert(defaultData.executedCount === 10 && (defaultData.results ?? []).length === 10, "batch did not enforce the maximum of ten sequential executions");
      assert((defaultData.results ?? []).every((item) => item.type !== "ticket" && item.type !== "foresttrip"), "ticket or Foresttrip was not excluded by default");
      const ticketBatch = await assertResponse(await request(baseUrl, "/api/watchlist/run-batch", json({ type: "ticket", failedOnly: false, includeTickets: true, limit: 10 })), 200);
      assert(((ticketBatch.data as { results?: unknown[] }).results ?? []).length > 0, "ticket was not included when requested");
      const foresttripBatch = await assertResponse(await request(baseUrl, "/api/watchlist/run-batch", json({ type: "foresttrip", failedOnly: false, includeForesttrip: true, limit: 10 })), 200);
      const foresttripData = foresttripBatch.data as { requested?: { includeForesttrip?: boolean; limit?: number }; executedCount?: number; results?: Array<{ type?: string; status?: string; skipped?: boolean }> };
      assert(foresttripData.requested?.includeForesttrip === true && foresttripData.requested?.limit === 10, "Foresttrip batch opt-in or cap contract failed");
      assert(foresttripData.executedCount === 1 && foresttripData.results?.length === 1 && foresttripData.results[0]?.type === "foresttrip" && foresttripData.results[0]?.status === "success" && foresttripData.results[0]?.skipped === false, "Foresttrip was not executed when explicitly requested");
      const failedOnly = await assertResponse(await request(baseUrl, "/api/watchlist/run-batch", json({ failedOnly: true, includeTickets: false, limit: 10 })), 200);
      const failedOnlyResults = (failedOnly.data as { results?: Array<{ skipped?: boolean; skipReason?: string }> }).results ?? [];
      assert(failedOnlyResults.some((item) => item.skipped && item.skipReason === "FAILED_RERUN_COOLDOWN"), "failed-only batch did not report the cooldown skip");
    });
    await runCase("database:query-result-and-dashboard", async () => {
      const adapter = await import("@prisma/adapter-better-sqlite3"); const prismaModule = await import("@prisma/client");
      const db = new prismaModule.PrismaClient({ adapter: new adapter.PrismaBetterSqlite3({ url: managed!.databaseUrl }) });
      try {
        const rows = await db.queryResult.findMany({ where: { watchItemId: flightId } });
        assert(rows.length >= 2, "single and disabled runs did not persist QueryResult rows");
        assert(rows.some((row) => row.status === "success" || row.status === "partial"), "successful run result is missing");
        assert(rows.some((row) => row.status === "failed" && row.errorCode === "DISABLED_WATCH_ITEM"), "disabled failure result is missing");
        for (const row of rows) {
          assert(row.watchItemId === flightId, "QueryResult watchItemId linkage is wrong");
          assert(typeof row.summary === "string" && row.summary.length > 0, "QueryResult summary is missing");
          const data = JSON.parse(row.resultJson) as Record<string, unknown>;
          for (const key of ["status", "checkedAt", "source", "officialUrl", "summary", "error", "raw", "stderr", "data"]) {
            assert(!(key in data), `resultJson contains envelope or raw error key: ${key}`);
          }
          assertSafeOfficialUrl(row.officialUrl);
        }
        const foresttripRows = await db.queryResult.findMany({ where: { source: "mock-foresttrip-helper" } });
        assert(foresttripRows.length > 0, "Foresttrip POST did not persist a QueryResult");
        const foresttripWatchRows = await db.queryResult.findMany({ where: { watchItemId: foresttripId } });
        assert(foresttripWatchRows.length === 3 && foresttripWatchRows.every((row) => row.source === "mock-foresttrip-helper"), "Foresttrip watch row/source count changed");
        for (const row of foresttripRows) {
          assert(row.officialUrl === "https://foresttrip.go.kr/index.jsp", "Foresttrip QueryResult official URL changed");
          const data = JSON.parse(row.resultJson) as Record<string, unknown>;
          assert(!("status" in data) && !("source" in data) && !("officialUrl" in data), "Foresttrip QueryResult must store data only");
        }
        const dashboard = await assertResponse(await request(baseUrl, "/api/dashboard/summary"), 200);
        assert(dashboard.status === "success", "dashboard summary did not succeed");
        const data = dashboard.data as {
          counts?: { watchItems?: number; foresttrips?: number; queryResults?: number; failedResults?: number };
          watchItems?: unknown[];
          recentResults?: unknown[];
          failedResults?: unknown[];
        };
        assert((data.counts?.watchItems ?? 0) >= 13, "dashboard watch item count did not reflect mutation smoke");
        assert((data.counts?.queryResults ?? 0) >= 13, "dashboard QueryResult count did not reflect runs");
        assert(data.counts?.foresttrips === 1, "dashboard Foresttrip type count changed");
        assert((data.watchItems?.length ?? 0) <= 10 && (data.recentResults?.length ?? 0) <= 10 && (data.failedResults?.length ?? 0) <= 10, "dashboard list limit exceeded ten");
      } finally {
        await db.$disconnect();
      }
    });
  } catch (error) {
    record("managed-mock-phase", "BLOCKED", boundedReason(error));
  } finally {
    await cleanup(managed);
    record("foresttrip:temp-db-cleanup", "PASS", "managed server, SQLite files, and OS-temp directory were removed");
  }
}

async function requestReal(baseUrl: string, path: string, body: unknown): Promise<{ response: Response; envelope: Envelope }> {
  let response: Response;

  try {
    response = await request(baseUrl, path, json(body), 75_000);
  } catch {
    throw new BlockedError("real helper request timed out or became unavailable");
  }

  return { response, envelope: asEnvelope(await response.json()) };
}

function throwIfExternalBlock(envelope: Envelope): void {
  const code = envelope.error?.code;
  if (code && ["HELPER_FAILED", "HELPER_TIMEOUT", "NO_RESULTS", "NO_SCHEDULE"].includes(code)) {
    throw new BlockedError(`external helper or provider unavailable: ${code}`);
  }
}

async function realPhase(): Promise<void> {
  let managed: ManagedServer | undefined;
  try {
    managed = await startManagedServer(false); const baseUrl = managed.baseUrl; const date = futureDate(45);
    const cases: Array<[string, string, unknown]> = [
      ["real:flight", "/api/flights/search", { from: "ICN", to: "NRT", date, adults: 1, seat: "economy", mode: "oneway", limit: 1 }],
      ["real:express-bus", "/api/buses/express/search", { departName: "서울경부", arriveName: "부산", date, time: "09:00", passengers: 1 }],
      ["real:intercity-bus", "/api/buses/intercity/search", { departName: "동서울", arriveName: "속초", date, time: "09:00", passengers: 1 }]
    ];
    for (const [name, path, body] of cases) await runCase(name, async () => {
      const { response, envelope } = await requestReal(baseUrl, path, body);
      throwIfExternalBlock(envelope);
      assert(response.status === 200 && (envelope.status === "success" || envelope.status === "partial") && envelope.data !== undefined, "real helper product contract mismatch");
      assertSafeOfficialUrl(envelope.officialUrl);
    });
    const input = process.env.TRIPWATCH_SMOKE_TICKET_INPUT?.trim();
    if (!input) record("real:ticket-schedule-and-seats", "NOT_RUN", "TRIPWATCH_SMOKE_TICKET_INPUT is empty");
    else await runCase("real:ticket-schedule-and-seats", async () => {
      const schedule = await requestReal(baseUrl, "/api/tickets/schedule", { input, mode: "schedule" });
      throwIfExternalBlock(schedule.envelope);
      assert(schedule.response.status === 200 && (schedule.envelope.status === "success" || schedule.envelope.status === "partial") && schedule.envelope.data !== undefined, "ticket schedule product contract mismatch");
      assertSafeOfficialUrl(schedule.envelope.officialUrl);

      const seats = await requestReal(baseUrl, "/api/tickets/seats", { input, mode: "seats" });
      throwIfExternalBlock(seats.envelope);
      assert(seats.response.status === 200 && (seats.envelope.status === "success" || seats.envelope.status === "partial") && seats.envelope.data !== undefined, "ticket seats product contract mismatch");
      assertSafeOfficialUrl(seats.envelope.officialUrl);
    });
  } catch (error) { record("managed-real-phase", "BLOCKED", boundedReason(error)); }
  finally { await cleanup(managed); }
}

async function main(): Promise<void> {
  const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const mutationEnabled = process.env.TRIPWATCH_SMOKE_ALLOW_DB_MUTATION === "true";
  const realHelpersEnabled = process.env.TRIPWATCH_SMOKE_REAL_HELPERS === "true";
  const foresttripReadOnly = process.argv.includes("--foresttrip-read-only");
  const foresttripTempDb = process.argv.includes("--foresttrip-temp-db");
  const alertsPure = process.argv.includes("--alerts-pure");
  const alertsPrisma = process.argv.includes("--alerts-prisma");

  assert([foresttripReadOnly, foresttripTempDb, alertsPure, alertsPrisma].filter(Boolean).length <= 1, "smoke selectors cannot be combined");
  if (alertsPure) {
    await alertPurePhase();
  } else if (alertsPrisma) {
    await alertPrismaPhase();
  } else if (foresttripReadOnly) {
    await foresttripReadOnlyPhase();
  } else if (foresttripTempDb) {
    if (!mutationEnabled) {
      record("foresttrip:temp-db-opt-in", "BLOCKED", "TRIPWATCH_SMOKE_ALLOW_DB_MUTATION must be exactly true");
    } else {
      await mutationPhase();
    }
  } else {
    if (!mutationEnabled && !realHelpersEnabled) {
      await defaultPhase(baseUrl);
    }
    if (mutationEnabled) await mutationPhase();
    else notRunMutationCases("DB mutation safety opt-in requires TRIPWATCH_SMOKE_ALLOW_DB_MUTATION=true");
    if (realHelpersEnabled) await realPhase();
    else record("real:opt-in", "NOT_RUN", "TRIPWATCH_SMOKE_REAL_HELPERS is not exactly true");
  }
  const counts = results.reduce<Record<Status, number>>((total, result) => ({ ...total, [result.status]: total[result.status] + 1 }), { PASS: 0, FAIL: 0, NOT_RUN: 0, BLOCKED: 0 });
  console.log(`SUMMARY PASS=${counts.PASS} FAIL=${counts.FAIL} NOT_RUN=${counts.NOT_RUN} BLOCKED=${counts.BLOCKED}`);
  process.exitCode = counts.FAIL > 0 ? 1 : 0;
}

void main().catch((error) => { record("runner", "FAIL", boundedReason(error)); console.log("SUMMARY PASS=0 FAIL=1 NOT_RUN=0 BLOCKED=0"); process.exitCode = 1; });
