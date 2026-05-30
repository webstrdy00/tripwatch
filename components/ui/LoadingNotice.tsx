export function LoadingNotice({ message = "외부 조회는 아직 구현하지 않은 placeholder입니다." }: { message?: string }) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-900">{message}</div>
  );
}
