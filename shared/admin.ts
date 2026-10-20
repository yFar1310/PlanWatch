export interface Invitation {
  id: string; label: string; createdAt: number; expiresAt: number;
  status: 'active' | 'used' | 'revoked' | 'expired';
}
export interface Member {
  id: string; displayName: string; status: 'active' | 'banned'; createdAt: number; version: number;
  isAdmin: boolean; lastSeenAt: number | null; sessions: number; activeMs: number;
  tasks: number; completedTasks: number;
}
export interface AdminDashboard {
  totals: { members: number; banned: number; recentlySeen: number; activeMs: number; tasks: number };
  members: Member[]; nextCursor: string | null; invitations: Invitation[];
}
