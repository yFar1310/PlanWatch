# PlanWatch · 🗺️

> **Monorepo** _Web + API + Infra_ pour gérer des **plans** (tâches) avec **Vue 3 + Vite + Tailwind** (web), **Hono (Node 20 + TypeScript)** (API), **PostgreSQL** (données) & **MongoDB** (events).

**Features principales :**

- ✅ Authentification JWT (signup / login / profil)
- ✅ Plans par **utilisateur** (scopés par `user_id`)
- ✅ Dashboard avec cartes **Today / Upcoming / Activity**
- ✅ Board de tâches par statut + priorité
- ✅ **Dépendances** entre plans + graphe **PERT** (chemin critique)
- ✅ Journal d’activité (Mongo) + **export PDF**
- ✅ Page **profil** avec upload d’avatar (data URL base64)
- ✅ Dark / light mode, DatePicker, modales de succès & confirmation
- ✅ **Docker Compose** complet (web, API, Postgres, Mongo)

---

## 🧠 Ce que fait PlanWatch (en bref)

PlanWatch est une web-app de coaching d’estimation et de traçabilité :

- On saisit des **plans** (titre, durée prévue, durée réelle, échéance, note, dépendance, statut).
- L’application calcule des **KPI** : temps planifié / réalisé, charge du jour, tâches à venir, etc.
- Un **graphe PERT** visualise les dépendances et le chemin critique.
- Chaque action (create / update / delete) est journalisée dans **MongoDB** pour alimenter :
  - la timeline d’activité,
  - l’export PDF,
  - des analyses futures.

Architecture de persistance :

- **PostgreSQL** = _source de vérité_ (tables `users`, `plans`, `subtasks`, …).
- **MongoDB** = journal d’**événements immuables** (`events`) + projection `plans` pour des requêtes rapides côté dashboard.

Le front **Vue 3 (Vite)** consomme une API **Hono** qui écrit à la fois dans Postgres et Mongo.

---

## 🚀 Sommaire

- [🎯 Aperçu rapide](#-aperçu-rapide)
- [🧱 Structure](#-structure)
- [⚡ Démarrage rapide](#-démarrage-rapide)
- [🔧 Variables d’environnement](#-variables-denvironnement)
- [🗃️ Base de données](#️-base-de-données)
- [🛣️ API (Hono)](#️-api-hono)
- [🖥️ Front (Vue 3 + Vite + Tailwind)](#️-front-vue-3--vite--tailwind)
- [📦 Seed & comptes de démo](#-seed--comptes-de-démo)
- [✅ Qualité & Tests](#-qualité--tests)
- [🩺 Dépannage](#-dépannage)
- [👥 Équipe](#-équipe-)

---

## 🎯 Aperçu rapide

```text
web (Vue 3 · Vite · Tailwind)
        │   JWT, JSON
        │   🌐 CORS (Authorization, Content-Type)
        ▼
server (Hono · Node 20 · TypeScript)
    │         │
    │         ├────────► PostgreSQL (users, plans, subtasks, …)
    │         │
    │         └────────► MongoDB (events, projections plans)
    │
    └── Auth JWT (login / signup / me / profil, middleware requireAuth)
```

---

## 🧱 Structure

```text
PlanWatch/
├─ infra/            # Docker Compose (web, server, postgres, mongo)
│  └─ docker-compose.yml
├─ server/           # API Hono (Node 20, TypeScript)
│  ├─ src/index.ts   # bootstrap, CORS, routes, ensureSchema + seed
│  ├─ src/routes/    # health, submit, plans, stats, activity, pert, auth, …
│  ├─ src/db/        # clients Postgres + Mongo
│  └─ .env.example
└─ web/              # Front Vue 3 + Vite + Tailwind
   ├─ src/pages/     # Dashboard, Plans, New, Edit, Activity, Login, Signup, ...
   ├─ src/components # UI (Card, Field, Button, NavBar, Modals, PERTGraph, …)
   └─ .env.example
```

---

## ⚡ Démarrage rapide

### Full Docker (web + API + DB)

```bash
cd infra
docker compose up --build
```

email : yahya@planwatch.test
Mot de passe  : Planwatch@123

- Web : `http://localhost:5173`
- API : `http://localhost:3000`
- PostgreSQL : `postgres://app:app@localhost:5432/appdb`
- MongoDB : `mongodb://localhost:27017/planwatch`

> 💡 **Tailwind en Docker**
> - Vite tourne **dans** le conteneur `web`.
> - Si aucun style : vérifier `tailwind.config.ts`, l’import des CSS, et que `npm run dev` est bien exécuté dans l’image.

---

## 🔧 Variables d’environnement

### `server/.env.example`

```env
HOST=0.0.0.0
PORT=3000

POSTGRES_URL=postgres://app:app@localhost:5432/appdb
MONGO_URL=mongodb://localhost:27017/planwatch

# CORS
CORS_ORIGIN=http://localhost:5173

# Reset one-shot (utile sur Railway / dev)
RESET_DB_ON_BOOT=0

# Comptes de démo
DEMO_EMAIL=demo@planwatch.test
DEMO_PASSWORD=Cookie@123

# Mot de passe commun pour les users Yahya / Morelli seedés
SEED_PASSWORD=Planwatch@123
```

### `web/.env.example`

```env
VITE_API_URL=http://localhost:3000
```

---

## 🗃️ Base de données

### PostgreSQL — données métier 🐘

#### Table `users`

- `id` SERIAL PRIMARY KEY  
- `email` TEXT UNIQUE NOT NULL  
- `password_hash` TEXT NOT NULL (bcrypt)  
- `full_name` TEXT NULL  
- `avatar_data` TEXT NULL (data URL base64 — petite image ≤ ~200 Ko)  
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

#### Table `plans`

- `id` SERIAL PRIMARY KEY  
- `user_id` INT REFERENCES `users(id)` ON DELETE CASCADE  
- `title` TEXT NOT NULL  
- `expected_minutes` INT CHECK (expected_minutes > 0)  
- `actual_minutes` INT NULL CHECK (actual_minutes >= 0)  
- `due_at` TIMESTAMPTZ NOT NULL  
- `note` TEXT NULL  
- `depends_on` INT NULL REFERENCES `plans(id)` ON DELETE SET NULL  
- `status` TEXT NOT NULL DEFAULT 'not_started'  
  - `not_started` | `in_progress` | `done` (pour le board)  
- `priority` INT NOT NULL DEFAULT 0 (pour tris futurs)  
- `project_id` INT NULL (future feature “projets”)  
- `recurrence_rule` TEXT NULL (type RRULE pour répéter un plan)  
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

**Index utiles :**

```sql
CREATE INDEX IF NOT EXISTS idx_plans_due_at       ON plans (due_at);
CREATE INDEX IF NOT EXISTS idx_plans_created_at   ON plans (created_at);
CREATE INDEX IF NOT EXISTS idx_plans_user_due_at  ON plans (user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_plans_project      ON plans (project_id);
```

#### Tables annexes (features futures déjà prêtes)

- `projects` : projet parent optionnel.
- `labels` + `plan_labels` : tags colorés par plan.
- `subtasks` : sous-tâches checkables par plan.
- `time_entries` : entrées de time-tracking (minutes, started_at).

---

### MongoDB — events / analytics 🍃

#### Collection `events`

Exemple de document :

```json
{
  "type": "plan_created | plan_updated | plan_deleted",
  "userId": 1,
  "planId": 42,
  "at": "2025-11-29T16:30:00.000Z",
  "payload": { "title": "Prepare NoSQL lecture", "expectedMinutes": 120 }
}
```

- Index TTL (optionnel, ex. 7 jours) :

```js
db.events.createIndex({ at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
```

#### Collection `plans`

Projection des plans Postgres pour des lectures rapides dans le dashboard :

```json
{
  "pgId": 42,
  "userId": 1,
  "title": "Review PlanWatch project status",
  "dueAt": "2025-11-30T17:42:46.000Z",
  "status": "not_started"
}
```

Index :

```js
db.plans.createIndex({ pgId: 1, userId: 1 }, { unique: true });
db.plans.createIndex({ userId: 1, dueAt: 1 });
db.plans.createIndex({ status: 1 });
```

---

## 🛣️ API (Hono)

### 🔐 CORS (global)

Dans `server/src/index.ts` :

- `origin` = `CORS_ORIGIN`
- `allowMethods` : `GET, POST, PATCH, DELETE, OPTIONS`
- `allowHeaders` : `Content-Type, Authorization`

### 🔑 Auth & profil

| Méthode | Route              | Description                                    |
|--------:|--------------------|-----------------------------------------------|
| POST    | `/api/auth/signup` | Créer un compte (email + password + fullName) |
| POST    | `/api/auth/login`  | Login → `{ ok, token, user }`                 |
| GET     | `/api/auth/me`     | Infos de l’utilisateur courant (JWT)          |
| PATCH   | `/api/users/me`    | Mise à jour `fullName` + `avatarData`         |

- JWT signé en HS256.
- Mot de passe hashé avec **bcryptjs**.
- Middleware `requireAuth` pour protéger les routes `/api/*`.

### 📌 Plans & CRUD

| Méthode | Route              | Description                         | Auth |
|--------:|--------------------|-------------------------------------|------|
| POST    | `/api/submit`      | Créer un plan (alias create)       | ✅   |
| GET     | `/api/plans`       | Lister les plans de l’utilisateur  | ✅   |
| GET     | `/api/plans/:id`   | Obtenir un plan (user-scopé)       | ✅   |
| PATCH   | `/api/plans/:id`   | Modifier partiellement un plan     | ✅   |
| DELETE  | `/api/plans/:id`   | Supprimer un plan                  | ✅   |

Query params pour `/api/plans` :

- `from`, `to` (dates ISO)
- `limit`, `offset`
- `order` : `due_at` ou `created_at`
- `dir` : `asc` / `desc`
- `status`, `projectId`, `search` (extensions futures)

### 📊 Stats, activity & PERT

| Méthode | Route                    | Description                                   |
|--------:|--------------------------|-----------------------------------------------|
| GET     | `/api/stats`             | KPI dashboard (today, upcoming, board)       |
| GET     | `/api/activity`          | Timeline d’événements paginée                 |
| GET     | `/api/activity/export`   | Export PDF de l’activité                      |
| GET     | `/api/pert`              | Graphe PERT (tâches + chemin critique)       |

- Toutes ces routes sont **scopées par `user_id`**.
- PERT :
  - `SELECT` des plans de l’utilisateur avec `expected_minutes` > 0.
  - On construit un DAG implicite via `depends_on`.
  - Calcul **forward pass** (`es/ef`) puis **backward pass** (`ls/lf`) pour obtenir `slack` et `projectDuration`.
  - Réponse : `{ tasks: PertTask[], projectDuration }`.

---

## 🖥️ Front (Vue 3 + Vite + Tailwind)

### 🌐 Routing

- `/login` — connexion (email + password)
- `/signup` — création de compte
- `/profile` — profil utilisateur :
  - avatar upload (input file → data URL base64)
  - full name
- `/` — **Dashboard** :
  - carte **Today**
  - carte **Upcoming**
  - carte **Recent activity** (+ export PDF)
  - board **Tasks** (colonnes par statut)
  - PERT timeline
- `/plans` — liste avec tableau (desktop) & cartes (mobile)
- `/plans/new` — création d’un plan
- `/plans/:id/edit` — édition d’un plan

### 🧩 Composants clés

- `components/layout/AppNav.vue` :
  - brand “PlanWatch”
  - navigation Dashboard / Plans / New
  - bouton **New Plan**
  - toggle dark / light
  - avatar (initiales ou image depuis `avatarData`)
  - menu utilisateur (Profile / Logout)
- `components/common/AlertMessage.vue` — alertes (`error`, `success`, …)
- `components/common/ConfirmModal.vue` — confirmation suppression
- `components/ui/Card.vue`, `Field.vue`, `Input.vue`, `Button.vue` — design system de base
- `components/PERT/PERTGraph.vue` — rendu du graphe PERT (vue + lib de graph)

### 🕒 Dates & timezone

- Le DatePicker stocke une `Date` JS.
- Avant d’appeler l’API, on convertit en **ISO UTC** (`date.toISOString()`).
- À l’affichage : `new Date(dueAt).toLocaleString()` (configurable).

---

## 📦 Seed & comptes de démo

Au démarrage, `ensureSchema()` :

1. Crée / migre les tables Postgres.
2. Si `RESET_DB_ON_BOOT=true` → **TRUNCATE** des tables (plans, users, labels, …) + purge Mongo → reseed propre.
3. Crée un **user de démo** générique :
   - `demo@planwatch.test` / `Cookie@123` (par défaut).
4. Crée deux utilisateurs “réalistes” :

```text
Yahya  : yahya@planwatch.test
Mot de passe (par défaut) : Planwatch@123
```

5. Pour chacun, seed de plans **enchaînés** via `depends_on` :
   - Yahya : basket, peinture, code, gym, études, etc.
   - Morelli : “Review PlanWatch project status”, “Prepare NoSQL lecture”, “Correct student projects”, “Department meeting”, “Research time”, “Long-term course redesign”, etc.

Ces dépendances permettent d’avoir immédiatement un **graphe PERT parlant** + un dashboard réaliste.

## ✅ Qualité & Tests

**API :**

- **Vitest** + `hono/testing` pour les routes (happy path + erreurs de validation + 401/404).
- Tests utiles :
  - création / édition / suppression d’un plan
  - routing protégé par JWT
  - PERT avec petit graphe factice (vérifier `projectDuration` & `slack`).

**Front :**

- **Playwright** (ou Cypress) pour un scénario E2E :
  1. Login avec un user de déмо.
  2. Créer un plan.
  3. Vérifier qu’il apparaît dans `/plans`.
  4. L’éditer (changer minutes / due date).
  5. Le supprimer (ConfirmModal) et vérifier la disparition.

---

## 🩺 Dépannage

> ⚠️ **Erreur CORS / Authorization**
>
> - Vérifier la valeur de `CORS_ORIGIN` côté server.
> - S’assurer que `allowHeaders` contient bien `Authorization`.
> - Les requêtes `OPTIONS` doivent être acceptées par le middleware `cors`.

> 🔐 **401 / redirection vers /login**
>
> - Si le JWT est invalide ou expiré, l’API renvoie `401`.
> - Le front supprime `pw.token` / `pw.user` et redirige automatiquement vers `/login`.

> 🗑️ **DELETE → “Failed to fetch” côté front**
>
> - Les endpoints `DELETE` renvoient `200 { ok: true }`.
> - Si tu changes en `204`, attention à ne pas faire `response.json()` côté front.

> 🖼️ **Avatar qui ne s’affiche pas**
>
> - `avatarData` doit être une **data URL** (`data:image/png;base64,...`).
> - Taille limitée (~quelques centaines de Ko) pour rester raisonnable.
> - Le front lit le fichier via `FileReader` et met à jour `pw.user` dans `localStorage`.

---

## 🧭 Checklist de mise en route

- [ ] `cp server/.env.example server/.env` + ajuster `POSTGRES_URL`, `MONGO_URL`, `CORS_ORIGIN`
- [ ] `cp web/.env.example web/.env` + ajuster `VITE_API_URL`
- [ ] `npm install` dans `server/` et `web/`
- [ ] Lancer Postgres + Mongo (`docker compose up -d postgres mongo`)
- [ ] `npm run dev` dans `server/` puis dans `web/`
- [ ] Vérifier :
  - [ ] `http://localhost:3000/health`
  - [ ] `http://localhost:5173`
- [ ] Se connecter avec un compte seedé (`yahya@planwatch.test` / `Planwatch@123`)
- [ ] Vérifier dashboard, plans, PERT, activity, profil + avatar

---

## 👥 Équipe

### FAREHAN Yahya  
_Co-fondateur & Développeur logiciel (backend & frontend)_

### JDAIAA Youssef  
_Co-fondateur & Responsable data/stats (optimisation des calculs & KPI)._

_Fait avec ❤️, Hono, Vue 3… et pas mal de café ☕️_
