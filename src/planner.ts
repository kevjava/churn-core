import { TaskWithPriority, TaskService } from './task-service';

// ===== TYPES =====

export interface TimeSlot {
  start: string; // HH:MM
  end: string; // HH:MM
}

export interface ScheduledTask {
  task: TaskWithPriority;
  slot: TimeSlot;
  estimateMinutes: number;
  isDefaultEstimate: boolean;
}

export interface UnscheduledTask {
  task: TaskWithPriority;
  reason: string;
}

export interface DailyPlan {
  date: Date;
  workHours: TimeSlot;
  scheduled: ScheduledTask[];
  unscheduled: UnscheduledTask[];
  totalScheduledMinutes: number;
  remainingMinutes: number;
}

export interface PlannerConfig {
  workHoursStart: string; // HH:MM, default "08:00"
  workHoursEnd: string; // HH:MM, default "17:00"
  defaultEstimateMinutes: number; // default 15
}

const DEFAULT_CONFIG: PlannerConfig = {
  workHoursStart: '08:00',
  workHoursEnd: '17:00',
  defaultEstimateMinutes: 15,
};

// ===== HELPERS =====

/**
 * Parse HH:MM string to minutes since midnight
 */
function parseTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Format minutes since midnight to HH:MM string
 */
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Get the intersection of two time ranges
 */
function rangeIntersection(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): { start: number; end: number } | null {
  const start = Math.max(start1, start2);
  const end = Math.min(end1, end2);
  if (start >= end) return null;
  return { start, end };
}

// ===== DAILY PLANNER =====

export class DailyPlanner {
  private config: PlannerConfig;

  constructor(config: Partial<PlannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a daily plan for the given date.
   * Uses greedy first-fit scheduling based on priority.
   */
  async planDay(
    taskService: TaskService,
    date: Date,
    options: { limit?: number; includeTimeBlocks?: boolean } = {}
  ): Promise<DailyPlan> {
    const { limit = 8, includeTimeBlocks = true } = options;

    // Use mid-morning (9 AM or work start, whichever is later) for priority calculation
    // This ensures tasks with typical time windows get proper priority
    const priorityTime = new Date(date);
    const [startHour, startMin] = this.config.workHoursStart.split(':').map(Number);
    const calcHour = Math.max(startHour, 9); // At least 9 AM
    priorityTime.setHours(calcHour, startMin, 0, 0);

    // Get tasks sorted by priority
    const tasks = await taskService.getByPriority(limit * 2, priorityTime);

    // Filter to actionable tasks
    const actionable = this.filterActionable(tasks, date);

    const workStart = parseTime(this.config.workHoursStart);
    const workEnd = parseTime(this.config.workHoursEnd);
    const totalWorkMinutes = workEnd - workStart;

    if (!includeTimeBlocks) {
      // Just return prioritized list without scheduling
      const scheduled: ScheduledTask[] = actionable.slice(0, limit).map((task) => ({
        task,
        slot: { start: this.config.workHoursStart, end: this.config.workHoursEnd },
        estimateMinutes: task.estimate_minutes ?? this.config.defaultEstimateMinutes,
        isDefaultEstimate: !task.estimate_minutes,
      }));

      const totalScheduled = scheduled.reduce((sum, s) => sum + s.estimateMinutes, 0);

      return {
        date,
        workHours: {
          start: this.config.workHoursStart,
          end: this.config.workHoursEnd,
        },
        scheduled,
        unscheduled: [],
        totalScheduledMinutes: totalScheduled,
        remainingMinutes: totalWorkMinutes - totalScheduled,
      };
    }

    // Track used time slots (as [start, end] tuples in minutes)
    const usedSlots: Array<{ start: number; end: number }> = [];
    const scheduled: ScheduledTask[] = [];
    const unscheduled: UnscheduledTask[] = [];

    for (const task of actionable) {
      if (scheduled.length >= limit) {
        break;
      }

      const estimateMinutes = task.estimate_minutes ?? this.config.defaultEstimateMinutes;
      const isDefaultEstimate = !task.estimate_minutes;

      // Determine allowed time range for this task
      let allowedStart = workStart;
      let allowedEnd = workEnd;

      if (task.window_start && task.window_end) {
        // Task has a time window constraint
        const taskWindowStart = parseTime(task.window_start);
        const taskWindowEnd = parseTime(task.window_end);

        // Intersect with work hours
        const intersection = rangeIntersection(workStart, workEnd, taskWindowStart, taskWindowEnd);

        if (!intersection) {
          unscheduled.push({
            task,
            reason: 'window outside work hours',
          });
          continue;
        }

        allowedStart = intersection.start;
        allowedEnd = intersection.end;
      }

      // Find first available slot
      const slot = this.findAvailableSlot(usedSlots, allowedStart, allowedEnd, estimateMinutes);

      if (slot) {
        usedSlots.push(slot);
        usedSlots.sort((a, b) => a.start - b.start);

        scheduled.push({
          task,
          slot: {
            start: formatTime(slot.start),
            end: formatTime(slot.end),
          },
          estimateMinutes,
          isDefaultEstimate,
        });
      } else {
        unscheduled.push({
          task,
          reason: 'does not fit',
        });
      }
    }

    const totalScheduled = scheduled.reduce((sum, s) => sum + s.estimateMinutes, 0);

    return {
      date,
      workHours: {
        start: this.config.workHoursStart,
        end: this.config.workHoursEnd,
      },
      scheduled,
      unscheduled,
      totalScheduledMinutes: totalScheduled,
      remainingMinutes: totalWorkMinutes - totalScheduled,
    };
  }

  /**
   * Filter tasks to those actionable today
   */
  private filterActionable(tasks: TaskWithPriority[], date: Date): TaskWithPriority[] {
    return tasks.filter((task) => {
      // Skip blocked tasks (priority = 0 from dependencies)
      if (task.priority === 0) {
        return false;
      }

      // Include tasks with deadline today or overdue
      if (task.deadline) {
        const deadlineDate = new Date(task.deadline);
        deadlineDate.setHours(0, 0, 0, 0);
        const planDate = new Date(date);
        planDate.setHours(0, 0, 0, 0);
        if (deadlineDate <= planDate) {
          return true;
        }
      }

      // Include recurring tasks due today
      if (task.next_due_at) {
        const dueDate = new Date(task.next_due_at);
        dueDate.setHours(0, 0, 0, 0);
        const planDate = new Date(date);
        planDate.setHours(0, 0, 0, 0);
        if (dueDate <= planDate) {
          return true;
        }
      }

      // Include tasks with time windows that overlap today's work hours
      if (task.window_start && task.window_end) {
        return true;
      }

      // Include high-priority tasks (> 0.3)
      if (task.priority > 0.3) {
        return true;
      }

      return false;
    });
  }

  /**
   * Find the first available time slot that fits the required duration
   */
  private findAvailableSlot(
    usedSlots: Array<{ start: number; end: number }>,
    allowedStart: number,
    allowedEnd: number,
    durationMinutes: number
  ): { start: number; end: number } | null {
    // Sort used slots by start time
    const sorted = [...usedSlots].sort((a, b) => a.start - b.start);

    // Try to fit before the first used slot
    if (sorted.length === 0) {
      // No slots used yet
      if (allowedEnd - allowedStart >= durationMinutes) {
        return { start: allowedStart, end: allowedStart + durationMinutes };
      }
      return null;
    }

    // Check gap before first slot
    const firstSlotStart = sorted[0].start;
    if (firstSlotStart > allowedStart) {
      const gapEnd = Math.min(firstSlotStart, allowedEnd);
      if (gapEnd - allowedStart >= durationMinutes) {
        return { start: allowedStart, end: allowedStart + durationMinutes };
      }
    }

    // Check gaps between slots
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapStart = Math.max(sorted[i].end, allowedStart);
      const gapEnd = Math.min(sorted[i + 1].start, allowedEnd);

      if (gapEnd - gapStart >= durationMinutes) {
        return { start: gapStart, end: gapStart + durationMinutes };
      }
    }

    // Check gap after last slot
    const lastSlotEnd = sorted[sorted.length - 1].end;
    if (lastSlotEnd < allowedEnd) {
      const gapStart = Math.max(lastSlotEnd, allowedStart);
      if (allowedEnd - gapStart >= durationMinutes) {
        return { start: gapStart, end: gapStart + durationMinutes };
      }
    }

    return null;
  }
}
