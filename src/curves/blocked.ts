import { AsyncPriorityCurve, PriorityCurve, CurveMetadata } from './types';
import { Task, TaskStatus } from '../types';

export interface DependencyChecker {
  getTask(id: number): Promise<Task | null>;
}

export class BlockedCurve implements AsyncPriorityCurve {
  constructor(
    private dependencies: number[],
    private thenCurve: PriorityCurve,
    private dependencyChecker: DependencyChecker
  ) {
    if (dependencies.length === 0) {
      throw new Error('Blocked curve requires at least one dependency');
    }
  }

  async calculate(datetime: Date): Promise<number> {
    const allComplete = await this.allDependenciesComplete();

    if (!allComplete) {
      return 0;
    }

    return this.thenCurve.calculate(datetime);
  }

  private async allDependenciesComplete(): Promise<boolean> {
    for (const depId of this.dependencies) {
      const task = await this.dependencyChecker.getTask(depId);
      if (!task || task.status !== TaskStatus.COMPLETED) {
        return false;
      }
    }
    return true;
  }

  metadata(): CurveMetadata {
    return {
      type: 'blocked',
      parameters: {
        dependencies: this.dependencies,
        then_curve: this.thenCurve.metadata(),
      },
      description: `Blocked by tasks ${this.dependencies.join(', ')}`,
    };
  }
}
