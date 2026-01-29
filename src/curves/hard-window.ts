import { PriorityCurve, CurveMetadata } from './types';

export class HardWindowCurve implements PriorityCurve {
  constructor(
    private windowStart: Date,
    private windowEnd: Date,
    private priority: number = 1.0
  ) {
    if (windowEnd.getTime() <= windowStart.getTime()) {
      throw new Error('Window end must be after window start');
    }
    if (priority < 0 || priority > 2.0) {
      throw new Error('Priority must be between 0 and 2.0');
    }
  }

  calculate(datetime: Date): number {
    const now = datetime.getTime();
    const start = this.windowStart.getTime();
    const end = this.windowEnd.getTime();

    if (now >= start && now <= end) {
      return this.priority;
    }

    return 0;
  }

  metadata(): CurveMetadata {
    return {
      type: 'hard_window',
      parameters: {
        window_start: this.windowStart.toISOString(),
        window_end: this.windowEnd.toISOString(),
        priority: this.priority,
      },
      description: 'On/off within specific time window',
    };
  }
}
