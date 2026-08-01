import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorPath = new URL("../../components/watchlist/AlertRuleEditor.tsx", import.meta.url);
const tablePath = new URL("../../components/watchlist/WatchlistTable.tsx", import.meta.url);

async function source(path: URL) {
  return readFile(path, "utf8");
}

test("alert rule editor supports only approved watch item modes and fields", async () => {
  const editor = await source(editorPath);

  for (const mode of ["flight_search", "flight_compare_month", "express_bus_search", "intercity_bus_search", "ticket_seats", "foresttrip_search"]) {
    assert.match(editor, new RegExp(`"${mode}"`));
  }
  assert.match(editor, /displayed_price_at_or_below/);
  assert.match(editor, /date_displayed_price_at_or_below/);
  assert.match(editor, /seats_at_or_above/);
  assert.match(editor, /availability/);
  assert.match(editor, /공연 일정 조회는 알림을 지원하지 않습니다/);
  assert.doesNotMatch(editor, /version:\s*1/);
});

test("alert rule editor is local configuration without credentials, dispatch controls, or timers", async () => {
  const editor = await source(editorPath);

  assert.match(editor, /Telegram 발송에 명시적으로 동의합니다/);
  assert.match(editor, /checked=\{outboundOptIn\}/);
  assert.match(editor, /알림 활성화/);
  assert.match(editor, /알림 비활성화/);
  assert.match(editor, /사용하지 않는 초안 삭제/);
  assert.doesNotMatch(editor, /password|secret|api[_-]?key|bot[_-]?token|credential/i);
  assert.doesNotMatch(editor, /setInterval|setTimeout|cron|polling|worker|예약 시작|메시지 미리보기/i);
});

test("alert rule editor retains official-link booking and payment safety copy", async () => {
  const editor = await source(editorPath);

  assert.match(editor, /공식 페이지에서만 예약·결제/);
  assert.match(editor, /자격 증명이나 메시지 내용이 없습니다/);
});
test("alert rule editor displays bounded alert outcomes and delivery state", async () => {
  const editor = await source(editorPath);

  assert.match(editor, /latestOutcomeAt/);
  assert.match(editor, /latestOutcomeCode/);
  assert.match(editor, /lastAttemptAt/);
  assert.match(editor, /terminalAt/);
  assert.match(editor, /deliveryCode/);
});

test("watch item and alert rule mutations replace complete authoritative items", async () => {
  const table = await source(tablePath);
  const editor = await source(editorPath);

  assert.match(table, /import \{ replaceWatchItemById \} from "@\/lib\/watchlist-client-state"/);
  assert.match(table, /setItems\(\(current\) => replaceWatchItemById\(current, updatedItem\)\)/);
  assert.match(editor, /TripWatchApiResponse<\{ item: WatchItemListItem \}>/);
  assert.match(editor, /onItemMutation\(payload\.data\.item\)/);
  assert.doesNotMatch(editor, /fetch\("\/api\/watchlist"/);
});
