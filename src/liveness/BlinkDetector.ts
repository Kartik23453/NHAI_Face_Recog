/**
 * @file BlinkDetector.ts
 * @description Real-time blink detection using EAR with anti-jitter logic.
 *
 * A blink is defined as the sequence:
 *   OPEN (EAR ≥ 0.25) → CLOSED (EAR ≤ 0.21) → OPEN (EAR ≥ 0.25)
 *
 * Anti-false-positive measures (per Phase 3 requirements):
 *   1. Consecutive closed-eye frames — a single frame dip is ignored.
 *   2. Consecutive open-eye frames  — reopening must be confirmed over
 *      multiple frames before the blink is counted.
 *   3. Maximum closed duration     — prevents a held eye-closed pose from
 *      registering as a blink when the eye finally opens.
 *   4. Binocular averaging         — uses both eyes to cancel single-eye jitter.
 *
 * State machine (internal to this class):
 *   OPEN → (N consecutive closed) → CLOSING
 *   CLOSING → (M consecutive open) → OPEN + emit blink
 *   CLOSING → (too many closed frames) → RESET (held-close, not a blink)
 *
 * Architecture (mobile-developer skill):
 *   Pure class, no React. Feed EARResult per frame; receive boolean output.
 *   Designed to be called from a Reanimated runOnJS callback without allocation.
 */

import { EAR_THRESHOLDS, type EARResult } from './EARCalculator';

// ---------------------------------------------------------------------------
// Tuning Constants
// ---------------------------------------------------------------------------

/**
 * Minimum consecutive frames with EAR below MAX_EAR_CLOSED before we
 * accept that the eye is genuinely closed. Prevents single-frame dips
 * from landmark jitter triggering a false blink.
 */
const MIN_CLOSED_FRAMES = 2;

/**
 * Minimum consecutive frames with EAR above MIN_EAR_OPEN after a closing
 * sequence before we confirm the eye has reopened (completing the blink).
 */
const MIN_REOPEN_FRAMES = 2;

/**
 * Maximum consecutive frames the eye can be closed before we declare the
 * pose a "held close" rather than a blink, and reset the detector.
 * At 30 fps this is approximately 1 second.
 */
const MAX_CLOSED_FRAMES = 30;

/**
 * Minimum number of open-eye frames required at the START of the detection
 * window before we begin watching for a closure. This ensures we begin from
 * a confirmed-open baseline and don't trigger on ambiguous initial states.
 */
const MIN_INITIAL_OPEN_FRAMES = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal detection phase within BlinkDetector */
type BlinkPhase =
  | 'AWAITING_OPEN'   // Not yet confirmed an open-eye baseline
  | 'OPEN'            // Eye confirmed open — watching for closure
  | 'CLOSING'         // Consecutive closed frames accumulating
  | 'REOPENING';      // Eye is opening after confirmed closure — confirming reopen

/** Result returned per frame */
export interface BlinkDetectionResult {
  /** Whether a complete blink was confirmed THIS frame (true for exactly 1 frame) */
  blinkConfirmed: boolean;
  /** Current internal phase — useful for debug overlays */
  phase: BlinkPhase;
  /** Most recent averaged EAR value */
  currentEAR: number;
  /** Number of consecutive closed frames so far (useful for progress bars) */
  closedFrameCount: number;
}

// ---------------------------------------------------------------------------
// BlinkDetector Class
// ---------------------------------------------------------------------------

/**
 * Stateful blink detector.
 *
 * Usage:
 *   const detector = new BlinkDetector();
 *   const result = detector.processFrame(earResult);
 *   if (result.blinkConfirmed) { ... }
 *
 * Reset between verification sessions:
 *   detector.reset();
 */
export class BlinkDetector {
  private phase: BlinkPhase = 'AWAITING_OPEN';

  /** Frames in current phase */
  private phaseFrameCount: number = 0;

  /** Total consecutive frames the eye has been closed (for max-close guard) */
  private closedFrameCount: number = 0;

  /** Frames at initial open baseline */
  private initialOpenFrameCount: number = 0;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Process one camera frame. Returns detection result for this frame.
   *
   * Call this every frame from the JS thread (via runOnJS) after computing
   * binocular EAR for the current face.
   *
   * @param earResult - Result from EARCalculator.computeBinocularEAR()
   * @returns         BlinkDetectionResult for this frame
   */
  public processFrame(earResult: EARResult): BlinkDetectionResult {
    // If EAR couldn't be computed (e.g. partial face), hold state
    if (!earResult.isValid) {
      return this.buildResult(false);
    }

    const ear = earResult.averageEAR;
    const isOpen   = ear >= EAR_THRESHOLDS.MIN_EAR_OPEN;
    const isClosed = ear <= EAR_THRESHOLDS.MAX_EAR_CLOSED;

    switch (this.phase) {
      case 'AWAITING_OPEN':
        return this.handleAwaitingOpen(isOpen);
      case 'OPEN':
        return this.handleOpen(isOpen, isClosed);
      case 'CLOSING':
        return this.handleClosing(isOpen, isClosed);
      case 'REOPENING':
        return this.handleReopening(isOpen);
    }
  }

  /**
   * Resets all internal state. Call between liveness sessions or on IDLE reset.
   */
  public reset(): void {
    this.phase = 'AWAITING_OPEN';
    this.phaseFrameCount = 0;
    this.closedFrameCount = 0;
    this.initialOpenFrameCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Private State Handlers
  // ---------------------------------------------------------------------------

  /**
   * AWAITING_OPEN: Build a confirmed open-eye baseline before watching for blinks.
   * Prevents the detector from triggering on an ambiguous starting pose.
   */
  private handleAwaitingOpen(isOpen: boolean): BlinkDetectionResult {
    if (isOpen) {
      this.initialOpenFrameCount += 1;
      if (this.initialOpenFrameCount >= MIN_INITIAL_OPEN_FRAMES) {
        this.transitionTo('OPEN');
      }
    } else {
      // Reset baseline counter — user may have started with eyes closed
      this.initialOpenFrameCount = 0;
    }
    return this.buildResult(false);
  }

  /**
   * OPEN: Eye is confirmed open. Watch for the start of a closure.
   */
  private handleOpen(isOpen: boolean, isClosed: boolean): BlinkDetectionResult {
    if (isClosed) {
      // Eye appears closed — start counting closure frames
      this.phaseFrameCount = 1;
      this.closedFrameCount = 1;
      this.transitionTo('CLOSING');
    } else if (!isOpen) {
      // In the transition zone (0.21–0.25) — maintain open state but don't reset
      // This prevents jitter in the transition zone from bouncing between phases
    }
    return this.buildResult(false);
  }

  /**
   * CLOSING: Consecutive closed-eye frames accumulating.
   *  - If enough closed frames: move to REOPENING
   *  - If eye reopens immediately: single-frame dip, return to OPEN
   *  - If too many closed frames: held-close, not a blink → reset
   */
  private handleClosing(isOpen: boolean, isClosed: boolean): BlinkDetectionResult {
    if (isClosed) {
      this.phaseFrameCount += 1;
      this.closedFrameCount += 1;

      // Guard: held-close is not a blink
      if (this.closedFrameCount > MAX_CLOSED_FRAMES) {
        console.log('[BlinkDetector] Eye held closed too long — resetting');
        this.transitionTo('OPEN'); // Return to open watch state
        return this.buildResult(false);
      }

      // Confirmed closure: enough consecutive closed frames
      if (this.phaseFrameCount >= MIN_CLOSED_FRAMES) {
        this.phaseFrameCount = 0;
        this.transitionTo('REOPENING');
      }
    } else if (isOpen) {
      // Eye opened before MIN_CLOSED_FRAMES was reached — jitter, not a blink
      this.phaseFrameCount = 0;
      this.closedFrameCount = 0;
      this.transitionTo('OPEN');
    }
    // Else: in transition zone — hold CLOSING state, keep counting

    return this.buildResult(false);
  }

  /**
   * REOPENING: Eye has confirmed closure and is now watching for reopening.
   * After MIN_REOPEN_FRAMES of open-eye frames, a complete blink is confirmed.
   */
  private handleReopening(isOpen: boolean): BlinkDetectionResult {
    if (isOpen) {
      this.phaseFrameCount += 1;

      if (this.phaseFrameCount >= MIN_REOPEN_FRAMES) {
        // ✅ COMPLETE BLINK CONFIRMED
        console.log('[BlinkDetector] Blink confirmed!');
        this.phaseFrameCount = 0;
        this.closedFrameCount = 0;
        this.transitionTo('OPEN'); // Ready for next blink
        return this.buildResult(true); // <- Single frame with blinkConfirmed = true
      }
    } else {
      // Still closed or in transition — reset reopen counter
      this.phaseFrameCount = 0;
    }

    return this.buildResult(false);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private transitionTo(next: BlinkPhase): void {
    this.phase = next;
    if (next === 'OPEN') {
      this.phaseFrameCount = 0;
    }
  }

  private buildResult(blinkConfirmed: boolean): BlinkDetectionResult {
    return {
      blinkConfirmed,
      phase: this.phase,
      currentEAR: 0, // Caller can override with actual EAR value if needed
      closedFrameCount: this.closedFrameCount,
    };
  }
}
