"use client";

import { useMemo, useState } from "react";

import { CheapestDatesCard } from "@/components/flights/CheapestDatesCard";
import { FlightResultSummary } from "@/components/flights/FlightResultSummary";
import { FlightResultTable } from "@/components/flights/FlightResultTable";
import { SaveFlightWatchButton } from "@/components/flights/SaveFlightWatchButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import type { TripWatchApiResponse } from "@/lib/api-response";
import { SAFETY_NOTICE } from "@/lib/constants";
import type { FlightQuery, FlightSearchData } from "@/lib/normalize/normalize-flight";

type FlightFormState = {
  from: string;
  to: string;
  date: string;
  returnDate: string;
  adults: string;
  seat: FlightQuery["seat"];
  mode: FlightQuery["mode"];
  limit: string;
  yearMonth: string;
  sample: "weekly" | "daily";
};

type LoadingMode = "search" | "compare-month";

const SEAT_OPTIONS: Array<{ value: FlightQuery["seat"]; label: string }> = [
  { value: "economy", label: "Economy" },
  { value: "premium-economy", label: "Premium" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" }
];

function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function defaultFormState(): FlightFormState {
  const date = futureDate(45);
  const returnDate = futureDate(50);

  return {
    from: "ICN",
    to: "NRT",
    date,
    returnDate,
    adults: "1",
    seat: "economy",
    mode: "roundtrip",
    limit: "5",
    yearMonth: date.slice(0, 7),
    sample: "weekly"
  };
}

function boundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function buildQueryFromState(form: FlightFormState): FlightQuery {
  return {
    from: form.from.trim().toUpperCase(),
    to: form.to.trim().toUpperCase(),
    date: form.date,
    returnDate: form.mode === "roundtrip" ? form.returnDate : undefined,
    adults: boundedInteger(form.adults, 1, 1, 9),
    seat: form.seat,
    mode: form.mode,
    limit: boundedInteger(form.limit, 5, 1, 20),
    yearMonth: form.yearMonth,
    sample: form.sample
  };
}

function buildSearchPayload(form: FlightFormState) {
  const query = buildQueryFromState(form);

  return {
    from: query.from,
    to: query.to,
    date: query.date,
    returnDate: query.mode === "roundtrip" ? query.returnDate : undefined,
    adults: query.adults,
    seat: query.seat,
    mode: query.mode,
    limit: query.limit
  };
}

function buildCompareMonthPayload(form: FlightFormState) {
  return {
    ...buildSearchPayload(form),
    yearMonth: form.yearMonth || form.date.slice(0, 7),
    sample: form.sample
  };
}

function responseMessage(payload: TripWatchApiResponse<FlightSearchData>): string {
  if (!payload.error) {
    return payload.summary ?? "요청을 처리하지 못했습니다.";
  }

  if (payload.error.code === "VALIDATION_ERROR" && payload.error.raw) {
    return `${payload.error.message}: ${payload.error.raw}`;
  }

  return payload.error.message;
}

export function FlightSearchForm() {
  const [form, setForm] = useState<FlightFormState>(() => defaultFormState());
  const [result, setResult] = useState<TripWatchApiResponse<FlightSearchData> | undefined>();
  const [loadingMode, setLoadingMode] = useState<LoadingMode | undefined>();
  const activeQuery = useMemo(() => result?.data?.query ?? buildQueryFromState(form), [form, result?.data?.query]);
  const officialUrl = result?.officialUrl ?? result?.data?.bookingSearchUrl;
  const busy = Boolean(loadingMode);

  function updateForm<K extends keyof FlightFormState>(key: K, value: FlightFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function requestFlight(endpoint: "/api/flights/search" | "/api/flights/compare-month", mode: LoadingMode) {
    setLoadingMode(mode);
    setResult(undefined);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(endpoint === "/api/flights/search" ? buildSearchPayload(form) : buildCompareMonthPayload(form))
      });
      const payload = (await response.json()) as TripWatchApiResponse<FlightSearchData>;
      setResult(payload);
    } catch {
      setResult({
        status: "failed",
        checkedAt: new Date().toISOString(),
        source: "google-flights-link",
        summary: "항공권 조회 요청을 완료하지 못했습니다.",
        error: {
          code: "UNKNOWN_ERROR",
          message: "항공권 조회 요청을 완료하지 못했습니다."
        }
      });
    } finally {
      setLoadingMode(undefined);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestFlight("/api/flights/search", "search");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.45fr)]">
      <section className="grid content-start gap-4 rounded-md border border-line bg-white p-4">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="form-field">
              <span className="form-label">출발 공항</span>
              <input
                className="form-input uppercase"
                value={form.from}
                maxLength={3}
                onChange={(event) => updateForm("from", event.target.value.toUpperCase())}
              />
            </label>
            <label className="form-field">
              <span className="form-label">도착 공항</span>
              <input
                className="form-input uppercase"
                value={form.to}
                maxLength={3}
                onChange={(event) => updateForm("to", event.target.value.toUpperCase())}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="form-field">
              <span className="form-label">출발일</span>
              <input className="form-input" type="date" value={form.date} onChange={(event) => updateForm("date", event.target.value)} />
            </label>
            <label className="form-field">
              <span className="form-label">귀국일</span>
              <input
                className="form-input"
                type="date"
                value={form.returnDate}
                disabled={form.mode === "oneway"}
                onChange={(event) => updateForm("returnDate", event.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="form-field">
              <span className="form-label">성인</span>
              <input
                className="form-input"
                type="number"
                min={1}
                max={9}
                value={form.adults}
                onChange={(event) => updateForm("adults", event.target.value)}
              />
            </label>
            <label className="form-field">
              <span className="form-label">좌석</span>
              <select className="form-input" value={form.seat} onChange={(event) => updateForm("seat", event.target.value as FlightQuery["seat"])}>
                {SEAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span className="form-label">표시 개수</span>
              <input
                className="form-input"
                type="number"
                min={1}
                max={20}
                value={form.limit}
                onChange={(event) => updateForm("limit", event.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-2">
            <span className="form-label">여정</span>
            <div className="grid grid-cols-2 gap-2">
              {(["roundtrip", "oneway"] as const).map((mode) => (
                <label
                  key={mode}
                  className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-black ${
                    form.mode === mode ? "border-accent bg-blue-50 text-accent" : "border-line bg-white text-slate-700"
                  }`}
                >
                  <input className="sr-only" type="radio" name="mode" checked={form.mode === mode} onChange={() => updateForm("mode", mode)} />
                  {mode === "roundtrip" ? "왕복" : "편도"}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 rounded-md border border-line bg-panel p-3 sm:grid-cols-2">
            <label className="form-field">
              <span className="form-label">비교 월</span>
              <input className="form-input" type="month" value={form.yearMonth} onChange={(event) => updateForm("yearMonth", event.target.value)} />
            </label>
            <label className="form-field">
              <span className="form-label">샘플</span>
              <select className="form-input" value={form.sample} onChange={(event) => updateForm("sample", event.target.value as "weekly" | "daily")}>
                <option value="weekly">주간</option>
                <option value="daily">일간</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="action-button" type="submit" disabled={busy}>
              {loadingMode === "search" ? "검색 중" : "검색하기"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                void requestFlight("/api/flights/compare-month", "compare-month");
              }}
            >
              {loadingMode === "compare-month" ? "비교 중" : "월별 비교하기"}
            </button>
          </div>
        </form>

        <SaveFlightWatchButton query={activeQuery} disabled={busy} />
        <p className="text-sm font-semibold text-slate-700">{SAFETY_NOTICE} 정확한 결제가는 공식 페이지에서 확인하세요.</p>
      </section>

      <section className="grid content-start gap-5">
        {busy ? <LoadingNotice message="항공권 외부 조회 중입니다. 월별 비교는 시간이 더 걸릴 수 있습니다." /> : null}

        {!result && !busy ? (
          <EmptyState title="항공권 결과 없음" description="검색 또는 월별 비교를 실행하면 가격 요약과 후보가 표시됩니다." />
        ) : null}

        {result?.status === "failed" ? <ErrorCard title="항공권 조회 실패" message={responseMessage(result)} /> : null}

        {officialUrl ? (
          <a className="secondary-button inline-flex w-fit items-center" href={officialUrl} target="_blank" rel="noreferrer">
            Google Flights에서 직접 확인
          </a>
        ) : null}

        {result?.data ? (
          <>
            <FlightResultSummary data={result.data} status={result.status} checkedAt={result.checkedAt} />
            <CheapestDatesCard dates={result.data.cheapestDates} />
            <FlightResultTable flights={result.data.flights} />
          </>
        ) : null}
      </section>
    </div>
  );
}
