# Seek API integration (see-know.eu)

Le backend Aegis expose un proxy unifié pour l'API see-know.eu. Le panel n'a
**jamais** la clé API en clair — elle reste côté serveur.

## Configuration

Dans `backend/.env` :

```env
SEEK_API_KEY=seek-XXXXXXXXXXXXXXXXXXXXXXXX
SEEK_BASE_URL=https://see-know.eu          # par défaut
SEEK_CACHE_TTL_MS=86400000                 # 24h, durée du cache
```

Sans `SEEK_API_KEY`, le proxy renverra une 500 pour les requêtes live, mais
les hits de cache continuent de fonctionner.

## Crédits & cache

- **Cache 24h** : toute requête identique (même endpoint + mêmes paramètres)
  dans la fenêtre TTL est servie depuis SQLite, **0 crédit**.
- **`?fresh=1`** : force une requête live, bypass cache (coûte des crédits).
- **`credits_remaining`** : retourné par l'API upstream à chaque appel live,
  affiché dans le panel et stocké côté serveur.

## Routes panel ↔ backend

Toutes les routes du proxy passent par `/api/seek/<key>` avec le même token
d'auth que le reste de l'API (`Authorization: Bearer $API_TOKEN`).

| Méthode | Route                   | Description                                 |
| ------- | ----------------------- | ------------------------------------------- |
| `GET`   | `/api/seek/catalog`     | Liste des endpoints + crédits restants       |
| `GET`   | `/api/seek/<key>?…`     | Endpoint GET upstream (params en query)     |
| `POST`  | `/api/seek/<key>`       | Endpoint POST upstream (params en body)     |

### Réponse type

```json
{
  "ok": true,
  "cached": false,
  "endpoint": "/api/v1/search",
  "cost": 1,
  "credits_remaining": 4978,
  "data": { /* JSON brut de l'API upstream */ },
  "status": 200,
  "fetched_at": 1779113000000
}
```

## Catalogue d'endpoints

Toutes les `<key>` ci-dessous sont mappées vers `/api/v1/...` upstream :

| Key                | Méthode | Cost | Path upstream                  | Champs principaux            |
| ------------------ | ------- | ---- | ------------------------------ | ---------------------------- |
| `search`           | POST    | 1    | `/api/v1/search`               | `query`, `type`, `limit`     |
| `stealer`          | POST    | 2    | `/api/v1/stealer`              | `query`, `limit`             |
| `discord_user`     | GET     | 1    | `/api/v1/discord/user`         | `discord_id`                 |
| `discord_roblox`   | GET     | 1    | `/api/v1/discord/to-roblox`    | `discord_id`                 |
| `username_github`  | GET     | 1    | `/api/v1/username/github`      | `username`                   |
| `username_twitter` | GET     | 1    | `/api/v1/username/twitter`     | `username`                   |
| `username_tiktok`  | GET     | 1    | `/api/v1/username/tiktok`      | `username`                   |
| `username_reddit`  | GET     | 1    | `/api/v1/username/reddit`      | `username`                   |
| `username_social`  | GET     | 1    | `/api/v1/username/social`      | `username`, `platforms`      |
| `username_history` | GET     | 1    | `/api/v1/username/history`     | `username`                   |
| `network_ip`       | GET     | 1    | `/api/v1/network/ip`           | `ip`                         |
| `network_email`    | GET     | 1    | `/api/v1/network/email-check`  | `email`                      |
| `network_phone`    | GET     | 1    | `/api/v1/network/phone`        | `phone`                      |
| `domain_intel`     | GET     | 1    | `/api/v1/domain/intel`         | `domain`                     |
| `domain_whois`     | GET     | 1    | `/api/v1/domain/whois`         | `domain`                     |
| `gaming_xbox`      | GET     | 1    | `/api/v1/gaming/xbox`          | `gamertag`                   |
| `gaming_roblox`    | GET     | 1    | `/api/v1/gaming/roblox`        | `username` ou `user_id`      |
| `gaming_minecraft` | GET     | 1    | `/api/v1/gaming/minecraft`     | `username`                   |

## Exemples cURL (vers backend Aegis)

Recherche universelle :

```bash
TOKEN=$(grep '^API_TOKEN' backend/.env | cut -d= -f2 | tr -d '"')
curl -X POST http://localhost:8787/api/seek/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"john@example.com","limit":50}'
```

IP intel (GET) :

```bash
curl "http://localhost:8787/api/seek/network_ip?ip=192.0.2.1" \
  -H "Authorization: Bearer $TOKEN"
```

Forcer un appel live (skip cache) :

```bash
curl "http://localhost:8787/api/seek/network_ip?ip=192.0.2.1&fresh=1" \
  -H "Authorization: Bearer $TOKEN"
```

## Bonnes pratiques pour économiser les crédits

1. **Toujours laisser le cache actif** sauf besoin réel de fraîcheur.
2. **Vérifier `cached: true` dans la réponse** pour confirmer 0 crédit.
3. **Utiliser `username_social` plutôt que d'appeler chaque plateforme** (1
   crédit qui couvre 70+ plateformes).
4. **Surveiller `credits_remaining`** dans le header du panel — bandeau
   ambré quand < 50.
5. **Ne pas implémenter d'auto-search** sur la frappe — le panel exige un
   clic explicite ou une touche Entrée pour lancer.

## Schéma DB du cache

Table `seek_cache` :

| Colonne       | Type    | Description                        |
| ------------- | ------- | ---------------------------------- |
| `cache_key`   | TEXT PK | sha256 de `endpoint + params` (32 c) |
| `endpoint`    | TEXT    | path upstream (ex: `/api/v1/search`) |
| `params_json` | TEXT    | params normalisés                  |
| `response`    | TEXT    | body JSON upstream                 |
| `credits`     | INT     | crédits restants au moment du fetch |
| `fetched_at`  | INT     | timestamp ms                       |

Pour purger le cache manuellement :

```bash
sqlite3 backend/data.sqlite "DELETE FROM seek_cache;"
```
