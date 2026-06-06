"use client";

import { useMemo, useState } from "react";

import { BusScheduleTable } from "@/components/buses/BusScheduleTable";
import { SaveBusWatchButton } from "@/components/buses/SaveBusWatchButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { TripWatchApiResponse } from "@/lib/api-response";
import { SAFETY_NOTICE } from "@/lib/constants";
import type { BusKind, BusQuery, BusSearchData } from "@/lib/normalize/normalize-bus";

type BusFormState = {
  departName: string;
  arriveName: string;
  date: string;
  time: string;
  passengers: string;
};

const OFFICIAL_LABELS: Record<BusKind, string> = {
  express: "공식 KOBUS에서 보기",
  intercity: "공식 티머니 시외버스에서 보기"
};

const OFFICIAL_URLS: Record<BusKind, string> = {
  express: "https://www.kobus.co.kr/mrs/rotinf.do",
  intercity: "https://intercitybus.tmoney.co.kr/otck/trmlInfEnty.do"
};

function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function defaultFormState(kind: BusKind): BusFormState {
  return kind === "express"
    ? {
        departName: "서울경부",
        arriveName: "부산",
        date: futureDate(14),
        time: "09:00",
        passengers: "1"
      }
    : {
        departName: "동서울",
        arriveName: "속초",
        date: futureDate(14),
        time: "08:00",
        passengers: "1"
      };
}

function boundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function buildQueryFromState(form: BusFormState): BusQuery {
  return {
    departName: form.departName.trim(),
    arriveName: form.arriveName.trim(),
    date: form.date,
    time: form.time,
    passengers: boundedInteger(form.passengers, 1, 1, 9)
  };
}

function responseMessage(payload: TripWatchApiResponse<BusSearchData>): string {
  if (!payload.error) {
    return payload.summary ?? "요청을 처리하지 못했습니다.";
  }

  if ((payload.error.code === "VALIDATION_ERROR" || payload.error.code === "TERMINAL_NOT_FOUND") && payload.error.raw) {
    return `${payload.error.message}: ${payload.error.raw}`;
  }

  return payload.error.message;
}

export function BusSearchForm({ kind }: { kind: BusKind }) {
  const [form, setForm] = useState<BusFormState>(() => defaultFormState(kind));
  const [result, setResult] = useState<TripWatchApiResponse<BusSearchData> | undefined>();
  const [loading, setLoading] = useState(false);
  const activeQuery = useMemo(() => result?.data?.query ?? buildQueryFromState(form), [form, result?.data?.query]);
  const officialUrl = result?.officialUrl ?? result?.data?.officialUrl ?? OFFICIAL_URLS[kind];

  function updateForm<K extends keyof BusFormState>(key: K, value: BusFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setResult(undefined);

    try {
      const endpoint = kind === "express" ? "/api/buses/express/search" : "/api/buses/intercity/search";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildQueryFromState(form))
      });
      const payload = (await response.json()) as TripWatchApiResponse<BusSearchData>;
      setResult(payload);
    } catch {
      setResult({
        status: "failed",
        checkedAt: new Date().toISOString(),
        source: kind === "express" ? "kobus-link" : "tmoney-link",
        officialUrl: OFFICIAL_URLS[kind],
        summary: "버스 조회 요청을 완료하지 못했습니다.",
        error: {
          code: "UNKNOWN_ERROR",
          message: "버스 조회 요청을 완료하지 못했습니다."
        }
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.45fr)]">
      <section className="grid content-start gap-4 rounded-md border border-line bg-white p-4">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="form-field">
              <span className="form-label">출발 터미널</span>
              <input className="form-input" value={form.departName} maxLength={80} onChange={(event) => updateForm("departName", event.target.value)} />
            </label>
            <label className="form-field">
              <span className="form-label">도착 터미널</span>
              <input className="form-input" value={form.arriveName} maxLength={80} onChange={(event) => updateForm("arriveName", event.target.value)} />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="form-field">
              <span className="form-label">날짜</span>
              <input className="form-input" type="date" value={form.date} onChange={(event) => updateForm("date", event.target.value)} />
            </label>
            <label className="form-field">
              <span className="form-label">희망 시간</span>
              <input className="form-input" type="time" value={form.time} onChange={(event) => updateForm("time", event.target.value)} />
            </label>
            <label className="form-field">
              <span className="form-label">인원 수</span>
              <input
                className="form-input"
                type="number"
                min={1}
                max={9}
                value={form.passengers}
                onChange={(event) => updateForm("passengers", event.target.value)}
              />
            </label>
          </div>

          <div>
            <button className="action-button" type="submit" disabled={loading}>
              {loading ? "검색 중" : "검색하기"}
            </button>
          </div>
        </form>

        <SaveBusWatchButton kind={kind} query={activeQuery} disabled={loading} />
        <p className="text-sm font-semibold text-slate-700">{SAFETY_NOTICE} 공식 페이지에서 좌석 선택과 결제를 직접 진행하세요.</p>
      </section>

      <section className="grid content-start gap-5">
        {loading ? <LoadingNotice message="버스 외부 조회 중입니다. 공식 사이트 응답에 따라 시간이 걸릴 수 있습니다." /> : null}

        {!result && !loading ? (
          <EmptyState title="배차 결과 없음" description="검색을 실행하면 배차, 등급, 잔여석, 요금이 표시됩니다." />
        ) : null}

        {result ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={result.status} />
            <span className="text-sm font-semibold text-slate-600">조회 시각 {new Date(result.checkedAt).toISOString().replace("T", " ").slice(0, 16)}</span>
          </div>
        ) : null}

        {result?.status === "failed" ? <ErrorCard title="버스 조회 실패" message={responseMessage(result)} /> : null}

        <a className="secondary-button inline-flex w-fit items-center" href={officialUrl} target="_blank" rel="noreferrer">
          {OFFICIAL_LABELS[kind]}
        </a>

        {result?.data ? <BusScheduleTable kind={kind} schedules={result.data.schedules} /> : null}
      </section>
    </div>
  );
}
