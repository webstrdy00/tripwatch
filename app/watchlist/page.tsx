import { WatchlistTable } from "@/components/watchlist/WatchlistTable";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { SAFETY_NOTICE } from "@/lib/constants";
import { db } from "@/lib/db";
import { summarizeError } from "@/lib/errors";
import { serializeWatchItems, type WatchItemListItem } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

const watchItemInclude = {
  results: {
    orderBy: [
      {
        checkedAt: "desc" as const
      },
      {
        createdAt: "desc" as const
      },
      {
        id: "desc" as const
      }
    ],
    take: 1
  }
};

async function getWatchItems(): Promise<{ items: WatchItemListItem[]; error?: string }> {
  try {
    const items = await db.watchItem.findMany({
      orderBy: {
        updatedAt: "desc"
      },
      include: watchItemInclude
    });

    return {
      items: serializeWatchItems(items)
    };
  } catch (error) {
    return {
      items: [],
      error: summarizeError(error)
    };
  }
}

export default async function WatchlistPage() {
  const { items, error } = await getWatchItems();

  return (
    <div className="grid gap-5">
      <PageTitle title="관심 조건" description="저장한 항공권, 버스, 공연, 자연휴양림 조건을 관리합니다." />
      {error ? <ErrorCard title="관심 조건을 불러오지 못했습니다." message={error} /> : null}
      <WatchlistTable initialItems={items} />
      <p className="text-sm font-semibold text-slate-700">{SAFETY_NOTICE}</p>
    </div>
  );
}

function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-line pb-4">
      <h1 className="text-2xl font-black tracking-normal text-ink">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm font-medium text-slate-600">{description}</p>
    </div>
  );
}
