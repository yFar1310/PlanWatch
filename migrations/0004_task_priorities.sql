ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('urgent','high','medium','low'));
CREATE INDEX tasks_owner_priority ON tasks(owner_id,priority,created_at DESC,id DESC) WHERE deleted_at IS NULL;

-- Completion must wait for an unfinished dependency. SQL checks cover concurrent changes as well.
CREATE TRIGGER tasks_validate_completion_insert BEFORE INSERT ON tasks
WHEN NEW.status='done' AND NEW.depends_on IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'dependency_incomplete') WHERE EXISTS(
    SELECT 1 FROM tasks WHERE id=NEW.depends_on AND owner_id=NEW.owner_id AND deleted_at IS NULL AND status<>'done'
  );
END;
CREATE TRIGGER tasks_validate_completion_update BEFORE UPDATE OF status,depends_on ON tasks
WHEN NEW.status='done' AND NEW.depends_on IS NOT NULL AND (OLD.status<>'done' OR NEW.depends_on IS NOT OLD.depends_on)
BEGIN
  SELECT RAISE(ABORT,'dependency_incomplete') WHERE EXISTS(
    SELECT 1 FROM tasks WHERE id=NEW.depends_on AND owner_id=NEW.owner_id AND deleted_at IS NULL AND status<>'done'
  );
END;

DROP TRIGGER tasks_record_create;
DROP TRIGGER tasks_record_update;

CREATE TRIGGER tasks_record_create AFTER INSERT ON tasks
BEGIN
  INSERT INTO task_events (owner_id, task_id, kind, at, before_json, after_json)
  VALUES (NEW.owner_id, NEW.id, 'created', NEW.created_at, NULL,
    json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'status', NEW.status, 'priority', NEW.priority,
      'estimateMinutes', NEW.estimate_minutes, 'actualMinutes', NEW.actual_minutes,
      'dependsOn', NEW.depends_on, 'plannedDate', NEW.planned_date,
      'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at,
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
    json_object('id', OLD.id, 'title', OLD.title, 'notes', OLD.notes, 'status', OLD.status, 'priority', OLD.priority,
      'estimateMinutes', OLD.estimate_minutes, 'actualMinutes', OLD.actual_minutes,
      'dependsOn', OLD.depends_on, 'plannedDate', OLD.planned_date,
      'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at,
      'completedAt', OLD.completed_at, 'deletedAt', OLD.deleted_at, 'version', OLD.version),
    json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'status', NEW.status, 'priority', NEW.priority,
      'estimateMinutes', NEW.estimate_minutes, 'actualMinutes', NEW.actual_minutes,
      'dependsOn', NEW.depends_on, 'plannedDate', NEW.planned_date,
      'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at,
      'completedAt', NEW.completed_at, 'deletedAt', NEW.deleted_at, 'version', NEW.version));
END;
