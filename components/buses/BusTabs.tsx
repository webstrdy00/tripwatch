"use client";

import { useState } from "react";

import { BusSearchForm } from "@/components/buses/BusSearchForm";
import type { BusKind } from "@/lib/normalize/normalize-bus";

const TABS: Array<{ kind: BusKind; label: string }> = [
  { kind: "express", label: "고속버스" },
  { kind: "intercity", label: "시외버스" }
];

export function BusTabs() {
  const [activeKind, setActiveKind] = useState<BusKind>("express");

  return (
    <section className="grid gap-4">
      <div className="grid max-w-md grid-cols-2 rounded-md border border-line bg-panel p-1">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            className={`min-h-10 rounded px-3 py-2 text-center text-sm font-black ${
              activeKind === tab.kind ? "bg-white text-accent shadow-sm" : "text-slate-600"
            }`}
            type="button"
            onClick={() => setActiveKind(tab.kind)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <BusSearchForm key={activeKind} kind={activeKind} />
    </section>
  );
}
