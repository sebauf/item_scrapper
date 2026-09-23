import type { ComponentStatus, ComponentVersion } from '@/lib/api';
import { shortDigest } from '@/lib/format';

/** Libellés d'affichage des Deployments ; un nom inconnu s'affiche tel quel. */
const LABELS: Record<string, string> = {
  'price-tracker-frontend': 'Frontend',
  'price-tracker-backend': 'API (backend)',
  'price-tracker-mcp': 'Serveur MCP',
  'airflow-webserver': 'Airflow — interface',
  'airflow-scheduler': 'Airflow — scheduler',
};

const STATUS_STYLES: Record<ComponentStatus, { label: string; className: string }> = {
  'up-to-date': { label: 'À jour', className: 'bg-deal-soft text-deal border-deal-border' },
  outdated: { label: 'Nouvelle version', className: 'bg-warn-soft text-warn border-warn-border' },
  updating: { label: 'Redémarrage…', className: 'bg-accent-soft text-accent border-accent/30' },
  unknown: { label: 'Inconnu', className: 'bg-surface-hover text-muted border-border' },
};

export function ComponentVersionList({ components }: { components: ComponentVersion[] }) {
  return (
    <ul className="divide-y divide-border-subtle">
      {components.map((component) => {
        const style = STATUS_STYLES[component.status];
        return (
          <li key={component.name} className="px-5 py-4 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{LABELS[component.name] ?? component.name}</p>
              <p className="text-xs text-faint truncate" title={component.image}>
                {component.image}
              </p>
              <p className="text-xs text-muted mt-1 font-mono">
                {shortDigest(component.runningDigest)}
                {component.status === 'outdated' && <> → {shortDigest(component.latestDigest)}</>}
              </p>
            </div>
            <span
              className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${style.className}`}
            >
              {style.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
