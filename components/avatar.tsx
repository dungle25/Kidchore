import { avatarOf } from "@/lib/avatars";

/**
 * A child's avatar, wherever one is shown.
 *
 * One component rather than the same `avatar_url ? <img> : 🙂` in three places, because
 * the column can now hold three different things - nothing, a preset key, or an image URL
 * - and a fourth place that gets the fallback wrong shows a child the word "fox" instead
 * of a fox.
 *
 * `size` is in pixels and drives the emoji size too, so a caller cannot end up with a big
 * circle and a tiny animal in it.
 */
export default function Avatar({
  value,
  size = 36,
  className = "",
}: {
  value: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const avatar = avatarOf(value);

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-100 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      {avatar.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar.value}
          alt={`Ảnh đại diện: ${avatar.label}`}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{avatar.value}</span>
      )}
    </span>
  );
}
