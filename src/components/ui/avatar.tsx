/**
 * A person's face, everywhere people appear: the real profile photo when
 * OAuth gave us one, otherwise their initial on a muted hue picked by
 * hashing their user id — same person, same color, in light and dark
 * (the theme owns lightness/chroma via --avatar-* tokens in globals.css).
 *
 * Avatars are decoration: always `aria-hidden`, with the person's name
 * rendered as text beside them by the caller.
 */

const AVATAR_HUES = [25, 70, 115, 160, 205, 250, 295, 340] as const;

/** Deterministic muted hue for a user id — same person, same color. */
export function avatarHue(userId: string): number {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]!;
}

/** The letter an avatar falls back to: first character of the name. */
export function avatarInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function Avatar({
  userId,
  name,
  avatarUrl,
  className = "size-6 text-[11px]",
}: {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  /** Sizing + type scale live together — pass both when overriding. */
  className?: string;
}) {
  if (avatarUrl) {
    return (
      // remote OAuth photos come from arbitrary provider hosts; next/image
      // needs each host allowlisted and these are tiny decorative circles
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  const hue = avatarHue(userId);
  return (
    <span
      aria-hidden
      style={{
        backgroundColor: `oklch(var(--avatar-l) var(--avatar-c) ${hue})`,
        color: `oklch(var(--avatar-fg-l) var(--avatar-fg-c) ${hue})`,
      }}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${className}`}
    >
      {avatarInitial(name)}
    </span>
  );
}
