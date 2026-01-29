import {
  TaskScheduler,
  ScheduledTask as SchedulerTask,
  DailyPlan as SchedulerPlan,
  CompletionData,
} from '@kevjava/task-parser';
import { TaskService } from './task-service';
import { DailyPlanner, PlannerConfig } from './planner';
import { Database } from './database';
import { Task, CreateCompletionInput } from './types';

/**
 * ChurnScheduler implements TaskScheduler with priority curves and recurrence.
 *
 * Uses DailyPlanner for time-based scheduling with:
 * - Priority curves (linear, exponential, accumulator, etc.)
 * - Time windows
 * - Dependencies
 * - Recurrence patterns
 */
export class ChurnScheduler implements TaskScheduler {
  private taskService: TaskService;
  private planner: DailyPlanner;
  private db: Database;

  constructor(db: Database, plannerConfig?: Partial<PlannerConfig>) {
    this.db = db;
    this.taskService = new TaskService(db);
    this.planner = new DailyPlanner(plannerConfig);
  }

  async getDailyPlan(date: Date, options?: { limit?: number }): Promise<SchedulerPlan> {
    const plan = await this.planner.planDay(this.taskService, date, {
      limit: options?.limit ?? 10,
      includeTimeBlocks: false, // Just return prioritized list for now
    });

    // Convert to TaskScheduler format
    const tasks: SchedulerTask[] = plan.scheduled.map((s) => this.taskToSchedulerTask(s.task));

    return {
      tasks,
      totalMinutes: plan.totalScheduledMinutes,
      remainingMinutes: plan.remainingMinutes,
    };
  }

  async getTask(id: number): Promise<SchedulerTask | null> {
    const task = await this.taskService.get(id);
    if (!task) return null;
    return this.taskToSchedulerTask(task);
  }

  async completeTask(completion: CompletionData): Promise<void> {
    const task = await this.taskService.get(completion.taskId);
    if (!task) {
      throw new Error(`Task ${completion.taskId} not found`);
    }

    // Record completion with time tracking data
    const completionInput: CreateCompletionInput = {
      task_id: completion.taskId,
      completed_at: completion.completedAt,
      actual_minutes: completion.actualMinutes,
      scheduled_minutes: completion.scheduledMinutes ?? task.estimate_minutes,
      variance_minutes:
        completion.scheduledMinutes !== undefined
          ? completion.actualMinutes - completion.scheduledMinutes
          : undefined,
      day_of_week: completion.completedAt.getDay(),
      hour_of_day: completion.completedAt.getHours(),
    };
    await this.db.insertCompletion(completionInput);

    // Update task (handles recurrence internally)
    await this.taskService.complete(completion.taskId, completion.completedAt);
  }

  async addTask(task: Omit<SchedulerTask, 'id'>): Promise<SchedulerTask> {
    const created = await this.taskService.create({
      title: task.title,
      project: task.project,
      tags: task.tags,
      estimate_minutes: task.estimateMinutes,
      deadline: task.deadline,
      window_start: task.windowStart,
      window_end: task.windowEnd,
    });

    return this.taskToSchedulerTask(created);
  }

  async removeTask(id: number): Promise<void> {
    await this.taskService.delete(id);
  }

  isAvailable(): boolean {
    return true;
  }

  // ===== Additional Methods for Churn-specific functionality =====

  /**
   * Get the underlying TaskService for advanced operations
   */
  getTaskService(): TaskService {
    return this.taskService;
  }

  /**
   * Get the underlying DailyPlanner
   */
  getPlanner(): DailyPlanner {
    return this.planner;
  }

  // ===== Private Helpers =====

  private taskToSchedulerTask(task: Task & { priority?: number }): SchedulerTask {
    return {
      id: task.id,
      title: task.title,
      project: task.project,
      tags: task.tags,
      estimateMinutes: task.estimate_minutes,
      priority: task.priority,
      deadline: task.deadline,
      windowStart: task.window_start,
      windowEnd: task.window_end,
    };
  }
}
