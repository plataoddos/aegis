<!--
═══════════════════════════════════════════════════════════════════════════════
  AEGIS — Audit de sécurité
  Date initiale  : 2026-05-25
  Mise à jour    : 2026-05-25 (post-remédiation)
  Scope          : backend Express/SQLite + Panel React + WS + intégration BrixHub
═══════════════════════════════════════════════════════════════════════════════
-->

# 🛡️ Aegis — Audit de sécurité

> Revue manuelle du code (backend + panel + WS), des dépendances et de la configuration.
>
> **Statut après remédiation : `BON`**
> 11/14 findings corrigés ; reste 1 risque structurel (selfbot Discord = ToS) et
> 1 amélioration long terme (cookies HttpOnly à la place du Bearer en localStorage).

---

## 📊 Synthèse

| Sévérité   | Initial | Corrigé | Restant | Domaines principaux |
|:-----------|:-------:|:-------:|:-------:|:--------------------|
| 🔴 Critique |   0    |   0    |   0    | —                   |
| 🟠 Haute    |   3    |   2    |   1    | brute-force ✅, secrets selfbot chiffrés ✅, ToS Discord ⚠️ |
| 🟡 Moyenne  |   6    |   5    |   1    | helmet ✅, mdp ✅, CSRF ✅, logs ✅, CORS prod ✅, localStorage ⚠️ |
| 🔵 Basse    |   5    |   4    |   1    | session sliding ✅, UX expired ✅, parseId ✅, IPv6 strict ✅, README ✅ |
| ✅ Bons points | 10  |  +5    |   —    | + chiffrement at-rest, rate-limit, CSP-ready, slid. session, parseId |

---

## 🟢 Corrigés dans cette release

### ✅ H-01 — Rate-limit anti brute-force
**Fix** : `express-rate-limit` sur `/login` (10/15 min/IP), `/signup` (5/h/IP), `/redeem` (20/15 min/IP).
**Fichier** : `backend/src/auth.ts` · `loginLimiter`, `signupLimiter`, `redeemLimiter`
**Bonus** : `app.set('trust proxy', 1)` pour lire `X-Forwarded-For` derrière nginx/Cloudflare.

### ✅ H-02 — Tokens selfbot Discord chiffrés au repos (AES-256-GCM)
**Fix** : nouveau module `secretCrypto.ts` — chiffrement AES-256-GCM avec
`MASTER_KEY` (env, hex/base64) ou clé auto-générée persistée dans
`backend/data/.master_key` (chmod 600). Les anciennes lignes en clair sont
**ré-écrites chiffrées au premier read** (transparente).
**Fichiers** : `backend/src/secretCrypto.ts`, `backend/src/db.ts` (`tokens.add/get/list`)

### ✅ M-02 — `helmet` + reverse-proxy trust
**Fix** : `app.use(helmet({ … }))` ajoute X-CT-O, Referrer-Policy, Strict-Transport-Security,
X-Frame-Options. CSP délégué au panel (meta).
**Fichier** : `backend/src/index.ts`

### ✅ M-03 — Politique de mot de passe durcie
**Fix** : minimum **10 caractères**, au moins **3 classes** parmi
{minuscules, majuscules, chiffres, symboles}, blacklist top-30 des mots de passe
faibles (`password`, `azerty`, `aegis123`…), interdiction du nom d'utilisateur dans le mot de passe.
Appliqué aussi sur `/change-password`.
**Fichier** : `backend/src/auth.ts` · `validatePasswordStrength`
**Panel** : `AccountSecurity.tsx`, `AuthPage.tsx` mis à jour pour cohérence UX.

### ✅ M-05 — Logs scrubbés (anti-leak PII)
**Fix** : les erreurs upstream BrixHub n'écrivent plus le `data` brut dans les logs.
Seuls `status`, `message` (≤ 200 chars) et `error_type` sont préservés.
**Fichier** : `backend/src/seek.ts`

### ✅ M-06 — Boot guard production
**Fix** : si `NODE_ENV=production` et `ALLOWED_ORIGINS` n'est pas défini,
le serveur affiche `[fatal]` et `process.exit(1)` immédiatement.
**Fichier** : `backend/src/index.ts`

### ✅ L-01 — Sliding-refresh des sessions
**Fix** : `requireUser` étend l'expiration à `now + 24 h` à chaque requête authentifiée
(throttlé à 1×/min/token pour éviter les writes inutiles).
**Fichier** : `backend/src/auth.ts` (+ `sessions.touch` dans `db.ts`)

### ✅ L-02 — Toast UX sur session expirée
**Fix** : `AuthProvider` écoute `aegis:auth-expired` et affiche un toast
*"Session expirée — Reconnecte-toi pour continuer."* (uniquement si l'utilisateur
était bien authentifié, pour éviter le spam sur le login screen).
**Fichier** : `Panel/app/lib/auth.tsx`

### ✅ L-03 — `parseId()` strict
**Fix** : helper `parseId(raw)` rejette `42abc`, `-1`, `0`, NaN. Appliqué à tous les
endpoints `/accounts/:id`, `/persons/:id`, `/admin/users/:id`.
**Fichiers** : `backend/src/api.ts`, `backend/src/auth.ts`

### ✅ L-04 — Validation IP stricte (RFC-compliant)
**Fix** : remplacé `/^[0-9a-f:]+$/i` par un couple `IPV4_RX` (octets 0–255) +
`IPV6_RX` (8 groupes, `::` compactage, IPv4-mapped `::ffff:1.2.3.4`).
**Fichier** : `backend/src/api.ts` · `isValidIp`

### ✅ L-05 — README
**Fix** : voir `README.md` à la racine.

---

## 🟠 Risques restants

### ⚠️ H-03 — Module Discord Watcher = violation ToS Discord
**Statut** : *non corrigeable techniquement, documenté.*
**Mesures déjà en place** :
- Avertissement dans `.env.example`, dans le README et dans le disclaimer du panel.
- Recommandation : ne brancher que des comptes throwaway.
- Possibilité future : flag global `WATCHER_DISABLED=1` pour les déploiements publics.

### ⚠️ M-01 — Session token en `localStorage` (XSS persistant)
**Statut** : *atténué mais non éliminé.*
**Atténuations en place** :
- `helmet` ajoute des headers (X-CT-O, X-Frame-Options).
- Aucune utilisation de `dangerouslySetInnerHTML`, `eval`, `Function()` (vérifié par grep).
- Sliding refresh + sessions révocables côté serveur.

**Non corrigé** : la migration vers `Set-Cookie: HttpOnly; Secure; SameSite=Strict`
demande de réécrire le flux d'auth (CSRF tokens, gestion WebSocket) — chantier d'½ journée
réservé à une release dédiée.

---

## ✅ Bonnes pratiques en place (post-remédiation)

| # | Mesure | Fichier |
|---|--------|---------|
| 1 | Toutes les requêtes SQL utilisent des **prepared statements** paramétrés | `backend/src/db.ts` |
| 2 | Mots de passe hashés avec **scrypt + salt 16 b** + `timingSafeEqual` | `backend/src/auth.ts` |
| 3 | Mots de passe : ≥10 chars, 3 classes, blacklist faibles, anti-username | `backend/src/auth.ts` |
| 4 | Sessions stockées **côté serveur** + sliding refresh + révocables | `backend/src/auth.ts`, `db.ts` |
| 5 | **Quotas par utilisateur** appliqués serveur-side | `backend/src/api.ts` |
| 6 | **Per-user data isolation** (`persons`, `watches` filtrés par `created_by`) | `backend/src/api.ts` |
| 7 | **CORS allow-list** explicite, refuse de booter en prod sans config | `backend/src/index.ts` |
| 8 | Validation stricte des **snowflakes Discord**, **IDs**, **IPs** | `api.ts`, `auth.ts` |
| 9 | **Rate-limit** sur `/login`, `/signup`, `/redeem` | `backend/src/auth.ts` |
| 10 | **`helmet`** : HSTS, X-CT-O, Referrer-Policy, X-Frame-Options | `backend/src/index.ts` |
| 11 | **Aucun** `eval` / `Function()` / `dangerouslySetInnerHTML` | grep global |
| 12 | API key BrixHub **jamais exposée au client** (proxy backend) | `backend/src/seek.ts` |
| 13 | **Tokens Discord chiffrés AES-256-GCM** au repos | `backend/src/secretCrypto.ts` |
| 14 | `express.json({ limit: '256kb' })` — anti-DoS payload | `backend/src/index.ts` |
| 15 | Logs **scrub** des PII potentielles | `backend/src/seek.ts` |

---

## 🔬 Méthodologie

- Lecture exhaustive de `backend/src/*.ts` et `Panel/app/components/**`
- `grep` ciblé : `eval`, `Function(`, `innerHTML`, `dangerouslySet`, `localStorage`,
  `db.prepare\(\`?[A-Z]+\s.*\$\{`, `helmet`, `rate-limit`, `csrf`, `bcrypt`
- Vérification des dépendances dans `backend/package.json` et `Panel/package.json`
- Test mental des flux : signup / login / redeem premium / quota / scoping data / WS handshake
- **Build TypeScript** vérifié sans erreur après remédiation (`tsc --noEmit`, `vite build`)

---

<div align="center">

— *Audit signé Aegis · 2026* —

</div>
