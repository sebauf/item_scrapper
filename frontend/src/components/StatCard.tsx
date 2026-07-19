export interface StatCardProps {
  value: number | string;
  label: string;
  icon: string;
  accent?: string;
}

export function StatCard({ value, label, icon, accent = 'text-foreground' }: StatCardProps) {
  return (
    <div className="bg-surface rounded-2xl border border-border px-4 py-4 flex items-center gap-3">
      <span className="text-2xl shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className={`text-base sm:text-2xl font-bold leading-tight truncate ${accent}`}>{value}</p>
        <p className="text-xs text-muted mt-0.5 truncate">{label}</p>
      </div>
    </div>
  );
}
