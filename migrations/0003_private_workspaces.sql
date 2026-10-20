-- Existing task owners and event snapshots are preserved. The administrator's workspace stays 'personal'.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (id <> 'personal' OR status = 'active')
) STRICT;
CREATE INDEX workspaces_created ON workspaces(created_at DESC, id DESC);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  created_by TEXT NOT NULL REFERENCES workspaces(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER,
  redeemed_by TEXT,
  redeemed_at INTEGER,
  CHECK ((redeemed_by IS NULL) = (redeemed_at IS NULL))
) STRICT;
CREATE INDEX invitations_created ON invitations(created_at DESC, id DESC);

CREATE TABLE usage_sessions (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0 CHECK (active_ms >= 0),
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  ended_at INTEGER
) STRICT;
CREATE INDEX usage_workspace_seen ON usage_sessions(workspace_id,last_seen_at DESC);
