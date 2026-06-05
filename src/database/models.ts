/**
 * @file models.ts
 * @description Core TypeScript domain model interfaces for NetraSetu.
 *
 * These interfaces represent the exact shape of rows returned from SQLite
 * and are used as the single source of truth across the entire database layer.
 * All numeric timestamps are stored as Unix epoch milliseconds (Date.now()).
 *
 * sync_status values:
 *   0 = pending sync (local-only)
 *   1 = synced to remote server
 *   2 = sync failed / needs retry
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { SyncStatus } from '../sync/SyncTypes';

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/**
 * Represents a registered worker whose face has been enrolled in the system.
 * `face_embedding` is stored as a JSON-serialised float array string so it
 * can survive SQLite's TEXT column without a BLOB codec.
 */
export interface Worker {
  /** UUID v4 – generated client-side to support offline creation */
  worker_id: string;

  /** Full display name of the worker */
  name: string;

  /**
   * JSON-serialised numeric array representing the face embedding vector.
   * Example: "[0.123, -0.456, ...]"
   * Empty string "" when the face has not yet been captured.
   */
  face_embedding: string;

  /**
   * Sync status flag.
   * 0 = PENDING | 1 = SYNCED
   */
  sync_status: SyncStatus;

  /** Unix timestamp (ms) when this record was created locally */
  created_at: number;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/**
 * Represents a single attendance event captured via facial recognition.
 * Each row links a worker to a specific moment in time.
 */
export interface Attendance {
  /** UUID v4 – generated client-side to support offline creation */
  attendance_id: string;

  /** Foreign key referencing Worker.worker_id */
  worker_id: string;

  /** Unix timestamp (ms) of the attendance capture event */
  timestamp: number;

  /**
   * Sync status flag.
   * 0 = PENDING | 1 = SYNCED
   */
  sync_status: SyncStatus;
}

// ---------------------------------------------------------------------------
// Utility / Input types
// ---------------------------------------------------------------------------

/**
 * Payload accepted when creating a new worker.
 * `worker_id` and `created_at` are generated automatically.
 */
export type CreateWorkerInput = Omit<Worker, 'worker_id' | 'created_at' | 'sync_status'> &
  Partial<Pick<Worker, 'sync_status'>>;

/**
 * Fields that can be updated on an existing worker record.
 */
export type UpdateWorkerInput = Partial<Omit<Worker, 'worker_id' | 'created_at'>>;

/**
 * Payload accepted when creating a new attendance record.
 * `attendance_id` is generated automatically; `timestamp` defaults to now.
 */
export type CreateAttendanceInput = Omit<Attendance, 'attendance_id' | 'sync_status'> &
  Partial<Pick<Attendance, 'sync_status' | 'timestamp'>>;
