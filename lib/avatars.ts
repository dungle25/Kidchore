/**
 * Avatars a child can pick.
 *
 * Emoji rather than image files, on purpose:
 *
 *  - no upload, so no bucket and no Server Action to write one;
 *  - no binary assets in the repository, so nothing to keep in sync;
 *  - they render everywhere, including on a tablet with no network;
 *  - a child picking a dinosaur is more fun than a parent cropping a photo, and the
 *    parent does not have to find one.
 *
 * The stored value is the **key**, not the emoji. That way the artwork can change without
 * migrating rows, and a future "upload a photo" feature can store an https URL in the
 * same column - `avatarOf` below already understands both.
 *
 * Pure and free of React so the list can be checked from Node.
 */

export interface AvatarChoice {
  /** Stored on the row, and the only part that is a contract. */
  key: string;
  emoji: string;
  /** Vietnamese, because a parent reads this out to a child. */
  label: string;
}

export const AVATAR_CHOICES: readonly AvatarChoice[] = [
  { key: "fox", emoji: "🦊", label: "Cáo" },
  { key: "panda", emoji: "🐼", label: "Gấu trúc" },
  { key: "tiger", emoji: "🐯", label: "Hổ" },
  { key: "lion", emoji: "🦁", label: "Sư tử" },
  { key: "monkey", emoji: "🐵", label: "Khỉ" },
  { key: "koala", emoji: "🐨", label: "Koala" },
  { key: "frog", emoji: "🐸", label: "Ếch" },
  { key: "penguin", emoji: "🐧", label: "Cánh cụt" },
  { key: "octopus", emoji: "🐙", label: "Bạch tuộc" },
  { key: "whale", emoji: "🐳", label: "Cá voi" },
  { key: "unicorn", emoji: "🦄", label: "Kỳ lân" },
  { key: "dino", emoji: "🦖", label: "Khủng long" },
  { key: "rocket", emoji: "🚀", label: "Tên lửa" },
  { key: "star", emoji: "⭐", label: "Ngôi sao" },
  { key: "rainbow", emoji: "🌈", label: "Cầu vồng" },
  { key: "ball", emoji: "⚽", label: "Quả bóng" },
];

/** What a child with no avatar yet shows. */
export const DEFAULT_AVATAR = "🙂";

/**
 * What to actually draw.
 *
 * Handles the three shapes the column can hold, in the order they arrived: nothing, a
 * preset key, or an https URL from a future upload feature. An unknown key falls back to
 * the default rather than rendering the raw key as text - a child seeing "fox" next to
 * their name is a bug, not a fallback.
 */
export function avatarOf(value: string | null | undefined): { kind: "emoji" | "image"; value: string; label: string } {
  const raw = (value ?? "").trim();
  if (!raw) return { kind: "emoji", value: DEFAULT_AVATAR, label: "Chưa chọn" };

  if (isImageAvatar(raw)) return { kind: "image", value: raw, label: "Ảnh" };

  const choice = AVATAR_CHOICES.find((item) => item.key === raw);
  if (choice) return { kind: "emoji", value: choice.emoji, label: choice.label };

  return { kind: "emoji", value: DEFAULT_AVATAR, label: "Chưa chọn" };
}

/** True for anything that can go straight into `<img src>`. */
export function isImageAvatar(value: string | null | undefined): boolean {
  return /^https:\/\/[^\s]+$/i.test((value ?? "").trim());
}

/** True when the stored value is one of the presets above. */
export function isPresetAvatar(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim();
  return AVATAR_CHOICES.some((item) => item.key === raw);
}
