/**
 * @file workerRepository.ts
 * @description CRUD data-access layer for the `workers` table in NetraSetu.
 *
 * Design principles (per mobile-developer skill – offline-first pattern):
 *   - All writes go to SQLite first; network sync is a separate concern.
 *   - Every public function is async and returns typed results.
 *   - Errors bubble up with descriptive messages so callers can handle them.
 *   - UUIDs are generated client-side to avoid server round-trips.
 *
 * TypeScript standards (per frontend-expert skill):
 *   - No `any` types; explicit return types on all functions.
 *   - Input types are derived from the Worker interface via utility types.
 */

import 'react-native-get-random-values'; // Polyfill for crypto.getRandomValues on RN
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';
import type { Worker, CreateWorkerInput, UpdateWorkerInput } from './models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a raw SQLite row object to a typed Worker interface.
 * SQLite returns numbers for INTEGER columns, so no coercion is needed.
 */
function rowToWorker(row: Record<string, unknown>): Worker {
  return {
    worker_id: row['worker_id'] as string,
    name: row['name'] as string,
    face_embedding: row['face_embedding'] as string,
    sync_status: row['sync_status'] as number,
    created_at: row['created_at'] as number,
  };
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Inserts a new worker record into the database.
 *
 * Generates a UUID v4 for `worker_id` and stamps `created_at` with the
 * current Unix timestamp (ms) so the record is self-contained offline.
 *
 * @param input - Worker fields provided by the caller (name, face_embedding)
 * @returns     The fully-populated Worker object as stored in the database
 * @throws      If the INSERT fails (e.g. duplicate primary key)
 */
export async function createWorker(input: CreateWorkerInput): Promise<Worker> {
  const db = await getDatabase();

  const worker: Worker = {
    worker_id: uuidv4(),
    name: input.name.trim(),
    face_embedding: input.face_embedding ?? '',
    sync_status: input.sync_status ?? 0,
    created_at: Date.now(),
  };

  try {
    await db.runAsync(
      `INSERT INTO workers (worker_id, name, face_embedding, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        worker.worker_id,
        worker.name,
        worker.face_embedding,
        worker.sync_status,
        worker.created_at,
      ],
    );

    console.log('[WorkerRepository] Created worker:', worker.worker_id);
    return worker;
  } catch (error) {
    console.error('[WorkerRepository] createWorker failed:', error);
    throw new Error(
      `Failed to create worker "${input.name}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// READ – single
// ---------------------------------------------------------------------------

/**
 * Retrieves a single worker by their primary key.
 *
 * @param worker_id - UUID of the worker to fetch
 * @returns         The Worker object, or null if not found
 * @throws          If the query itself fails (not for missing rows)
 */
export async function getWorker(worker_id: string): Promise<Worker | null> {
  const db = await getDatabase();

  try {
    const row = await db.getFirstAsync<Record<string, unknown>>(
      'SELECT * FROM workers WHERE worker_id = ?',
      [worker_id],
    );

    if (row === null) {
      return null;
    }

    return rowToWorker(row);
  } catch (error) {
    console.error('[WorkerRepository] getWorker failed:', error);
    throw new Error(
      `Failed to fetch worker "${worker_id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// READ – all
// ---------------------------------------------------------------------------

/**
 * Returns every worker in the database, ordered by creation date (newest first).
 *
 * This is the primary feed for the worker list UI and the face-matching loop.
 * For large datasets consider adding pagination via LIMIT / OFFSET.
 *
 * @returns Array of Worker objects (empty array if none exist)
 * @throws  If the query fails
 */
export async function getAllWorkers(): Promise<Worker[]> {
  const db = await getDatabase();

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM workers ORDER BY created_at DESC',
    );

    return rows.map(rowToWorker);
  } catch (error) {
    console.error('[WorkerRepository] getAllWorkers failed:', error);
    throw new Error(
      `Failed to fetch workers: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

/**
 * Applies a partial update to an existing worker record.
 *
 * Only the fields present in `fields` are modified; unspecified fields are
 * left unchanged. This makes it safe to call for targeted updates such as
 * saving a face embedding after capture or marking sync_status = 1.
 *
 * @param worker_id - UUID of the worker to update
 * @param fields    - Partial Worker fields to overwrite
 * @returns         The updated Worker object
 * @throws          If the worker does not exist or the UPDATE fails
 */
export async function updateWorker(
  worker_id: string,
  fields: UpdateWorkerInput,
): Promise<Worker> {
  const db = await getDatabase();

  // Build dynamic SET clause from provided fields only
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) {
    throw new Error('updateWorker: at least one field must be provided');
  }

  const setClauses = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value);

  try {
    const result = await db.runAsync(
      `UPDATE workers SET ${setClauses} WHERE worker_id = ?`,
      [...values, worker_id],
    );

    if (result.changes === 0) {
      throw new Error(`Worker "${worker_id}" not found`);
    }

    // Return fresh copy from DB to reflect any DB-level defaults
    const updated = await getWorker(worker_id);
    if (updated === null) {
      throw new Error(`Worker "${worker_id}" disappeared after update`);
    }

    console.log('[WorkerRepository] Updated worker:', worker_id);
    return updated;
  } catch (error) {
    console.error('[WorkerRepository] updateWorker failed:', error);
    throw error instanceof Error
      ? error
      : new Error(
          `Failed to update worker "${worker_id}": ${String(error)}`,
        );
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

/**
 * Permanently removes a worker and all their attendance records.
 *
 * The CASCADE constraint on the attendance foreign key handles the child rows
 * automatically, so no separate DELETE on the attendance table is needed.
 *
 * @param worker_id - UUID of the worker to delete
 * @returns         true if a row was deleted, false if the worker didn't exist
 * @throws          If the DELETE query itself fails
 */
export async function deleteWorker(worker_id: string): Promise<boolean> {
  const db = await getDatabase();

  try {
    const result = await db.runAsync(
      'DELETE FROM workers WHERE worker_id = ?',
      [worker_id],
    );

    const deleted = result.changes > 0;
    if (deleted) {
      console.log('[WorkerRepository] Deleted worker:', worker_id);
    }
    return deleted;
  } catch (error) {
    console.error('[WorkerRepository] deleteWorker failed:', error);
    throw new Error(
      `Failed to delete worker "${worker_id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Returns all workers with sync_status = 0 (pending upload).
 * Used by the background sync manager to batch-upload new registrations.
 *
 * @returns Array of unsynced Worker objects
 */
export async function getUnsyncedWorkers(): Promise<Worker[]> {
  const db = await getDatabase();

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM workers WHERE sync_status = 0 ORDER BY created_at ASC',
    );
    return rows.map(rowToWorker);
  } catch (error) {
    console.error('[WorkerRepository] getUnsyncedWorkers failed:', error);
    throw new Error(
      `Failed to fetch unsynced workers: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
