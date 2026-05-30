export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-5">
      <div className="text-sm font-black text-slate-800">{title}</div>
      {description ? <p className="mt-1 text-sm font-medium text-slate-600">{description}</p> : null}
    </div>
  );
}
