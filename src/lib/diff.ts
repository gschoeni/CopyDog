/**
 * Minimal line diff (LCS-based) for proposal reviews. Copy files are small,
 * so O(n·m) is fine and the output maps directly to added/removed rows.
 */

export type DiffLine =
  | { kind: "same"; text: string }
  | { kind: "added"; text: string }
  | { kind: "removed"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // LCS table
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "added", text: b[j]! });
      j++;
    }
  }
  while (i < m) out.push({ kind: "removed", text: a[i++]! });
  while (j < n) out.push({ kind: "added", text: b[j++]! });
  return out;
}

export function hasChanges(diff: DiffLine[]): boolean {
  return diff.some((line) => line.kind !== "same");
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normalized === "" ? [] : normalized.split("\n");
}
