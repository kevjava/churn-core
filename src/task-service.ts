import { Database } from './database';
import {
  Task,
  TaskStatus,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  CreateCompletionInput,
} from './types';
import { CurveFactory, PriorityCurve, AsyncPriorityCurve, DependencyChecker } from './curves';

export interface TaskWithPriority extends Task {
  priority: number;
}

export class TaskService implements DependencyChecker {
  constructor(private db: Database) {}

  // ===== CRUD =====

  async create(input: CreateTaskInput): Promise<Task> {
    // Validate dependencies exist and no circular refs
    if (input.dependencies && input.dependencies.length > 0) {
      await this.validateDependencies(input.dependencies);
    }

    const id = await this.db.insertTask(input);
    const task = await this.db.getTask(id);
    if (!task) {
      throw new Error('Failed to create task');
    }
    return task;
  }

  async get(id: number): Promise<Task | null> {
    return this.db.getTask(id);
  }

  async getTask(id: number): Promise<Task | null> {
    return this.db.getTask(id);
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    return this.db.getTasks(filter);
  }

  async update(id: number, updates: UpdateTaskInput): Promise<Task> {
    // Validate dependencies if being updated
    if (updates.dependencies && updates.dependencies.length > 0) {
      await this.validateDependencies(updates.dependencies, id);
    }

    await this.db.updateTask(id, updates);
    const task = await this.db.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }
    return task;
  }

  async delete(id: number): Promise<void> {
    // Check if other tasks depend on this one
    const dependents = await this.getDependents(id);
    if (dependents.length > 0) {
      const depIds = dependents.map((t) => t.id).join(', ');
      throw new Error(`Cannot delete task ${id}: tasks ${depIds} depend on it`);
    }

    await this.db.deleteTask(id);
  }

  // ===== STATUS MANAGEMENT =====

  async complete(id: number, completedAt?: Date): Promise<void> {
    const task = await this.db.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    const now = completedAt ?? new Date();

    // Record completion
    const completionInput: CreateCompletionInput = {
      task_id: id,
      completed_at: now,
      day_of_week: now.getDay(),
      hour_of_day: now.getHours(),
      scheduled_minutes: task.estimate_minutes,
    };
    await this.db.insertCompletion(completionInput);

    // Update task
    await this.db.setTaskLastCompleted(id, now);

    if (task.recurrence_pattern) {
      // Recurring task: calculate next due and keep open
      const nextDue = this.calculateNextDue(task, now);
      await this.db.setTaskNextDue(id, nextDue);
      await this.db.updateTask(id, { status: TaskStatus.OPEN });
    } else {
      // One-time task: mark as completed
      await this.db.updateTask(id, { status: TaskStatus.COMPLETED });
    }
  }

  async reopen(id: number): Promise<void> {
    const task = await this.db.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    await this.db.updateTask(id, { status: TaskStatus.OPEN });
  }

  // ===== QUERIES =====

  async search(query: string): Promise<Task[]> {
    return this.db.searchTasks(query);
  }

  async getDependencies(id: number): Promise<Task[]> {
    const task = await this.db.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    const dependencies: Task[] = [];
    for (const depId of task.dependencies) {
      const dep = await this.db.getTask(depId);
      if (dep) {
        dependencies.push(dep);
      }
    }
    return dependencies;
  }

  async getDependents(id: number): Promise<Task[]> {
    const allTasks = await this.db.getTasks();
    return allTasks.filter((task) => task.dependencies.includes(id));
  }

  async getRecurring(): Promise<Task[]> {
    return this.db.getTasks({ has_recurrence: true });
  }

  async getBlocked(): Promise<Task[]> {
    const allTasks = await this.db.getTasks({
      status: [TaskStatus.OPEN, TaskStatus.BLOCKED],
    });

    const blocked: Task[] = [];
    for (const task of allTasks) {
      if (task.dependencies.length > 0) {
        const allComplete = await this.allDependenciesComplete(task.dependencies);
        if (!allComplete) {
          blocked.push(task);
        }
      }
    }
    return blocked;
  }

  async allDependenciesComplete(dependencies: number[]): Promise<boolean> {
    for (const depId of dependencies) {
      const task = await this.db.getTask(depId);
      if (!task || task.status !== TaskStatus.COMPLETED) {
        return false;
      }
    }
    return true;
  }

  // ===== PRIORITY =====

  async calculatePriority(id: number, datetime?: Date): Promise<number> {
    const task = await this.db.getTask(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    return this.calculateTaskPriority(task, datetime ?? new Date());
  }

  async getByPriority(limit?: number, datetime?: Date): Promise<TaskWithPriority[]> {
    const now = datetime ?? new Date();
    const tasks = await this.db.getTasks({
      status: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS],
    });

    const tasksWithPriority: TaskWithPriority[] = [];

    for (const task of tasks) {
      const priority = await this.calculateTaskPriority(task, now);
      tasksWithPriority.push({ ...task, priority });
    }

    // Sort by priority descending
    tasksWithPriority.sort((a, b) => b.priority - a.priority);

    if (limit) {
      return tasksWithPriority.slice(0, limit);
    }
    return tasksWithPriority;
  }

  // ===== PRIVATE HELPERS =====

  private async calculateTaskPriority(task: Task, datetime: Date): Promise<number> {
    // Check if blocked by dependencies first
    if (task.dependencies.length > 0) {
      const allComplete = await this.allDependenciesComplete(task.dependencies);
      if (!allComplete) {
        return 0; // Blocked tasks have zero priority
      }
    }

    // Check time window if applicable
    if (task.window_start && task.window_end) {
      if (!this.isInTimeWindow(datetime, task.window_start, task.window_end)) {
        return 0; // Outside time window
      }
    }

    try {
      const curve = CurveFactory.create(task.curve_config, this, task);

      if (this.isAsyncCurve(curve)) {
        return await curve.calculate(datetime);
      } else {
        return curve.calculate(datetime);
      }
    } catch {
      // Fallback to linear if curve creation fails
      return this.calculateLinearPriority(task, datetime);
    }
  }

  private isAsyncCurve(curve: PriorityCurve | AsyncPriorityCurve): curve is AsyncPriorityCurve {
    return curve.calculate.constructor.name === 'AsyncFunction';
  }

  private calculateLinearPriority(task: Task, datetime: Date): number {
    const start = task.created_at.getTime();
    const end = task.deadline?.getTime() ?? start + 7 * 86400000;
    const now = datetime.getTime();

    if (now < start) return 0;
    if (now > end) {
      return 1.0 + (now - end) / (end - start);
    }
    return (now - start) / (end - start);
  }

  private isInTimeWindow(datetime: Date, windowStart: string, windowEnd: string): boolean {
    const [startHour, startMin] = windowStart.split(':').map(Number);
    const [endHour, endMin] = windowEnd.split(':').map(Number);

    const currentHour = datetime.getHours();
    const currentMin = datetime.getMinutes();
    const currentTime = currentHour * 60 + currentMin;
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    // Handle windows that cross midnight
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime;
    }

    return currentTime >= startTime && currentTime <= endTime;
  }

  private calculateNextDue(task: Task, completedAt: Date): Date {
    const pattern = task.recurrence_pattern;
    if (!pattern) {
      throw new Error('Task has no recurrence pattern');
    }

    const msPerDay = 86400000;

    if (pattern.mode === 'completion') {
      // Completion mode: next due is interval after completion
      let intervalDays = 7; // default
      if (pattern.type === 'daily') {
        intervalDays = 1;
      } else if (pattern.type === 'weekly') {
        intervalDays = 7;
      } else if (pattern.type === 'monthly') {
        intervalDays = 30;
      } else if (pattern.type === 'interval' && pattern.interval && pattern.unit) {
        const unitDays: Record<string, number> = { days: 1, weeks: 7, months: 30 };
        intervalDays = pattern.interval * unitDays[pattern.unit];
      }
      return new Date(completedAt.getTime() + intervalDays * msPerDay);
    } else {
      // Calendar mode: next occurrence based on schedule
      const now = completedAt;

      if (pattern.type === 'daily') {
        // Next day
        const next = new Date(now);
        next.setDate(next.getDate() + 1);
        next.setHours(0, 0, 0, 0);
        return next;
      } else if (pattern.type === 'weekly' && pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
        // Next occurrence of any of the specified weekdays
        const next = new Date(now);
        next.setDate(next.getDate() + 1); // Start from tomorrow
        next.setHours(0, 0, 0, 0);

        // Find the next day that's in daysOfWeek (max 7 iterations)
        for (let i = 0; i < 7; i++) {
          if (pattern.daysOfWeek.includes(next.getDay())) {
            return next;
          }
          next.setDate(next.getDate() + 1);
        }
        return next; // Should never reach here
      } else if (pattern.type === 'weekly' && pattern.dayOfWeek !== undefined) {
        // Next occurrence of single weekday
        const next = new Date(now);
        const currentDay = next.getDay();
        let daysUntil = pattern.dayOfWeek - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        next.setDate(next.getDate() + daysUntil);
        next.setHours(0, 0, 0, 0);
        return next;
      } else if (pattern.type === 'monthly') {
        // Next month, same day
        const next = new Date(now);
        next.setMonth(next.getMonth() + 1);
        next.setHours(0, 0, 0, 0);
        return next;
      } else if (pattern.type === 'interval' && pattern.interval && pattern.unit) {
        const unitDays: Record<string, number> = { days: 1, weeks: 7, months: 30 };
        const intervalDays = pattern.interval * unitDays[pattern.unit];
        const anchor = pattern.anchor ?? task.created_at;

        // Find next occurrence after now
        let next = new Date(anchor);
        while (next.getTime() <= now.getTime()) {
          next = new Date(next.getTime() + intervalDays * msPerDay);
        }
        return next;
      }

      // Fallback: 7 days
      return new Date(now.getTime() + 7 * msPerDay);
    }
  }

  private async validateDependencies(
    dependencies: number[],
    excludeTaskId?: number
  ): Promise<void> {
    // Check all dependencies exist
    for (const depId of dependencies) {
      const dep = await this.db.getTask(depId);
      if (!dep) {
        throw new Error(`Dependency task ${depId} not found`);
      }
    }

    // Check for circular dependencies
    if (excludeTaskId !== undefined) {
      const visited = new Set<number>();
      const queue = [...dependencies];

      while (queue.length > 0) {
        const current = queue.shift()!;

        if (current === excludeTaskId) {
          throw new Error('Circular dependency detected');
        }

        if (visited.has(current)) {
          continue;
        }

        visited.add(current);

        const task = await this.db.getTask(current);
        if (task?.dependencies) {
          queue.push(...task.dependencies);
        }
      }
    }
  }
}
