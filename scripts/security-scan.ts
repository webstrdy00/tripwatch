import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

type Classification = "HIGH" | "REVIEW" | "INFO" | "ALLOWED";

type Finding = {
  classification: Classification;
  excerpt: string;
  file: string;
  line: number;
  reason?: string;
  rule: string;
};

const ROOT = process.cwd();
const SOURCE_DIRECTORIES = ["app", "components", "lib", "scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".next", "coverage", "prisma", "generated"]);
const EXCLUDED_FILES = new Set(["package-lock.json"]);
// SECURITY_SCAN_RULES_BEGIN
const FORBIDDEN_KEYWORDS = [
  "payment",
  "checkout",
  "autoPay",
  "reserve",
  "bookingConfirm",
  "hold-seat",
  "seatSelect",
  "captcha",
  "fingerprint",
  "bot-block",
  "setInterval",
  "cron"
] as const;
function stripOwnRuleDefinitions(content: string): string {
  const start = content.indexOf("// SECURITY_SCAN_RULES_BEGIN");
  const endMarker = "// SECURITY_SCAN_RULES_END";
  const end = content.lastIndexOf(endMarker);

  if (start < 0 || end < 0 || end < start) {
    return content;
  }

  const endOffset = end + endMarker.length;
  return content.slice(0, start) + content.slice(start, endOffset).replace(/[^\n]/g, " ") + content.slice(endOffset);
}


function isSourceFile(path: string): boolean {
  return [...SOURCE_EXTENSIONS].some((extension) => path.endsWith(extension));
}

function isExcluded(path: string): boolean {
  const parts = relative(ROOT, path).split(sep);
  return parts.some((part) => EXCLUDED_DIRECTORIES.has(part)) || EXCLUDED_FILES.has(parts.at(-1) ?? "");
}

function collectFiles(directory: string, matcher: (path: string) => boolean): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name);
    if (isExcluded(path)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...collectFiles(path, matcher));
    } else if (entry.isFile() && matcher(path)) {
      files.push(path);
    }
  }
  return files;
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function excerptAt(content: string, index: number): string {
  const line = content.slice(0, index).split("\n").at(-1) ?? "";
  return redactSecrets(line.trim()).slice(0, 220);
}

function redactSecrets(value: string): string {
  return value.replace(/((?:secret|token|password|passwd|pwd|api[_-]?key|credential|authorization|cookie)\s*[:=]\s*["']?)[^\s,"'}\]]+/gi, "$1[REDACTED]");
}

function addFinding(findings: Finding[], file: string, content: string, index: number, classification: Classification, rule: string, reason?: string): void {
  findings.push({
    classification,
    excerpt: excerptAt(content, index),
    file: relative(ROOT, file).replaceAll(sep, "/"),
    line: lineNumber(content, index),
    reason,
    rule
  });
}

function hasReadOnlySeatVocabulary(content: string): boolean {
  return /(?:seat|좌석).{0,40}(?:availability|available|잔여석|remaining)|(?:availability|available|잔여석|remaining).{0,40}(?:seat|좌석)/i.test(content);
}
function isExactNegativeTimerAssertion(relativeFile: string, content: string, index: number): boolean {
  if (relativeFile !== "scripts/smoke-test.ts") {
    return false;
  }

  const start = content.lastIndexOf("\n", index) + 1;
  const end = content.indexOf("\n", index);
  const line = content.slice(start, end < 0 ? content.length : end);
  return (
    /^\s*assert\(!\/(?:useEffect\|)?setInterval(?:\|setTimeout)?(?:\|retry\|for\\s\*\\\([^)]*\*attempt)?/.test(line)
      && /Foresttrip UI contains lifecycle|service contains lifecycle/.test(line)
  ) || (
    /^\s*assert\(!\/setInterval\|setTimeout\|cron\|scheduler\|polling\|\\bretry\\s\*\\\(/.test(line)
      && /worker contains lifecycle/.test(line)
  );
}

export function isApprovedAlertStateKeyword(relativeFile: string, keyword: string, content: string, index: number): boolean {
  const lineStart = content.lastIndexOf("\n", index) + 1;
  const lineEnd = content.indexOf("\n", index);
  const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd).trim();

  if (keyword === "reserve") {
    return (
      relativeFile === "lib/alerts/state-machine.ts" &&
      (
        line === 'deliveryAction: "none" | "suppressed" | "reserve";' ||
        line === 'deliveryAction: eligible ? "reserve" : "suppressed"'
      )
    ) || (
      relativeFile === "lib/services/alert-worker-service.ts" &&
      line === 'if (deliveryAction !== "reserve") {'
    );
  }

  const approvedFingerprintLines: Record<string, RegExp[]> = {
    "lib/alerts/canonicalize.ts": [
      /^if \(!input \|\| typeof input !== "object" \|\| Array\.isArray\(input\)\) return reject\("Fingerprint input must be an ordinary object\."\);$/,
      /^return reject\("Fingerprint version or mode is invalid\."\);$/,
      /^const fingerprint = `v1:\$\{createHash\("sha256"\)\.update\(canonicalBytes\)\.digest\("hex"\)\}` as const;$/,
      /^return \{ canonicalJson, canonicalBytes, fingerprint, matches \};$/
    ],
    "lib/alerts/state-machine.ts": [
      /^\| \{ matched: true; fingerprint: string \};$/,
      /^if \(previous\.baselineState === "matched" && previous\.baselineFingerprint === evaluation\.fingerprint\) \{$/,
      /^baselineFingerprint: evaluation\.fingerprint,$/
    ],
    "lib/alerts/types.ts": [
      /^fingerprint: `v1:\$\{string\}`;$/
    ],
    "lib/services/alert-worker-service.ts": [
      /^let fingerprint: string \| null = null;$/,
      /^fingerprint = canonical\.fingerprint;$/,
      /^const transition = transitionSuccessfulBaseline\(baseline, fingerprint \? \{ matched: true, fingerprint \} : \{ matched: false \}, now\(\)\);$/,
      /^attemptFingerprint: fingerprint, attemptTransitionSeq: transition\.baselineTransitionSeq,$/,
      /^current\.attemptRunId === runId && current\.attemptFingerprint === fingerprint &&$/,
      /^where: \{ id: current\.id, deliveryState: "reserved", attemptId, attemptRunId: runId, attemptFingerprint: fingerprint, attemptTransitionSeq: transition\.baselineTransitionSeq, attemptResultId: latest\.id, attemptResultType: latest\.type, terminalAt: null \},$/,
      /^id: current\.id, attemptId, attemptRunId: runId, attemptFingerprint: fingerprint,$/,
      /^attemptFingerprint: fingerprint,$/
    ]
  };

  return approvedFingerprintLines[relativeFile]?.some((pattern) => pattern.test(line)) ?? false;
}

export const CHILD_PROCESS_LAUNCH_PATTERN =
  /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(|\(\s*[^()\n]*\?\?\s*spawn\s*\)\s*\(/g;

export type ChildProcessLaunch = Readonly<{ index: number; call: string }>;

function invocationEnd(content: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return openIndex;
}

export function childProcessLaunches(content: string): ChildProcessLaunch[] {
  return [...content.matchAll(CHILD_PROCESS_LAUNCH_PATTERN)].flatMap((match) => {
    if (match.index === undefined) return [];
    const invocationOpen = match.index + match[0].lastIndexOf("(");
    const end = invocationEnd(content, invocationOpen);
    return end > invocationOpen ? [{ index: match.index, call: content.slice(match.index, end) }] : [];
  });
}

export function childProcessLaunchOffsets(content: string): number[] {
  return childProcessLaunches(content).map((launch) => launch.index);
}

function hasSafeShellWrapper(content: string): boolean {
  return /from\s+["']node:child_process["']/.test(content) && /\bspawn\b/.test(content) && /shell\s*:\s*false/.test(content);
}

function hasSafeSmokeHarness(content: string): boolean {
  return hasSafeShellWrapper(content)
    && /setTimeout\s*\(/.test(content)
    && /STDOUT_LIMIT_BYTES/.test(content)
    && /STDERR_LIMIT_BYTES/.test(content)
    && /maskSecrets\s*\(/.test(content)
    && /stdoutPreview/.test(content)
    && /stderrPreview/.test(content);
}
function hasSafeManagedSmokeHarness(content: string): boolean {
  return hasSafeShellWrapper(content)
    && /withOwnedTempDb\s*\(/.test(content)
    && /resolveShellFreeCommand\s*\(/.test(content)
    && /verifyLoopback\s*\(/.test(content)
    && /finally\s*\{\s*await cleanup\(/.test(content);
}

function hasSafeOwnedTempDbWrapper(content: string): boolean {
  return hasSafeShellWrapper(content)
    && /export async function withOwnedTempDb/.test(content)
    && /assertOwner\s*\(/.test(content)
    && /prismaCli[\s\S]*?"migrate", "deploy"/.test(content)
    && /TRIPWATCH_SMOKE_ALLOW_DB_MUTATION: "true"/.test(content)
    && /acquireCleanupLease/.test(content)
    && /OWNED_TEMP_DB_CLEANUP_UNPROVEN/.test(content)
    && /pathExists\(cleanupLease\)[\s\S]*?assertOwner\(evidence\)[\s\S]*?rm\(directory/.test(content);
}

function hasSafeLoopbackVerifier(content: string): boolean {
  return /import\s*\{[^}]*\bexecFile\b[^}]*\}\s*from\s*["']node:child_process["']/.test(content)
    && /execFile\([\s\S]*?"netstat"[\s\S]*?maxBuffer:\s*256\s*\*\s*1024[\s\S]*?timeout:\s*5_000[\s\S]*?windowsHide:\s*true/.test(content);
}

type LaunchAllowance = Readonly<{ rule: string; reason: string }>;
function singleLaunchSection(
  content: string,
  launch: ChildProcessLaunch,
  startMarker: string,
  endMarker?: string
): string | null {
  const start = content.indexOf(startMarker);
  if (start < 0 || launch.index < start) return null;
  const end = endMarker ? content.indexOf(endMarker, start + startMarker.length) : content.length;
  const boundedEnd = end < 0 ? content.length : end;
  if (launch.index >= boundedEnd) return null;
  const section = content.slice(start, boundedEnd);
  return childProcessLaunches(section).length === 1 ? section : null;
}

function launchAllowance(
  relativeFile: string,
  content: string,
  launch: ChildProcessLaunch,
  contracts: Readonly<{
    safeShellWrapper: boolean;
    safeSmokeHarness: boolean;
    safeManagedSmokeHarness: boolean;
    safeOwnedTempDbWrapper: boolean;
    safeLoopbackVerifier: boolean;
  }>
): LaunchAllowance | null {
  const call = launch.call;
  const shellFalse = /shell\s*:\s*false/.test(call);

  if (relativeFile === "lib/shell.ts" && contracts.safeShellWrapper && shellFalse) {
    const section = singleLaunchSection(content, launch, "export async function runHelperCommand");
    if (
      section &&
      /^\(\s*options\.spawnImplementation\s*\?\?\s*spawn\s*\)\s*\(\s*command\s*,\s*\[\.\.\.args\]/.test(call) &&
      /setTimeout\s*\(/.test(section) &&
      /appendWithLimit\s*\(/.test(section) &&
      /maskSecrets\s*\(/.test(section)
    ) {
      return { rule: "SAFE_SPAWN_WRAPPER", reason: "Allowlisted per occurrence: the sole helper launch in runHelperCommand uses argv, shell:false, timeout, bounded output, and masking." };
    }
  }

  if (relativeFile === "scripts/helper-smoke.ts" && contracts.safeSmokeHarness) {
    const pathSection = singleLaunchSection(
      content,
      launch,
      "async function resolveWslPath",
      "async function runCase"
    );
    if (
      pathSection &&
      /^execFile\(\s*"wsl\.exe"\s*,\s*\["--exec",\s*"\/usr\/bin\/wslpath",\s*"-a",\s*windowsPath\]/.test(call) &&
      /maxBuffer:\s*STDOUT_LIMIT_BYTES/.test(call) &&
      /timeout:\s*10_000/.test(call) &&
      /windowsHide:\s*true/.test(call) &&
      /maskSecrets\s*\(/.test(pathSection)
    ) {
      return { rule: "SAFE_SMOKE_EXECFILE", reason: "Allowlisted per occurrence: fixed wslpath argv has call-local timeout/maxBuffer and bounded masked errors." };
    }

    const runCaseSection = singleLaunchSection(
      content,
      launch,
      "async function runCase",
      "async function runIsolatedCase"
    );
    if (
      runCaseSection &&
      shellFalse &&
      /^spawn\(\s*execution\.command\s*,\s*execution\.args\s*,/.test(call) &&
      /setTimeout\s*\(/.test(runCaseSection) &&
      /appendLimited\(stdout/.test(runCaseSection) &&
      /appendLimited\(stderr/.test(runCaseSection) &&
      /maskSecrets\s*\(/.test(runCaseSection)
    ) {
      return { rule: "SAFE_SMOKE_SPAWN", reason: "Allowlisted per occurrence: the sole runCase launch has argv, shell:false, timeout, bounded output, and masking in its lexical supervisor." };
    }
  }

  if (relativeFile === "scripts/smoke-test.ts" && contracts.safeManagedSmokeHarness && shellFalse) {
    const startSection = singleLaunchSection(
      content,
      launch,
      "async function startManagedServer",
      "async function forceKillWindowsTree"
    );
    if (
      startSection &&
      /^spawn\(\s*invocation\.executable\s*,\s*invocation\.args\s*,/.test(call) &&
      /child\.stderr\.resume\s*\(/.test(startSection) &&
      /attempt\s*<\s*30/.test(startSection) &&
      /verifyLoopback\s*\(/.test(startSection) &&
      /await cleanup\(managed\)/.test(startSection)
    ) {
      return { rule: "SAFE_SMOKE_SPAWN", reason: "Allowlisted per occurrence: the sole managed-server launch uses approved argv, shell:false, drained stderr, bounded readiness, loopback verification, and fail-closed cleanup." };
    }

    const killSection = singleLaunchSection(
      content,
      launch,
      "async function forceKillWindowsTree",
      "async function waitForTrackedChildClose"
    );
    if (
      killSection &&
      /^spawn\(\s*"taskkill"\s*,\s*\["\/PID",\s*String\(pid\),\s*"\/T",\s*"\/F"\]/.test(call) &&
      /taskkill\.once\("error"/.test(killSection) &&
      /taskkill\.once\("close"/.test(killSection)
    ) {
      return { rule: "SAFE_SMOKE_SPAWN", reason: "Allowlisted per occurrence: the sole Windows tree-kill launch uses fixed argv, shell:false, and awaits an error-or-close outcome." };
    }
  }

  if (relativeFile === "scripts/with-owned-temp-db.ts" && contracts.safeOwnedTempDbWrapper && shellFalse) {
    const migrateSection = singleLaunchSection(
      content,
      launch,
      "function migrate",
      "async function assertDatabase"
    );
    if (
      migrateSection &&
      /^spawnSync\(\s*process\.execPath\s*,\s*\[prismaCli,\s*"migrate",\s*"deploy"\]/.test(call) &&
      /timeout:\s*60_000/.test(call) &&
      /encoding:\s*"utf8"/.test(call)
    ) {
      return { rule: "SAFE_OWNED_TEMP_DB_SPAWN", reason: "Allowlisted per occurrence: the sole migration launch uses fixed argv, shell:false, call-local timeout, and bounded ownership workflow." };
    }

    const commandSection = singleLaunchSection(
      content,
      launch,
      "export async function runOwnedCommand",
      "if (process.argv[1]?.endsWith"
    );
    if (
      commandSection &&
      /^\(\s*seams\.spawnChild\s*\?\?\s*spawn\s*\)\s*\(\s*invocation\.executable\s*,\s*invocation\.args\s*,/.test(call) &&
      /return withOwnedTempDb\s*\(/.test(commandSection) &&
      /child\.once\("error"/.test(commandSection) &&
      /child\.once\("close"/.test(commandSection)
    ) {
      return { rule: "SAFE_OWNED_TEMP_DB_SPAWN", reason: "Allowlisted per occurrence: the sole owned-command launch is lexically tied to withOwnedTempDb and resolves only on child error or close." };
    }
  }

  if (
    relativeFile === "scripts/verify-loopback.ts" &&
    contracts.safeLoopbackVerifier &&
    childProcessLaunches(content).length === 1 &&
    /^execFile\(\s*"netstat"\s*,\s*\["-ano",\s*"-p",\s*"tcp"\]/.test(call) &&
    /maxBuffer:\s*256\s*\*\s*1024/.test(call) &&
    /timeout:\s*5_000/.test(call) &&
    /windowsHide:\s*true/.test(call)
  ) {
    return { rule: "SAFE_LOOPBACK_EXECFILE", reason: "Allowlisted per occurrence: the verifier's sole child launch uses fixed netstat argv with call-local timeout and output bound." };
  }
  return null;
}

export type ChildProcessLaunchClassification = Readonly<{
  index: number;
  classification: "ALLOWED" | "HIGH";
  rule: string;
  reason: string;
}>;

export function classifyChildProcessLaunches(
  relativeFile: string,
  content: string
): ChildProcessLaunchClassification[] {
  const contracts = {
    safeShellWrapper: hasSafeShellWrapper(content),
    safeSmokeHarness: relativeFile === "scripts/helper-smoke.ts" && hasSafeSmokeHarness(content),
    safeManagedSmokeHarness: relativeFile === "scripts/smoke-test.ts" && hasSafeManagedSmokeHarness(content),
    safeOwnedTempDbWrapper:
      relativeFile === "scripts/with-owned-temp-db.ts" && hasSafeOwnedTempDbWrapper(content),
    safeLoopbackVerifier:
      relativeFile === "scripts/verify-loopback.ts" && hasSafeLoopbackVerifier(content)
  };

  return childProcessLaunches(content).map((launch) => {
    const allowance = launchAllowance(relativeFile, content, launch, contracts);
    return {
      index: launch.index,
      classification: allowance ? "ALLOWED" : "HIGH",
      rule: allowance?.rule ?? "UNALLOWLISTED_CHILD_PROCESS_LAUNCH",
      reason: allowance?.reason ?? "Child-process launch lacks a matching exact call shape and shell, timeout, output, ownership, or cleanup contract."
    };
  });
}

function hasImportedExec(content: string): boolean {
  return /import\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*from\s*["']node:child_process["']/.test(content)
    || /(?:const|let|var)\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*=\s*require\(\s*["']node:child_process["']\s*\)/.test(content);
}


function scanPattern(findings: Finding[], file: string, content: string, pattern: RegExp, classification: Classification, rule: string, reason?: string): void {
  for (const match of content.matchAll(pattern)) {
    if (match.index !== undefined) {
      addFinding(findings, file, content, match.index, classification, rule, reason);
    }
  }
}
export const AUTOMATED_TRANSACTION_ACTION_PATTERN = /\b(?:autoPay|payment|checkout|reserve|bookingConfirm|holdSeat|seatSelect|cancelBooking|cancelReservation)\s*\(/gi;


function scanSource(file: string): Finding[] {
  const rawContent = readFileSync(file, "utf8");
  const relativeFile = relative(ROOT, file).replaceAll(sep, "/");
  const content = relativeFile === "scripts/security-scan.ts" ? stripOwnRuleDefinitions(rawContent) : rawContent;
  const findings: Finding[] = [];
  const importedExec = hasImportedExec(content);

  for (const launch of classifyChildProcessLaunches(relativeFile, content)) {
    addFinding(
      findings,
      file,
      content,
      launch.index,
      launch.classification,
      launch.rule,
      launch.reason
    );
  }

  scanPattern(findings, file, content, /\b(?:child_process|childProcess)\.exec(?:Sync)?\s*\(/g, "HIGH", "EXEC_STRING_COMMAND", "exec executes a shell command string.");
  if (importedExec) {
    scanPattern(findings, file, content, /\bexec(?:Sync)?\s*\(/g, "HIGH", "EXEC_STRING_COMMAND", "Imported child_process exec executes a shell command string.");
  }
  scanPattern(findings, file, content, /\b(?:spawn|execFile)\s*\([\s\S]{0,300}?shell\s*:\s*true/g, "HIGH", "SHELL_TRUE", "shell:true enables shell command interpretation.");
  scanPattern(findings, file, content, /\b(?:spawn|execFile)\s*\(\s*(?:`[^`]*\$\{|[^,()\n]+\s*\+\s*[^,\n]+)/g, "HIGH", "COMMAND_CONCATENATION", "Command construction concatenates or interpolates values.");
  scanPattern(findings, file, content, /--hold-seat\b/g, "HIGH", "SEAT_HOLD_FLAG", "Seat holding is forbidden.");
  scanPattern(findings, file, content, AUTOMATED_TRANSACTION_ACTION_PATTERN, "HIGH", "AUTOMATED_TRANSACTION_ACTION", "Automatic payment, reservation, cancellation, or seat action is forbidden.");
  scanPattern(findings, file, content, /\bsetInterval\s*\(/g, "HIGH", "REPEATED_TIMER", "Repeated timers can create aggressive polling.");
  scanPattern(findings, file, content, /setTimeout\s*\(\s*\([^)]*\b(?:fetch|refetch)\b[\s\S]{0,180}?,\s*(?:[0-5]?\d_?\d{0,3}|60000)\s*\)/gi, "HIGH", "SHORT_REFETCH_TIMER", "Short delayed refetch can create aggressive polling.");
  scanPattern(findings, file, content, /console\.(?:log|info|warn|error)\s*\([^\n]*(?:process\.env\.[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL)|\b(?:secret|token|password|apiKey|authorization)\b)/gi, "HIGH", "SECRET_CONSOLE_EXPOSURE", "Console output may expose a secret; values are redacted in this report.");
  scanPattern(findings, file, content, /(?:\.json|NextResponse\.json)\s*\(\s*process\.env\.[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL)/gi, "HIGH", "SECRET_API_EXPOSURE", "API response may expose a secret; values are redacted in this report.");
  scanPattern(findings, file, content, /console\.(?:log|info|warn|error)\s*\([^\n]*(?:response\.(?:data|body)|\b(?:rawStderr|stderr)\b)/gi, "HIGH", "RAW_RESPONSE_CONSOLE_EXPOSURE", "Console output may expose an API response or raw stderr.");

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    for (const match of content.matchAll(pattern)) {
      if (match.index !== undefined) {
        const allowed = (/seat/i.test(keyword) && hasReadOnlySeatVocabulary(content))
          || ((keyword === "setInterval" || keyword === "cron") && isExactNegativeTimerAssertion(relativeFile, content, match.index))
          || ((keyword === "fingerprint" || keyword === "reserve") && isApprovedAlertStateKeyword(relativeFile, keyword, content, match.index));
        addFinding(
          findings,
          file,
          content,
          match.index,
          allowed ? "ALLOWED" : "REVIEW",
          "FORBIDDEN_KEYWORD",
          allowed
            ? (/seat/i.test(keyword)
              ? "Allowlisted: read-only seat availability vocabulary, not a seat action."
              : "Allowlisted: exact fingerprint or delivery-reservation state-machine symbol line.")
            : "Keyword review required; keyword presence alone does not prove unsafe behavior."
        );
      }
    }
  }

  return findings;
}

function scanForesttripContract(): Finding[] {
  const files = {
    service: resolve(ROOT, "lib/services/foresttrip-service.ts"),
    route: resolve(ROOT, "app/api/foresttrip/search/route.ts"),
    page: resolve(ROOT, "app/foresttrip/page.tsx"),
    batch: resolve(ROOT, "app/api/watchlist/run-batch/route.ts"),
    official: resolve(ROOT, "lib/official-urls.ts")
  };
  const findings: Finding[] = [];
  const content = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, readFileSync(path, "utf8")])) as Record<string, string>;
  const checks: Array<[keyof typeof files, RegExp, string, string]> = [
    ["service", /const TIMEOUT_MS = 60_000[\s\S]*?(?:TZ: "Asia\/Seoul"|env\.TZ = "Asia\/Seoul")[\s\S]*?runHelperCommand<unknown>/, "FORESTTRIP_RUNTIME_BOUNDS", "Foresttrip uses the allowlisted 60-second, Seoul-time helper contract."],
    ["service", /if \(useMockHelpers\(\)\)[\s\S]*?return successResponse[\s\S]*?runtimeConfiguration\(\)/, "FORESTTRIP_MOCK_BEFORE_REAL", "Mock execution is gated before real helper configuration."],
    ["official", /foresttrip:\s*"https:\/\/foresttrip\.go\.kr\/index\.jsp"/, "FORESTTRIP_CANONICAL_URL", "Foresttrip uses the canonical official URL."],
    ["batch", /input\.type === "foresttrip" && !input\.includeForesttrip[\s\S]*?includeForesttrip/, "FORESTTRIP_BATCH_GATE", "Foresttrip batch execution has an independent explicit opt-in gate."],
    ["page", /^(?![\s\S]*(?:useEffect|setInterval|setTimeout))[\s\S]*$/, "FORESTTRIP_NO_UI_LIFECYCLE", "Foresttrip UI has no lifecycle or timer call."],
    ["service", /^(?![\s\S]*(?:spawn\s*\(|execFile\s*\(|\.\.\.process\.env|process\.env\s*[,)}]|(?:proxy|cache)\s*:))[\s\S]*$/, "FORESTTRIP_NO_RUNTIME_FORWARDING", "Foresttrip does not spawn directly or forward whole environment, proxy, or cache settings."],
    ["route", /^(?![\s\S]*(?:process\.env|console\.(?:log|info|warn|error)))[\s\S]*$/, "FORESTTRIP_NO_SECRET_LEAK", "Foresttrip route does not expose environment values or log secret-bearing data."]
  ];
  for (const [key, pattern, rule, reason] of checks) {
    const value = content[key];
    const index = value.search(pattern);
    addFinding(findings, files[key], value, Math.max(0, index), index >= 0 ? "ALLOWED" : "HIGH", rule, index >= 0 ? reason : "Foresttrip safety contract is missing or changed.");
  }
  return findings;
}

function contractContent(path: string): string {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ? readFileSync(path, "utf8") : "";
}

function scanApiBoundaryContract(): Finding[] {
  const inventoryPath = resolve(ROOT, "tests/alerts/api-boundary-inventory.test.ts");
  const localOperatorPath = resolve(ROOT, "lib/security/local-operator.ts");
  const inventory = contractContent(inventoryPath);
  const localOperator = contractContent(localOperatorPath);
  const findings: Finding[] = [];
  const checks: Array<[string, string, RegExp, string, string]> = [
    [inventoryPath, inventory, /API_BOUNDARY_EXPECTED_METHODS[\s\S]*?API_BOUNDARY_ALLOWED_AUTHORITIES[\s\S]*?127\.0\.0\.1[\s\S]*?localhost[\s\S]*?API_BOUNDARY_MUTATING_METHODS[\s\S]*?API_BOUNDARY_HANDLER_EFFECTS/s, "API_BOUNDARY_INVENTORY", "The API inventory fixes routes, methods, allowed authorities, and every handler's pinned effects."],
    [inventoryPath, inventory, /mixed|127\.0\.0\.1[\s\S]*?localhost[\s\S]*?(?:403|ALERT_LOCAL_OPERATOR_REQUIRED)[\s\S]*?(?:forwarded|x-forwarded)/is, "API_BOUNDARY_MIXED_AND_FORWARDED_REJECTION", "The API boundary rejects mixed authorities and forwarded-header rescue."],
    [localOperatorPath, localOperator, /LOCAL_OPERATOR_HOSTNAMES[\s\S]*?127\.0\.0\.1[\s\S]*?localhost[\s\S]*?new URL\(request\.url\)[\s\S]*?LOCAL_OPERATOR_HOSTNAMES\.has\(hostname\)/s, "LOCAL_OPERATOR_EXACT_HOSTNAMES", "Only exact loopback hostnames are admitted."],
    [localOperatorPath, localOperator, /request instanceof NextRequest[\s\S]*?request\.nextUrl\.hostname === "localhost"[\s\S]*?requestUrl\.hostname === "localhost"[\s\S]*?hostUrl\.hostname === "127\.0\.0\.1"[\s\S]*?requestUrl\.port === hostUrl\.port[\s\S]*?hostUrl\.host !== host[\s\S]*?host === requestUrl\.host \|\| hasFrameworkReconstructedUrl[\s\S]*?requestUrl\.protocol !== "http:"[\s\S]*?hostUrl === null[\s\S]*?!LOCAL_OPERATOR_HOSTNAMES\.has\(hostUrl\.hostname\.toLowerCase\(\)\)[\s\S]*?headers\.get\("origin"\) !== hostUrl\.origin[\s\S]*?headers\.get\("sec-fetch-site"\) !== "same-origin"/s, "LOCAL_OPERATOR_HOST_ORIGIN_EQUALITY", "Requests require an exact external Host authority and self-origin; only genuine NextRequest localhost reconstruction can use the same-port 127 Host exception."],
    [localOperatorPath, localOperator, /^(?![\s\S]*headers\.get\(["'](?:x-forwarded|forwarded))/is, "LOCAL_OPERATOR_NO_FORWARDED_RESCUE", "Forwarded headers are never read to establish local authority."]
  ];

  for (const [path, content, pattern, rule, reason] of checks) {
    const index = content.search(pattern);
    addFinding(findings, path, content, Math.max(0, index), index >= 0 ? "ALLOWED" : "HIGH", rule, index >= 0 ? reason : "Required API-boundary contract is missing or changed.");
  }

  const routeFiles = collectFiles(resolve(ROOT, "app/api"), (path) => /[\\/]route\.ts$/.test(path));
  const methods = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(\s*request\b/g;
  let methodCount = 0;
  for (const route of routeFiles) {
    const content = contractContent(route);
    const hasImport = /import\s*\{[^}]*\bassertLocalOperatorRequest\b[^}]*\}\s*from\s*["']@\/lib\/security\/local-operator["']/.test(content);
    for (const match of content.matchAll(methods)) {
      methodCount += 1;
      const body = content.slice(match.index ?? 0, (match.index ?? 0) + 4000);
      const guard = body.search(/assertLocalOperatorRequest\(request\)/);
      const effect = body.search(/\b(?:parseJsonBody(?:WithSchema)?|assertNoRequestBody|db\.|runWatchItem|run[A-Z]\w*Service|search[A-Z]\w*|get[A-Z]\w*|compare[A-Z]\w*|preflightWatchItemAssociation|createQueryResultFromResponse|storeResponse)\b/);
      const allowed = hasImport && guard >= 0 && (effect < 0 || guard < effect);
      addFinding(findings, route, content, match.index ?? 0, allowed ? "ALLOWED" : "HIGH", "API_ROUTE_LOCAL_OPERATOR_GUARD", allowed ? "The route guard precedes body, database, provider, association, storage, and delivery effects." : "Every route handler must import and call the local-operator guard before effects.");
    }
  }
  const routeCountAllowed = routeFiles.length === 14 && methodCount === 18;
  addFinding(findings, inventoryPath, inventory, 0, routeCountAllowed ? "ALLOWED" : "HIGH", "API_ROUTE_INVENTORY_COUNT", routeCountAllowed ? "The repository contains the required 14 routes and 18 exported methods." : "Route inventory count changed; update the explicit boundary inventory first.");
  return findings;
}

function scanAlertContract(): Finding[] {
  const files = {
    preflight: resolve(ROOT, "lib/alerts/alert-preflight.ts"),
    types: resolve(ROOT, "lib/alerts/types.ts"),
    telegram: resolve(ROOT, "lib/alerts/telegram.ts"),
    worker: resolve(ROOT, "lib/services/alert-worker-service.ts"),
    runner: resolve(ROOT, "scripts/run-alerts.ts"),
    packageJson: resolve(ROOT, "package.json"),
    verifier: resolve(ROOT, "scripts/verify-loopback.ts"),
    envExample: resolve(ROOT, ".env.example"),
    schema: resolve(ROOT, "prisma/schema.prisma"),
    watchlist: resolve(ROOT, "lib/watchlist.ts"),
    ownedTempDb: resolve(ROOT, "scripts/with-owned-temp-db.ts")
  };
  const findings: Finding[] = [];
  const content = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, contractContent(path)])) as Record<keyof typeof files, string>;
  const checks: Array<[keyof typeof files, RegExp, string, string]> = [
    ["types", /ALERT_SOURCES = \[\s*"flight-ticket-search",\s*"express-bus-booking",\s*"intercity-bus-booking",\s*"ticket-availability",\s*"foresttrip-vacancy"\s*\]/s, "ALERT_EXACT_LIVE_SOURCES", "Alert eligibility is limited to exact official live provider source constants."],
    ["preflight", /preflightAlertBootstrap[\s\S]*?parseAlertArguments[\s\S]*?assertWslEvidence[\s\S]*?TRIPWATCH_USE_MOCK_HELPERS === "true"[\s\S]*?readTelegramCredentials[\s\S]*?removeTelegramCredentialsFromAmbientEnv/s, "ALERT_PREFLIGHT_ORDER", "Preflight parses arguments, verifies WSL, blocks mocks, snapshots credentials, and strips ambient credential names."],
    ["preflight", /delete env\[name\][\s\S]*?TELEGRAM_ENV_NOT_REMOVED/, "ALERT_ENV_STRIPPING", "Telegram credential names are deleted and their absence is verified before worker import."],
    ["runner", /preflightAlertBootstrap\(process\.argv\.slice\(2\)\)[\s\S]*?await import\("\.\.\/lib\/services\/alert-worker-service"\)/s, "ALERT_STATIC_IMPORT_PREFLIGHT_GRAPH", "The runner reaches the worker only through a post-preflight dynamic import."],
    ["runner", /^(?![\s\S]*(?:spawn\s*\(|exec(?:File|Sync)?\s*\(|process\.env\.(?:TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)))[\s\S]*$/, "ALERT_RUNNER_NO_DIRECT_SPAWN_OR_CREDENTIAL_READ", "The runner neither spawns processes nor reads credentials outside preflight."],
    ["telegram", /https:\/\/api\.telegram\.org\/bot\$\{botToken\}\/sendMessage/, "ALERT_FIXED_TELEGRAM_TRANSPORT", "Telegram delivery has one fixed Bot API sendMessage endpoint."],
    ["telegram", /^(?![\s\S]*(?:console\.|process\.env|\bretry\s*\(|setInterval|setImmediate))[\s\S]*$/, "ALERT_TELEGRAM_NO_LEAK_OR_RETRY", "Telegram transport has no console output, ambient environment read, repeated timer, or retry loop."],
    ["preflight", /ALERT_DEFAULT_LIMIT = 5[\s\S]*?ALERT_MAX_LIMIT = 10/, "ALERT_WORKER_LIMITS", "Worker limits have a default of five and a hard maximum of ten."],
    ["worker", /function compareFairCandidates[\s\S]*?lastProviderRunAt[\s\S]*?getTime\(\)[\s\S]*?createdAt[\s\S]*?getTime\(\)[\s\S]*?left\.id[\s\S]*?candidates\.sort\(compareFairCandidates\)/s, "ALERT_FAIR_ORDERING", "Candidates are materially sorted by last provider run, creation time, and id before dispatch."],
    ["worker", /^(?![\s\S]*(?:setInterval|setTimeout|cron|scheduler|polling|\bretry\s*\(|spawn\s*\(|exec(?:File|Sync)?\s*\())[\s\S]*$/, "ALERT_WORKER_ONE_SHOT", "Worker contains no scheduler, polling, retry, or direct process spawning."],
    ["packageJson", /"dev": "next dev -H 127\.0\.0\.1"[\s\S]*?"start": "next start -H 127\.0\.0\.1"/s, "ALERT_DEFAULT_LOOPBACK_BINDING", "Default development and production scripts bind IPv4 loopback."],
    ["packageJson", /"verify:loopback": "tsx scripts\/verify-loopback\.ts"/, "ALERT_LOOPBACK_VERIFICATION", "Loopback verification uses the socket-and-HTTP verifier."],
    ["verifier", /IPV4_LOOPBACK = "0100007F"[\s\S]*?assertLoopbackSocket[\s\S]*?http:\/\/127\.0\.0\.1:\$\{port\}\/watchlist[\s\S]*?args\[0\] !== "--port"/s, "ALERT_LOOPBACK_SOCKET_AND_HTTP_CONTRACT", "The verifier requires an explicit port, one IPv4 loopback socket, no IPv6 socket, and a loopback HTTP response."],
    ["envExample", /TELEGRAM_BOT_TOKEN=""[\s\S]*?TELEGRAM_CHAT_ID=""/, "ALERT_ENV_EXAMPLE_NAMES_ONLY", "The example exposes only empty Telegram credential variable names."],
    ["schema", /model AlertRule \{[\s\S]*?watchItemId\s+String\s+@unique[\s\S]*?channel\s+String\s+@default\("telegram"\)[\s\S]*?outboundOptIn\s+Boolean\s+@default\(false\)/, "ALERT_SCHEMA_PROTECTED_INVARIANTS", "AlertRule remains one-per-watch, Telegram-only, and explicit-opt-in."],
    ["schema", /^(?![\s\S]*(?:fingerprint|attemptId|attemptRunId|attemptFingerprint|attemptResultId|attemptResultType)\s+String\s+@(?:@unique|unique))[\s\S]*$/, "ALERT_PRIVATE_FINGERPRINT", "Private delivery and fingerprint state is not publicly unique or exposed through schema shortcuts."],
    ["watchlist", /function serializeAlertRule[\s\S]*?return \{(?:(?!baselineFingerprint|attemptId|attemptRunId|attemptFingerprint|attemptTransitionSeq|attemptResultId|attemptResultType)[\s\S])*?\n {2}\};/, "ALERT_PUBLIC_SERIALIZER_NO_PRIVATE_STATE", "The public AlertRule serializer excludes private fingerprints and attempt state."],
    ["ownedTempDb", /export\s+async\s+function withOwnedTempDb[\s\S]*?assertOwner\(evidence\)[\s\S]*?migrate\(databaseUrl\)[\s\S]*?assertDatabase\(databaseUrl\)[\s\S]*?TRIPWATCH_SMOKE_ALLOW_DB_MUTATION: "true"/s, "OWNED_TEMP_DB_WRAPPER", "The owned temp-database wrapper alone grants mutation permission after ownership and migration proof."],
    ["packageJson", /"version": "0\.1\.0"[\s\S]*?"dependencies": \{[\s\S]*?"@prisma\/client": "\^7\.8\.0"/s, "ALERT_PACKAGE_PROTECTED_INVARIANTS", "Alert scripts do not change package version or dependencies."]
  ];
  for (const [key, pattern, rule, reason] of checks) {
    const value = content[key];
    const index = value.search(pattern);
    addFinding(findings, files[key], value, Math.max(0, index), index >= 0 ? "ALLOWED" : "HIGH", rule, index >= 0 ? reason : "Alert safety contract is missing or changed.");
  }
  return [...findings, ...scanApiBoundaryContract()];
}

function scanDocumentation(file: string): Finding[] {
  const content = readFileSync(file, "utf8");
  const findings: Finding[] = [];
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    for (const match of content.matchAll(pattern)) {
      if (match.index !== undefined) {
        addFinding(findings, file, content, match.index, "INFO", "DOCUMENTATION_KEYWORD", "Documentation is informational and is not executable code.");
      }
    }
  }
  return findings;
}
// SECURITY_SCAN_RULES_END

function main(): void {
  const sourceFiles = SOURCE_DIRECTORIES.flatMap((directory) => collectFiles(resolve(ROOT, directory), isSourceFile)).sort();
  const documentationFiles = [resolve(ROOT, "README.md"), ...collectFiles(resolve(ROOT, "docs"), (path) => path.endsWith(".md"))]
    .filter((path, index, paths) => statSync(path, { throwIfNoEntry: false })?.isFile() && paths.indexOf(path) === index)
    .sort();
  const sourceFindings = [...sourceFiles.flatMap(scanSource), ...scanForesttripContract(), ...scanAlertContract()].sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule)
  );
  const documentationFindings = documentationFiles.flatMap(scanDocumentation).sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule)
  );
  const counts: Record<Classification, number> = { HIGH: 0, REVIEW: 0, INFO: 0, ALLOWED: 0 };

  console.log("SOURCE FINDINGS");
  for (const finding of sourceFindings) {
    counts[finding.classification] += 1;
    const reason = finding.reason ? ` reason=${finding.reason}` : "";
    console.log(`${finding.file}:${finding.line} ${finding.classification} ${finding.rule} ${finding.excerpt}${reason}`);
  }

  console.log("DOCUMENTATION INFO");
  for (const finding of documentationFindings) {
    counts[finding.classification] += 1;
    const reason = finding.reason ? ` reason=${finding.reason}` : "";
    console.log(`${finding.file}:${finding.line} ${finding.classification} ${finding.rule} ${finding.excerpt}${reason}`);
  }

  console.log(`SUMMARY HIGH=${counts.HIGH} REVIEW=${counts.REVIEW} INFO=${counts.INFO} ALLOWED=${counts.ALLOWED}`);
  if (counts.HIGH > 0 || counts.REVIEW > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("security-scan.ts")) {
  main();
}
