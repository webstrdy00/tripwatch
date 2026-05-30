import Link from "next/link";

import { APP_NAME, NAV_ITEMS } from "@/lib/constants";

export function Nav() {
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="주요 메뉴">
      <Link href="/dashboard" className="mr-2 text-base font-black text-ink">
        {APP_NAME}
      </Link>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-md px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
