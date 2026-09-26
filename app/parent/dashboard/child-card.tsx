"use client";

import { useState, useTransition } from "react";
import { adjustPoints } from "@/app/actions/family-actions";
import type { ParentChild } from "@/lib/domain";

/** The amounts offered as one-tap awards, mirrored as one-tap penalties. */
const AMOUNTS = [1, 3, 5] as const;

/** Used to decide whether a penalty can push this child below zero. */
const LARGEST_AMOUNT = AMOUNTS[AMOUNTS.length - 1];

/** Which control was tapped, so only that button shows the pending state. */
type TapKind = "AWARD" | "PENALTY" | "UNDO";

interface Tap {
  kind: TapKind;
  amount: number;
}

interface Feedback {
  text: string;
  ok: boolean;
  /** Points to hand back, set only right after a successful penalty. */
  undoAmount: number | null;
}

/**
 * A child's card on the parent dashboard, with quick bonus and quick penalty.
 *
 * The quick buttons cover the everyday case the chore flow does not: something worth
 * recognising — or worth taking points away for — happens on the spot, and a parent
 * should not have to invent a task to record it.
 *
 * Both directions reuse `adjust_points`, so every tap lands in `point_transactions` as a
 * MANUAL_ADJUSTMENT with a readable reason. A penalty is therefore an auditable act
 * rather than an unexplained drop in the child's balance.
 *
 * A penalty is never refused and never trimmed. Points may go negative, because a child
 * with nothing left to take is exactly the child a parent most often needs to penalise,
 * and a punishment is the family's decision rather than something the app gets to
 * overrule. Migration 0010 dropped `CHECK (points_balance >= 0)` for that reason, so the
 * deduction is recorded in full and the balance becomes "điểm nợ" the child works off.
 * Clamping was rejected on purpose: quietly turning a tapped "-5" into "-3" would write
 * an audit line that does not match what the parent asked for, which is the hole
 * CONVENTIONS.md §1.3 closes. Refusing the tap was rejected because it leaves the
 * punishment unrecorded — the worst of both worlds.
 *
 * Because the tap always lands, the card owes the parent the consequence before it
 * happens: the penalty row warns when a deduction would cross zero, the badge turns into
 * "Nợ N điểm", and the result says how deep the debt now is.
 *
 * No reason is required, to keep "phạt nhanh" quick, and the trade-off is real: the
 * history line says what happened, not why. The fuller form on the Gia đình screen stays
 * the place for a deduction that needs an explanation the child can read.
 *
 * Because a one-tap penalty is easy to fire by accident on a shared tablet, the penalty
 * row is separated from the award row by colour, glyph and a rule, and every penalty can
 * be taken back with one more tap. The undo adds a compensating transaction instead of
 * rewriting the log, so a mistake stays visible in the audit trail.
 *
 * The whole card is a client component rather than just the buttons, so the displayed
 * balance reflects a tap immediately. That number comes from the database's answer to
 * the call, not from local arithmetic, so a second parent spending the same points on
 * another device cannot leave this card showing a balance the child never had.
 */
export default function ChildCard({ child }: { child: ParentChild }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Tap | null>(null);
  const [balance, setBalance] = useState(child.points_balance);
  const [result, setResult] = useState<Feedback | null>(null);

  /**
   * Sends one signed adjustment and reflects the database's answer.
   *
   * The displayed balance moves only after the call succeeds, and takes the value the
   * database returned; a refused tap must not move the number, or the card would show
   * points the child does not have.
   */
  function submit(
    tap: Tap,
    signedAmount: number,
    description: string,
    successText: (newBalance: number) => string,
    undoAmount: number | null = null
  ) {
    setBusy(tap);
    setResult(null);

    startTransition(async () => {
      const response = await adjustPoints({
        childId: child.id,
        amount: signedAmount,
        description,
      });
      setBusy(null);

      if (!response.ok) {
        setResult({
          text: response.error ?? "Không thực hiện được.",
          ok: false,
          undoAmount: null,
        });
        return;
      }

      setBalance(response.balance);
      setResult({ text: successText(response.balance), ok: true, undoAmount });
    });
  }

  function award(amount: number) {
    submit(
      { kind: "AWARD", amount },
      amount,
      `Thưởng nhanh +${amount} điểm`,
      () => `Đã thưởng ${amount} điểm cho ${child.display_name}.`
    );
  }

  function penalise(amount: number) {
    submit(
      { kind: "PENALTY", amount },
      -amount,
      `Phạt nhanh -${amount} điểm`,
      (newBalance) =>
        newBalance < 0
          ? `Đã trừ ${amount} điểm của ${child.display_name}. Bé đang nợ ${Math.abs(newBalance)} điểm.`
          : `Đã trừ ${amount} điểm của ${child.display_name}.`,
      amount
    );
  }

  function undoPenalty(amount: number) {
    submit(
      { kind: "UNDO", amount },
      amount,
      `Hoàn tác phạt nhanh +${amount} điểm`,
      () => `Đã trả lại ${amount} điểm cho ${child.display_name}.`
    );
  }

  const busyAward = busy?.kind === "AWARD" ? busy.amount : null;
  const busyPenalty = busy?.kind === "PENALTY" ? busy.amount : null;
  const undoAmount = result?.undoAmount ?? null;
  const inDebt = balance < 0;

  /** States what a penalty does to a small or already negative balance, before the tap. */
  const debtWarning = inDebt
    ? `Bé đang nợ ${Math.abs(balance)} điểm — phạt thêm sẽ cộng vào khoản nợ.`
    : balance === 0
      ? "Bé đang có 0 điểm — phạt sẽ thành điểm nợ (âm điểm)."
      : `Bé chỉ còn ${balance} điểm — phạt quá ${balance} điểm sẽ thành điểm nợ (âm điểm).`;

  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-800">{child.display_name}</p>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            inDebt ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
          }`}
        >
          {inDebt ? `Nợ ${Math.abs(balance)} điểm` : `${balance} điểm`}
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Đã hoàn thành {child.approved_total} việc
        {child.pending_review > 0 && (
          <>
            {" · "}
            <span className="font-medium text-blue-600">
              {child.pending_review} chờ duyệt
            </span>
          </>
        )}
      </p>

      {!child.can_sign_in && (
        <p className="mt-2 text-xs font-medium text-amber-700">
          ⚠️ Bé chưa đăng nhập được — vào mục Gia đình để sửa.
        </p>
      )}

      {/* mt-auto keeps both action rows aligned across cards of different heights. */}
      <div className="mt-auto pt-3">
        {/* Awards come first: giving points is the everyday act, taking them away is the
            exception. The two rows keep separate colours and glyphs so a hasty tap on a
            shared tablet cannot land in the wrong one. */}
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-xs font-semibold text-green-700">Thưởng nhanh</span>
          <div className="flex gap-1.5">
            {AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => award(amount)}
                disabled={pending}
                aria-label={`Thưởng ${amount} điểm cho ${child.display_name}`}
                className="min-w-[2.75rem] rounded-lg border border-green-300 bg-green-50 px-2 py-1.5 text-sm font-bold text-green-800 transition hover:bg-green-100 disabled:opacity-50"
              >
                {busyAward === amount ? "…" : `+${amount}`}
              </button>
            ))}
          </div>
        </div>

        {/* Never disabled: the amount is always deductable, even into debt. */}
        <div className="mt-3 flex items-center gap-2 border-t border-red-100 pt-3">
          <span className="text-xs font-semibold text-red-700">Phạt nhanh</span>
          <div className="flex gap-1.5">
            {AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => penalise(amount)}
                disabled={pending}
                aria-label={`Trừ ${amount} điểm của ${child.display_name}`}
                className="min-w-[2.75rem] rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
              >
                {busyPenalty === amount ? "…" : `−${amount}`}
              </button>
            ))}
          </div>
        </div>

        {/* Shown before a tap that would cross zero, so a debt is never a surprise. */}
        {balance < LARGEST_AMOUNT && (
          <p className="mt-2 text-xs font-medium text-amber-700">{debtWarning}</p>
        )}

        {result && (
          <p
            role="status"
            className={`mt-2 text-xs font-medium ${
              result.ok ? "text-green-700" : "text-red-700"
            }`}
          >
            {result.text}
            {undoAmount !== null && (
              <button
                type="button"
                onClick={() => undoPenalty(undoAmount)}
                disabled={pending}
                className="ml-2 font-semibold text-red-700 underline underline-offset-2 disabled:opacity-50"
              >
                Hoàn tác
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
