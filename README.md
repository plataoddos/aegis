<div align="center">

<img src="Panel/public/logo-plat-nb.png" alt="Aegis" width="220" />

### *Plateforme OSINT modulaire — multi-API, multi-utilisateur, temps réel*

[![Stack](https://img.shields.io/badge/stack-React%20%C2%B7%20Vite%20%C2%B7%20Express%20%C2%B7%20SQLite-6366f1?style=for-the-badge)]()
[![License](https://img.shields.io/badge/license-Private-9333ea?style=for-the-badge)]()
[![Status](https://img.shields.io/badge/status-Active-10b981?style=for-the-badge)]()
[![Audit](https://img.shields.io/badge/security-audited-f59e0b?style=for-the-badge)](./SECURITY_AUDIT.md)

*Renseignement · Discord Watcher · Fiches · Quotas · Premium · Admin*

</div>

---

## ✨ En bref

**Aegis** est une plateforme OSINT auto-hébergée qui agrège plusieurs APIs publiques et privées
derrière une UI unique et soignée. Elle gère ses propres comptes utilisateurs (login/mot de passe),
des quotas journaliers, un système premium par clé d'activation, et un module Discord Watcher
en temps réel via WebSocket.

> *« One panel to rule them all. »*

<div align="center">

```text
   ╭──────────────────────────────────────────────────────────────╮
   │                                                              │
   │     🎯  Renseignement       🛰️  Discord Watcher              │
   │     📇  Fiches              💎  Premium / Quotas             │
   │     ⚡  Multi-API            🔐  Auth + Admin                 │
   │                                                              │
   ╰──────────────────────────────────────────────────────────────╯
```

</div>

---

## 🚀 Fonctionnalités

### 🎯 Module **Renseignement** — *multi-API*
- **Auto-détection** intelligente sur n'importe quelle valeur :
  IPv4/IPv6, domaine, email, username, snowflake Discord, hash MD5/SHA1/SHA256, téléphone
- **Mode multi-critères** : recherche identité (nom, prénom, ville, NIR, IBAN, SIRET…)
- **Fan-out parallèle** vers chaque source applicable, avec score de confiance
- **APIs intégrées** :
  - 🟣 **BrixHub** — recherche universelle, lookup email/téléphone/IBAN
  - 🌐 **ipwho.is + ipapi.co** — géoloc IP avec fallback automatique
  - *(prévu : SeekNow, autres providers — l'architecture est plug-and-play)*
- **Liens familiaux expandables** : chaque profil détaillé dévoile ses liens (adresse, téléphone, IBAN, nom commun)
- **Cache 24 h** : ré-exécuter la même recherche est gratuit (0 quota consommé)
- **One-click → Fiche** : transforme un profil BrixHub en fiche structurée

### 🛰️ Module **Discord Watcher**
- Pool de comptes selfbot (⚠️ *viole les ToS Discord — comptes throwaway uniquement*)
- Surveillance d'IDs Discord en temps réel via WebSocket
- Capture des messages, salons rejoints/quittés, changements de profil
- Admin UI dédiée pour gérer le pool de tokens

### 📇 Module **Fiches**
- Base de données structurée des cibles : identité, adresse, allocataire, bancaire, meta
- **Webhook Discord** automatique à chaque création de fiche
- Données 100 % isolées par compte (chaque utilisateur ne voit que ses fiches)

### 💎 **Quotas & Premium**
- **5 requêtes/jour** offertes (cache hits gratuits)
- **100 requêtes/jour** en premium
- Activation premium via clés `aegis_xxxxx…` (générées par les admins)
- Reset quotidien automatique à minuit UTC

### 🔐 **Authentification & Admin**
- Login/mot de passe — pas d'OAuth, pas d'email requis
- Sessions Bearer (UUID v4, TTL 24 h, stockées en SQLite)
- Mots de passe hashés avec **scrypt** + salt aléatoire
- Premier compte créé = **admin automatique**
- Page **Admin** avec sous-catégories :
  - 📊 **Aperçu** — stats globales
  - 📈 **Statistiques** — consommation par API/endpoint/utilisateur
  - 🔑 **Clés premium** — génération et gestion
  - 👥 **Utilisateurs** — gestion des comptes
  - 🛰️ **Discord Watcher** — pool de selfbots

### 📞 **Contact**
- Page dédiée avec **Session ID** officiel — messagerie chiffrée E2E
- Pas de numéro, pas d'email à donner

---

## 🏗️ Architecture

```
┌────────────────────┐         ┌──────────────────────┐         ┌─────────────┐
│                    │  HTTPS  │                      │  HTTPS  │             │
│   Panel React      │ ──────▶ │   Backend Express    │ ──────▶ │   BrixHub   │
│   (Vite, Tailwind) │ ◀────── │   (TypeScript)       │ ◀────── │   ipwho.is  │
│                    │   WS    │                      │         │   ipapi.co  │
└────────────────────┘         └──────────────────────┘         └─────────────┘
        │                                │
        │                                ▼
        │                       ┌────────────────┐
        │                       │  SQLite (WAL)  │
        │                       │  - users       │
        │                       │  - sessions    │
        │                       │  - persons     │
        │                       │  - watches     │
        │                       │  - api_usage   │
        │                       │  - cache       │
        │                       └────────────────┘
        │
        ▼ ws://
┌────────────────────┐
│  Selfbot pool      │
│  (Discord events)  │
└────────────────────┘
```

### Stack
| Couche      | Techno                                                      |
|:------------|:------------------------------------------------------------|
| **Frontend**| React 18 · Vite · TypeScript · Tailwind CSS · lucide-react · sonner |
| **Backend** | Node 20+ · Express · TypeScript · `tsx` (dev), `tsc` (prod) |
| **DB**      | SQLite (`better-sqlite3`, mode WAL)                         |
| **Auth**    | scrypt (Node natif) · sessions Bearer en DB                  |
| **Realtime**| `ws` (WebSocket pur)                                         |
| **Discord** | `discord.js-selfbot-v13`                                     |

---

## 📦 Installation

### Pré-requis
- Node.js **20+**
- une clé API **BrixHub** (`brix_xxx…`)
- *(optionnel)* tokens de selfbots Discord pour le watcher

### 1. Cloner & installer

```bash
git clone <ce-repo> aegis && cd aegis

# Backend
cd backend && npm install
cp .env.example .env
# → édite .env et renseigne BRIX_API_KEY

# Panel
cd ../Panel && npm install
```

### 2. Lancer en dev

```bash
# Terminal 1 — backend
cd backend && npm run dev   # → http://localhost:8787

# Terminal 2 — panel
cd Panel && npm run dev     # → http://localhost:5173
```

### 3. Premier login
1. Ouvre `http://localhost:5173`
2. Onglet **Inscription** → choisis un username + mot de passe
3. **Le premier compte créé devient automatiquement admin**
4. Va dans **Admin → Clés premium** pour générer tes clés d'activation

### 4. Production

```bash
cd backend && npm run build && npm start
cd Panel    && npm run build   # → dist/ servi par nginx ou équivalent
```

> **Important** : surcharge `ALLOWED_ORIGINS` avec le domaine de ton panel.

---

## ⚙️ Configuration

### `backend/.env`

| Variable             | Défaut                          | Description                               |
|:---------------------|:--------------------------------|:------------------------------------------|
| `PORT`               | `8787`                          | Port du backend                           |
| `ALLOWED_ORIGINS`    | `http://localhost:5173`         | CORS (CSV)                                |
| `BRIX_API_KEY`       | *(requis)*                      | Clé BrixHub `brix_xxx…`                   |
| `BRIX_BASE_URL`      | `https://brixhub.net/api/v1`    | Base URL upstream                         |
| `BRIX_CACHE_TTL_MS`  | `86400000` (24 h)               | Durée du cache disque                     |
| `WS_TOKEN`           | `""`                            | Token WS legacy (CLI), optionnel          |

### `Panel/.env.local`

| Variable               | Défaut                  | Description                |
|:-----------------------|:------------------------|:---------------------------|
| `VITE_WATCHER_API_URL` | `http://localhost:8787` | URL du backend             |

---

## 🔐 Sécurité

Un audit complet est disponible dans **[`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md)**.

**Bonnes pratiques en place :**
- ✅ Prepared statements partout (pas d'injection SQL)
- ✅ Mots de passe hashés scrypt + salt + `timingSafeEqual`
- ✅ Politique mdp : ≥10 chars, 3 classes, anti-blacklist, anti-username
- ✅ **Rate-limit** anti brute-force sur `/login`, `/signup`, `/redeem`
- ✅ **`helmet`** (HSTS, X-CT-O, X-Frame-Options, Referrer-Policy)
- ✅ Sessions serveur révocables, **sliding refresh** automatique
- ✅ **Tokens Discord chiffrés AES-256-GCM** au repos (clé `MASTER_KEY`)
- ✅ Données isolées par utilisateur (`created_by`)
- ✅ Quotas serveur-side (impossibles à bypass côté panel)
- ✅ API keys jamais exposées au navigateur (proxy backend)
- ✅ CORS allow-list — refuse de booter en prod sans `ALLOWED_ORIGINS`
- ✅ Validation stricte des IDs, IPs et snowflakes Discord
- ✅ Logs scrubbés (pas de PII upstream dans la sortie console)
- ✅ Limit body 256 ko anti-DoS

**Risques résiduels (documentés) :**
- ⚠️ Module Discord Watcher = violation ToS Discord — comptes throwaway only
- ⚠️ Token de session en `localStorage` (XSS persistant) — migration cookies
  HttpOnly prévue dans une release dédiée

---

## 🗺️ Roadmap

- [ ] Intégration **SeekNow** (couplage avec BrixHub)
- [ ] Export CSV/JSON des fiches
- [ ] Webhook Discord configurable depuis le panel admin
- [ ] Pagination + recherche full-text dans Fiches
- [ ] Mode dark/light (actuellement dark only)
- [ ] 2FA TOTP (admin)
- [ ] Audit log persistant des actions admin

---

## ⚠️ Disclaimer

> Aegis est un outil **à usage interne, en environnement contrôlé**.
> Le module Discord Watcher utilise des **selfbots**, ce qui constitue une **violation des ToS Discord**.
> N'utilise que des comptes throwaway dont la perte ne te dérange pas.
> L'auteur décline toute responsabilité quant à l'usage qui en est fait.

---

<div align="center">

### **AEGIS**
*Built with discipline · Designed for operators*

— *Signé Aegis · 2026* —

</div>
