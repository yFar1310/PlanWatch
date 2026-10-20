export interface SessionInfo {
  mode: 'local' | 'clerk';
  email: string | null;
  expiresAt: number | null;
}
