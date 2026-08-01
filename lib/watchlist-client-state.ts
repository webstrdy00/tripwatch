import type { WatchItemListItem } from "@/lib/watchlist";

export function replaceWatchItemById(
  items: readonly WatchItemListItem[],
  replacement: WatchItemListItem
): WatchItemListItem[] {
  let matches = 0;

  for (const item of items) {
    if (item.id === replacement.id) {
      matches += 1;
    }
  }

  if (matches !== 1) {
    throw new Error(`Expected exactly one watch item with id ${replacement.id}; found ${matches}.`);
  }

  return items.map((item) => (item.id === replacement.id ? replacement : item));
}
