/**
 * @file AttendanceStateMachine.ts
 * @description Finite state machine governing the post-recognition attendance flow.
 *
 * State diagram:
 *
 *   IDLE ───────────────────────────────────────── Starting state
 *     │  (RecognitionResult.matched = true)
 *     ▼
 *   MATCH_FOUND ─────────────────────────────────── Worker identity confirmed
 *     │  (markAttendance() called)
 *     ▼
 *   MARKING_ATTENDANCE ──────────────────────────── DB write in progress
 *     │
 *     ├── (success)  ────────────────────────────► ATTENDANCE_SUCCESS
 *     │                                              onAttendanceMarked() fires
 *     │
 *     └── (rejected / error)  ──────────────────► ATTENDANCE_REJECTED
 *                                                    onAttendanceRejected() fires
 *
 * Any state → reset() → IDLE
 *
 * Design (mobile-developer skill — feature module):
 *   Pure class, zero React imports.
 *   All state transitions are explicit named methods — no ad-hoc mutation.
 *   Callbacks decouple the FSM from the UI component.
 */

import type { Attendance } from '../database/models';
import * as VoiceGuidanceService from '../voice/VoiceGuidanceService';
import type {
  MarkAttendanceResult,
  AttendanceRejectionReason,
} from './AttendanceService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All possible states in the attendance lifecycle FSM */
export type AttendanceFlowState =
  | 'IDLE'                  // No active recognition event
  | 'MATCH_FOUND'           // Worker recognised — about to mark attendance
  | 'MARKING_ATTENDANCE'    // DB write in progress
  | 'ATTENDANCE_SUCCESS'    // Record written — show success screen
  | 'ATTENDANCE_REJECTED';  // Validation failed — show rejection screen

/** Snapshot of the FSM at any point in time — rendered by the UI */
export interface AttendanceFlowData {
  state: AttendanceFlowState;

  /** Populated from MATCH_FOUND onwards */
  workerId: string | null;
  workerName: string | null;
  confidence: number | null;

  /** Populated in ATTENDANCE_SUCCESS */
  attendanceRecord: Attendance | null;

  /** Populated in ATTENDANCE_REJECTED */
  rejectionReason: AttendanceRejectionReason | null;
  rejectionMessage: string | null;
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export interface AttendanceStateMachineCallbacks {
  /** Fires every time state or data changes — drives React setState */
  onStateChange: (data: AttendanceFlowData) => void;
  /** Fires once when ATTENDANCE_SUCCESS is reached */
  onAttendanceMarked: (record: Attendance, workerName: string) => void;
  /** Fires once when ATTENDANCE_REJECTED is reached */
  onAttendanceRejected: (
    reason: AttendanceRejectionReason,
    message: string,
  ) => void;
}

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

/**
 * AttendanceStateMachine — drives the attendance workflow after recognition.
 *
 * Usage:
 *   const fsm = new AttendanceStateMachine(callbacks);
 *   fsm.onMatchFound(workerId, workerName, confidence);
 *   // → internally calls markAttendance() and transitions to SUCCESS/REJECTED
 */
export class AttendanceStateMachine {
  private _state: AttendanceFlowState = 'IDLE';
  private _data: AttendanceFlowData = this.emptyData();
  private readonly callbacks: AttendanceStateMachineCallbacks;

  constructor(callbacks: AttendanceStateMachineCallbacks) {
    this.callbacks = callbacks;
  }

  // ── Read-only accessors ────────────────────────────────────────────────────

  get state(): AttendanceFlowState {
    return this._state;
  }

  get data(): AttendanceFlowData {
    return this._data;
  }

  // ── Public transitions ─────────────────────────────────────────────────────

  /**
   * Called when Phase 4's findBestMatch() returns a successful match.
   * Transitions IDLE → MATCH_FOUND → MARKING_ATTENDANCE and triggers the DB write.
   *
   * @param workerId   - Matched worker UUID
   * @param workerName - Display name (from WorkerMatcher cache)
   * @param confidence - Cosine similarity score [0, 1]
   * @param markFn     - The markAttendance() async function (injected for testability)
   */
  public async onMatchFound(
    workerId: string,
    workerName: string,
    confidence: number,
    markFn: (workerId: string, workerName: string) => Promise<MarkAttendanceResult>,
  ): Promise<void> {
    if (this._state !== 'IDLE') {
      // Already processing — ignore duplicate triggers (e.g. from frame jitter)
      console.warn(
        `[AttendanceFSM] onMatchFound ignored in state: ${this._state}`,
      );
      return;
    }

    // IDLE → MATCH_FOUND
    this.transition('MATCH_FOUND', {
      workerId,
      workerName,
      confidence,
      attendanceRecord: null,
      rejectionReason: null,
      rejectionMessage: null,
    });

    // MATCH_FOUND → MARKING_ATTENDANCE
    this.transition('MARKING_ATTENDANCE', null);

    // Async DB write
    try {
      const result = await markFn(workerId, workerName);
      this.handleMarkResult(result, workerName);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';
      console.error('[AttendanceFSM] markAttendance threw:', message);
      this.transition('ATTENDANCE_REJECTED', {
        rejectionReason: 'DB_ERROR',
        rejectionMessage: message,
      });
      this.callbacks.onAttendanceRejected('DB_ERROR', message);
    }
  }

  /**
   * Resets the machine to IDLE. Call before starting a new recognition session.
   */
  public reset(): void {
    this._data = this.emptyData();
    this._state = 'IDLE';
    this.callbacks.onStateChange(this._data);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Applies a MarkAttendanceResult and transitions to SUCCESS or REJECTED.
   */
  private handleMarkResult(
    result: MarkAttendanceResult,
    workerName: string,
  ): void {
    if (result.success) {
      // Fire-and-forget the audio prompt (does not block attendance flow)
      VoiceGuidanceService.speak(`${workerName} ki haazri lag gayi`).catch(() => {});

      this.transition('ATTENDANCE_SUCCESS', {
        attendanceRecord: result.record,
        rejectionReason: null,
        rejectionMessage: null,
      });
      this.callbacks.onAttendanceMarked(result.record, workerName);
    } else {
      this.transition('ATTENDANCE_REJECTED', {
        rejectionReason: result.reason,
        rejectionMessage: result.message,
      });
      this.callbacks.onAttendanceRejected(result.reason, result.message);
    }
  }

  /**
   * Sets the new state and merges partial data, then fires onStateChange.
   */
  private transition(
    next: AttendanceFlowState,
    partialData: Partial<Omit<AttendanceFlowData, 'state'>> | null,
  ): void {
    this._state = next;
    if (partialData !== null) {
      this._data = { ...this._data, ...partialData, state: next };
    } else {
      this._data = { ...this._data, state: next };
    }
    this.callbacks.onStateChange(this._data);
  }

  /** Returns the blank initial data structure */
  private emptyData(): AttendanceFlowData {
    return {
      state: 'IDLE',
      workerId: null,
      workerName: null,
      confidence: null,
      attendanceRecord: null,
      rejectionReason: null,
      rejectionMessage: null,
    };
  }
}
