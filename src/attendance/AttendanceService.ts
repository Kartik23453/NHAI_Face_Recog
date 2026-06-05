/**
 * @file AttendanceService.ts
 * @description High-level attendance service for Phase 5 of NetraSetu.
 *
 * This service sits between the recognition pipeline (Phase 4) and the
 * database layer (Phase 1) and is the single module responsible for:
 *   1. markAttendance()         — write an attendance record after recognition
 *   2. hasRecentAttendance()    — lockout guard against twin passback
 *   3. getTodayAttendance()     — fetch all records for today's date window
 *
 * Offline-first guarantee (mobile-developer skill):
 *   All writes go directly to SQLite. No network call is made.
 *   sync_status = 0 on every new record — Phase 6 sync will upload them.
 *
 * Lockout logic:
 *   A worker cannot mark attendance again within LOCKOUT_MINUTES.
 *   This is queried from SQLite rather than held in memory so it survives
 *   app restarts, hot-reloads, and background-then-foreground cycles.
 *
 * Architecture (mobile-developer skill — feature-based modules):
 *   AttendanceService owns business logic only.
 *   Raw CRUD calls are delegated to attendanceRepository.ts (Phase 1).
 *   Validation rules live in AttendanceValidator.ts (this phase).
 */

import {
  createAttendance,
  getAttendanceByWorker,
  getAttendanceByDateRange,
} from '../database/attendanceRepository';
import type { Attendance } from '../database/models';
import { validateMarkAttendance } from './AttendanceValidator';
import { SyncStatus } from '../sync/SyncTypes';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Twin-passback lockout period in minutes.
 * A worker cannot mark attendance again within this window.
 * Raise it to match your site's shift change frequency.
 */
export const LOCKOUT_MINUTES = 5;

/** Derived lockout period in milliseconds (used for timestamp comparisons) */
export const LOCKOUT_MS = LOCKOUT_MINUTES * 60 * 1000;

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/** Possible rejection reasons returned by markAttendance() */
export type AttendanceRejectionReason =
  | 'RECENT_ATTENDANCE'  // Worker attended within LOCKOUT_MINUTES
  | 'WORKER_NOT_FOUND'   // workerId does not exist (guard for callers)
  | 'DB_ERROR';          // Unexpected database failure

/** Result of a markAttendance() call — discriminated union */
export type MarkAttendanceResult =
  | {
      success: true;
      /** The freshly written Attendance record */
      record: Attendance;
    }
  | {
      success: false;
      reason: AttendanceRejectionReason;
      /** Human-readable description for logging / debug overlays */
      message: string;
      /**
       * The most recent attendance record that triggered the lockout.
       * Present only when reason === 'RECENT_ATTENDANCE'.
       */
      lastRecord?: Attendance;
    };

// ---------------------------------------------------------------------------
// markAttendance
// ---------------------------------------------------------------------------

/**
 * Marks attendance for a successfully recognised worker.
 *
 * Flow:
 *   1. Run AttendanceValidator.validateMarkAttendance() to check lockout.
 *   2. If validation fails  → return { success: false, reason }
 *   3. If validation passes → createAttendance() in SQLite
 *   4. Return { success: true, record }
 *
 * This function is the ONLY way attendance should be written in Phase 5.
 * Callers must NOT call createAttendance() directly.
 *
 * @param workerId   - UUID of the matched worker (from RecognitionResult)
 * @param workerName - Display name (passed through for UI convenience)
 * @param timestamp  - Event time in ms (defaults to Date.now())
 * @returns          MarkAttendanceResult discriminated union
 */
export async function markAttendance(
  workerId: string,
  workerName: string,
  timestamp: number = Date.now(),
): Promise<MarkAttendanceResult> {
  console.log(
    `[AttendanceService] markAttendance called for worker: ${workerName} (${workerId})`,
  );

  try {
    // ── Step 1: Lockout validation ────────────────────────────────────────
    const validation = await validateMarkAttendance(workerId, timestamp);

    if (!validation.allowed) {
      console.warn(
        `[AttendanceService] Attendance rejected for ${workerName}: ${validation.reason}`,
      );
      return {
        success: false,
        reason: validation.reason as AttendanceRejectionReason,
        message: validation.message,
        lastRecord: validation.lastRecord,
      };
    }

    // ── Step 2: Write to SQLite ───────────────────────────────────────────
    const record = await createAttendance({
      worker_id: workerId,
      timestamp,
      sync_status: SyncStatus.PENDING, // Unsynced — Phase 7 (AWS sync) will upload
    });

    console.log(
      `[AttendanceService] Attendance recorded: ${record.attendance_id} for ${workerName}`,
    );

    return { success: true, record };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[AttendanceService] markAttendance failed:', message);
    return {
      success: false,
      reason: 'DB_ERROR',
      message: `Database error: ${message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// hasRecentAttendance
// ---------------------------------------------------------------------------

/**
 * Checks whether a worker has marked attendance within the lockout period.
 *
 * Used by AttendanceValidator internally, but also exported so the UI can
 * display a warning badge ("Already marked today") on the camera screen
 * before recognition even starts.
 *
 * @param workerId  - Worker UUID to check
 * @param asOf      - Reference time (defaults to Date.now())
 * @returns         Object with `hasRecent` flag and optional `lastRecord`
 */
export async function hasRecentAttendance(
  workerId: string,
  asOf: number = Date.now(),
): Promise<{ hasRecent: boolean; lastRecord: Attendance | null }> {
  try {
    // Fetch the single most-recent attendance for this worker
    const records = await getAttendanceByWorker(workerId, /* limit */ 1);

    if (records.length === 0) {
      return { hasRecent: false, lastRecord: null };
    }

    const last = records[0];
    const elapsedMs = asOf - last.timestamp;
    const hasRecent = elapsedMs < LOCKOUT_MS;

    return { hasRecent, lastRecord: last };
  } catch (error) {
    console.error('[AttendanceService] hasRecentAttendance failed:', error);
    // Fail-open: allow attendance if we can't check — better than blocking
    return { hasRecent: false, lastRecord: null };
  }
}

// ---------------------------------------------------------------------------
// getTodayAttendance
// ---------------------------------------------------------------------------

/**
 * Returns all attendance records with timestamps falling within today's
 * calendar day in the device's local timezone.
 *
 * "Today" is defined as midnight-to-midnight in device local time, which
 * is appropriate for a site-based attendance system.
 *
 * @returns Array of today's Attendance records, newest-first
 */
export async function getTodayAttendance(): Promise<Attendance[]> {
  const now = new Date();

  // Midnight at the START of today in local time
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0,
  ).getTime();

  // Midnight at the END of today (= start of tomorrow)
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

  try {
    return await getAttendanceByDateRange(startOfDay, endOfDay);
  } catch (error) {
    console.error('[AttendanceService] getTodayAttendance failed:', error);
    return [];
  }
}
