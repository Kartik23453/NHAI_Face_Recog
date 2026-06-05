/**
 * @file attendanceRepository.ts
 * @description CRUD data-access layer for the `attendance` table in NetraSetu.
 *
 * Design principles (per mobile-developer skill – offline-first pattern):
 *   - Every recognition event is persisted locally before any network call.
 *   - sync_status tracks which records still need to be uploaded.
 *   - All functions are async with explicit TypeScript return types.
 *   - Errors are descriptive and include the operation context.
 *
 * Relationship:
 *   Each Attendance row belongs to exactly one Worker (via worker_id FK).
 *   Querying attendance by worker is the primary use-case for reports.
 */

import 'react-native-get-random-values'; // Polyfill for crypto.getRandomValues on RN
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';
import type { Attendance, CreateAttendanceInput } from './models';
import { SyncStatus } from '../sync/SyncTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a raw SQLite row object to a typed Attendance interface.
 */
function rowToAttendance(row: Record<string, unknown>): Attendance {
  return {
    attendance_id: row['attendance_id'] as string,
    worker_id: row['worker_id'] as string,
    timestamp: row['timestamp'] as number,
    sync_status: row['sync_status'] as SyncStatus,
  };
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Records a new attendance event in the local database.
 *
 * Called immediately after a successful face recognition match so the event
 * is persisted even if the device loses connectivity right after. Sync is
 * handled separately by the background sync manager.
 *
 * @param input - worker_id and optional timestamp (defaults to Date.now())
 * @returns     The fully-populated Attendance object as stored
 * @throws      If the INSERT fails (e.g. worker_id references a non-existent worker)
 */
export async function createAttendance(
  input: CreateAttendanceInput,
): Promise<Attendance> {
  const db = await getDatabase();

  const record: Attendance = {
    attendance_id: uuidv4(),
    worker_id: input.worker_id,
    timestamp: input.timestamp ?? Date.now(),
    sync_status: input.sync_status ?? SyncStatus.PENDING,
  };

  try {
    await db.runAsync(
      `INSERT INTO attendance (attendance_id, worker_id, timestamp, sync_status)
       VALUES (?, ?, ?, ?)`,
      [
        record.attendance_id,
        record.worker_id,
        record.timestamp,
        record.sync_status,
      ],
    );

    console.log(
      '[AttendanceRepository] Recorded attendance:',
      record.attendance_id,
      'for worker:',
      record.worker_id,
    );

    return record;
  } catch (error) {
    console.error('[AttendanceRepository] createAttendance failed:', error);
    throw new Error(
      `Failed to record attendance for worker "${input.worker_id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// READ – by worker
// ---------------------------------------------------------------------------

/**
 * Retrieves all attendance records for a specific worker.
 *
 * Results are sorted newest-first, which is the natural order for
 * displaying a worker's attendance history in the UI.
 *
 * @param worker_id  - UUID of the worker whose records to fetch
 * @param limit      - Optional max number of records (useful for recent-only views)
 * @returns          Array of Attendance objects (empty if none)
 * @throws           If the query fails
 */
export async function getAttendanceByWorker(
  worker_id: string,
  limit?: number,
): Promise<Attendance[]> {
  const db = await getDatabase();

  const sql =
    limit !== undefined
      ? 'SELECT * FROM attendance WHERE worker_id = ? ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM attendance WHERE worker_id = ? ORDER BY timestamp DESC';

  const params: (string | number)[] =
    limit !== undefined ? [worker_id, limit] : [worker_id];

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(sql, params);
    return rows.map(rowToAttendance);
  } catch (error) {
    console.error('[AttendanceRepository] getAttendanceByWorker failed:', error);
    throw new Error(
      `Failed to fetch attendance for worker "${worker_id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// READ – all
// ---------------------------------------------------------------------------

/**
 * Returns every attendance record in the database, ordered newest-first.
 *
 * This is primarily used for admin dashboards and full data exports.
 * For large datasets consider paginating with the optional parameters.
 *
 * @param options.limit  - Max rows to return (default: no limit)
 * @param options.offset - Row offset for pagination (default: 0)
 * @returns              Array of Attendance objects
 * @throws               If the query fails
 */
export async function getAllAttendance(options?: {
  limit?: number;
  offset?: number;
}): Promise<Attendance[]> {
  const db = await getDatabase();

  let sql = 'SELECT * FROM attendance ORDER BY timestamp DESC';
  const params: number[] = [];

  if (options?.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(options.limit);

    if (options.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }
  }

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(sql, params);
    return rows.map(rowToAttendance);
  } catch (error) {
    console.error('[AttendanceRepository] getAllAttendance failed:', error);
    throw new Error(
      `Failed to fetch all attendance records: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// UPDATE – sync status
// ---------------------------------------------------------------------------

/**
 * Updates the sync_status of one or more attendance records.
 *
 * Called by the background sync manager after a successful (or failed) upload
 * to mark records accordingly:
 *   - Pass `1` after a successful server acknowledgement.
 *   - Pass `2` if the upload failed and will be retried later.
 *
 * Accepts a single ID or an array for batch updates in one DB round-trip.
 *
 * @param attendance_ids - One ID or an array of IDs to update
 * @param sync_status    - New sync_status value (0 | 1 | 2)
 * @returns              Number of rows actually updated
 * @throws               If the UPDATE query fails
 */
export async function updateAttendanceSyncStatus(
  attendance_ids: string | string[],
  sync_status: SyncStatus,
): Promise<number> {
  const db = await getDatabase();

  const ids = Array.isArray(attendance_ids) ? attendance_ids : [attendance_ids];
  if (ids.length === 0) {
    return 0;
  }

  // Use an IN clause for efficient batch updates
  const placeholders = ids.map(() => '?').join(', ');

  try {
    const result = await db.runAsync(
      `UPDATE attendance SET sync_status = ? WHERE attendance_id IN (${placeholders})`,
      [sync_status, ...ids],
    );

    console.log(
      `[AttendanceRepository] Updated sync_status=${sync_status} for ${result.changes} record(s)`,
    );

    return result.changes;
  } catch (error) {
    console.error(
      '[AttendanceRepository] updateAttendanceSyncStatus failed:',
      error,
    );
    throw new Error(
      `Failed to update sync status: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Returns all attendance records with sync_status = PENDING.
 * Used by the background sync manager to batch-upload unsynced events.
 *
 * @param limit - Optional max records per sync batch (default: 100)
 * @returns     Array of unsynced Attendance objects, oldest-first
 */
export async function getPendingAttendance(
  limit: number = 100,
): Promise<Attendance[]> {
  const db = await getDatabase();

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM attendance WHERE sync_status = ? ORDER BY timestamp ASC LIMIT ?',
      [SyncStatus.PENDING, limit],
    );
    return rows.map(rowToAttendance);
  } catch (error) {
    console.error(
      '[AttendanceRepository] getPendingAttendance failed:',
      error,
    );
    throw new Error(
      `Failed to fetch pending attendance: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Returns all attendance records with sync_status = SYNCED.
 *
 * @param limit - Optional max records to fetch (default: 100)
 * @returns     Array of synced Attendance objects, newest-first
 */
export async function getSyncedAttendance(
  limit: number = 100,
): Promise<Attendance[]> {
  const db = await getDatabase();

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM attendance WHERE sync_status = ? ORDER BY timestamp DESC LIMIT ?',
      [SyncStatus.SYNCED, limit],
    );
    return rows.map(rowToAttendance);
  } catch (error) {
    console.error('[AttendanceRepository] getSyncedAttendance failed:', error);
    throw new Error(
      `Failed to fetch synced attendance: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Counts the total number of pending attendance records.
 *
 * @returns Number of records waiting to be synced.
 */
export async function countPendingAttendance(): Promise<number> {
  const db = await getDatabase();

  try {
    const result = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM attendance WHERE sync_status = ?',
      [SyncStatus.PENDING]
    );
    return result?.count ?? 0;
  } catch (error) {
    console.error('[AttendanceRepository] countPendingAttendance failed:', error);
    return 0;
  }
}

/**
 * Returns attendance records within a date range for reporting.
 *
 * @param from - Start timestamp (ms, inclusive)
 * @param to   - End timestamp (ms, inclusive)
 * @returns    Array of Attendance objects within the range
 */
export async function getAttendanceByDateRange(
  from: number,
  to: number,
): Promise<Attendance[]> {
  const db = await getDatabase();

  try {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM attendance WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC',
      [from, to],
    );
    return rows.map(rowToAttendance);
  } catch (error) {
    console.error(
      '[AttendanceRepository] getAttendanceByDateRange failed:',
      error,
    );
    throw new Error(
      `Failed to fetch attendance for date range: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
