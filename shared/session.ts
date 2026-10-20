export interface SessionInfo {
  mode: 'local' | 'clerk';
  email: string | null;
  expiresAt: number | null;
  workspaceId: string;
  canAdmin: boolean;
  displayName: string;
}
