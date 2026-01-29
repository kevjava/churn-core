import { Database, TaskService, CurveType, RecurrenceMode, RecurrenceType } from '../src';
import { DailyPlanner } from '../src/planner';

describe('DailyPlanner', () => {
  let db: Database;
  let service: TaskService;
  let planner: DailyPlanner;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.init();
    service = new TaskService(db);
    planner = new DailyPlanner({
      workHoursStart: '09:00',
      workHoursEnd: '17:00',
      defaultEstimateMinutes: 15,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('planDay with time blocks', () => {
    test('schedules tasks into time slots', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      await service.create({
        title: 'Task 1',
        estimate_minutes: 60,
        deadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      await service.create({
        title: 'Task 2',
        estimate_minutes: 30,
        deadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), {
        limit: 5,
        includeTimeBlocks: true,
      });

      expect(plan.scheduled.length).toBeGreaterThan(0);
      expect(plan.scheduled[0].slot.start).toBeDefined();
      expect(plan.scheduled[0].slot.end).toBeDefined();
    });

    test('respects task time windows', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      // Task with afternoon-only window
      await service.create({
        title: 'Afternoon task',
        estimate_minutes: 60,
        window_start: '14:00',
        window_end: '16:00',
        deadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), {
        limit: 5,
        includeTimeBlocks: true,
      });

      if (plan.scheduled.length > 0) {
        // Task should be scheduled within its window
        const slot = plan.scheduled[0].slot;
        expect(slot.start).toBe('14:00');
      }
    });

    test('excludes tasks when window is outside priority calculation time', async () => {
      const pastStart = new Date(Date.now() - 3 * 86400000); // 3 days ago
      const deadline = new Date(Date.now() + 86400000);

      // Task with evening window - priority calculated at 9 AM is 0 (outside window)
      // so it won't appear in the plan at all
      await service.create({
        title: 'Evening task',
        estimate_minutes: 60,
        window_start: '19:00',
        window_end: '21:00',
        deadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), {
        limit: 5,
        includeTimeBlocks: true,
      });

      // Task has priority 0 (outside its time window at 9 AM) so it's not included
      expect(plan.scheduled.length).toBe(0);
      expect(plan.unscheduled.length).toBe(0);
    });

    test('fills time slots in order', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      // Create multiple tasks
      for (let i = 1; i <= 3; i++) {
        await service.create({
          title: `Task ${i}`,
          estimate_minutes: 60,
          deadline,
          curve_config: {
            type: CurveType.LINEAR,
            start_date: pastStart,
            deadline,
          },
        });
      }

      const plan = await planner.planDay(service, new Date(), {
        limit: 10,
        includeTimeBlocks: true,
      });

      expect(plan.scheduled.length).toBe(3);
      // First slot should start at work start
      expect(plan.scheduled[0].slot.start).toBe('09:00');
      // Subsequent slots should be later
      expect(plan.scheduled[1].slot.start).toBe('10:00');
      expect(plan.scheduled[2].slot.start).toBe('11:00');
    });

    test('calculates total and remaining minutes', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      await service.create({
        title: 'Task 1',
        estimate_minutes: 60,
        deadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), {
        limit: 5,
        includeTimeBlocks: true,
      });

      expect(plan.totalScheduledMinutes).toBe(60);
      // 9-5 = 8 hours = 480 minutes, minus 60 = 420
      expect(plan.remainingMinutes).toBe(420);
    });

    test('uses default estimate when task has none', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      await service.create({
        title: 'Task without estimate',
        // No estimate_minutes
        deadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), {
        limit: 5,
        includeTimeBlocks: true,
      });

      expect(plan.scheduled.length).toBe(1);
      expect(plan.scheduled[0].estimateMinutes).toBe(15); // Default
      expect(plan.scheduled[0].isDefaultEstimate).toBe(true);
    });

    test('limits number of scheduled tasks', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      // Create more tasks than the limit
      for (let i = 1; i <= 10; i++) {
        await service.create({
          title: `Task ${i}`,
          estimate_minutes: 30,
          deadline,
          curve_config: {
            type: CurveType.LINEAR,
            start_date: pastStart,
            deadline,
          },
        });
      }

      const plan = await planner.planDay(service, new Date(), {
        limit: 3,
        includeTimeBlocks: true,
      });

      expect(plan.scheduled.length).toBe(3);
    });
  });

  describe('filterActionable', () => {
    test('includes tasks with deadline today', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      await service.create({
        title: 'Due today',
        deadline: today,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline: today,
        },
      });

      const plan = await planner.planDay(service, new Date(), { limit: 10 });
      expect(plan.scheduled.length).toBe(1);
    });

    test('includes overdue tasks', async () => {
      const pastStart = new Date(Date.now() - 7 * 86400000); // 7 days ago
      const pastDeadline = new Date(Date.now() - 86400000); // Yesterday

      await service.create({
        title: 'Overdue task',
        deadline: pastDeadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline: pastDeadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), { limit: 10 });
      expect(plan.scheduled.length).toBe(1);
    });

    test('includes recurring tasks due today', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      // Create a recurring task and complete it to set next_due_at
      const task = await service.create({
        title: 'Daily recurring',
        recurrence_pattern: {
          mode: RecurrenceMode.CALENDAR,
          type: RecurrenceType.DAILY,
        },
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      // Complete yesterday to set next_due_at to today
      const yesterday = new Date(Date.now() - 86400000);
      await service.complete(task.id, yesterday);

      const plan = await planner.planDay(service, new Date(), { limit: 10 });
      expect(plan.scheduled.some(s => s.task.title === 'Daily recurring')).toBe(true);
    });

    test('includes windowed tasks when window overlaps priority calc time', async () => {
      const pastStart = new Date(Date.now() - 3 * 86400000); // 3 days ago
      const deadline = new Date(Date.now() + 86400000);

      // Task with morning window that includes 9 AM (priority calc time)
      await service.create({
        title: 'Windowed task',
        window_start: '08:00',
        window_end: '12:00',
        deadline, // Has deadline so it's actionable
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), { limit: 10 });
      expect(plan.scheduled.some(s => s.task.title === 'Windowed task')).toBe(true);
    });

    test('includes high priority tasks', async () => {
      const pastStart = new Date(Date.now() - 5 * 86400000); // 5 days ago
      const nearDeadline = new Date(Date.now() + 2 * 86400000); // 2 days

      await service.create({
        title: 'High priority',
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline: nearDeadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), { limit: 10 });
      expect(plan.scheduled.some(s => s.task.title === 'High priority')).toBe(true);
    });

    test('excludes blocked tasks', async () => {
      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      const dep = await service.create({
        title: 'Dependency',
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      await service.create({
        title: 'Blocked task',
        dependencies: [dep.id],
        deadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      const plan = await planner.planDay(service, new Date(), { limit: 10 });
      // Only dependency should be scheduled (blocked task has priority 0)
      expect(plan.scheduled.length).toBe(1);
      expect(plan.scheduled[0].task.title).toBe('Dependency');
    });
  });

  describe('edge cases', () => {
    test('handles no actionable tasks', async () => {
      // Create task that's not actionable (no deadline, no window, low priority)
      await service.create({
        title: 'Future task',
        // No deadline, no window, start_date is now so priority ~= 0
      });

      const plan = await planner.planDay(service, new Date(), { limit: 10 });
      expect(plan.scheduled.length).toBe(0);
    });

    test('handles custom work hours', async () => {
      const customPlanner = new DailyPlanner({
        workHoursStart: '10:00',
        workHoursEnd: '14:00',
      });

      const pastStart = new Date(Date.now() - 86400000);
      const deadline = new Date(Date.now() + 86400000);

      await service.create({
        title: 'Task',
        estimate_minutes: 60,
        deadline,
        curve_config: {
          type: CurveType.LINEAR,
          start_date: pastStart,
          deadline,
        },
      });

      const plan = await customPlanner.planDay(service, new Date(), {
        limit: 5,
        includeTimeBlocks: true,
      });

      expect(plan.workHours.start).toBe('10:00');
      expect(plan.workHours.end).toBe('14:00');
      expect(plan.scheduled[0].slot.start).toBe('10:00');
    });
  });
});
