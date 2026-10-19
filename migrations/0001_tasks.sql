CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 5000),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR estimate_minutes > 0),
  actual_minutes INTEGER CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  depends_on TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  deleted_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  creation_key TEXT NOT NULL,
  creation_payload TEXT NOT NULL CHECK (json_valid(creation_payload)),
  UNIQUE (owner_id, creation_key),
  CHECK ((status = 'done' AND completed_at IS NOT NULL) OR (status <> 'done' AND completed_at IS NULL))
) STRICT;

CREATE INDEX tasks_owner_created ON tasks(owner_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX tasks_owner_dependency ON tasks(owner_id, depends_on);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'updated', 'deleted', 'restored')),
  at INTEGER NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json))
) STRICT;

CREATE INDEX events_owner_time ON task_events(owner_id, at DESC, id DESC);

CREATE TRIGGER tasks_validate_insert
BEFORE INSERT ON tasks WHEN NEW.depends_on IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'dependency_cycle') WHERE NEW.depends_on = NEW.id;
  SELECT RAISE(ABORT, 'dependency_not_found') WHERE NOT EXISTS (
    SELECT 1 FROM tasks WHERE id = NEW.depends_on AND owner_id = NEW.owner_id AND deleted_at IS NULL
  );
END;

CREATE TRIGGER tasks_validate_dependency
BEFORE UPDATE OF depends_on ON tasks WHEN NEW.depends_on IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'dependency_not_found') WHERE NOT EXISTS (
    SELECT 1 FROM tasks WHERE id = NEW.depends_on AND owner_id = NEW.owner_id AND deleted_at IS NULL
  );
  SELECT RAISE(ABORT, 'dependency_cycle') WHERE EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.depends_on
      UNION
      SELECT t.depends_on FROM tasks t JOIN ancestors a ON t.id = a.id
      WHERE t.owner_id = NEW.owner_id AND t.depends_on IS NOT NULL
    ) SELECT 1 FROM ancestors WHERE id = NEW.id
  );
END;

-- History is written by the same SQL operation. A failed history insert aborts the task mutation.
CREATE TRIGGER tasks_record_create AFTER INSERT ON tasks
BEGIN
  INSERT INTO task_events (owner_id, task_id, kind, at, before_json, after_json)
  VALUES (NEW.owner_id, NEW.id, 'created', NEW.created_at, NULL,
    json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'status', NEW.status,
      'estimateMinutes', NEW.estimate_minutes, 'actualMinutes', NEW.actual_minutes,
      'dependsOn', NEW.depends_on, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at,
      'completedAt', NEW.completed_at, 'deletedAt', NEW.deleted_at, 'version', NEW.version));
END;

CREATE TRIGGER tasks_record_update AFTER UPDATE ON tasks
BEGIN
  INSERT INTO task_events (owner_id, task_id, kind, at, before_json, after_json)
  VALUES (NEW.owner_id, NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'deleted'
         WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN 'restored'
         ELSE 'updated' END,
    NEW.updated_at,
    json_object('id', OLD.id, 'title', OLD.title, 'notes', OLD.notes, 'status', OLD.status,
      'estimateMinutes', OLD.estimate_minutes, 'actualMinutes', OLD.actual_minutes,
      'dependsOn', OLD.depends_on, 'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at,
      'completedAt', OLD.completed_at, 'deletedAt', OLD.deleted_at, 'version', OLD.version),
    json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'status', NEW.status,
      'estimateMinutes', NEW.estimate_minutes, 'actualMinutes', NEW.actual_minutes,
      'dependsOn', NEW.depends_on, 'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at,
      'completedAt', NEW.completed_at, 'deletedAt', NEW.deleted_at, 'version', NEW.version));
END;

CREATE TRIGGER tasks_unlink_deleted_parent AFTER UPDATE OF deleted_at ON tasks
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE tasks SET depends_on = NULL, updated_at = NEW.updated_at, version = version + 1
  WHERE owner_id = NEW.owner_id AND depends_on = NEW.id;
END;
