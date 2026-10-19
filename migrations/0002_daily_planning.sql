ALTER TABLE tasks ADD COLUMN planned_date TEXT CHECK (
  planned_date IS NULL OR (
    length(planned_date) = 10 AND planned_date >= '0001-01-01'
    AND planned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND COALESCE(date(planned_date, '+0 days') = planned_date, 0)
  )
);

CREATE INDEX tasks_owner_planned ON tasks(owner_id, planned_date, created_at DESC, id DESC)
WHERE deleted_at IS NULL AND status <> 'done';
CREATE INDEX tasks_owner_deleted ON tasks(owner_id, deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;

-- Keep historical events intact. New snapshots also record the planned calendar day.
DROP TRIGGER tasks_record_create;
DROP TRIGGER tasks_record_update;

CREATE TRIGGER tasks_record_create AFTER INSERT ON tasks
BEGIN
  INSERT INTO task_events (owner_id, task_id, kind, at, before_json, after_json)
  VALUES (NEW.owner_id, NEW.id, 'created', NEW.created_at, NULL,
    json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'status', NEW.status,
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
    json_object('id', OLD.id, 'title', OLD.title, 'notes', OLD.notes, 'status', OLD.status,
      'estimateMinutes', OLD.estimate_minutes, 'actualMinutes', OLD.actual_minutes,
      'dependsOn', OLD.depends_on, 'plannedDate', OLD.planned_date,
      'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at,
      'completedAt', OLD.completed_at, 'deletedAt', OLD.deleted_at, 'version', OLD.version),
    json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'status', NEW.status,
      'estimateMinutes', NEW.estimate_minutes, 'actualMinutes', NEW.actual_minutes,
      'dependsOn', NEW.depends_on, 'plannedDate', NEW.planned_date,
      'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at,
      'completedAt', NEW.completed_at, 'deletedAt', NEW.deleted_at, 'version', NEW.version));
END;
