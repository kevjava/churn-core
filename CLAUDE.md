# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build          # Compile TypeScript to dist/
npm test               # Run test suite
npm run test:watch     # Watch mode for development
npm run test:coverage  # Generate coverage reports
npm run lint           # Type check without emitting
```

Run a single test file:
```bash
npx jest tests/task-service.test.ts
```

Run tests matching a pattern:
```bash
npx jest -t "should create task"
```

## Architecture

This is a TypeScript library implementing a task management system with priority curves, recurrence patterns, and daily planning. It's a core library consumed by `churn` (CLI app in `../churn/`).

### Core Layers

1. **Database Layer** (`src/database.ts`) - SQLite via better-sqlite3 with FTS5 search support. Tables: `buckets`, `tasks`, `completions`, `config`.

2. **Service Layer** - `TaskService` and `BucketService` provide CRUD operations. TaskService implements `DependencyChecker` interface for checking task blocking relationships.

3. **Priority Curves** (`src/curves/`) - Five curve types determine task priority over time:
   - `LinearCurve` - Steady increase
   - `ExponentialCurve` - Accelerating urgency
   - `HardWindowCurve` - Time-bounded availability
   - `BlockedCurve` - Dependency-based blocking
   - `AccumulatorCurve` - Recurring task buildup

4. **Scheduling** - `DailyPlanner` uses greedy first-fit scheduling. `ChurnScheduler` implements `TaskScheduler` interface from `@kevjava/task-parser`.

### Key Patterns

- Factory pattern: `CurveFactory` creates curve instances from `CurveType` enum
- Services take `Database` instance as constructor dependency
- Complex fields (tags, dependencies, curve_config, recurrence_pattern) stored as JSON in SQLite

### Related Packages

- `@kevjava/task-parser` (local: `../task-parser/`) - Task parsing library, provides `TaskScheduler` interface
- `churn` (local: `../churn/`) - CLI consumer of this library

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

Format: `<type>[optional scope]: <description>`

Types:
- `feat`: New feature (correlates with MINOR in semver)
- `fix`: Bug fix (correlates with PATCH in semver)
- `docs`: Documentation only
- `style`: Code style (formatting, semicolons, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or correcting tests
- `chore`: Maintenance tasks
- `build`: Build system or external dependencies
- `ci`: CI configuration

Breaking changes: Add `!` before the colon (e.g., `feat!: remove deprecated API`) or include `BREAKING CHANGE:` in the footer.

## Git Workflow

Always use feature branches and pull requests for changes:

1. Create a feature branch from the main branch
2. Make changes and commit with conventional commit messages
3. Push the branch and create a pull request
4. Merge via PR after review

Never commit directly to the main branch.
