import { PriorityCurve, CurveMetadata } from './types';
import { RecurrencePattern, RecurrenceMode, RecurrenceType } from '../types';

export class AccumulatorCurve implements PriorityCurve {
  constructor(
    private recurrence: RecurrencePattern,
    private lastCompleted: Date | null,
    private nextDue: Date,
    private buildupRate: number = 0.1
  ) {}

  calculate(datetime: Date): number {
    const now = datetime.getTime();
    const due = this.nextDue.getTime();

    if (this.recurrence.mode === RecurrenceMode.CALENDAR) {
      return this.calculateCalendarMode(now, due);
    } else {
      return this.calculateCompletionMode(now);
    }
  }

  private calculateCalendarMode(now: number, due: number): number {
    const expectedInterval = this.getExpectedIntervalDays();
    const daysUntilDue = (due - now) / 86400000;

    if (daysUntilDue > expectedInterval / 2) {
      return 0.2; // Low priority, plenty of time
    }

    if (daysUntilDue < 0) {
      // Overdue
      const daysOverdue = Math.abs(daysUntilDue);
      return Math.min(1.5, 1.0 + daysOverdue * this.buildupRate);
    }

    // Linear buildup in second half of interval
    const progress = 1 - daysUntilDue / (expectedInterval / 2);
    return 0.2 + progress * 0.8; // 0.2 to 1.0
  }

  private calculateCompletionMode(now: number): number {
    const expectedDays = this.getExpectedIntervalDays();
    const lastDone = this.lastCompleted?.getTime() ?? now - expectedDays * 86400000;
    const daysSince = (now - lastDone) / 86400000;
    const ratio = daysSince / expectedDays;

    if (ratio < 0.5) return 0.1;
    if (ratio < 0.8) return 0.3;
    if (ratio < 1.0) return 0.6;
    if (ratio < 1.2) return 0.9;
    return 1.0;
  }

  private getExpectedIntervalDays(): number {
    switch (this.recurrence.type) {
      case RecurrenceType.DAILY:
        return 1;
      case RecurrenceType.WEEKLY:
        return 7;
      case RecurrenceType.MONTHLY:
        return 30;
      case RecurrenceType.INTERVAL: {
        const unitDays: Record<string, number> = { days: 1, weeks: 7, months: 30 };
        return (this.recurrence.interval ?? 1) * unitDays[this.recurrence.unit ?? 'days'];
      }
      default:
        return 7;
    }
  }

  metadata(): CurveMetadata {
    return {
      type: 'accumulator',
      parameters: {
        recurrence: this.recurrence,
        last_completed: this.lastCompleted?.toISOString() ?? null,
        next_due: this.nextDue.toISOString(),
        buildup_rate: this.buildupRate,
      },
      description: 'Priority increases since last completion',
    };
  }
}
