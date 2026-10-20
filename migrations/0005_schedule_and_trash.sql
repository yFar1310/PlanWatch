ALTER TABLE tasks ADD COLUMN planned_end_date TEXT CHECK(planned_end_date IS NULL OR (
  length(planned_end_date)=10 AND planned_end_date>='0001-01-01' AND planned_end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND COALESCE(date(planned_end_date,'+0 days')=planned_end_date,0)));
ALTER TABLE tasks ADD COLUMN start_time TEXT CHECK(start_time IS NULL OR (length(start_time)=5 AND start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time<'24:00'));
ALTER TABLE tasks ADD COLUMN end_time TEXT CHECK(end_time IS NULL OR (length(end_time)=5 AND end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time<'24:00'));
CREATE INDEX tasks_owner_timeline ON tasks(owner_id,planned_date,id) WHERE deleted_at IS NULL;
CREATE INDEX events_owner_task ON task_events(owner_id,task_id,id DESC);

CREATE TABLE purged_tasks (
  task_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  creation_key TEXT NOT NULL,
  purged_at INTEGER NOT NULL,
  UNIQUE(owner_id,creation_key)
) STRICT;
-- Keep only a content-free retry tombstone, so an old request cannot recreate erased work.
CREATE TRIGGER tasks_purge_history BEFORE DELETE ON tasks WHEN OLD.deleted_at IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO purged_tasks(task_id,owner_id,creation_key,purged_at) VALUES(OLD.id,OLD.owner_id,OLD.creation_key,unixepoch()*1000);
  DELETE FROM task_events WHERE owner_id=OLD.owner_id AND task_id=OLD.id;
END;

CREATE TRIGGER tasks_schedule_insert BEFORE INSERT ON tasks WHEN (NEW.planned_date IS NULL AND (NEW.planned_end_date IS NOT NULL OR NEW.start_time IS NOT NULL OR NEW.end_time IS NOT NULL)) OR (NEW.planned_end_date IS NOT NULL AND NEW.planned_end_date<NEW.planned_date) OR ((NEW.start_time IS NULL)<>(NEW.end_time IS NULL)) OR (NEW.start_time IS NOT NULL AND (NEW.end_time<=NEW.start_time OR (NEW.planned_end_date IS NOT NULL AND NEW.planned_end_date<>NEW.planned_date)))
BEGIN SELECT RAISE(ABORT,'invalid_schedule'); END;

CREATE TRIGGER tasks_schedule_update BEFORE UPDATE ON tasks WHEN (NEW.planned_date IS NULL AND (NEW.planned_end_date IS NOT NULL OR NEW.start_time IS NOT NULL OR NEW.end_time IS NOT NULL)) OR (NEW.planned_end_date IS NOT NULL AND NEW.planned_end_date<NEW.planned_date) OR ((NEW.start_time IS NULL)<>(NEW.end_time IS NULL)) OR (NEW.start_time IS NOT NULL AND (NEW.end_time<=NEW.start_time OR (NEW.planned_end_date IS NOT NULL AND NEW.planned_end_date<>NEW.planned_date)))
BEGIN SELECT RAISE(ABORT,'invalid_schedule'); END;

DROP TRIGGER tasks_record_create;
DROP TRIGGER tasks_record_update;

CREATE TRIGGER tasks_record_create AFTER INSERT ON tasks
BEGIN
  INSERT INTO task_events (owner_id, task_id, kind, at, before_json, after_json)
  VALUES (NEW.owner_id, NEW.id, 'created', NEW.created_at, NULL,
    json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'status', NEW.status, 'priority', NEW.priority,
      'estimateMinutes', NEW.estimate_minutes, 'actualMinutes', NEW.actual_minutes,
      'dependsOn', NEW.depends_on, 'plannedDate', NEW.planned_date, 'plannedEndDate', NEW.planned_end_date, 'startTime', NEW.start_time, 'endTime', NEW.end_time,
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
      'dependsOn', OLD.depends_on, 'plannedDate', OLD.planned_date, 'plannedEndDate', OLD.planned_end_date, 'startTime', OLD.start_time, 'endTime', OLD.end_time,
      'createdAt', OLD.created_at, 'updatedAt', OLD.updated_at,
      'completedAt', OLD.completed_at, 'deletedAt', OLD.deleted_at, 'version', OLD.version),
    json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'status', NEW.status, 'priority', NEW.priority,
      'estimateMinutes', NEW.estimate_minutes, 'actualMinutes', NEW.actual_minutes,
      'dependsOn', NEW.depends_on, 'plannedDate', NEW.planned_date, 'plannedEndDate', NEW.planned_end_date, 'startTime', NEW.start_time, 'endTime', NEW.end_time,
      'createdAt', NEW.created_at, 'updatedAt', NEW.updated_at,
      'completedAt', NEW.completed_at, 'deletedAt', NEW.deleted_at, 'version', NEW.version));
END;
