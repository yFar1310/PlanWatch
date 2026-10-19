# Step 1: reliable task actions

This step fixes core task behavior before changing the layout or adding Neo4j/AI.

- Create, edit, and delete commit to PostgreSQL together with a durable `task_outbox` event.
- A background publisher delivers events and task snapshots to MongoDB every three seconds. Delivery failures are retried without failing a task save. History may take a few seconds to appear.
- Events include full task snapshots and the prior state for edits/deletes. Stable event IDs prevent duplicate activity during retries. The ordered publisher can later feed a Neo4j projection.
- Omitted PATCH fields remain unchanged; explicit null clears optional values.
- Status is explicit and independent of time spent or the due date.
- Self-dependencies, cycles, links to another account, and inconsistent parent/child deadlines are rejected. Per-user transaction locks protect simultaneous graph edits.
- Repeating a delete is safe. Deletion is still permanent in this step; recovery/Trash belongs to a later UX step.
- The task list and editor show load failures and Retry, and deletion shows its pending/error state. A successful deletion updates the visible list without another fetch.
- Demo seeding and reset are gated behind `SEED_DEMO_DATA=true`; normal startup does not reset seeded account names/passwords or repopulate empty lists. Existing accounts and tasks are preserved.

Run from `infra/` with Docker Desktop running:

```sh
docker compose up -d --build
docker compose exec -T server npm run typecheck
docker compose exec -T server npm run build
docker compose exec -T server npm test
docker compose exec -T web npm run build
```

The integration suite uses a unique PostgreSQL schema and MongoDB database, then removes them. It does not modify ordinary app data. PostgreSQL credentials used for tests must permit creating schemas.

To inspect pending event delivery:

```sh
docker compose exec -T postgres psql -U app -d appdb -c 'SELECT count(*) FROM task_outbox WHERE delivered_at IS NULL'
docker compose logs --tail=50 server
```

Back up PostgreSQL as well as MongoDB. The outbox is durable and retained; retention/archiving, richer history UI, Neo4j delivery, and report jobs will be added in later steps. Do not delete pending events.

Still pending: Today redesign, quick-add, undo/Trash, full pagination/filtering, completion timestamps/timezone consistency, map interaction improvements, Neo4j, weekly email, and AI integration. No paid services or AI calls are enabled by this step.

Verification on 19 October 2026: all 13 regression scenarios passed, including rollback when event insertion fails, concurrent cycle prevention, and replay without duplicate MongoDB events. Backend typecheck/build and frontend production build passed. The existing account login and five saved tasks were verified after restart. Browser interaction testing was unavailable; rendered/mobile behavior still needs visual verification. The frontend retains its existing large-bundle warning.
