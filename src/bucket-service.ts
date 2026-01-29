import { Database } from './database';
import { Bucket, Task, CreateBucketInput } from './types';

export class BucketService {
  constructor(private db: Database) {}

  async create(input: CreateBucketInput): Promise<Bucket> {
    // Check for duplicate name
    const existing = await this.db.getBucketByName(input.name);
    if (existing) {
      throw new Error(`Bucket "${input.name}" already exists`);
    }

    const id = await this.db.insertBucket(input);
    const bucket = await this.db.getBucket(id);
    if (!bucket) {
      throw new Error('Failed to create bucket');
    }
    return bucket;
  }

  async get(id: number): Promise<Bucket | null> {
    return this.db.getBucket(id);
  }

  async getByName(name: string): Promise<Bucket | null> {
    return this.db.getBucketByName(name);
  }

  async list(): Promise<Bucket[]> {
    return this.db.getBuckets();
  }

  async update(id: number, updates: Partial<CreateBucketInput>): Promise<Bucket> {
    const bucket = await this.db.getBucket(id);
    if (!bucket) {
      throw new Error(`Bucket ${id} not found`);
    }

    // Check for name conflict if renaming
    if (updates.name && updates.name !== bucket.name) {
      const existing = await this.db.getBucketByName(updates.name);
      if (existing) {
        throw new Error(`Bucket "${updates.name}" already exists`);
      }
    }

    await this.db.updateBucket(id, updates);
    const updated = await this.db.getBucket(id);
    if (!updated) {
      throw new Error(`Bucket ${id} not found after update`);
    }
    return updated;
  }

  async delete(id: number): Promise<void> {
    const bucket = await this.db.getBucket(id);
    if (!bucket) {
      throw new Error(`Bucket ${id} not found`);
    }

    await this.db.deleteBucket(id);
  }

  async getTasks(bucketId: number): Promise<Task[]> {
    const bucket = await this.db.getBucket(bucketId);
    if (!bucket) {
      throw new Error(`Bucket ${bucketId} not found`);
    }

    return this.db.getTasks({ bucket_id: bucketId });
  }
}
