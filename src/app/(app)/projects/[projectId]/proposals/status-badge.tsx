export function StatusBadge({ status }: { status: "open" | "merged" | "closed" }) {
  const styles = {
    open: "bg-accent-soft text-accent",
    merged: "bg-success/15 text-success",
    closed: "bg-surface-sunken text-ink-tertiary",
  }[status];
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${styles}`}>{status}</span>
  );
}
