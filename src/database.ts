import BetterSqlite3, { Database as SqliteDatabase } from 'better-sqlite3';
import {
  Task,
  TaskRow,
  Bucket,
  BucketRow,
  Completion,
  CompletionRow,
  CreateTaskInput,
  UpdateTaskInput,
  TaskFilter,
  CreateBucketInput,
  CreateCompletionInput,
  TaskStatus,
  CurveType,
  CurveConfig,
  RecurrencePattern,
  ExportData,
  ImportResult,
} from './types';

const SCHEMA = `
-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ===== BUCKETS =====
CREATE TABLE IF NOT EXISTS buckets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('project', 'category', 'context')),
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_buckets_name ON buckets(name);

-- ===== TASKS =====
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  project TEXT,
  bucket_id INTEGER REFERENCES buckets(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  deadline TEXT,
  estimate_minutes INTEGER,
  recurrence_mode TEXT CHECK(recurrence_mode IN ('calendar', 'completion')),
  recurrence_pattern TEXT,
  last_completed_at TEXT,
  next_due_at TEXT,
  window_start TEXT,
  window_end TEXT,
  dependencies TEXT NOT NULL DEFAULT '[]',
  curve_config TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'completed', 'blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
CREATE INDEX IF NOT EXISTS idx_tasks_bucket ON tasks(bucket_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_next_due ON tasks(next_due_at);

-- ===== COMPLETIONS =====
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL,
  actual_minutes INTEGER,
  scheduled_minutes INTEGER,
  variance_minutes INTEGER,
  interruptions INTEGER DEFAULT 0,
  notes TEXT,
  day_of_week INTEGER NOT NULL,
  hour_of_day INTEGER NOT NULL,
  competing_tasks INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_completions_task ON completions(task_id);
CREATE INDEX IF NOT EXISTS idx_completions_time ON completions(completed_at);
CREATE INDEX IF NOT EXISTS idx_completions_day ON completions(day_of_week);

-- ===== CONFIGURATION =====
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const FTS_SCHEMA = `
-- Full-text search (only create if not exists)
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
  title,
  project,
  tags,
  content=tasks,
  content_rowid=id
);
`;

const FTS_TRIGGERS = `
-- Triggers to keep FTS in sync
DROP TRIGGER IF EXISTS tasks_ai;
CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, project, tags)
  VALUES (new.id, new.title, new.project, new.tags);
END;

DROP TRIGGER IF EXISTS tasks_ad;
CREATE TRIGGER tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, project, tags)
  VALUES ('delete', old.id, old.title, old.project, old.tags);
END;

DROP TRIGGER IF EXISTS tasks_au;
CREATE TRIGGER tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, project, tags)
  VALUES ('delete', old.id, old.title, old.project, old.tags);
  INSERT INTO tasks_fts(rowid, title, project, tags)
  VALUES (new.id, new.title, new.project, new.tags);
END;
`;

const INITIAL_CONFIG = `
INSERT OR IGNORE INTO config (key, value) VALUES
  ('version', '"1.0.0"'),
  ('defaults', '{"curve_type":"linear","work_hours_start":"08:00","work_hours_end":"17:00"}');
`;

export class Database {
  private db: SqliteDatabase;
  private path: string;

  constructor(path: string) {
    this.path = path;
    this.db = new BetterSqlite3(path);
  }

  async init(): Promise<void> {
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.db.exec(FTS_SCHEMA);
    this.db.exec(FTS_TRIGGERS);
    this.db.exec(INITIAL_CONFIG);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ===== TASK OPERATIONS =====

  async insertTask(input: CreateTaskInput): Promise<number> {
    const now = new Date().toISOString();
    const curveConfig = this.buildCurveConfig(input.curve_config, input.recurrence_pattern);

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        title, project, bucket_id, tags, deadline, estimate_minutes,
        recurrence_mode, recurrence_pattern, window_start, window_end,
        dependencies, curve_config, status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    const result = stmt.run(
      input.title,
      input.project ?? null,
      input.bucket_id ?? null,
      JSON.stringify(input.tags ?? []),
      input.deadline?.toISOString() ?? null,
      input.estimate_minutes ?? null,
      input.recurrence_pattern?.mode ?? null,
      input.recurrence_pattern ? JSON.stringify(input.recurrence_pattern) : null,
      input.window_start ?? null,
      input.window_end ?? null,
      JSON.stringify(input.dependencies ?? []),
      JSON.stringify(curveConfig),
      TaskStatus.OPEN,
      now,
      now
    );

    return result.lastInsertRowid as number;
  }

  async getTask(id: number): Promise<Task | null> {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  async getTasks(filter?: TaskFilter): Promise<Task[]> {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: unknown[] = [];

    if (filter) {
      if (filter.status) {
        if (Array.isArray(filter.status)) {
          sql += ` AND status IN (${filter.status.map(() => '?').join(',')})`;
          params.push(...filter.status);
        } else {
          sql += ' AND status = ?';
          params.push(filter.status);
        }
      }

      if (filter.project) {
        sql += ' AND project = ?';
        params.push(filter.project);
      }

      if (filter.bucket_id) {
        sql += ' AND bucket_id = ?';
        params.push(filter.bucket_id);
      }

      if (filter.tags && filter.tags.length > 0) {
        for (const tag of filter.tags) {
          sql += ' AND tags LIKE ?';
          params.push(`%"${tag}"%`);
        }
      }

      if (filter.has_deadline !== undefined) {
        sql += filter.has_deadline ? ' AND deadline IS NOT NULL' : ' AND deadline IS NULL';
      }

      if (filter.has_recurrence !== undefined) {
        sql += filter.has_recurrence
          ? ' AND recurrence_pattern IS NOT NULL'
          : ' AND recurrence_pattern IS NULL';
      }

      if (filter.overdue) {
        sql += " AND deadline < datetime('now') AND status != ?";
        params.push(TaskStatus.COMPLETED);
      }
    }

    sql += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as TaskRow[];
    return rows.map((row) => this.rowToTask(row));
  }

  async updateTask(id: number, updates: UpdateTaskInput): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      params.push(updates.title);
    }

    if (updates.project !== undefined) {
      fields.push('project = ?');
      params.push(updates.project);
    }

    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      params.push(JSON.stringify(updates.tags));
    }

    if (updates.deadline !== undefined) {
      fields.push('deadline = ?');
      params.push(updates.deadline?.toISOString() ?? null);
    }

    if (updates.estimate_minutes !== undefined) {
      fields.push('estimate_minutes = ?');
      params.push(updates.estimate_minutes);
    }

    if (updates.bucket_id !== undefined) {
      fields.push('bucket_id = ?');
      params.push(updates.bucket_id);
    }

    if (updates.recurrence_pattern !== undefined) {
      fields.push('recurrence_mode = ?');
      fields.push('recurrence_pattern = ?');
      params.push(updates.recurrence_pattern?.mode ?? null);
      params.push(updates.recurrence_pattern ? JSON.stringify(updates.recurrence_pattern) : null);
    }

    if (updates.window_start !== undefined) {
      fields.push('window_start = ?');
      params.push(updates.window_start);
    }

    if (updates.window_end !== undefined) {
      fields.push('window_end = ?');
      params.push(updates.window_end);
    }

    if (updates.dependencies !== undefined) {
      fields.push('dependencies = ?');
      params.push(JSON.stringify(updates.dependencies));
    }

    if (updates.curve_config !== undefined) {
      fields.push('curve_config = ?');
      params.push(JSON.stringify(this.buildCurveConfig(updates.curve_config, updates.recurrence_pattern)));
    }

    if (updates.status !== undefined) {
      fields.push('status = ?');
      params.push(updates.status);
    }

    if (fields.length === 0) {
      return;
    }

    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...params);
  }

  async deleteTask(id: number): Promise<void> {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  async searchTasks(query: string): Promise<Task[]> {
    const stmt = this.db.prepare(`
      SELECT t.*
      FROM tasks_fts fts
      JOIN tasks t ON t.id = fts.rowid
      WHERE tasks_fts MATCH ?
      ORDER BY rank
    `);
    const rows = stmt.all(query) as TaskRow[];
    return rows.map((row) => this.rowToTask(row));
  }

  async setTaskLastCompleted(id: number, completedAt: Date): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE tasks SET last_completed_at = ?, updated_at = ? WHERE id = ?
    `
      )
      .run(completedAt.toISOString(), new Date().toISOString(), id);
  }

  async setTaskNextDue(id: number, nextDue: Date): Promise<void> {
    this.db
      .prepare(
        `
      UPDATE tasks SET next_due_at = ?, updated_at = ? WHERE id = ?
    `
      )
      .run(nextDue.toISOString(), new Date().toISOString(), id);
  }

  // ===== BUCKET OPERATIONS =====

  async insertBucket(input: CreateBucketInput): Promise<number> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO buckets (name, type, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(input.name, input.type, JSON.stringify(input.config ?? {}), now, now);
    return result.lastInsertRowid as number;
  }

  async getBucket(id: number): Promise<Bucket | null> {
    const stmt = this.db.prepare('SELECT * FROM buckets WHERE id = ?');
    const row = stmt.get(id) as BucketRow | undefined;
    return row ? this.rowToBucket(row) : null;
  }

  async getBucketByName(name: string): Promise<Bucket | null> {
    const stmt = this.db.prepare('SELECT * FROM buckets WHERE name = ?');
    const row = stmt.get(name) as BucketRow | undefined;
    return row ? this.rowToBucket(row) : null;
  }

  async getBuckets(): Promise<Bucket[]> {
    const stmt = this.db.prepare('SELECT * FROM buckets ORDER BY name');
    const rows = stmt.all() as BucketRow[];
    return rows.map((row) => this.rowToBucket(row));
  }

  async updateBucket(id: number, updates: Partial<CreateBucketInput>): Promise<void> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      params.push(updates.name);
    }

    if (updates.type !== undefined) {
      fields.push('type = ?');
      params.push(updates.type);
    }

    if (updates.config !== undefined) {
      fields.push('config = ?');
      params.push(JSON.stringify(updates.config));
    }

    if (fields.length === 0) {
      return;
    }

    fields.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE buckets SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...params);
  }

  async deleteBucket(id: number): Promise<void> {
    this.db.prepare('DELETE FROM buckets WHERE id = ?').run(id);
  }

  // ===== COMPLETION OPERATIONS =====

  async insertCompletion(input: CreateCompletionInput): Promise<number> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO completions (
        task_id, completed_at, actual_minutes, scheduled_minutes,
        variance_minutes, interruptions, notes, day_of_week, hour_of_day,
        competing_tasks, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      input.task_id,
      input.completed_at.toISOString(),
      input.actual_minutes ?? null,
      input.scheduled_minutes ?? null,
      input.variance_minutes ?? null,
      input.interruptions ?? 0,
      input.notes ?? null,
      input.day_of_week,
      input.hour_of_day,
      input.competing_tasks ?? null,
      now
    );
    return result.lastInsertRowid as number;
  }

  async getCompletions(taskId: number, limit?: number): Promise<Completion[]> {
    let sql = 'SELECT * FROM completions WHERE task_id = ? ORDER BY completed_at DESC';
    if (limit) {
      sql += ` LIMIT ${limit}`;
    }
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(taskId) as CompletionRow[];
    return rows.map((row) => this.rowToCompletion(row));
  }

  async getCompletion(id: number): Promise<Completion | null> {
    const stmt = this.db.prepare('SELECT * FROM completions WHERE id = ?');
    const row = stmt.get(id) as CompletionRow | undefined;
    return row ? this.rowToCompletion(row) : null;
  }

  // ===== CONFIG OPERATIONS =====

  async getConfig(key: string): Promise<unknown> {
    const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  async setConfig(key: string, value: unknown): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `);
    const now = new Date().toISOString();
    const jsonValue = JSON.stringify(value);
    stmt.run(key, jsonValue, now, jsonValue, now);
  }

  // ===== TRANSACTIONS =====

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ===== UTILITY METHODS =====

  getPath(): string {
    return this.path;
  }

  // ===== EXPORT/IMPORT =====

  async getAllCompletions(): Promise<Completion[]> {
    const stmt = this.db.prepare('SELECT * FROM completions ORDER BY completed_at DESC');
    const rows = stmt.all() as CompletionRow[];
    return rows.map((row) => this.rowToCompletion(row));
  }

  async export(): Promise<ExportData> {
    const tasks = await this.getTasks();
    const buckets = await this.getBuckets();
    const completions = await this.getAllCompletions();

    return {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      buckets: buckets.map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        config: b.config,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        project: t.project,
        bucket_id: t.bucket_id,
        tags: t.tags,
        deadline: t.deadline?.toISOString(),
        estimate_minutes: t.estimate_minutes,
        recurrence_pattern: t.recurrence_pattern,
        last_completed_at: t.last_completed_at?.toISOString(),
        next_due_at: t.next_due_at?.toISOString(),
        window_start: t.window_start,
        window_end: t.window_end,
        dependencies: t.dependencies,
        curve_config: t.curve_config,
        status: t.status,
        created_at: t.created_at.toISOString(),
        updated_at: t.updated_at.toISOString(),
      })),
      completions: completions.map((c) => ({
        id: c.id,
        task_id: c.task_id,
        completed_at: c.completed_at.toISOString(),
        actual_minutes: c.actual_minutes,
        scheduled_minutes: c.scheduled_minutes,
        variance_minutes: c.variance_minutes,
        interruptions: c.interruptions,
        notes: c.notes,
        day_of_week: c.day_of_week,
        hour_of_day: c.hour_of_day,
        competing_tasks: c.competing_tasks,
      })),
    };
  }

  async import(data: ExportData, merge = false): Promise<ImportResult> {
    const result: ImportResult = {
      buckets: { imported: 0, skipped: 0 },
      tasks: { imported: 0, skipped: 0 },
      completions: { imported: 0, skipped: 0 },
    };

    return this.transaction(() => {
      // Clear existing data if not merging
      if (!merge) {
        this.db.exec('DELETE FROM completions');
        this.db.exec('DELETE FROM tasks');
        this.db.exec('DELETE FROM buckets');
      }

      // Import buckets
      for (const bucket of data.buckets) {
        if (merge) {
          const existing = this.db
            .prepare('SELECT id FROM buckets WHERE name = ?')
            .get(bucket.name);
          if (existing) {
            result.buckets.skipped++;
            continue;
          }
        }

        this.db
          .prepare(
            `
          INSERT INTO buckets (id, name, type, config, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `
          )
          .run(merge ? null : bucket.id, bucket.name, bucket.type, JSON.stringify(bucket.config ?? {}));
        result.buckets.imported++;
      }

      // Build bucket ID mapping for merge mode
      const bucketIdMap = new Map<number, number>();
      if (merge) {
        for (const bucket of data.buckets) {
          const existing = this.db
            .prepare('SELECT id FROM buckets WHERE name = ?')
            .get(bucket.name) as { id: number } | undefined;
          if (existing) {
            bucketIdMap.set(bucket.id, existing.id);
          }
        }
      }

      // Import tasks
      const taskIdMap = new Map<number, number>();
      for (const task of data.tasks) {
        if (merge) {
          const existing = this.db
            .prepare('SELECT id FROM tasks WHERE title = ? AND created_at = ?')
            .get(task.title, task.created_at);
          if (existing) {
            result.tasks.skipped++;
            continue;
          }
        }

        const bucketId = task.bucket_id
          ? merge
            ? bucketIdMap.get(task.bucket_id) ?? task.bucket_id
            : task.bucket_id
          : null;

        const stmt = this.db.prepare(`
          INSERT INTO tasks (
            id, title, project, bucket_id, tags, deadline, estimate_minutes,
            recurrence_mode, recurrence_pattern, last_completed_at, next_due_at,
            window_start, window_end, dependencies, curve_config, status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const info = stmt.run(
          merge ? null : task.id,
          task.title,
          task.project ?? null,
          bucketId,
          JSON.stringify(task.tags ?? []),
          task.deadline ?? null,
          task.estimate_minutes ?? null,
          task.recurrence_pattern?.mode ?? null,
          task.recurrence_pattern ? JSON.stringify(task.recurrence_pattern) : null,
          task.last_completed_at ?? null,
          task.next_due_at ?? null,
          task.window_start ?? null,
          task.window_end ?? null,
          JSON.stringify(task.dependencies ?? []),
          JSON.stringify(task.curve_config),
          task.status,
          task.created_at,
          task.updated_at
        );

        if (merge) {
          taskIdMap.set(task.id, info.lastInsertRowid as number);
        }
        result.tasks.imported++;
      }

      // Import completions
      for (const completion of data.completions) {
        const taskId = merge
          ? taskIdMap.get(completion.task_id) ?? completion.task_id
          : completion.task_id;

        // Check if task exists
        const taskExists = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
        if (!taskExists) {
          result.completions.skipped++;
          continue;
        }

        this.db
          .prepare(
            `
          INSERT INTO completions (
            id, task_id, completed_at, actual_minutes, scheduled_minutes,
            variance_minutes, interruptions, notes, day_of_week, hour_of_day,
            competing_tasks, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `
          )
          .run(
            merge ? null : completion.id,
            taskId,
            completion.completed_at,
            completion.actual_minutes ?? null,
            completion.scheduled_minutes ?? null,
            completion.variance_minutes ?? null,
            completion.interruptions ?? 0,
            completion.notes ?? null,
            completion.day_of_week,
            completion.hour_of_day,
            completion.competing_tasks ?? null
          );
        result.completions.imported++;
      }

      return result;
    });
  }

  // ===== PRIVATE HELPERS =====

  private buildCurveConfig(
    partial?: Partial<CurveConfig>,
    recurrencePattern?: RecurrencePattern
  ): CurveConfig {
    const now = new Date();
    const defaultDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Auto-default to ACCUMULATOR for recurring tasks (if no explicit type specified)
    const hasExplicitType = partial?.type !== undefined;
    const defaultType =
      !hasExplicitType && recurrencePattern
        ? CurveType.ACCUMULATOR
        : CurveType.LINEAR;

    const config: CurveConfig = {
      type: partial?.type ?? defaultType,
      start_date: partial?.start_date ?? now,
      deadline: partial?.deadline ?? defaultDeadline,
      ...partial,
    };

    // Ensure ACCUMULATOR curves have recurrence pattern
    if (
      config.type === CurveType.ACCUMULATOR &&
      !config.recurrence &&
      recurrencePattern
    ) {
      config.recurrence = recurrencePattern;
    }

    return config;
  }

  private rowToTask(row: TaskRow): Task {
    const curveConfig = JSON.parse(row.curve_config) as CurveConfig;
    if (curveConfig.start_date) {
      curveConfig.start_date = new Date(curveConfig.start_date);
    }
    if (curveConfig.deadline) {
      curveConfig.deadline = new Date(curveConfig.deadline);
    }
    if (curveConfig.window_start) {
      curveConfig.window_start = new Date(curveConfig.window_start);
    }
    if (curveConfig.window_end) {
      curveConfig.window_end = new Date(curveConfig.window_end);
    }

    let recurrencePattern: RecurrencePattern | undefined;
    if (row.recurrence_pattern) {
      recurrencePattern = JSON.parse(row.recurrence_pattern);
      if (recurrencePattern?.anchor) {
        recurrencePattern.anchor = new Date(recurrencePattern.anchor);
      }
    }

    return {
      id: row.id,
      title: row.title,
      project: row.project ?? undefined,
      bucket_id: row.bucket_id ?? undefined,
      tags: JSON.parse(row.tags),
      deadline: row.deadline ? new Date(row.deadline) : undefined,
      estimate_minutes: row.estimate_minutes ?? undefined,
      recurrence_pattern: recurrencePattern,
      last_completed_at: row.last_completed_at ? new Date(row.last_completed_at) : undefined,
      next_due_at: row.next_due_at ? new Date(row.next_due_at) : undefined,
      window_start: row.window_start ?? undefined,
      window_end: row.window_end ?? undefined,
      dependencies: JSON.parse(row.dependencies),
      curve_config: curveConfig,
      status: row.status as TaskStatus,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  private rowToBucket(row: BucketRow): Bucket {
    return {
      id: row.id,
      name: row.name,
      type: row.type as Bucket['type'],
      config: JSON.parse(row.config),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  private rowToCompletion(row: CompletionRow): Completion {
    return {
      id: row.id,
      task_id: row.task_id,
      completed_at: new Date(row.completed_at),
      actual_minutes: row.actual_minutes ?? undefined,
      scheduled_minutes: row.scheduled_minutes ?? undefined,
      variance_minutes: row.variance_minutes ?? undefined,
      interruptions: row.interruptions ?? undefined,
      notes: row.notes ?? undefined,
      day_of_week: row.day_of_week,
      hour_of_day: row.hour_of_day,
      competing_tasks: row.competing_tasks ?? undefined,
      created_at: new Date(row.created_at),
    };
  }
}
