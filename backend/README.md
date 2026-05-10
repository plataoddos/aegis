# NET.X Watcher Backend

Backend Node.js qui maintient un pool de **comptes utilisateurs Discord** (selfbots) connectés au Gateway et capture en temps réel les events des utilisateurs surveillés.

## ⚠️ Avertissement

Ce backend utilise `discord.js-selfbot-v13` avec des **tokens de comptes utilisateurs** (et non des bots). C'est une **violation explicite des conditions d'utilisation de Discord**. Les comptes peuvent être bannis (souvent en quelques heures pour des comportements automatisés évidents). N'utilise que des comptes jetables.

## Setup

```bash
cd backend
cp .env.example .env
# édite .env pour fixer API_TOKEN
npm install
npm run dev
```

Les **tokens des comptes** ne sont **plus** dans `.env` : ils s'ajoutent depuis le panel admin → onglet **Discord Watcher**. Ils sont stockés dans `data.sqlite` (ignoré par git).

## Workflow

1. Lance le backend (`npm run dev`)
2. Ouvre le panel → **Administration** → onglet **Discord Watcher**
3. Clique **Ajouter un compte** et colle le token utilisateur (récupérable via DevTools Discord Web → Network → Header `authorization`)
4. Le compte se connecte automatiquement, son statut passe en "Connecté"
5. Va dans la catégorie **Discord Watcher** du panel pour ajouter des IDs à surveiller

## API

Toutes les routes nécessitent un header `Authorization: Bearer <API_TOKEN>`.

| Route | Méthode | Description |
|---|---|---|
| `/health` | GET | (public) ping |
| `/api/status` | GET | bots connectés, guilds couvertes, # surveillés |
| `/api/watches` | GET | liste des IDs surveillés |
| `/api/watches` | POST | `{ user_id, label? }` ajoute |
| `/api/watches/:id` | DELETE | retire |
| `/api/watches/:id/profile` | GET | profil Discord (cache fetch) |
| `/api/events` | GET | `?user_id=&type=&limit=` |
| `/ws?token=<API_TOKEN>` | WS | flux live des events |

## Events capturés

- `message_create`, `message_update`, `message_delete`
- `guild_join`, `guild_leave`
- `nickname_change`, `roles_change`
- `presence_update` (online/idle/dnd/offline + activités)
- `voice_join`, `voice_leave`, `voice_move`
- `user_update` (changement de pseudo/avatar)

Les données sont persistées dans `data.sqlite` (créé automatiquement).

## Limites importantes

- **Un bot ne voit que les guilds où il est membre.** Pour couvrir "énormément de serveurs", il faut soit faire inviter les bots (légitime), soit avoir des bots déjà présents sur ces serveurs.
- Discord rate-limite agressivement : prévoir plusieurs tokens pour scaler.
- Le `MESSAGE_CONTENT` intent est privilégié — au-delà de 100 serveurs cumulés, Discord exige une vérification du bot.
