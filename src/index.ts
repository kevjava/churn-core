// Database
export { Database } from './database';

// Services
export { TaskService, TaskWithPriority } from './task-service';
export { BucketService } from './bucket-service';

// Planner
export {
  DailyPlanner,
  DailyPlan,
  ScheduledTask,
  UnscheduledTask,
  TimeSlot,
  PlannerConfig,
} from './planner';

// Scheduler (implements TaskScheduler from task-parser)
export { ChurnScheduler } from './scheduler';

// Priority Curves
export * from './curves';

// Types
export {
  // Enums
  TaskStatus,
  RecurrenceMode,
  RecurrenceType,
  CurveType,
  // Interfaces
  Task,
  Bucket,
  Completion,
  RecurrencePattern,
  TimeWindow,
  CurveConfig,
  // Input types
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  CreateBucketInput,
  CreateCompletionInput,
  // Export/Import
  ExportData,
  ImportResult,
  ExportedTask,
  ExportedBucket,
  ExportedCompletion,
  // Row types (for advanced use)
  TaskRow,
  BucketRow,
  CompletionRow,
} from './types';

// Re-export TaskScheduler interface from task-parser for convenience
export {
  TaskScheduler,
  ScheduledTask as SchedulerTask,
  DailyPlan as SchedulerPlan,
  CompletionData,
} from '@kevjava/task-parser';
