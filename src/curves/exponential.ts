import { PriorityCurve, CurveMetadata } from './types';

export class ExponentialCurve implements PriorityCurve {
  constructor(
    private startDate: Date,
    private deadline: Date,
    private exponent: number = 2.0
  ) {
    if (deadline.getTime() <= startDate.getTime()) {
      throw new Error('Deadline must be after start date');
    }
    if (exponent < 1.0 || exponent > 5.0) {
      throw new Error('Exponent must be between 1.0 and 5.0');
    }
  }

  calculate(datetime: Date): number {
    const start = this.startDate.getTime();
    const end = this.deadline.getTime();
    const now = datetime.getTime();

    if (now < start) return 0;

    if (now > end) {
      const overdueMs = now - end;
      const totalMs = end - start;
      return 1.0 + overdueMs / totalMs;
    }

    const linear = (now - start) / (end - start);
    return Math.pow(linear, this.exponent);
  }

  metadata(): CurveMetadata {
    return {
      type: 'exponential',
      parameters: {
        start_date: this.startDate.toISOString(),
        deadline: this.deadline.toISOString(),
        exponent: this.exponent,
      },
      description: `Exponential increase (x^${this.exponent})`,
    };
  }
}
