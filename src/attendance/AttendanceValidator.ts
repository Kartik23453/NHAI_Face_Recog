/**
 * @file AttendanceValidator.ts
 * @description Business-rule validation for attendance marking in NetraSetu.
 *
 * This module separates validation logic from the service layer so each can
 * be tested independently and the rules can evolve without touching the service.
 *
 * Current rules (extendable without modifying AttendanceService):
 *   1. LOCKOUT — a worker cannot mark attendance again within LOCKOUT_MINUTES.
 *
 * Design (frontend-expert skill — no `any` types):
 *   All function signatures are fully typed.
 *   ValidationResult is a discriminated union so callers get precise typing
 *   on the `allowed: false` branch (lastRecord is guaranteed present for
 *   RECENT_ATTENDANCE, absent for other reasons).
 *
 * Architecture (mobile-developer skill — feature-based module):
 *   Validator has NO dependency on AttendanceService to avoid circular imports.
 *   It imports directly from the Phase 1 database layer.
 */

import { getAttendanceByWorker } from '../database/attendanceRepository';
import type { Attendance } from '../database/models';
import { LOCKOUT_MS, LOCKOUT_MINUTES } from './AttendanceService';

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/** Rejection codes for failed validation */
export type ValidationRejectionReason =
  | 'RECENT_ATTENDANCE'  // Inside lockout window
  | 'INVALID_WORKER_ID'  // workerId is empty / malformed
  | 'FUTURE_TIMESTAMP';  // timestamp is more than 60s in the future

/** Discriminated union returned by validateMarkAttendance() */
export type ValidationResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: ValidationRejectionReason;
      message: string;
      /** Present when reason is RECENT_ATTENDANCE; helps UI show last-seen time */
      lastRecord?: Attendance;
    };

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validates whether a worker is allowed to mark attendance at the given time.
 *
 * Checks (in order):
 *   1. workerId format (non-empty string).
 *   2. timestamp is not unreasonably far in the future.
 *   3. Twin-passback lockout — query the most recent record for this worker.
 *
 * @param workerId  - UUID of the recognised worker
 * @param timestamp - Event time in ms (usually Date.now())
 * @returns         ValidationResult — check `allowed` before accessing other fields
 */
export async function validateMarkAttendance(
  workerId: string,
  timestamp: number,
): Promise<ValidationResult> {

  // ── Rule 1: workerId sanity check ──────────────────────────────────────────
  if (!workerId || typeof workerId !== 'string' || workerId.trim().length === 0) {
    return {
      allowed: false,
      reason: 'INVALID_WORKER_ID',
      message: 'Invalid worker ID — cannot record attendance.',
    };
  }

  // ── Rule 2: Clock sanity — reject timestamps > 60s in the future ──────────
  // Prevents edge cases where the device clock is badly misconfigured.
  const MAX_FUTURE_SKEW_MS = 60_000;
  if (timestamp - Date.now() > MAX_FUTURE_SKEW_MS) {
    return {
      allowed: false,
      reason: 'FUTURE_TIMESTAMP',
      message: 'Event timestamp is too far in the future. Check device clock.',
    };
  }

  // ── Rule 3: Twin-passback lockout ─────────────────────────────────────────
  // Fetch only the latest record to minimise DB read cost.
  try {
    const recentRecords = await getAttendanceByWorker(workerId, /* limit */ 1);

    if (recentRecords.length > 0) {
      const lastRecord = recentRecords[0];
      const elapsedMs = timestamp - lastRecord.timestamp;

      if (elapsedMs < LOCKOUT_MS) {
        const remainingMs = LOCKOUT_MS - elapsedMs;
        const remainingMin = Math.ceil(remainingMs / 60_000);

        return {
          allowed: false,
          reason: 'RECENT_ATTENDANCE',
          message:
            `Attendance already marked ${Math.floor(elapsedMs / 60_000)} min ago. ` +
            `Retry in ${remainingMin} min (lockout: ${LOCKOUT_MINUTES} min).`,
          lastRecord,
        };
      }
    }
  } catch (error) {
    // If we can't check the DB, fail-open (allow) and log the issue.
    // Failing closed would block attendance on any transient DB error.
    console.warn(
      '[AttendanceValidator] Could not check recent attendance, proceeding:',
      error,
    );
  }

  // All rules passed
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Pure helpers — usable in tests without async
// ---------------------------------------------------------------------------

/**
 * Returns true if the time elapsed since `lastTimestampMs` is within the
 * lockout window. Pure function — useful for unit tests.
 *
 * @param lastTimestampMs - Timestamp of the most recent attendance (ms)
 * @param nowMs           - Reference "current" time (defaults to Date.now())
 * @returns               true if still within lockout
 */
export function isWithinLockout(
  lastTimestampMs: number,
  nowMs: number = Date.now(),
): boolean {
  return nowMs - lastTimestampMs < LOCKOUT_MS;
}

/**
 * Formats a timestamp as a human-readable time string in the device locale.
 * Used by UI components to display "Last seen at HH:MM".
 *
 * @param timestampMs - Unix timestamp in milliseconds
 * @returns           Locale time string e.g. "14:35" or "2:35 PM"
 */
export function formatAttendanceTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats a timestamp as a short date string.
 * Used on the success screen for display purposes.
 *
 * @param timestampMs - Unix timestamp in milliseconds
 * @returns           e.g. "Thursday, 5 June 2026"
 */
export function formatAttendanceDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
