import { PriorityCurve, AsyncPriorityCurve } from './types';
import { CurveConfig, CurveType, Task } from '../types';
import { LinearCurve } from './linear';
import { ExponentialCurve } from './exponential';
import { HardWindowCurve } from './hard-window';
import { AccumulatorCurve } from './accumulator';
import { BlockedCurve, DependencyChecker } from './blocked';

export class CurveFactory {
  static create(
    config: CurveConfig,
    dependencyChecker?: DependencyChecker,
    task?: Task
  ): PriorityCurve | AsyncPriorityCurve {
    switch (config.type) {
      case CurveType.LINEAR:
        return new LinearCurve(
          config.start_date ?? new Date(),
          config.deadline ?? new Date(Date.now() + 7 * 86400000)
        );

      case CurveType.EXPONENTIAL:
        return new ExponentialCurve(
          config.start_date ?? new Date(),
          config.deadline ?? new Date(Date.now() + 7 * 86400000),
          config.exponent ?? 2.0
        );

      case CurveType.HARD_WINDOW:
        if (!config.window_start || !config.window_end) {
          throw new Error('Hard window curve requires window_start and window_end');
        }
        return new HardWindowCurve(
          config.window_start,
          config.window_end,
          config.priority ?? 1.0
        );

      case CurveType.BLOCKED:
        if (!dependencyChecker) {
          throw new Error('DependencyChecker required for blocked curve');
        }
        if (!config.dependencies || config.dependencies.length === 0) {
          throw new Error('Blocked curve requires dependencies');
        }
        const wrappedCurve = this.create(
          {
            type: config.then_curve ?? CurveType.LINEAR,
            start_date: config.start_date ?? new Date(),
            deadline: config.deadline,
          },
          dependencyChecker
        ) as PriorityCurve;
        return new BlockedCurve(config.dependencies, wrappedCurve, dependencyChecker);

      case CurveType.ACCUMULATOR:
        if (!config.recurrence) {
          throw new Error('Accumulator curve requires recurrence pattern');
        }
        return new AccumulatorCurve(
          config.recurrence,
          task?.last_completed_at ?? null,
          task?.next_due_at ?? new Date(),
          config.buildup_rate ?? 0.1
        );

      default:
        throw new Error(`Unknown curve type: ${config.type}`);
    }
  }

  static isAsync(curve: PriorityCurve | AsyncPriorityCurve): curve is AsyncPriorityCurve {
    return curve.calculate.constructor.name === 'AsyncFunction';
  }
}
