import { PriorityCurve, CurveMetadata } from './types';

export class LinearCurve implements PriorityCurve {
  constructor(
    private startDate: Date,
    private deadline: Date
  ) {
    if (deadline.getTime() <= startDate.getTime()) {
      throw new Error('Deadline must be after start date');
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

    return (now - start) / (end - start);
  }

  metadata(): CurveMetadata {
    return {
      type: 'linear',
      parameters: {
        start_date: this.startDate.toISOString(),
        deadline: this.deadline.toISOString(),
      },
      description: 'Linear increase from start to deadline',
    };
  }
}
