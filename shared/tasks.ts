export type TaskStatus = 'todo' | 'doing' | 'done';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  estimateMinutes: number | null;
  actualMinutes: number | null;
  dependsOn: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  deletedAt: number | null;
  version: number;
}

export interface TaskPage { items: Task[]; nextCursor: string | null }
export interface ApiProblem { error: string; message: string }
