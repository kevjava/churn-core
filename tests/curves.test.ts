import {
  LinearCurve,
  ExponentialCurve,
  HardWindowCurve,
  AccumulatorCurve,
  BlockedCurve,
  CurveFactory,
} from '../src/curves';
import { CurveType, RecurrenceMode, RecurrenceType, TaskStatus, Task } from '../src/types';

describe('LinearCurve', () => {
  test('returns 0 before start date', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new LinearCurve(start, deadline);

    const priority = curve.calculate(new Date('2024-01-05'));
    expect(priority).toBe(0);
  });

  test('returns 0.5 at midpoint', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new LinearCurve(start, deadline);

    const priority = curve.calculate(new Date('2024-01-15'));
    expect(priority).toBeCloseTo(0.5, 1);
  });

  test('returns 1.0 at deadline', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new LinearCurve(start, deadline);

    const priority = curve.calculate(deadline);
    expect(priority).toBeCloseTo(1.0, 1);
  });

  test('returns > 1.0 when overdue', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new LinearCurve(start, deadline);

    const priority = curve.calculate(new Date('2024-01-25'));
    expect(priority).toBeGreaterThan(1.0);
  });

  test('throws if deadline is before start', () => {
    expect(() => {
      new LinearCurve(new Date('2024-01-20'), new Date('2024-01-10'));
    }).toThrow('Deadline must be after start date');
  });

  test('metadata returns curve info', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new LinearCurve(start, deadline);

    const meta = curve.metadata();
    expect(meta.type).toBe('linear');
    expect(meta.description).toContain('Linear');
  });
});

describe('ExponentialCurve', () => {
  test('returns 0 before start date', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new ExponentialCurve(start, deadline, 2.0);

    const priority = curve.calculate(new Date('2024-01-05'));
    expect(priority).toBe(0);
  });

  test('returns less than linear at midpoint with exponent 2', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new ExponentialCurve(start, deadline, 2.0);

    const priority = curve.calculate(new Date('2024-01-15'));
    expect(priority).toBeCloseTo(0.25, 1); // 0.5^2 = 0.25
  });

  test('returns 1.0 at deadline', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new ExponentialCurve(start, deadline, 2.0);

    const priority = curve.calculate(deadline);
    expect(priority).toBeCloseTo(1.0, 1);
  });

  test('returns > 1.0 when overdue', () => {
    const start = new Date('2024-01-10');
    const deadline = new Date('2024-01-20');
    const curve = new ExponentialCurve(start, deadline, 2.0);

    const priority = curve.calculate(new Date('2024-01-25'));
    expect(priority).toBeGreaterThan(1.0);
  });

  test('throws if deadline is before start', () => {
    expect(() => {
      new ExponentialCurve(new Date('2024-01-20'), new Date('2024-01-10'));
    }).toThrow('Deadline must be after start date');
  });

  test('throws if exponent out of range', () => {
    expect(() => {
      new ExponentialCurve(new Date('2024-01-10'), new Date('2024-01-20'), 0.5);
    }).toThrow('Exponent must be between 1.0 and 5.0');

    expect(() => {
      new ExponentialCurve(new Date('2024-01-10'), new Date('2024-01-20'), 6.0);
    }).toThrow('Exponent must be between 1.0 and 5.0');
  });

  test('metadata returns curve info', () => {
    const curve = new ExponentialCurve(
      new Date('2024-01-10'),
      new Date('2024-01-20'),
      3.0
    );

    const meta = curve.metadata();
    expect(meta.type).toBe('exponential');
    expect(meta.parameters.exponent).toBe(3.0);
  });
});

describe('HardWindowCurve', () => {
  test('returns priority inside window', () => {
    const start = new Date('2024-01-10T10:00:00');
    const end = new Date('2024-01-10T14:00:00');
    const curve = new HardWindowCurve(start, end, 0.8);

    const priority = curve.calculate(new Date('2024-01-10T12:00:00'));
    expect(priority).toBe(0.8);
  });

  test('returns 0 before window', () => {
    const start = new Date('2024-01-10T10:00:00');
    const end = new Date('2024-01-10T14:00:00');
    const curve = new HardWindowCurve(start, end, 0.8);

    const priority = curve.calculate(new Date('2024-01-10T09:00:00'));
    expect(priority).toBe(0);
  });

  test('returns 0 after window', () => {
    const start = new Date('2024-01-10T10:00:00');
    const end = new Date('2024-01-10T14:00:00');
    const curve = new HardWindowCurve(start, end, 0.8);

    const priority = curve.calculate(new Date('2024-01-10T15:00:00'));
    expect(priority).toBe(0);
  });

  test('throws if end is before start', () => {
    expect(() => {
      new HardWindowCurve(
        new Date('2024-01-10T14:00:00'),
        new Date('2024-01-10T10:00:00')
      );
    }).toThrow('Window end must be after window start');
  });

  test('throws if priority out of range', () => {
    expect(() => {
      new HardWindowCurve(
        new Date('2024-01-10T10:00:00'),
        new Date('2024-01-10T14:00:00'),
        -0.5
      );
    }).toThrow('Priority must be between 0 and 2.0');

    expect(() => {
      new HardWindowCurve(
        new Date('2024-01-10T10:00:00'),
        new Date('2024-01-10T14:00:00'),
        2.5
      );
    }).toThrow('Priority must be between 0 and 2.0');
  });

  test('metadata returns curve info', () => {
    const curve = new HardWindowCurve(
      new Date('2024-01-10T10:00:00'),
      new Date('2024-01-10T14:00:00'),
      1.0
    );

    const meta = curve.metadata();
    expect(meta.type).toBe('hard_window');
  });
});

describe('AccumulatorCurve', () => {
  describe('calendar mode', () => {
    test('returns low priority when far from due', () => {
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + 10);

      const curve = new AccumulatorCurve(
        { mode: RecurrenceMode.CALENDAR, type: RecurrenceType.WEEKLY },
        null,
        nextDue
      );

      const priority = curve.calculate(new Date());
      expect(priority).toBe(0.2);
    });

    test('returns higher priority when overdue', () => {
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() - 2);

      const curve = new AccumulatorCurve(
        { mode: RecurrenceMode.CALENDAR, type: RecurrenceType.WEEKLY },
        null,
        nextDue
      );

      const priority = curve.calculate(new Date());
      expect(priority).toBeGreaterThan(1.0);
    });
  });

  describe('completion mode', () => {
    test('returns low priority when recently completed', () => {
      const lastCompleted = new Date();
      lastCompleted.setDate(lastCompleted.getDate() - 1); // 1 day ago

      const curve = new AccumulatorCurve(
        { mode: RecurrenceMode.COMPLETION, type: RecurrenceType.WEEKLY },
        lastCompleted,
        new Date()
      );

      const priority = curve.calculate(new Date());
      expect(priority).toBe(0.1); // ratio < 0.5
    });

    test('returns high priority when overdue completion', () => {
      const lastCompleted = new Date();
      lastCompleted.setDate(lastCompleted.getDate() - 10); // 10 days ago for weekly

      const curve = new AccumulatorCurve(
        { mode: RecurrenceMode.COMPLETION, type: RecurrenceType.WEEKLY },
        lastCompleted,
        new Date()
      );

      const priority = curve.calculate(new Date());
      expect(priority).toBe(1.0); // ratio >= 1.2
    });
  });

  test('handles different recurrence types', () => {
    const lastCompleted = new Date();
    lastCompleted.setDate(lastCompleted.getDate() - 1);

    // Daily - 1 day ago should be high priority
    const dailyCurve = new AccumulatorCurve(
      { mode: RecurrenceMode.COMPLETION, type: RecurrenceType.DAILY },
      lastCompleted,
      new Date()
    );
    expect(dailyCurve.calculate(new Date())).toBeGreaterThan(0.5);

    // Monthly - 1 day ago should be low priority
    const monthlyCurve = new AccumulatorCurve(
      { mode: RecurrenceMode.COMPLETION, type: RecurrenceType.MONTHLY },
      lastCompleted,
      new Date()
    );
    expect(monthlyCurve.calculate(new Date())).toBe(0.1);
  });

  test('handles interval recurrence type', () => {
    const lastCompleted = new Date();
    lastCompleted.setDate(lastCompleted.getDate() - 5); // 5 days ago

    const curve = new AccumulatorCurve(
      {
        mode: RecurrenceMode.COMPLETION,
        type: RecurrenceType.INTERVAL,
        interval: 3,
        unit: 'days',
      },
      lastCompleted,
      new Date()
    );

    // 5 days / 3 days = 1.67 ratio -> should be 1.0
    expect(curve.calculate(new Date())).toBe(1.0);
  });

  test('metadata returns curve info', () => {
    const curve = new AccumulatorCurve(
      { mode: RecurrenceMode.CALENDAR, type: RecurrenceType.WEEKLY },
      null,
      new Date()
    );

    const meta = curve.metadata();
    expect(meta.type).toBe('accumulator');
  });
});

describe('BlockedCurve', () => {
  const mockDependencyChecker = (completedIds: number[]) => ({
    getTask: async (id: number): Promise<Task | null> => {
      if (completedIds.includes(id)) {
        return {
          id,
          title: 'Completed task',
          tags: [],
          dependencies: [],
          curve_config: { type: CurveType.LINEAR },
          status: TaskStatus.COMPLETED,
          created_at: new Date(),
          updated_at: new Date(),
        };
      }
      return {
        id,
        title: 'Open task',
        tags: [],
        dependencies: [],
        curve_config: { type: CurveType.LINEAR },
        status: TaskStatus.OPEN,
        created_at: new Date(),
        updated_at: new Date(),
      };
    },
  });

  test('returns 0 when dependencies not complete', async () => {
    const innerCurve = new LinearCurve(
      new Date('2024-01-01'),
      new Date('2024-01-10')
    );
    const checker = mockDependencyChecker([]); // No completed tasks

    const curve = new BlockedCurve([1, 2], innerCurve, checker);
    const priority = await curve.calculate(new Date('2024-01-05'));

    expect(priority).toBe(0);
  });

  test('returns inner curve value when all dependencies complete', async () => {
    const innerCurve = new LinearCurve(
      new Date('2024-01-01'),
      new Date('2024-01-10')
    );
    const checker = mockDependencyChecker([1, 2]); // Both complete

    const curve = new BlockedCurve([1, 2], innerCurve, checker);
    const priority = await curve.calculate(new Date('2024-01-05'));

    expect(priority).toBeGreaterThan(0);
  });

  test('throws if no dependencies provided', () => {
    const innerCurve = new LinearCurve(
      new Date('2024-01-01'),
      new Date('2024-01-10')
    );
    const checker = mockDependencyChecker([]);

    expect(() => {
      new BlockedCurve([], innerCurve, checker);
    }).toThrow('Blocked curve requires at least one dependency');
  });

  test('metadata returns curve info', () => {
    const innerCurve = new LinearCurve(
      new Date('2024-01-01'),
      new Date('2024-01-10')
    );
    const checker = mockDependencyChecker([]);

    const curve = new BlockedCurve([1, 2], innerCurve, checker);
    const meta = curve.metadata();

    expect(meta.type).toBe('blocked');
    expect(meta.parameters.dependencies).toEqual([1, 2]);
  });
});

describe('CurveFactory', () => {
  test('creates linear curve', () => {
    const curve = CurveFactory.create({
      type: CurveType.LINEAR,
      start_date: new Date('2024-01-01'),
      deadline: new Date('2024-01-10'),
    });

    expect(curve.metadata().type).toBe('linear');
  });

  test('creates exponential curve', () => {
    const curve = CurveFactory.create({
      type: CurveType.EXPONENTIAL,
      start_date: new Date('2024-01-01'),
      deadline: new Date('2024-01-10'),
      exponent: 3.0,
    });

    expect(curve.metadata().type).toBe('exponential');
  });

  test('creates hard window curve', () => {
    const curve = CurveFactory.create({
      type: CurveType.HARD_WINDOW,
      window_start: new Date('2024-01-10T10:00:00'),
      window_end: new Date('2024-01-10T14:00:00'),
      priority: 0.9,
    });

    expect(curve.metadata().type).toBe('hard_window');
  });

  test('creates accumulator curve', () => {
    const curve = CurveFactory.create(
      {
        type: CurveType.ACCUMULATOR,
        recurrence: { mode: RecurrenceMode.CALENDAR, type: RecurrenceType.WEEKLY },
      },
      undefined,
      {
        id: 1,
        title: 'Test',
        tags: [],
        dependencies: [],
        curve_config: { type: CurveType.LINEAR },
        status: TaskStatus.OPEN,
        created_at: new Date(),
        updated_at: new Date(),
        next_due_at: new Date(),
      }
    );

    expect(curve.metadata().type).toBe('accumulator');
  });

  test('throws for hard window without dates', () => {
    expect(() => {
      CurveFactory.create({ type: CurveType.HARD_WINDOW });
    }).toThrow('Hard window curve requires window_start and window_end');
  });

  test('throws for accumulator without recurrence', () => {
    expect(() => {
      CurveFactory.create({ type: CurveType.ACCUMULATOR });
    }).toThrow('Accumulator curve requires recurrence pattern');
  });

  test('throws for blocked without dependency checker', () => {
    expect(() => {
      CurveFactory.create({
        type: CurveType.BLOCKED,
        dependencies: [1],
      });
    }).toThrow('DependencyChecker required for blocked curve');
  });

  test('throws for blocked without dependencies', () => {
    const checker = { getTask: async () => null };
    expect(() => {
      CurveFactory.create(
        { type: CurveType.BLOCKED, dependencies: [] },
        checker
      );
    }).toThrow('Blocked curve requires dependencies');
  });

  test('throws for unknown curve type', () => {
    expect(() => {
      CurveFactory.create({ type: 'unknown' as CurveType });
    }).toThrow('Unknown curve type');
  });

  test('isAsync returns true for async curves', () => {
    const checker = { getTask: async () => null };
    const innerCurve = new LinearCurve(new Date(), new Date(Date.now() + 86400000));
    const blockedCurve = new BlockedCurve([1], innerCurve, checker);

    expect(CurveFactory.isAsync(blockedCurve)).toBe(true);
    expect(CurveFactory.isAsync(innerCurve)).toBe(false);
  });
});
