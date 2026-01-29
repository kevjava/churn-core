import { Database, ChurnScheduler, TaskService, TaskStatus, RecurrenceMode, RecurrenceType, CurveType } from '../src';

describe('ChurnScheduler', () => {
  let db: Database;
  let scheduler: ChurnScheduler;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.init();
    scheduler = new ChurnScheduler(db);
  });

  afterEach(async () => {
    await db.close();
  });

  test('isAvailable returns true', () => {
    expect(scheduler.isAvailable()).toBe(true);
  });

  test('getDailyPlan returns empty plan when no tasks', async () => {
    const plan = await scheduler.getDailyPlan(new Date());
    expect(plan.tasks).toHaveLength(0);
    expect(plan.totalMinutes).toBe(0);
  });

  test('addTask creates a task', async () => {
    const task = await scheduler.addTask({
      title: 'Test task',
      tags: ['test'],
      estimateMinutes: 30,
    });

    expect(task.id).toBeDefined();
    expect(task.title).toBe('Test task');
    expect(task.tags).toEqual(['test']);
    expect(task.estimateMinutes).toBe(30);
  });

  test('getTask retrieves a task by ID', async () => {
    const created = await scheduler.addTask({
      title: 'Test task',
      tags: [],
    });

    const retrieved = await scheduler.getTask(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Test task');
  });

  test('getDailyPlan includes added tasks with deadline today', async () => {
    // Add task with deadline today (should be actionable)
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    // Create task via TaskService to set curve_config with past start_date
    // (otherwise priority = 0 because we're at the start of the curve)
    const taskService = scheduler.getTaskService();
    const pastStart = new Date(Date.now() - 86400000); // Yesterday
    await taskService.create({
      title: 'Urgent task',
      tags: [],
      estimate_minutes: 60,
      deadline: today,
      curve_config: {
        type: CurveType.LINEAR,
        start_date: pastStart,
        deadline: today,
      },
    });

    const plan = await scheduler.getDailyPlan(new Date());
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.tasks[0].title).toBe('Urgent task');
  });

  test('removeTask deletes a task', async () => {
    const task = await scheduler.addTask({
      title: 'To be deleted',
      tags: [],
    });

    await scheduler.removeTask(task.id);

    const retrieved = await scheduler.getTask(task.id);
    expect(retrieved).toBeNull();
  });

  test('completeTask marks task as completed', async () => {
    const task = await scheduler.addTask({
      title: 'To be completed',
      tags: [],
    });

    await scheduler.completeTask({
      taskId: task.id,
      completedAt: new Date(),
      actualMinutes: 45,
    });

    // Task should be completed (non-recurring task)
    const taskService = scheduler.getTaskService();
    const updatedTask = await taskService.get(task.id);
    expect(updatedTask?.status).toBe(TaskStatus.COMPLETED);
  });
});

describe('TaskService', () => {
  let db: Database;
  let service: TaskService;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.init();
    service = new TaskService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  test('create task with deadline', async () => {
    const deadline = new Date('2025-12-31');
    const task = await service.create({
      title: 'Task with deadline',
      deadline,
    });

    expect(task.id).toBeDefined();
    expect(task.title).toBe('Task with deadline');
    expect(task.deadline?.toISOString()).toBe(deadline.toISOString());
  });

  test('getByPriority returns tasks sorted by priority', async () => {
    // Create two tasks with different curve configurations
    // Task with past start date will have higher priority
    const pastStart = new Date();
    pastStart.setDate(pastStart.getDate() - 5);

    const nearDeadline = new Date();
    nearDeadline.setDate(nearDeadline.getDate() + 2);

    const farDeadline = new Date();
    farDeadline.setDate(farDeadline.getDate() + 30);

    await service.create({
      title: 'Far deadline',
      deadline: farDeadline,
      curve_config: {
        type: CurveType.LINEAR,
        start_date: new Date(), // Starts now
        deadline: farDeadline,
      },
    });

    await service.create({
      title: 'Near deadline',
      deadline: nearDeadline,
      curve_config: {
        type: CurveType.LINEAR,
        start_date: pastStart, // Started 5 days ago
        deadline: nearDeadline,
      },
    });

    const tasks = await service.getByPriority();

    // Near deadline with past start should have higher priority
    expect(tasks[0].title).toBe('Near deadline');
    expect(tasks[0].priority).toBeGreaterThan(tasks[1].priority);
  });

  test('complete recurring task calculates next due', async () => {
    const task = await service.create({
      title: 'Daily task',
      recurrence_pattern: {
        mode: RecurrenceMode.CALENDAR,
        type: RecurrenceType.DAILY,
      },
    });

    await service.complete(task.id);

    const updated = await service.get(task.id);
    expect(updated?.status).toBe(TaskStatus.OPEN); // Stays open
    expect(updated?.next_due_at).toBeDefined();
    expect(updated?.last_completed_at).toBeDefined();
  });
});
