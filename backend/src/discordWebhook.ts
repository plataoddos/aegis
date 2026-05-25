// ── Discord webhook notifier (Fiches) ───────────────────────────────────────
// Sends a minimalist embed to a Discord channel when a Fiche is created.
// URL can be overridden with PERSONS_WEBHOOK_URL env var.

import type { Person } from './db.js';

const DEFAULT_WEBHOOK =
  'https://discord.com/api/webhooks/1507545847271919666/1sn1yuZHEy0jcBxcL6LZ0fYIFxib2GSKXcIwHPwY24MzY5zbcIfFpClM3WW4Q7oIpN4Z';

const WEBHOOK_URL = process.env.PERSONS_WEBHOOK_URL || DEFAULT_WEBHOOK;

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Fire-and-forget : never throws, never blocks the caller.
 * Logs failures but lets the API response proceed normally.
 */
export function notifyPersonCreated(p: Person): void {
  if (!WEBHOOK_URL) return;

  const fields: { name: string; value: string; inline?: boolean }[] = [];

  const dob = fmtDate(p.date_naissance);
  if (dob)         fields.push({ name: 'Naissance', value: dob,          inline: true });
  if (p.ville)     fields.push({ name: 'Ville',     value: p.ville,      inline: true });
  if (p.categorie) fields.push({ name: 'Catégorie', value: p.categorie,  inline: true });

  const embed = {
    title: `${p.prenom} ${p.nom}`.trim(),
    description: '`+` Nouvelle fiche enregistrée',
    color: 0x6366f1, // indigo-500 — matches Aegis primary
    fields: fields.length ? fields : undefined,
    footer: { text: `Aegis · Fiches · #${p.id}` },
    timestamp: new Date(p.created_at).toISOString(),
  };

  const payload = {
    username: 'Aegis Fiches',
    embeds: [embed],
  };

  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(r => {
      if (!r.ok) {
        r.text().then(t => console.warn('[discordWebhook] HTTP', r.status, t.slice(0, 200)));
      }
    })
    .catch(err => console.warn('[discordWebhook] error:', err?.message || err));
}
