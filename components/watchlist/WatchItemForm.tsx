"use client";

import { useState } from "react";

import type { WatchItemType } from "@/lib/validation/common-schema";
import { getKstCalendarDate } from "@/lib/dates";

export type WatchItemCreatePayload = {
  type: WatchItemType;
  title: string;
  paramsJson: string;
  memo?: string;
};

const SAMPLE_PARAMS: Record<Exclude<WatchItemType, "foresttrip">, string> = {
  flight: JSON.stringify(
    {
      from: "ICN",
      to: "NRT",
      date: "2026-07-10",
      returnDate: "2026-07-14",
      adults: 1,
      seat: "economy",
      mode: "roundtrip"
    },
    null,
    2
  ),
  express_bus: JSON.stringify(
    {
      departName: "서울경부",
      arriveName: "부산",
      date: "2026-06-13",
      time: "09:00",
      passengers: 1
    },
    null,
    2
  ),
  intercity_bus: JSON.stringify(
    {
      departName: "동서울",
      arriveName: "속초",
      date: "2026-06-13",
      time: "08:00",
      passengers: 1
    },
    null,
    2
  ),
  ticket: JSON.stringify(
    {
      input: "interpark:26000541",
      mode: "seats"
    },
    null,
    2
  )
};

function sampleParams(type: WatchItemType): string {
  if (type === "foresttrip") {
    return JSON.stringify(
      {
        forestName: "국립유명산자연휴양림",
        date: getKstCalendarDate(),
        category: "01"
      },
      null,
      2
    );
  }

  return SAMPLE_PARAMS[type];
}

const DEFAULT_TITLES: Record<WatchItemType, string> = {
  flight: "ICN → NRT 왕복",
  express_bus: "서울경부 → 부산",
  intercity_bus: "동서울 → 속초",
  ticket: "인터파크 공연",
  foresttrip: "국립유명산자연휴양림 숙박"
};

export function WatchItemForm({
  busy,
  onCreate
}: {
  busy: boolean;
  onCreate: (payload: WatchItemCreatePayload) => Promise<void>;
}) {
  const [type, setType] = useState<WatchItemType>("flight");
  const [title, setTitle] = useState(DEFAULT_TITLES.flight);
  const [memo, setMemo] = useState("");
  const [paramsJson, setParamsJson] = useState(sampleParams("flight"));

  function handleTypeChange(nextType: WatchItemType) {
    setType(nextType);
    setTitle(DEFAULT_TITLES[nextType]);
    setParamsJson(sampleParams(nextType));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreate({
      type,
      title,
      paramsJson,
      memo: memo.trim() ? memo.trim() : undefined
    });
  }

  return (
    <form className="grid gap-4 rounded-md border border-line bg-white p-4" onSubmit={handleSubmit}>
      <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
        <label className="form-field">
          <span className="form-label">유형</span>
          <select className="form-input" value={type} onChange={(event) => handleTypeChange(event.target.value as WatchItemType)}>
            <option value="flight">항공권</option>
            <option value="express_bus">고속버스</option>
            <option value="intercity_bus">시외버스</option>
            <option value="ticket">공연</option>
            <option value="foresttrip">자연휴양림</option>
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">제목</span>
          <input className="form-input" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </label>
      </div>

      <label className="form-field">
        <span className="form-label">조건 JSON</span>
        <textarea
          className="form-input min-h-44 resize-y font-mono text-sm"
          value={paramsJson}
          spellCheck={false}
          onChange={(event) => setParamsJson(event.target.value)}
        />
      </label>

      <label className="form-field">
        <span className="form-label">메모</span>
        <textarea className="form-input min-h-20 resize-y" value={memo} maxLength={1000} onChange={(event) => setMemo(event.target.value)} />
      </label>

      <div>
        <button className="action-button" type="submit" disabled={busy || !title.trim()}>
          관심 조건 저장
        </button>
      </div>
    </form>
  );
}
