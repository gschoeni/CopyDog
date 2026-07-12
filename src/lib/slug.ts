const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Lowercase, hyphen-separated, ascii-safe slug of a human name. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

/** Short random suffix to make repo names unique within the Oxen namespace. */
export function shortId(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length]).join("");
}
