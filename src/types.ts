// ===== ENUMS =====

export enum TaskStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  BLOCKED = 'blocked',
}

export enum RecurrenceMode {
  CALENDAR = 'calendar',
  COMPLETION = 'completion',
}

export enum RecurrenceType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  INTERVAL = 'interval',
}

export enum CurveType {
  LINEAR = 'linear',
  EXPONENTIAL = 'exponential',
  HARD_WINDOW = 'hard_window',
  BLOCKED = 'blocked',
  ACCUMULATOR = 'accumulator',
}

// ===== INTERFACES =====

export interface RecurrencePattern {
  mode: RecurrenceMode;
  type: RecurrenceType;
  interval?: number;
  unit?: 'days' | 'weeks' | 'months';
  dayOfWeek?: number; // 0-6 (0 = Sunday) - single day
  daysOfWeek?: number[]; // 0-6 array - multiple days (e.g., [1,2,4] for Mon,Tue,Thu)
  timeOfDay?: string; // HH:MM format (e.g., "16:00")
  anchor?: Date;
}

export interface TimeWindow {
  start: string; // HH:MM format (24-hour)
  end: string; // HH:MM format (24-hour)
}

export interface CurveConfig {
  type: CurveType;

  // Common parameters
  start_date?: Date;
  deadline?: Date;

  // Exponential curve
  exponent?: number; // Default 2.0

  // Hard window curve
  window_start?: Date;
  window_end?: Date;
  priority?: number; // Default 1.0

  // Blocked curve
  dependencies?: number[]; // Task IDs
  then_curve?: CurveType; // Curve to use after unblocked

  // Accumulator curve
  recurrence?: RecurrencePattern;
  buildup_rate?: number; // Default 0.1
}

export interface Task {
  id: number;
  title: string;

  // Optional associations
  project?: string;
  bucket_id?: number;
  tags: string[];

  // Temporal properties
  deadline?: Date;
  estimate_minutes?: number;

  // Recurrence
  recurrence_pattern?: RecurrencePattern;
  last_completed_at?: Date;
  next_due_at?: Date;

  // Time window
  window_start?: string; // HH:MM
  window_end?: string; // HH:MM

  // Dependencies
  dependencies: number[]; // Task IDs this task depends on

  // Priority curve
  curve_config: CurveConfig;

  // Status
  status: TaskStatus;

  // Metadata
  created_at: Date;
  updated_at: Date;
}

export interface Bucket {
  id: number;
  name: string;
  type: 'project' | 'category' | 'context';

  config: {
    preferred_times?: string[];
    min_block_duration?: number; // minutes
    interruptible?: boolean;
    hours_per_week?: number;
  };

  created_at: Date;
  updated_at: Date;
}

export interface Completion {
  id: number;
  task_id: number;
  completed_at: Date;

  // Time tracking (from tt integration)
  actual_minutes?: number;
  scheduled_minutes?: number;
  variance_minutes?: number;
  interruptions?: number;
  notes?: string;

  // Context for learning
  day_of_week: number; // 0-6
  hour_of_day: number; // 0-23
  competing_tasks?: number;

  created_at: Date;
}

// ===== INPUT TYPES =====

export interface CreateTaskInput {
  title: string;
  project?: string;
  tags?: string[];
  deadline?: Date;
  estimate_minutes?: number;
  bucket_id?: number;
  recurrence_pattern?: RecurrencePattern;
  window_start?: string;
  window_end?: string;
  dependencies?: number[];
  curve_config?: Partial<CurveConfig>;
}

export interface UpdateTaskInput {
  title?: string;
  project?: string;
  tags?: string[];
  deadline?: Date;
  estimate_minutes?: number;
  bucket_id?: number;
  recurrence_pattern?: RecurrencePattern;
  window_start?: string;
  window_end?: string;
  dependencies?: number[];
  curve_config?: Partial<CurveConfig>;
  status?: TaskStatus;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  project?: string;
  bucket_id?: number;
  tags?: string[];
  has_deadline?: boolean;
  has_recurrence?: boolean;
  overdue?: boolean;
}

export interface CreateBucketInput {
  name: string;
  type: 'project' | 'category' | 'context';
  config?: Bucket['config'];
}

export interface CreateCompletionInput {
  task_id: number;
  completed_at: Date;
  actual_minutes?: number;
  scheduled_minutes?: number;
  variance_minutes?: number;
  interruptions?: number;
  notes?: string;
  day_of_week: number;
  hour_of_day: number;
  competing_tasks?: number;
}

// ===== DATABASE ROW TYPES =====

export interface TaskRow {
  id: number;
  title: string;
  project: string | null;
  bucket_id: number | null;
  tags: string; // JSON array
  deadline: string | null; // ISO 8601
  estimate_minutes: number | null;
  recurrence_mode: string | null;
  recurrence_pattern: string | null; // JSON
  last_completed_at: string | null; // ISO 8601
  next_due_at: string | null; // ISO 8601
  window_start: string | null; // HH:MM
  window_end: string | null; // HH:MM
  dependencies: string; // JSON array
  curve_config: string; // JSON
  status: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

export interface BucketRow {
  id: number;
  name: string;
  type: string;
  config: string; // JSON
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

export interface CompletionRow {
  id: number;
  task_id: number;
  completed_at: string; // ISO 8601
  actual_minutes: number | null;
  scheduled_minutes: number | null;
  variance_minutes: number | null;
  interruptions: number | null;
  notes: string | null;
  day_of_week: number;
  hour_of_day: number;
  competing_tasks: number | null;
  created_at: string; // ISO 8601
}

// ===== EXPORT/IMPORT TYPES =====

export interface ExportedBucket {
  id: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface ExportedTask {
  id: number;
  title: string;
  project?: string;
  bucket_id?: number;
  tags: string[];
  deadline?: string;
  estimate_minutes?: number;
  recurrence_pattern?: RecurrencePattern;
  last_completed_at?: string;
  next_due_at?: string;
  window_start?: string;
  window_end?: string;
  dependencies: number[];
  curve_config: CurveConfig;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ExportedCompletion {
  id: number;
  task_id: number;
  completed_at: string;
  actual_minutes?: number;
  scheduled_minutes?: number;
  variance_minutes?: number;
  interruptions?: number;
  notes?: string;
  day_of_week: number;
  hour_of_day: number;
  competing_tasks?: number;
}

export interface ExportData {
  version: string;
  exported_at: string;
  buckets: ExportedBucket[];
  tasks: ExportedTask[];
  completions: ExportedCompletion[];
}

export interface ImportResult {
  buckets: { imported: number; skipped: number };
  tasks: { imported: number; skipped: number };
  completions: { imported: number; skipped: number };
}
