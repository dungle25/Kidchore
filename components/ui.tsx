import type { ReactNode } from "react";

/**
 * Small shared presentation pieces.
 *
 * These exist so that empty and error states look the same everywhere, instead of
 * each screen inventing its own placeholder. Replacing the old demo-data fallbacks
 * is the whole point: when there is no data we say so plainly rather than showing
 * invented chores.
 */

export function StatCard({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "slate" | "violet" | "green" | "amber" | "blue";
}) {
  const tones: Record<string, string> = {
    slate: "border-l-slate-400",
    violet: "border-l-violet-500",
    green: "border-l-green-500",
    amber: "border-l-amber-500",
    blue: "border-l-blue-500",
  };

  return (
    <div
      className={`rounded-xl border border-slate-200 border-l-4 ${tones[tone]} bg-white p-4 shadow-sm`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  icon = "📭",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-3xl" aria-hidden>
        {icon}
      </p>
      <p className="mt-2 font-semibold text-slate-700">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
    >
      {message}
    </p>
  );
}

export function SuccessNote({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
    >
      {message}
    </p>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <div>
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {description && <p className="text-xs text-slate-400">{description}</p>}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Formats a points value with a sign, so adjustments read correctly. */
export function formatPoints(amount: number): string {
  return `${amount > 0 ? "+" : ""}${amount} điểm`;
}

/**
 * Formats a timestamp in the family's locale and timezone.
 *
 * Re-exported rather than reimplemented: the screens import it from here, and the
 * implementation lives in `lib/format-date.ts` where it can be tested without a browser.
 */
export { formatDateTime } from "@/lib/format-date";

/** Human-friendly stock label, honouring -1 as unlimited. */
export function formatStock(stock: number): string {
  return stock === -1 ? "Không giới hạn" : `${stock} phần`;
}
