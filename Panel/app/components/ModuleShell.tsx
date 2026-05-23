/**
 * ModuleShell — wrapper visuel partagé par tous les outils Aegis.
 *
 * Donne à chaque module la même structure :
 *   <ModuleShell title="…" icon={Icon} description="…" actions={<…/>}>
 *     <Section title="Sous-titre">…</Section>
 *     …
 *   </ModuleShell>
 *
 * Inclut :
 *   - une carte glass header avec icône à gauche, titre/description, actions à droite
 *   - une zone de contenu animée (fade-in)
 *   - sous-composants utilitaires : Section, Card, Stat, KBD
 */
import { type ReactNode } from 'react';

interface ModuleShellProps {
  title: string;
  description?: string;
  icon?: any;
  iconTone?: 'primary' | 'emerald' | 'amber' | 'rose' | 'sky';
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

const TONE_BG: Record<NonNullable<ModuleShellProps['iconTone']>, string> = {
  primary: 'bg-primary/15 border-primary/30 text-primary',
  emerald: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
  amber:   'bg-amber-500/15 border-amber-500/30 text-amber-400',
  rose:    'bg-rose-500/15 border-rose-500/30 text-rose-400',
  sky:     'bg-sky-500/15 border-sky-500/30 text-sky-400',
};

export function ModuleShell({
  title, description, icon: Icon, iconTone = 'primary',
  badge, actions, children,
}: ModuleShellProps) {
  return (
    <div className="space-y-6 aegis-fade-in">
      {/* Header */}
      <div className="aegis-card aegis-card-edge px-6 py-5 flex items-center gap-4 flex-wrap">
        {Icon && (
          <div className={`w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0 ${TONE_BG[iconTone]}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">{title}</h1>
            {badge}
          </div>
          {description && <p className="text-muted-foreground text-sm mt-0.5">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      {/* Content */}
      <div className="space-y-5">{children}</div>
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────
interface SectionProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Use `flat` to skip the card chrome (just title + content). */
  flat?: boolean;
  className?: string;
}

export function Section({ title, description, actions, children, flat, className }: SectionProps) {
  if (flat) {
    return (
      <div className={className || ''}>
        {(title || actions) && (
          <div className="flex items-end justify-between mb-3">
            <div>
              {title && <h2 className="text-foreground text-sm font-semibold">{title}</h2>}
              {description && <p className="text-muted-foreground text-xs mt-0.5">{description}</p>}
            </div>
            {actions}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div className={`aegis-card aegis-card-edge overflow-hidden ${className || ''}`}>
      {(title || actions) && (
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between gap-3">
          <div>
            {title && <h2 className="text-foreground text-sm font-semibold">{title}</h2>}
            {description && <p className="text-muted-foreground text-xs mt-0.5">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Stat tile ───────────────────────────────────────────────────────────────
interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: any;
  trend?: 'up' | 'down' | 'flat';
  tone?: NonNullable<ModuleShellProps['iconTone']>;
}

export function Stat({ label, value, hint, icon: Icon, tone = 'primary', trend }: StatProps) {
  const trendColor = trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-rose-400' : 'text-muted-foreground';
  return (
    <div className="aegis-card aegis-card-edge p-5 group hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${TONE_BG[tone]}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
      <p className="text-foreground text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <p className={`text-xs mt-1 ${trendColor}`}>{hint}</p>}
    </div>
  );
}

// ── Keyboard hint ───────────────────────────────────────────────────────────
export function KBD({ children }: { children: ReactNode }) {
  return <kbd className="aegis-kbd">{children}</kbd>;
}
