// web/src/types.ts
export type PlanStatus = 'not_started' | 'in_progress' | 'done';

export interface Plan {
  id?: number;
  title: string;
  expectedMinutes: number;
  actualMinutes?: number | null;
  dueAt: string;                 // ISO
  note?: string | null;
  dependsOn?: number | null;
  createdAt?: string;

  status?: PlanStatus;
  userId?: number;
  projectId?: number | null;
  priority?: number | null;      // -5 .. 5
  recurrenceRule?: string | null;
}


export interface DashboardStats {
    todayExpectedMinutes: number;
    todayActualMinutes: number;
    todayCount: number;
    upcomingCount: number;
    plansWithDependency: number;
  }
  
  export interface ActivityEvent {
    id: string;
    type: string;          // 'plan_submitted' | 'plan_updated' | 'plan_deleted'
    at: string;            // ISO date
    planId: number | null;
    dependsOn?: number | null;
  }

  export interface User {
  id: number;
  email: string;
  fullName?: string | null;
  avatarData?: string | null;
}