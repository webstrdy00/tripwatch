"use client";

import { useMemo, useState } from "react";

import { SaveForesttripWatchButton } from "@/components/foresttrip/SaveForesttripWatchButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { TripWatchApiResponse } from "@/lib/api-response";
import { SAFETY_NOTICE } from "@/lib/constants";
import { formatDateTime, getKstCalendarDate } from "@/lib/dates";
import type { ForesttripSearchData } from "@/lib/normalize/normalize-foresttrip";
import type { ForesttripSearchInput } from "@/lib/validation/foresttrip-schema";

const OFFICIAL_FORESTTRIP_URL = "https://foresttrip.go.kr/index.jsp";

type ForesttripFormState = ForesttripSearchInput;

function defaultFormState(): ForesttripFormState {
  return {
    forestName: "",
    date: getKstCalendarDate(),
    category: "01"
  };
}

function responseMessage(payload: TripWatchApiResponse<ForesttripSearchData>): string {
  if (!payload.error) {
    return payload.summary ?? "요청을 처리하지 못했습니다.";
  }

  if (payload.error.code === "VALIDATION_ERROR" && payload.error.raw) {
    return `${payload.error.message}: ${payload.error.raw}`;
  }

  return payload.error.message;
}

export function ForesttripSearchForm() {
  const [form, setForm] = useState<ForesttripFormState>(() => defaultFormState());
  const [result, setResult] = useState<TripWatchApiResponse<ForesttripSearchData> | undefined>();
  const [loading, setLoading] = useState(false);
  const minimumDate = getKstCalendarDate();
  const activeQuery = useMemo(
    () => result?.data?.query ?? { forestName: form.forestName.trim().normalize("NFC"), date: form.date, category: form.category },
    [form, result?.data?.query]
  );

  function updateForm<K extends keyof ForesttripFormState>(key: K, value: ForesttripFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setResult(undefined);

    const query = {
      forestName: form.forestName.trim().normalize("NFC"),
      date: form.date,
      category: form.category
    };

    try {
      const response = await fetch("/api/foresttrip/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(query)
      });
      const payload = (await response.json()) as TripWatchApiResponse<ForesttripSearchData>;
      setResult(payload);
    } catch {
      setResult({
        status: "failed",
        checkedAt: new Date().toISOString(),
        source: "foresttrip-official-link",
        officialUrl: OFFICIAL_FORESTTRIP_URL,
        summary: "자연휴양림 조회 요청을 완료하지 못했습니다.",
        error: {
          code: "UNKNOWN_ERROR",
          message: "자연휴양림 조회 요청을 완료하지 못했습니다."
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
          <label className="form-field">
            <span className="form-label">휴양림명</span>
            <input className="form-input" value={form.forestName} onChange={(event) => updateForm("forestName", event.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">날짜</span>
            <input className="form-input" type="date" min={minimumDate} value={form.date} onChange={(event) => updateForm("date", event.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">카테고리</span>
            <select className="form-input" value={form.category} onChange={(event) => updateForm("category", event.target.value as ForesttripSearchInput["category"])}>
              <option value="01">01 숙박</option>
              <option value="02">02 야영</option>
            </select>
          </label>
          <button className="action-button w-fit" type="submit" disabled={loading || !form.forestName.trim() || !form.date}>
            {loading ? "조회 중" : "조회하기"}
          </button>
        </form>

        <SaveForesttripWatchButton query={activeQuery} disabled={loading || !activeQuery.forestName || !activeQuery.date} />
        <p className="text-sm font-semibold text-slate-700">도우미는 응답을 받기 전에 입력한 휴양림명 부분 문자열로 일치 여부를 확인합니다. 휴양림의 공식 전체 명칭을 입력하세요.</p>
        <p className="text-sm font-semibold text-slate-700">정규화된 빈 결과는 조회 시각에 빈 객실이 없다는 뜻이지만, 대상 휴양림의 동일성을 독립적으로 다시 표시하거나 증명하지는 않습니다.</p>
        <p className="text-sm font-semibold text-slate-700">{SAFETY_NOTICE} 예약/결제는 공식 페이지에서 직접 진행하세요.</p>
      </section>

      <section className="grid content-start gap-5">
        {loading ? <LoadingNotice message="자연휴양림 조회 중입니다." /> : null}
        {!result && !loading ? <EmptyState title="자연휴양림 결과 없음" description="휴양림명, 날짜, 카테고리를 입력한 뒤 조회하기를 선택하세요." /> : null}
        {result ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={result.status} />
            <span className="text-sm font-semibold text-slate-600">조회 시각 {formatDateTime(result.checkedAt)}</span>
          </div>
        ) : null}
        {result?.status === "failed" ? <ErrorCard title="자연휴양림 조회 실패" message={responseMessage(result)} /> : null}
        <a className="secondary-button inline-flex w-fit items-center" href={OFFICIAL_FORESTTRIP_URL} target="_blank" rel="noreferrer">
          자연휴양림 공식 페이지에서 확인
        </a>
        {result?.data ? (
          result.data.rooms.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-line bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-panel text-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-black">객실명</th>
                    <th className="px-4 py-3 font-black">날짜</th>
                    <th className="px-4 py-3 font-black">카테고리</th>
                    <th className="px-4 py-3 font-black">정원</th>
                    <th className="px-4 py-3 font-black">예약 가능 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.rooms.map((room) => (
                    <tr key={room.id} className="border-t border-line">
                      <td className="px-4 py-3 font-bold text-ink">{room.roomName}</td>
                      <td className="px-4 py-3">{room.date}</td>
                      <td className="px-4 py-3">{room.categoryLabel}</td>
                      <td className="px-4 py-3">{room.capacity === null ? "확인 불가" : `${room.capacity}명`}</td>
                      <td className="px-4 py-3 font-bold text-emerald-700">{room.availability === "available" ? "예약 가능" : room.availability}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="예약 가능한 시설 없음" description="입력한 조건에서 표시할 예약 가능 시설이 없습니다. 공식 페이지에서 다시 확인하세요." />
          )
        ) : null}
      </section>
    </div>
  );
}
