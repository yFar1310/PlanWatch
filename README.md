# PlanWatch

Minimal monorepo scaffold (Vue 3 frontend, Hono TypeScript server) with Postgres and MongoDB. Run everything with Docker Compose.

Prereqs
- Docker & Docker Compose
- (Optional) Node/npm for local debugging

Quickstart

```bash
cd infra
cp .env.example .env # optional
docker compose up --build
```

Open the UI: http://localhost:5173

Check health endpoint:

```bash
curl http://localhost:3000/health
```

Verify DBs

Postgres (run the following to inspect latest plans):

```bash
docker exec -it $(docker ps -qf name=postgres) psql -U app -d appdb -c "SELECT id,title,expected_minutes,due_at FROM plans ORDER BY id DESC LIMIT 5;"
```

Mongo (view recent events):

```bash
docker exec -it $(docker ps -qf name=mongo) mongosh --eval 'db.events.find().sort({_id:-1}).limit(5).pretty()'
```

Migration and seed scripts (server):

```bash
# run once to create table
docker compose run --rm server npm run migrate

# seed sample plans
docker compose run --rm server npm run seed
```

Notes
- Server: Hono on port 3000. Uses `POSTGRES_URL` and `MONGO_URL` from env.
- Web: Vite + Vue on port 5173. Uses `VITE_API_URL` env to reach server.

Git

Initialize repo and first commit suggestion:

```bash
git init
git add .
git commit -m "chore: initial PlanWatch monorepo scaffold (web, server, infra)"
```

Next steps
- Add a dashboard page to list plans and events.
- Add a separate migration runner or SQL files for more complex schemas.
- Investigate analytics (z-score anomaly detection) for durations.
