"use client";

import { useEffect, useState } from "react";

import { formatDateTime } from "@/components/watchlist/WatchItemSummary";
import type { TripWatchApiResponse } from "@/lib/api-response";
import type { AlertCondition } from "@/lib/alerts/types";
import type { WatchItemListItem } from "@/lib/watchlist";

type AlertMode = "flight_search" | "flight_compare_month" | "express_bus_search" | "intercity_bus_search" | "ticket_seats" | "foresttrip_search" | "schedule";

function alertModeFor(item: WatchItemListItem): AlertMode {
  let params: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(item.paramsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
  } catch {
    return item.type === "ticket" ? "schedule" : "flight_search";
  }

  if (item.type === "ticket") return params.mode === "schedule" ? "schedule" : "ticket_seats";
  if (item.type === "flight") return typeof params.yearMonth === "string" || typeof params.month === "string" || typeof params.sample === "string" ? "flight_compare_month" : "flight_search";
  if (item.type === "express_bus") return "express_bus_search";
  if (item.type === "intercity_bus") return "intercity_bus_search";
  return "foresttrip_search";
}

function defaultCondition(mode: AlertMode): AlertCondition {
  if (mode === "flight_search") return { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 100000 };
  if (mode === "flight_compare_month") return { kind: "date_displayed_price_at_or_below", maxDisplayedPriceKrw: 100000 };
  if (mode === "express_bus_search" || mode === "intercity_bus_search") return { kind: "seats_at_or_above", minSeats: 1 };
  return { kind: "availability" };
}

function conditionForRequest(condition: AlertCondition): AlertCondition {
  return condition;
}

function conditionField(mode: AlertMode): "price" | "seats" | undefined {
  if (mode === "flight_search" || mode === "flight_compare_month") return "price";
  if (mode === "express_bus_search" || mode === "intercity_bus_search") return "seats";
  return undefined;
}

export function AlertRuleEditor({ item, busy, onItemMutation }: { item: WatchItemListItem; busy: boolean; onItemMutation: (item: WatchItemListItem) => void }) {
  const mode = alertModeFor(item);
  const rule = item.alertRule;
  const [condition, setCondition] = useState<AlertCondition>(() => rule?.condition ?? defaultCondition(mode));
  const [outboundOptIn, setOutboundOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setCondition(rule?.condition ?? defaultCondition(mode));
    setOutboundOptIn(false);
    setError(undefined);
  }, [item.id, mode, rule?.configVersion, rule?.condition]);

  if (mode === "schedule") {
    return <p className="text-xs font-bold text-slate-600">공연 일정 조회는 알림을 지원하지 않습니다.</p>;
  }

  const field = conditionField(mode);
  const disabled = busy || submitting;
  const displayValue = condition.kind === "displayed_price_at_or_below" || condition.kind === "date_displayed_price_at_or_below"
    ? condition.maxDisplayedPriceKrw
    : condition.kind === "seats_at_or_above" ? condition.minSeats : undefined;
  const canDeleteDraft = Boolean(rule && !rule.enabled && !rule.outboundOptIn && rule.latestOutcome === "never" && rule.baselineState === "never" && rule.baselineTransitionSeq === 0 && rule.deliveryState === "never" && !rule.lastProviderRunAt && !rule.lastAttemptAt && !rule.terminalAt);
  const conditionValid = displayValue === undefined || (displayValue >= 1 && displayValue <= (field === "price" ? 100000000 : 99));

  async function mutate(method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    setSubmitting(true);
    setError(undefined);
    try {
      const url = rule ? `/api/alert-rules/${encodeURIComponent(rule.id)}` : "/api/alert-rules";
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = await response.json() as TripWatchApiResponse<{ item: WatchItemListItem }>;
      if (payload.status === "success" && payload.data?.item) {
        onItemMutation(payload.data.item);
        return;
      }
      setError(payload.error?.message ?? payload.summary ?? "알림 설정 요청을 처리하지 못했습니다.");
    } catch {
      setError("알림 설정 요청을 완료하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  function setNumber(value: string) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) return;
    if (field === "price") setCondition({ kind: mode === "flight_compare_month" ? "date_displayed_price_at_or_below" : "displayed_price_at_or_below", maxDisplayedPriceKrw: number });
    if (field === "seats") setCondition({ kind: "seats_at_or_above", minSeats: number });
  }

  return (
    <div className="grid gap-2 border-t border-slate-200 pt-2 text-xs">
      <p className="font-black text-slate-800">Telegram 알림 설정 (로컬 구성만)</p>
      {field ? (
        <label className="form-field">
          <span className="form-label">{field === "price" ? "표시 가격 이하 (원)" : "잔여 좌석 이상"}</span>
          <input className="form-input" type="number" min={1} max={field === "price" ? 100000000 : 99} value={displayValue ?? ""} disabled={disabled} onChange={(event) => setNumber(event.currentTarget.value)} />
        </label>
      ) : <p className="text-slate-600">예약 가능 상태가 확인되면 알립니다.</p>}
      {!rule ? (
        <button className="secondary-button" type="button" disabled={disabled || !conditionValid} onClick={() => void mutate("POST", { watchItemId: item.id, condition: conditionForRequest(condition) })}>알림 초안 만들기</button>
      ) : (
        <>
          <button className="secondary-button" type="button" disabled={disabled || !conditionValid} onClick={() => void mutate("PATCH", { configVersion: rule.configVersion, condition: conditionForRequest(condition) })}>조건 저장</button>
          <label className="flex items-center gap-2 font-bold text-slate-700">
            <input type="checkbox" checked={outboundOptIn} disabled={disabled} onChange={(event) => setOutboundOptIn(event.currentTarget.checked)} />
            Telegram 발송에 명시적으로 동의합니다
          </label>
          <div className="flex flex-wrap gap-2">
            {rule.enabled ? (
              <button className="secondary-button" type="button" disabled={disabled} onClick={() => void mutate("PATCH", { configVersion: rule.configVersion, enabled: false, outboundOptIn: false, channel: "telegram" })}>알림 비활성화</button>
            ) : (
              <button className="secondary-button" type="button" disabled={disabled || !outboundOptIn} onClick={() => void mutate("PATCH", { configVersion: rule.configVersion, enabled: true, outboundOptIn: true, channel: "telegram" })}>알림 활성화</button>
            )}
            {canDeleteDraft ? <button className="danger-button" type="button" disabled={disabled} onClick={() => void mutate("DELETE")}>사용하지 않는 초안 삭제</button> : null}
          </div>
          <dl className="grid gap-1 text-slate-600">
            <div><dt className="inline font-bold">최근 결과: </dt><dd className="inline">{rule.latestOutcome} / {formatDateTime(rule.latestOutcomeAt ?? undefined)} / {rule.latestOutcomeCode ?? "-"}</dd></div>
            <div><dt className="inline font-bold">최근 발송: </dt><dd className="inline">{rule.deliveryState} / 시도 {formatDateTime(rule.lastAttemptAt ?? undefined)} / 종료 {formatDateTime(rule.terminalAt ?? undefined)} / {rule.deliveryCode ?? "-"}</dd></div>
          </dl>
        </>
      )}
      <p className="text-slate-600">공식 페이지에서만 예약·결제하고, 이 화면에는 자격 증명이나 메시지 내용이 없습니다.</p>
      {error ? <p className="font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
