/**
 * Helpers partagés entre les sous-pages "Compte".
 */
export function fmtDate(ts: number | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function daysLeft(until: number | null): number | null {
  if (!until) return null;
  const ms = until - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400_000) : 0;
}
