import { z } from 'zod';
import { AuthError, type AuthBindings, type Identity, type Session } from './auth';
import { Problem } from './tasks';
import type { AdminDashboard, Invitation } from '../shared/admin';

export const invitationSchema = z.object({ label: z.string().trim().min(1).max(80) }).strict();
export const acceptSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), displayName: z.string().trim().min(1).max(80), usageAcknowledged: z.literal(true) }).strict();
export const memberStatusSchema = z.object({ status: z.enum(['active', 'banned']), version: z.number().int().positive() }).strict();
export const activitySchema = z.object({ active: z.boolean() }).strict();
interface Workspace { id: string; clerk_user_id: string; display_name: string; status: 'active' | 'banned' }
const DAY = 86_400_000;

export async function resolveWorkspace(db: D1Database, identity: Identity, env: AuthBindings): Promise<Session> {
  if (identity.mode === 'local') return { ...identity, ownerId: 'local-preview', workspaceId: 'local-preview', displayName: 'Local preview', canAdmin: false };
  const admin = identity.userId === env.CLERK_OWNER_USER_ID?.trim();
  let workspace = await db.prepare('SELECT id,clerk_user_id,display_name,status FROM workspaces WHERE clerk_user_id=?').bind(identity.userId).first<Workspace>();
  if (admin && !workspace) {
    // The configured administrator alone can claim the existing personal data. A different ID never wins a race.
    await db.prepare("INSERT INTO workspaces(id,clerk_user_id,display_name,created_at) VALUES('personal',?,'Administrator',?) ON CONFLICT DO NOTHING")
      .bind(identity.userId, Date.now()).run();
  }
  workspace ??= await db.prepare('SELECT id,clerk_user_id,display_name,status FROM workspaces WHERE clerk_user_id=?').bind(identity.userId).first<Workspace>();
  if (!workspace) throw new AuthError('invitation_required', 'You need an invitation to create your private workspace.', 403);
  if (workspace.status !== 'active') throw new AuthError('account_banned', 'Your access has been paused. Contact the administrator.', 403);
  if (admin && workspace.id !== 'personal') throw new AuthError('setup_required', 'The administrator workspace needs attention.', 503);
  return { ...identity, ownerId: workspace.id, workspaceId: workspace.id, displayName: workspace.display_name, canAdmin: admin && workspace.id === 'personal' };
}
export function requireAdmin(session: Session) {
  if (!session.canAdmin) throw new AuthError('admin_required', 'Only the administrator can manage invitations and members.', 403);
}
async function hash(code: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
export async function createInvitation(db: D1Database, session: Session, label: string, appOrigin: string) {
  requireAdmin(session);
  const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
  const id = crypto.randomUUID(), now = Date.now(), expiresAt = now + 7 * DAY;
  const result = await db.prepare(`INSERT INTO invitations(id,token_hash,label,created_by,created_at,expires_at)
    SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM invitations WHERE redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>?)<20`)
    .bind(id, await hash(code), label, session.workspaceId, now, expiresAt, now).run();
  if (!result.meta.changes) throw new Problem('invitation_limit', 'You already have 20 unused invitations. Revoke one before creating another.', 409);
  return { invitation: { id, label, createdAt: now, expiresAt, status: 'active' } satisfies Invitation, link: `${new URL(appOrigin).origin}/#invite=${code}` };
}
export async function acceptInvitation(db: D1Database, identity: Identity, input: z.infer<typeof acceptSchema>) {
  if (identity.mode !== 'clerk' || !identity.userId) throw new AuthError('sign_in_required', 'Sign in before accepting an invitation.', 401);
  const existing = await db.prepare('SELECT id,status FROM workspaces WHERE clerk_user_id=?').bind(identity.userId).first<{ id: string; status: string }>();
  if (existing?.status === 'banned') throw new AuthError('account_banned', 'Your access has been paused. A new invitation cannot reactivate it.', 403);
  if (existing) throw new Problem('already_member', 'You already have a private workspace. Open it instead of using this invitation.', 409);
  const digest = await hash(input.code), now = Date.now(), workspaceId = crypto.randomUUID();
  const result = await db.batch([
    db.prepare(`UPDATE invitations SET redeemed_by=?,redeemed_at=? WHERE token_hash=? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>?
      AND NOT EXISTS(SELECT 1 FROM workspaces WHERE clerk_user_id=?)`).bind(identity.userId, now, digest, now, identity.userId),
    db.prepare(`INSERT INTO workspaces(id,clerk_user_id,display_name,created_at)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM invitations WHERE token_hash=? AND redeemed_by=? AND redeemed_at=?)
      AND NOT EXISTS(SELECT 1 FROM workspaces WHERE clerk_user_id=?)`)
      .bind(workspaceId, identity.userId, input.displayName, now, digest, identity.userId, now, identity.userId),
  ]);
  if (!result[0].meta.changes) throw new Problem('invalid_invitation', 'This invitation is invalid, expired, revoked, or already used. Ask for a new link.');
  return { joined: true };
}
export async function revokeInvitation(db: D1Database, session: Session, id: string) {
  requireAdmin(session);
  const result = await db.prepare('UPDATE invitations SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND created_by=? AND redeemed_at IS NULL')
    .bind(Date.now(), id, session.workspaceId).run();
  if (!result.meta.changes) throw new Problem('invitation_unavailable', 'That invitation is unavailable or already used.', 404);
  return { revoked: true };
}
export async function setMemberStatus(db: D1Database, session: Session, id: string, input: z.infer<typeof memberStatusSchema>) {
  requireAdmin(session);
  if (id === 'personal' || id === session.workspaceId) throw new AuthError('protected_admin', 'The administrator cannot be banned.', 403);
  const now = Date.now();
  const results = await db.batch([
    db.prepare('UPDATE workspaces SET status=?,version=version+1 WHERE id=? AND version=?').bind(input.status, id, input.version),
    db.prepare(`UPDATE usage_sessions SET active=0,ended_at=? WHERE workspace_id=? AND ended_at IS NULL
      AND EXISTS(SELECT 1 FROM workspaces WHERE id=? AND status='banned')`).bind(now, id, id),
  ]);
  if (!results[0].meta.changes) throw new Problem('version_conflict', 'This member changed elsewhere. Refresh before trying again.', 409);
  return { updated: true };
}
export async function recordActivity(db: D1Database, session: Session, active: boolean) {
  if (session.mode === 'local' || !session.sessionId) return { recorded: false };
  const now = Date.now();
  await db.prepare(`INSERT INTO usage_sessions(session_id,workspace_id,started_at,last_seen_at,active,ended_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=? AND status='active')
    ON CONFLICT(session_id) DO UPDATE SET
    active_ms=usage_sessions.active_ms+CASE WHEN usage_sessions.active=1 AND excluded.active=1
      AND excluded.last_seen_at-usage_sessions.last_seen_at BETWEEN 0 AND 45000
      THEN min(excluded.last_seen_at-usage_sessions.last_seen_at,30000) ELSE 0 END,
    last_seen_at=excluded.last_seen_at,active=excluded.active,ended_at=CASE WHEN excluded.active=0 THEN excluded.last_seen_at ELSE NULL END
    WHERE usage_sessions.workspace_id=excluded.workspace_id AND EXISTS(SELECT 1 FROM workspaces WHERE id=excluded.workspace_id AND status='active')`).bind(session.sessionId, session.workspaceId, now, now, active ? 1 : 0, active ? null : now, session.workspaceId).run();
  return { recorded: true };
}
export async function dashboard(db: D1Database, session: Session, query: URLSearchParams): Promise<AdminDashboard> {
  requireAdmin(session);
  const search = z.string().trim().max(80).parse(query.get('q') ?? '');
  const state = z.enum(['all','active','banned']).parse(query.get('status') ?? 'all');
  const limit = 50, where = ['instr(lower(display_name),lower(?))>0'];
  const bindings: (string | number)[] = [search];
  if (state !== 'all') { where.push('status=?'); bindings.push(state); }
  const scope = JSON.stringify([session.workspaceId, search, state]);
  if (query.has('cursor')) {
    try {
      const cursor = z.object({ at: z.number().int(), id: z.string(), scope: z.literal(scope) }).parse(JSON.parse(decodeURIComponent(atob(query.get('cursor')!))));
      where.push('(created_at<? OR (created_at=? AND id<?))'); bindings.push(cursor.at,cursor.at,cursor.id);
    } catch { throw new Problem('invalid_cursor', 'Refresh the member list and try again.'); }
  }
  const now = Date.now();
  const results = await db.batch([
    db.prepare(`SELECT count(*) AS members,COALESCE(sum(status='banned'),0) AS banned,
      (SELECT count(DISTINCT workspace_id) FROM usage_sessions WHERE last_seen_at>? AND ended_at IS NULL) AS recentlySeen,
      (SELECT COALESCE(sum(active_ms),0) FROM usage_sessions) AS activeMs,(SELECT count(*) FROM tasks WHERE owner_id IN (SELECT id FROM workspaces)) AS tasks FROM workspaces`).bind(now - 15*60_000),
    db.prepare(`SELECT id,display_name AS displayName,status,created_at AS createdAt,version,(id='personal') AS isAdmin,
      (SELECT max(last_seen_at) FROM usage_sessions WHERE workspace_id=w.id) AS lastSeenAt,
      (SELECT count(*) FROM usage_sessions WHERE workspace_id=w.id) AS sessions,
      (SELECT COALESCE(sum(active_ms),0) FROM usage_sessions WHERE workspace_id=w.id) AS activeMs,
      (SELECT count(*) FROM tasks WHERE owner_id=w.id) AS tasks,
      (SELECT count(*) FROM tasks WHERE owner_id=w.id AND status='done') AS completedTasks
      FROM workspaces w WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`).bind(...bindings,limit+1),
    db.prepare(`SELECT id,label,created_at AS createdAt,expires_at AS expiresAt,
      CASE WHEN redeemed_at IS NOT NULL THEN 'used' WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at<=? THEN 'expired' ELSE 'active' END AS status
      FROM invitations WHERE created_by=? ORDER BY (redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>?) DESC,created_at DESC,id DESC LIMIT 50`).bind(now,session.workspaceId,now),
  ]);
  const all = results[1].results as unknown as AdminDashboard['members'];
  const members = all.slice(0,limit).map(member => ({ ...member, isAdmin: !!member.isAdmin }));
  const last = members.at(-1);
  return { totals: results[0].results[0] as unknown as AdminDashboard['totals'], members,
    nextCursor: all.length>limit && last ? btoa(encodeURIComponent(JSON.stringify({ at:last.createdAt,id:last.id,scope }))) : null,
    invitations: results[2].results as unknown as Invitation[] };
}
