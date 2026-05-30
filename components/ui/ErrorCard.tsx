export function ErrorCard({ title = "실패 상태 placeholder", message }: { title?: string; message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <div className="font-black">{title}</div>
      <p className="mt-1 font-medium">{message}</p>
    </div>
  );
}
