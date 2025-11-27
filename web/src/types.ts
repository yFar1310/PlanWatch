export type PlanStatus = 'not_started' | 'in_progress' | 'done';
export interface Plan {
dependsOn: null
id?: string
title: string
expectedMinutes: number
actualMinutes?: number
dueAt: string // ISO
note?: string
createdAt?: string,
status: PlanStatus,
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