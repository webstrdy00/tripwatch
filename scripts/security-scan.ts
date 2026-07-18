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
function isForesttripNegativeSourceAssertion(relativeFile: string, content: string, index: number): boolean {
  if (relativeFile !== "scripts/smoke-test.ts") {
    return false;
  }

  const start = content.lastIndexOf("\n", index) + 1;
  const end = content.indexOf("\n", index);
  const line = content.slice(start, end < 0 ? content.length : end);
  return /^\s*assert\(!\/(?:useEffect\|)?setInterval(?:\|setTimeout)?(?:\|retry\|for\\s\*\\\([^)]*\*attempt)?/.test(line)
    && /Foresttrip UI contains lifecycle|service contains lifecycle/.test(line);
}

function hasSafeShellWrapper(content: string): boolean {
  return /from\s+["']node:child_process["']/.test(content) && /\bspawn\s*\(/.test(content) && /shell\s*:\s*false/.test(content);
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
    && /mkdtemp\s*\(/.test(content)
    && /isSafeTempDirectory\s*\(/.test(content)
    && /TRIPWATCH_SMOKE_ALLOW_DB_MUTATION/.test(content)
    && /AbortController/.test(content)
    && /finally\s*\{\s*await cleanup\(/.test(content);
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

function scanSource(file: string): Finding[] {
  const rawContent = readFileSync(file, "utf8");
  const relativeFile = relative(ROOT, file).replaceAll(sep, "/");
  const content = relativeFile === "scripts/security-scan.ts" ? stripOwnRuleDefinitions(rawContent) : rawContent;
  const findings: Finding[] = [];
  const safeShellWrapper = relativeFile === "lib/shell.ts" && hasSafeShellWrapper(content);
  const safeSmokeHarness = relativeFile === "scripts/helper-smoke.ts" && hasSafeSmokeHarness(content);
  const safeManagedSmokeHarness = relativeFile === "scripts/smoke-test.ts" && hasSafeManagedSmokeHarness(content);
  const importedExec = hasImportedExec(content);
  if (safeShellWrapper) {
    const spawnIndex = content.search(/\bspawn\s*\(/);
    if (spawnIndex >= 0) {
      addFinding(findings, file, content, spawnIndex, "ALLOWED", "SAFE_SPAWN_WRAPPER", "Allowlisted: node spawn uses shell:false with bounded helper execution.");
    }
  } else if (safeSmokeHarness || safeManagedSmokeHarness) {
    const spawnIndex = content.search(/\bspawn\s*\(/);
    if (spawnIndex >= 0) {
      addFinding(
        findings,
        file,
        content,
        spawnIndex,
        "ALLOWED",
        "SAFE_SMOKE_SPAWN",
        safeManagedSmokeHarness
          ? "Allowlisted: managed smoke uses shell:false, request timeouts, a verified OS-temp database, and finally cleanup."
          : "Allowlisted: helper smoke uses shell:false, timeouts, output limits, and secret masking."
      );
    }
  } else {
    scanPattern(findings, file, content, /\bspawn\s*\(/g, "HIGH", "UNALLOWLISTED_SPAWN", "Spawn use lacks required shell:false and bounded-execution evidence.");
  }

  scanPattern(findings, file, content, /\b(?:child_process|childProcess)\.exec(?:Sync)?\s*\(/g, "HIGH", "EXEC_STRING_COMMAND", "exec executes a shell command string.");
  if (importedExec) {
    scanPattern(findings, file, content, /\bexec(?:Sync)?\s*\(/g, "HIGH", "EXEC_STRING_COMMAND", "Imported child_process exec executes a shell command string.");
  }
  scanPattern(findings, file, content, /\b(?:spawn|execFile)\s*\([\s\S]{0,300}?shell\s*:\s*true/g, "HIGH", "SHELL_TRUE", "shell:true enables shell command interpretation.");
  scanPattern(findings, file, content, /\b(?:spawn|execFile)\s*\(\s*(?:`[^`]*\$\{|[^,()\n]+\s*\+\s*[^,\n]+)/g, "HIGH", "COMMAND_CONCATENATION", "Command construction concatenates or interpolates values.");
  scanPattern(findings, file, content, /--hold-seat\b/g, "HIGH", "SEAT_HOLD_FLAG", "Seat holding is forbidden.");
  scanPattern(findings, file, content, /\b(?:autoPay|payment|checkout|reserve|bookingConfirm|holdSeat|seatSelect|cancel(?:Booking|Reservation)?)\s*\(/gi, "HIGH", "AUTOMATED_TRANSACTION_ACTION", "Automatic payment, reservation, cancellation, or seat action is forbidden.");
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
          || (keyword === "setInterval" && isForesttripNegativeSourceAssertion(relativeFile, content, match.index));
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
              : "Allowlisted: Foresttrip read-only smoke asserts the absence of lifecycle and timer calls in product source.")
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
  const sourceFindings = [...sourceFiles.flatMap(scanSource), ...scanForesttripContract()].sort((left, right) =>
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
  if (counts.HIGH > 0) {
    process.exitCode = 1;
  }
}

main();
