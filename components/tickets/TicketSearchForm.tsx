"use client";

import { useMemo, useState } from "react";

import { SaveTicketWatchButton } from "@/components/tickets/SaveTicketWatchButton";
import { TicketScheduleTable } from "@/components/tickets/TicketScheduleTable";
import { TicketSeatTable } from "@/components/tickets/TicketSeatTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { TripWatchApiResponse } from "@/lib/api-response";
import type { TicketScheduleData, TicketSeatsData } from "@/lib/normalize/normalize-ticket";

type TicketMode = "schedule" | "seats";
type TicketResultData = TicketScheduleData | TicketSeatsData;
type TicketResult = TripWatchApiResponse<TicketResultData>;

const DEFAULT_INPUT = "interpark:26000541";

function responseMessage(payload: TicketResult): string {
  if (!payload.error) {
    return payload.summary ?? "요청을 처리하지 못했습니다.";
  }

  if (payload.error.code === "VALIDATION_ERROR" && payload.error.raw) {
    return `${payload.error.message}: ${payload.error.raw}`;
  }

  return payload.error.message;
}

function checkedAtText(value: string | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toISOString().replace("T", " ").slice(0, 16);
}

function normalizedInput(data: TicketResultData | undefined, fallback: string): string {
  return data ? `${data.platform}:${data.id}` : fallback.trim();
}

function isScheduleData(value: TicketResultData | undefined): value is TicketScheduleData {
  return Boolean(value && "performances" in value);
}

function isSeatsData(value: TicketResultData | undefined): value is TicketSeatsData {
  return Boolean(value && "seats" in value);
}

export function TicketSearchForm() {
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [result, setResult] = useState<TicketResult | undefined>();
  const [resultMode, setResultMode] = useState<TicketMode | undefined>();
  const [loadingMode, setLoadingMode] = useState<TicketMode | undefined>();
  const busy = Boolean(loadingMode);
  const saveInput = useMemo(() => normalizedInput(result?.data, input), [input, result?.data]);

  async function requestTicket(mode: TicketMode) {
    setLoadingMode(mode);
    setResultMode(mode);
    setResult(undefined);

    try {
      const endpoint = mode === "schedule" ? "/api/tickets/schedule" : "/api/tickets/seats";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: input.trim(),
          mode
        })
      });
      const payload = (await response.json()) as TicketResult;
      setResult(payload);
    } catch {
      setResult({
        status: "failed",
        checkedAt: new Date().toISOString(),
        source: "ticket-official-link",
        officialUrl: "https://tickets.interpark.com",
        summary: "공연 조회 요청을 완료하지 못했습니다.",
        error: {
          code: "UNKNOWN_ERROR",
          message: "공연 조회 요청을 완료하지 못했습니다."
        }
      });
    } finally {
      setLoadingMode(undefined);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestTicket("schedule");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.45fr)]">
      <section className="grid content-start gap-4 rounded-md border border-line bg-white p-4">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="form-field">
            <span className="form-label">공연 URL 또는 platform:id</span>
            <input className="form-input" value={input} onChange={(event) => setInput(event.target.value)} />
          </label>

          <div className="flex flex-wrap gap-2">
            <button className="action-button" type="submit" disabled={busy || !input.trim()}>
              {loadingMode === "schedule" ? "일정 조회 중" : "일정 조회"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !input.trim()}
              onClick={() => {
                void requestTicket("seats");
              }}
            >
              {loadingMode === "seats" ? "잔여석 조회 중" : "잔여석 조회"}
            </button>
          </div>
        </form>

        <SaveTicketWatchButton input={saveInput} disabled={busy} />
        <p className="text-sm font-semibold text-slate-700">
          조회 시각 기준 정보이며 예매/결제/좌석 선택은 공식 페이지에서 직접 진행하세요.
        </p>
      </section>

      <section className="grid content-start gap-5">
        {busy ? <LoadingNotice message="공연 외부 조회 중입니다. 잔여석 조회는 회차 수에 따라 시간이 걸릴 수 있습니다." /> : null}

        {!result && !busy ? (
          <EmptyState title="공연 결과 없음" description="일정 조회 또는 잔여석 조회를 실행하면 회차와 등급별 잔여 수가 표시됩니다." />
        ) : null}

        {result ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={result.status} />
            <span className="text-sm font-semibold text-slate-600">조회 시각 {checkedAtText(result.checkedAt)}</span>
          </div>
        ) : null}

        {result?.status === "failed" ? <ErrorCard title="공연 조회 실패" message={responseMessage(result)} /> : null}

        {result?.officialUrl ? (
          <a className="secondary-button inline-flex w-fit items-center" href={result.officialUrl} target="_blank" rel="noreferrer">
            공식 예매 페이지에서 보기
          </a>
        ) : null}

        {resultMode === "schedule" && isScheduleData(result?.data) ? (
          result.data.performances.length > 0 ? (
            <TicketScheduleTable performances={result.data.performances} />
          ) : (
            <EmptyState title="표시할 일정 정보가 없습니다" description="URL 또는 platform:id를 확인하거나 공식 페이지를 직접 확인하세요." />
          )
        ) : null}

        {resultMode === "seats" && isSeatsData(result?.data) ? <TicketSeatTable seats={result.data.seats} /> : null}
      </section>
    </div>
  );
}
