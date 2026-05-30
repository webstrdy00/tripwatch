import { Nav } from "@/components/layout/Nav";
import { SAFETY_NOTICE, SERVICE_NAME } from "@/lib/constants";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 sm:px-6 lg:px-8">
          <Nav />
          <div className="text-xs font-semibold text-slate-500">{SERVICE_NAME} v0.1 skeleton</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          {SAFETY_NOTICE}
        </div>
        {children}
      </main>
    </div>
  );
}
