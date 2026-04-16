import { Injectable, signal } from '@angular/core';

export interface AiTask {
  id: string;
  title: string;
  details: string;
  dueDate: string | null;
  sourceSubject: string;
  sourceSender: string;
  createdAt: string;
  completed: boolean;
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private static readonly storageKey = 'mailflow_ai_tasks';

  readonly tasks = signal<AiTask[]>(this.readTasks());

  addTask(task: Omit<AiTask, 'id' | 'createdAt' | 'completed'>): void {
    const nextTask: AiTask = {
      ...task,
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
      completed: false,
    };
    this.tasks.update((tasks) => [nextTask, ...tasks]);
    this.persist();
  }

  toggleCompleted(id: string): void {
    this.tasks.update((tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task))
    );
    this.persist();
  }

  removeTask(id: string): void {
    this.tasks.update((tasks) => tasks.filter((task) => task.id !== id));
    this.persist();
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TaskService.storageKey, JSON.stringify(this.tasks()));
  }

  private readTasks(): AiTask[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(TaskService.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
