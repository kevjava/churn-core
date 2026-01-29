import { Database, BucketService } from '../src';

describe('BucketService', () => {
  let db: Database;
  let service: BucketService;

  beforeEach(async () => {
    db = new Database(':memory:');
    await db.init();
    service = new BucketService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  test('create bucket', async () => {
    const bucket = await service.create({
      name: 'Work',
      type: 'category',
      config: { hours_per_week: 40 },
    });

    expect(bucket.id).toBeDefined();
    expect(bucket.name).toBe('Work');
    expect(bucket.type).toBe('category');
    expect(bucket.config.hours_per_week).toBe(40);
  });

  test('create bucket with duplicate name throws', async () => {
    await service.create({ name: 'Work', type: 'category' });

    await expect(
      service.create({ name: 'Work', type: 'project' })
    ).rejects.toThrow('Bucket "Work" already exists');
  });

  test('get bucket by id', async () => {
    const created = await service.create({ name: 'Test', type: 'context' });

    const bucket = await service.get(created.id);
    expect(bucket).not.toBeNull();
    expect(bucket!.name).toBe('Test');
  });

  test('get bucket returns null for non-existent id', async () => {
    const bucket = await service.get(999);
    expect(bucket).toBeNull();
  });

  test('get bucket by name', async () => {
    await service.create({ name: 'MyBucket', type: 'project' });

    const bucket = await service.getByName('MyBucket');
    expect(bucket).not.toBeNull();
    expect(bucket!.name).toBe('MyBucket');
  });

  test('list buckets', async () => {
    await service.create({ name: 'Bucket A', type: 'category' });
    await service.create({ name: 'Bucket B', type: 'project' });

    const buckets = await service.list();
    expect(buckets).toHaveLength(2);
  });

  test('update bucket', async () => {
    const created = await service.create({
      name: 'Original',
      type: 'category',
    });

    const updated = await service.update(created.id, {
      name: 'Updated',
      config: { interruptible: true },
    });

    expect(updated.name).toBe('Updated');
    expect(updated.config.interruptible).toBe(true);
  });

  test('update bucket with duplicate name throws', async () => {
    await service.create({ name: 'First', type: 'category' });
    const second = await service.create({ name: 'Second', type: 'category' });

    await expect(
      service.update(second.id, { name: 'First' })
    ).rejects.toThrow('Bucket "First" already exists');
  });

  test('update non-existent bucket throws', async () => {
    await expect(
      service.update(999, { name: 'Test' })
    ).rejects.toThrow('Bucket 999 not found');
  });

  test('delete bucket', async () => {
    const created = await service.create({ name: 'ToDelete', type: 'context' });

    await service.delete(created.id);

    const bucket = await service.get(created.id);
    expect(bucket).toBeNull();
  });

  test('delete non-existent bucket throws', async () => {
    await expect(service.delete(999)).rejects.toThrow('Bucket 999 not found');
  });

  test('get tasks for bucket', async () => {
    const bucket = await service.create({ name: 'Work', type: 'category' });

    // Create tasks in the bucket
    await db.insertTask({
      title: 'Task 1',
      bucket_id: bucket.id,
    });
    await db.insertTask({
      title: 'Task 2',
      bucket_id: bucket.id,
    });
    await db.insertTask({
      title: 'Task 3',
      // No bucket
    });

    const tasks = await service.getTasks(bucket.id);
    expect(tasks).toHaveLength(2);
  });

  test('get tasks for non-existent bucket throws', async () => {
    await expect(service.getTasks(999)).rejects.toThrow('Bucket 999 not found');
  });
});
