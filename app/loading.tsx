/**
 * Loading state.
 *
 * Skeletons rather than a spinner, so the layout does not jump when content
 * arrives. Most screens here are a header plus a few cards.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Đang tải…</span>

      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
          />
        ))}
      </div>

      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white"
          />
        ))}
      </div>
    </div>
  );
}
