# PlanWatch · 🗺️

> **Monorepo** _Web + API + Infra_ pour gérer des **plans** (tâches) avec **Vue 3 + Vite + Tailwind** (web), **Hono (Node 20 + TypeScript)** (API), **PostgreSQL** (données) & **MongoDB** (events).
> **Features** : CRUD complet, modales (succès & confirmation), DatePicker, **CORS propre**, **Docker Compose**.

---

## 🧠 Ce que fait PlanWatch (en bref)

PlanWatch est une web-app de coaching d’estimation et de traçabilité : on y saisit des “plans” (titre, durée prévue, durée réelle, échéance, note) et l’application mesure en continu l’écart prévu ↔ réalisé. Elle démontre une persistance polyglotte utile : PostgreSQL sert de source de vérité structurée (table plans, contraintes, calcul des KPI comme MAPE, taux à l’heure, charge/jour), tandis que MongoDB conserve un journal d’événements immuable (création, mise à jour du réalisé, retard, etc.) pour l’audit et la timeline. Le front Vue 3 (Vite) parle à une API Hono qui écrit en parallèle dans les deux stores. Résultat : une app simple mais professionnelle qui aide à mieux estimer, prouver l’avancement et analyser les dérives, livrée avec un docker-compose pour lancer l’UI, l’API et les bases, puis vérifier en live la persistance via psql et mongosh.

---

## 🚀 Sommaire

- [🧠 Ce que fait PlanWatch (en bref)](#-ce-que-fait-planwatch-en-bref)
- [🎯 Aperçu rapide](#-aperçu-rapide)
- [🧱 Structure](#-structure)
- [⚡ Démarrage rapide](#-démarrage-rapide)
- [🔧 Variables d’environnement](#-variables-denvironnement)
- [🗃️ Base de données](#️-base-de-données)
- [🛣️ API (Hono)](#️-api-hono)
- [🖥️ Front (Vue 3 + Vite + Tailwind)](#️-front-vue-3--vite--tailwind)
- [📜 Scripts NPM](#-scripts-npm)
- [✅ Qualité & Tests](#-qualité--tests)
- [🩺 Dépannage](#-dépannage)
- [🧭 Checklist](#-checklist-de-mise-en-route)

---

## 🎯 Aperçu rapide

```text
web (Vue 3 · Vite · Tailwind)
        │     🌐 CORS
        ▼
server (Hono · Node 20 · TS) ─────► PostgreSQL (données métier)
        │
        └──────────────────────────► MongoDB (events / analytics)
```

---

## 🧱 Structure

```
PlanWatch/
├─ infra/      # Docker Compose (web, server, postgres, mongo)
├─ server/     # API Hono (TypeScript, Node 20)
└─ web/        # Front Vue 3 + Vite + Tailwind
```

---

## ⚡ Démarrage rapide




### Option B — Full Docker 🐳

```bash
cd infra
```

- Web : `http://localhost:5173`
- API : `http://localhost:3000`
- PostgreSQL : `postgres://app:app@localhost:5432/appdb`
- MongoDB : `mongodb://localhost:27017/planwatch`

> 💡 **Tailwind en Docker**
> - Le watcher **Vite** doit tourner **dans** le conteneur `web`.
> - Si aucun style : vérifier `index.html`, `tailwind.config.ts`, et que `npm run dev` est lancé par l’image.

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
```

### `web/.env.example`
```env
VITE_API_URL=http://localhost:3000
```

---

## 🗃️ Base de données

### PostgreSQL — données métier 🐘

**Table `plans`**
- `id` SERIAL PRIMARY KEY
- `title` TEXT NOT NULL
- `expected_minutes` INT CHECK (> 0)
- `actual_minutes` INT NULL CHECK (>= 0)
- `due_at` TIMESTAMPTZ NOT NULL
- `note` TEXT NULL
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()

**DDL suggéré**
```sql
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  expected_minutes INT CHECK (expected_minutes > 0),
  actual_minutes INT NULL CHECK (actual_minutes >= 0),
  due_at TIMESTAMPTZ NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plans_due_at     ON plans(due_at);
CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at);
```

### MongoDB — events / analytics 🍃

- Collection `events` (ex. `{ type, at, planId, payload }`)
- Index TTL (7 jours) :
```js
db.events.createIndex(
  { at: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 }
);
```

---

## 🛣️ API (Hono)

### 🔐 CORS (global)
- `origin` = `CORS_ORIGIN`
- **Méthodes** : `GET, POST, PATCH, DELETE, OPTIONS`
- **Headers** : `Content-Type, Authorization`

### 🔗 Endpoints

| Méthode | Route              | Description              |
|--------:|--------------------|--------------------------|
| GET     | `/health`          | Health check             |
| POST    | `/api/submit`      | Créer un plan (alias)    |
| GET     | `/api/plans`       | Lister les plans         |
| GET     | `/api/plans/:id`   | Détail d’un plan         |
| PATCH   | `/api/plans/:id`   | Modifier partiellement   |
| DELETE  | `/api/plans/:id`   | Supprimer                |

**Payload (create/patch)**
```json
{
  "title": "string (>= 3)",
  "expectedMinutes": 45,
  "actualMinutes": 30,
  "dueAt": "2025-10-08T16:36:00.000Z",
  "note": "string <= 500"
}
```

**Réponses**
- `201 { ok: true, plan }` (create)
- `200 { ok: true, plan }` (patch)
- `200 { ok: true }` (delete)
- `400 { ok: false, error: "validation", issues: [...] }`
- `404 { ok: false, error: "not_found" }`

**Pagination (optionnelle)**
```
GET /api/plans?limit=20&cursor=123&order=due_at&dir=asc&from=...&to=...
→ { items: Plan[], nextCursor: number | null }
```

**Exemples `curl`**
```bash
# Create
curl -X POST http://localhost:3000/api/plans \
  -H "Content-Type: application/json" \
  -d '{"title":"Sprint Planning","expectedMinutes":60,"dueAt":"2025-10-31T15:00:00.000Z","note":"Salle A"}'

# Patch
curl -X PATCH http://localhost:3000/api/plans/4 \
  -H "Content-Type: application/json" \
  -d '{ "actualMinutes": 45, "note": "Terminé" }'

# Delete
curl -X DELETE http://localhost:3000/api/plans/4
```

---

## 🖥️ Front (Vue 3 + Vite + Tailwind)

### 📄 Pages
- `/plans` — liste + actions **Edit/Delete** (ConfirmModal)
- `/plans/new` — création (**Modal** succès)
- `/plans/:id/edit` — édition (**Modal** succès)

### 🧩 Composants
- `components/common/Modal.vue` — modale générique (Headless UI `TransitionRoot/Child`)
- `components/common/ConfirmModal.vue` — confirmation Delete
- `components/common/AlertMessage.vue` — alertes (`success|error|info|warning`)
- `@vuepic/vue-datepicker` — Date/Time picker (**`:teleport="false"`** recommandé)

### 🕒 Dates
- **Avant POST/PATCH** : sérialiser en **ISO UTC** (helper `toIsoUtc`)
- **Affichage** : `toLocaleString` (ou `date-fns`)

---

## 📜 Scripts NPM

**Web**
```bash
npm run dev       # Vite (dev)
npm run build     # build production
npm run preview   # preview du build
```

**Server**
```bash
npm run dev       # dev (ts-node/nodemon)
npm run start     # prod (node)
```

---

## ✅ Qualité & Tests

**API**
- **Vitest** + `hono/testing`
- Cas à couvrir : happy path, validation **Zod**, `not_found`

**E2E**
- **Playwright**
- Parcours : créer un plan → présent dans `/plans` → éditer → supprimer

---

## 🩺 Dépannage

> ⚠️ **CORS (PATCH/DELETE) bloqués**  
> Vérifier la **pré-requête OPTIONS** :  
> `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`  
> `Access-Control-Allow-Headers: Content-Type, Authorization`  
> Si `PATCH` manque → le navigateur bloque la requête.

> 🗑️ **DELETE → “Failed to fetch” côté front**  
> Si la route renvoie `204 No Content`, un `response.json()` lève une erreur.  
> ➜ Lire `response.text()` et parser JSON **seulement si non vide**, **ou** renvoyer `200 { ok: true }` côté serveur.

> 🗓️ **DatePicker / portails**  
> Utiliser `:teleport="false"` (ou `teleport="body"`) pour éviter les soucis d’insertion/overlay.

> 🎨 **Tailwind en Docker**  
> Le watcher **Vite** doit tourner **dans** le conteneur `web`.  
> Vérifier : import CSS dans `index.html` + chemins `content` de `tailwind.config.ts`.

---

## 🧭 Checklist de mise en route

- [ ] `cp server/.env.example server/.env`
- [ ] `cp web/.env.example web/.env`
- [ ] `npm i` dans `server/` et `web/`
- [ ] Lancer **Option A** _ou_ **Option B**
- [ ] Vérifier `http://localhost:5173` (Web) & `http://localhost:3000/health` (API)
- [ ] Tester un `POST /api/plans` puis vérifier la liste

---

## 👥 Équipe :

### FAREHAN Yahya : 
_Co-fondateur & Développeur logiciel (backend & frontend)_

### JDAIAA Youssef :
 _Co-fondateur & Responsable data/stats (optimisation des calculs & KPI)._


_Fait avec ❤️, Hono, Vue 3… et un peu de café ☕️_
