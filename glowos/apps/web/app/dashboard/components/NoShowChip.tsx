export function NoShowChip({ count, compact = false }: { count: number; compact?: boolean }) {
  if (!count || count <= 0) return null;
  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-semantic-danger/30 bg-semantic-danger/5 text-semantic-danger"
        title={`${count} prior no-show${count > 1 ? 's' : ''}`}
      >
        ⚠ {count}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-semantic-danger/30 bg-semantic-danger/5 text-semantic-danger">
      ⚠ {count} no-show{count > 1 ? 's' : ''}
    </span>
  );
}
