import {
  Database,
  TaskService,
  TaskStatus,
  RecurrenceMode,
  RecurrenceType,
  CurveType,
} from '../src';

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

  describe('CRUD operations', () => {
    test('create task', async () => {
      const task = await service.create({
        title: 'Test task',
        project: 'my-project',
        tags: ['important', 'urgent'],
        estimate_minutes: 30,
      });

      expect(task.id).toBeDefined();
      expect(task.title).toBe('Test task');
      expect(task.project).toBe('my-project');
      expect(task.tags).toEqual(['important', 'urgent']);
      expect(task.estimate_minutes).toBe(30);
      expect(task.status).toBe(TaskStatus.OPEN);
    });

    test('get task', async () => {
      const created = await service.create({ title: 'Test' });

      const task = await service.get(created.id);
      expect(task).not.toBeNull();
      expect(task!.title).toBe('Test');
    });

    test('getTask is alias for get', async () => {
      const created = await service.create({ title: 'Test' });

      const task = await service.getTask(created.id);
      expect(task).not.toBeNull();
      expect(task!.title).toBe('Test');
    });

    test('list tasks', async () => {
      await service.create({ title: 'Task 1' });
      await service.create({ title: 'Task 2' });

      const tasks = await service.list();
      expect(tasks).toHaveLength(2);
    });

    test('list tasks with filter', async () => {
      await service.create({ title: 'Open task' });
      const completed = await service.create({ title: 'Completed task' });
      await service.complete(completed.id);

      const openTasks = await service.list({ status: TaskStatus.OPEN });
      expect(openTasks).toHaveLength(1);
      expect(openTasks[0].title).toBe('Open task');
    });

    test('update task', async () => {
      const created = await service.create({ title: 'Original' });

      const updated = await service.update(created.id, {
        title: 'Updated',
        estimate_minutes: 60,
      });

      expect(updated.title).toBe('Updated');
      expect(updated.estimate_minutes).toBe(60);
    });

    test('update non-existent task throws', async () => {
      await expect(
        service.update(999, { title: 'Test' })
      ).rejects.toThrow('Task 999 not found');
    });

    test('delete task', async () => {
      const created = await service.create({ title: 'To delete' });

      await service.delete(created.id);

      const task = await service.get(created.id);
      expect(task).toBeNull();
    });
  });

  describe('Dependencies', () => {
    test('create task with dependencies', async () => {
      const dep1 = await service.create({ title: 'Dependency 1' });
      const dep2 = await service.create({ title: 'Dependency 2' });

      const task = await service.create({
        title: 'Dependent task',
        dependencies: [dep1.id, dep2.id],
      });

      expect(task.dependencies).toEqual([dep1.id, dep2.id]);
    });

    test('create task with non-existent dependency throws', async () => {
      await expect(
        service.create({
          title: 'Task',
          dependencies: [999],
        })
      ).rejects.toThrow('Dependency task 999 not found');
    });

    test('update task with circular dependency throws', async () => {
      const task1 = await service.create({ title: 'Task 1' });
      const task2 = await service.create({
        title: 'Task 2',
        dependencies: [task1.id],
      });

      await expect(
        service.update(task1.id, { dependencies: [task2.id] })
      ).rejects.toThrow('Circular dependency detected');
    });

    test('delete task with dependents throws', async () => {
      const dep = await service.create({ title: 'Dependency' });
      await service.create({
        title: 'Dependent',
        dependencies: [dep.id],
      });

      await expect(service.delete(dep.id)).rejects.toThrow(
        'Cannot delete task'
      );
    });

    test('getDependencies returns dependencies', async () => {
      const dep1 = await service.create({ title: 'Dep 1' });
      const dep2 = await service.create({ title: 'Dep 2' });
      const task = await service.create({
        title: 'Task',
        dependencies: [dep1.id, dep2.id],
      });

      const deps = await service.getDependencies(task.id);
      expect(deps).toHaveLength(2);
    });

    test('getDependencies throws for non-existent task', async () => {
      await expect(service.getDependencies(999)).rejects.toThrow(
        'Task 999 not found'
      );
    });

    test('getDependents returns tasks that depend on given task', async () => {
      const dep = await service.create({ title: 'Dependency' });
      await service.create({
        title: 'Dependent 1',
        dependencies: [dep.id],
      });
      await service.create({
        title: 'Dependent 2',
        dependencies: [dep.id],
      });

      const dependents = await service.getDependents(dep.id);
      expect(dependents).toHaveLength(2);
    });

    test('getBlocked returns tasks with incomplete dependencies', async () => {
      const dep = await service.create({ title: 'Dependency' });
      await service.create({
        title: 'Blocked task',
        dependencies: [dep.id],
      });

      const blocked = await service.getBlocked();
      expect(blocked).toHaveLength(1);
      expect(blocked[0].title).toBe('Blocked task');
    });
  });

  describe('Status management', () => {
    test('complete marks task as completed', async () => {
      const task = await service.create({ title: 'To complete' });

      await service.complete(task.id);

      const updated = await service.get(task.id);
      expect(updated!.status).toBe(TaskStatus.COMPLETED);
      expect(updated!.last_completed_at).toBeDefined();
    });

    test('complete non-existent task throws', async () => {
      await expect(service.complete(999)).rejects.toThrow(
        'Task 999 not found'
      );
    });

    test('reopen sets status to open', async () => {
      const task = await service.create({ title: 'Test' });
      await service.complete(task.id);

      await service.reopen(task.id);

      const updated = await service.get(task.id);
      expect(updated!.status).toBe(TaskStatus.OPEN);
    });

    test('reopen non-existent task throws', async () => {
      await expect(service.reopen(999)).rejects.toThrow('Task 999 not found');
    });
  });

  describe('Recurrence', () => {
    test('complete recurring task keeps it open with next due', async () => {
      const task = await service.create({
        title: 'Daily task',
        recurrence_pattern: {
          mode: RecurrenceMode.CALENDAR,
          type: RecurrenceType.DAILY,
        },
      });

      await service.complete(task.id);

      const updated = await service.get(task.id);
      expect(updated!.status).toBe(TaskStatus.OPEN);
      expect(updated!.next_due_at).toBeDefined();
      expect(updated!.last_completed_at).toBeDefined();
    });

    test('getRecurring returns tasks with recurrence', async () => {
      await service.create({
        title: 'Recurring',
        recurrence_pattern: {
          mode: RecurrenceMode.COMPLETION,
          type: RecurrenceType.WEEKLY,
        },
      });
      await service.create({ title: 'One-time' });

      const recurring = await service.getRecurring();
      expect(recurring).toHaveLength(1);
      expect(recurring[0].title).toBe('Recurring');
    });

    test('weekly recurrence with single day calculates next due', async () => {
      const task = await service.create({
        title: 'Weekly Monday',
        recurrence_pattern: {
          mode: RecurrenceMode.CALENDAR,
          type: RecurrenceType.WEEKLY,
          dayOfWeek: 1, // Monday
        },
      });

      await service.complete(task.id);

      const updated = await service.get(task.id);
      expect(updated!.next_due_at).toBeDefined();
      expect(updated!.next_due_at!.getDay()).toBe(1); // Should be Monday
    });

    test('weekly recurrence with multiple days calculates next due', async () => {
      const task = await service.create({
        title: 'MWF task',
        recurrence_pattern: {
          mode: RecurrenceMode.CALENDAR,
          type: RecurrenceType.WEEKLY,
          daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        },
      });

      await service.complete(task.id);

      const updated = await service.get(task.id);
      expect(updated!.next_due_at).toBeDefined();
      expect([1, 3, 5]).toContain(updated!.next_due_at!.getDay());
    });

    test('monthly recurrence calculates next due', async () => {
      const task = await service.create({
        title: 'Monthly task',
        recurrence_pattern: {
          mode: RecurrenceMode.CALENDAR,
          type: RecurrenceType.MONTHLY,
        },
      });

      const now = new Date();
      await service.complete(task.id, now);

      const updated = await service.get(task.id);
      expect(updated!.next_due_at).toBeDefined();
      expect(updated!.next_due_at!.getMonth()).toBe((now.getMonth() + 1) % 12);
    });

    test('interval recurrence with anchor calculates next due', async () => {
      const anchor = new Date('2024-01-01');
      const task = await service.create({
        title: 'Every 3 days',
        recurrence_pattern: {
          mode: RecurrenceMode.CALENDAR,
          type: RecurrenceType.INTERVAL,
          interval: 3,
          unit: 'days',
          anchor,
        },
      });

      await service.complete(task.id, new Date('2024-01-05'));

      const updated = await service.get(task.id);
      expect(updated!.next_due_at).toBeDefined();
    });

    test('completion mode recurrence calculates from completion', async () => {
      const task = await service.create({
        title: 'Weekly from completion',
        recurrence_pattern: {
          mode: RecurrenceMode.COMPLETION,
          type: RecurrenceType.WEEKLY,
        },
      });

      const completedAt = new Date('2024-01-15');
      await service.complete(task.id, completedAt);

      const updated = await service.get(task.id);
      expect(updated!.next_due_at).toBeDefined();
      const expectedDue = new Date(completedAt.getTime() + 7 * 86400000);
      expect(updated!.next_due_at!.getTime()).toBeCloseTo(
        expectedDue.getTime(),
        -3
      );
    });

    test('recurring task defaults to accumulator curve', async () => {
      const task = await service.create({
        title: 'Weekly recurring',
        recurrence_pattern: {
          mode: RecurrenceMode.CALENDAR,
          type: RecurrenceType.WEEKLY,
        },
      });

      expect(task.curve_config.type).toBe(CurveType.ACCUMULATOR);
      expect(task.curve_config.recurrence).toBeDefined();
      expect(task.curve_config.recurrence?.type).toBe(RecurrenceType.WEEKLY);
    });

    test('explicit curve type is respected for recurring task', async () => {
      const task = await service.create({
        title: 'Weekly with linear curve',
        recurrence_pattern: {
          mode: RecurrenceMode.COMPLETION,
          type: RecurrenceType.WEEKLY,
        },
        curve_config: {
          type: CurveType.LINEAR,
        },
      });

      expect(task.curve_config.type).toBe(CurveType.LINEAR);
    });

    test('non-recurring task defaults to linear curve', async () => {
      const task = await service.create({
        title: 'One-time task',
      });

      expect(task.curve_config.type).toBe(CurveType.LINEAR);
    });

    test('daily recurrence uses accumulator with correct pattern', async () => {
      const task = await service.create({
        title: 'Daily task',
        recurrence_pattern: {
          mode: RecurrenceMode.CALENDAR,
          type: RecurrenceType.DAILY,
        },
      });

      expect(task.curve_config.type).toBe(CurveType.ACCUMULATOR);
      expect(task.curve_config.recurrence?.type).toBe(RecurrenceType.DAILY);
    });

    test('interval recurrence uses accumulator with custom interval', async () => {
      const task = await service.create({
        title: 'Every 3 days',
        recurrence_pattern: {
          mode: RecurrenceMode.COMPLETION,
          type: RecurrenceType.INTERVAL,
          interval: 3,
          unit: 'days',
        },
      });

      expect(task.curve_config.type).toBe(CurveType.ACCUMULATOR);
      expect(task.curve_config.recurrence?.interval).toBe(3);
      expect(task.curve_config.recurrence?.unit).toBe('days');
    });
  });

  describe('Priority', () => {
    test('calculatePriority returns value', async () => {
      const task = await service.create({
        title: 'Test',
        curve_config: {
          type: CurveType.LINEAR,
          start_date: new Date(Date.now() - 86400000), // Yesterday
          deadline: new Date(Date.now() + 86400000), // Tomorrow
        },
      });

      const priority = await service.calculatePriority(task.id);
      expect(priority).toBeGreaterThan(0);
      expect(priority).toBeLessThan(1);
    });

    test('calculatePriority throws for non-existent task', async () => {
      await expect(service.calculatePriority(999)).rejects.toThrow(
        'Task 999 not found'
      );
    });

    test('blocked task has zero priority', async () => {
      const dep = await service.create({ title: 'Dependency' });
      const blocked = await service.create({
        title: 'Blocked',
        dependencies: [dep.id],
      });

      const priority = await service.calculatePriority(blocked.id);
      expect(priority).toBe(0);
    });

    test('task outside time window has zero priority', async () => {
      const task = await service.create({
        title: 'Windowed task',
        window_start: '14:00',
        window_end: '16:00',
      });

      // Calculate at midnight (outside window)
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);

      const priority = await service.calculatePriority(task.id, midnight);
      expect(priority).toBe(0);
    });

    test('task inside time window has priority', async () => {
      const task = await service.create({
        title: 'Windowed task',
        window_start: '14:00',
        window_end: '16:00',
        curve_config: {
          type: CurveType.LINEAR,
          start_date: new Date(Date.now() - 86400000),
          deadline: new Date(Date.now() + 86400000),
        },
      });

      const afternoon = new Date();
      afternoon.setHours(15, 0, 0, 0);

      const priority = await service.calculatePriority(task.id, afternoon);
      expect(priority).toBeGreaterThan(0);
    });

    test('time window crossing midnight works', async () => {
      const task = await service.create({
        title: 'Night task',
        window_start: '22:00',
        window_end: '06:00',
        curve_config: {
          type: CurveType.LINEAR,
          start_date: new Date(Date.now() - 86400000),
          deadline: new Date(Date.now() + 86400000),
        },
      });

      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);

      const priority = await service.calculatePriority(task.id, midnight);
      expect(priority).toBeGreaterThan(0);
    });
  });

  describe('Search', () => {
    test('search finds tasks by title', async () => {
      await service.create({ title: 'Fix authentication bug' });
      await service.create({ title: 'Add new feature' });

      const results = await service.search('authentication');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Fix authentication bug');
    });
  });
});
