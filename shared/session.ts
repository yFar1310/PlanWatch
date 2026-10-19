export interface SessionInfo {
  mode: 'local' | 'access';
  email: string | null;
  expiresAt: number | null;
}
