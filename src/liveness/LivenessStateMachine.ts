/**
 * @file LivenessStateMachine.ts
 * @description Finite state machine (FSM) governing the liveness verification flow.
 *
 * The FSM enforces a strict linear progression through five states and is the
 * single source of truth for what the user should be doing at each moment.
 *
 * State diagram:
 *
 *   IDLE ──────────────── (face detected by Phase 2)
 *     │
 *     ▼
 *   FACE_READY ─────────── (face is centred & large enough)
 *     │   (auto-advance after FACE_READY_HOLD_FRAMES consecutive valid frames)
 *     ▼
 *   WAITING_FOR_BLINK ──── (audio prompt "Palk Jhapkayein" is played)
 *     │   (blink detected by BlinkDetector within BLINK_CHALLENGE_TIMEOUT_MS)
 *     ▼
 *   BLINK_DETECTED ─────── (intermediate state — one frame acknowledgement)
 *     │   (auto-advance after BLINK_CONFIRM_HOLD_MS)
 *     ▼
 *   LIVENESS_VERIFIED ──── (onLivenessVerified callback fires)
 *
 * Timeout / reset paths:
 *   WAITING_FOR_BLINK → (timeout) → IDLE  (face lost or took too long)
 *   Any state         → (face lost N frames) → IDLE
 *
 * Design (mobile-developer skill):
 *   - Pure class, no React imports — testable in isolation.
 *   - All timing is expressed in milliseconds for clarity.
 *   - State transitions are explicit methods, never implicit mutations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All possible liveness verification states.
 * Exported so overlay and audio components can branch on them.
 */
export type LivenessState =
  | 'IDLE'               // No face or awaiting face detection
  | 'FACE_READY'         // Valid face detected — preparing blink challenge
  | 'WAITING_FOR_BLINK'  // Challenge active — user must blink
  | 'BLINK_DETECTED'     // Blink confirmed — brief success acknowledgement
  | 'LIVENESS_VERIFIED'; // Full verification complete

/** Metadata attached to the current state for UI rendering */
export interface LivenessStateData {
  state: LivenessState;
  /** Human-readable instruction shown in the overlay */
  message: string;
  /** Progress towards the current state's threshold (0–1) */
  progress: number;
  /** Milliseconds remaining in the blink challenge (only in WAITING_FOR_BLINK) */
  blinkChallengeRemainingMs: number;
}

// ---------------------------------------------------------------------------
// Tuning Constants
// ---------------------------------------------------------------------------

/**
 * Number of consecutive valid-face frames required before transitioning
 * from FACE_READY → WAITING_FOR_BLINK.
 * Higher = more stable face position required before challenge starts.
 */
export const FACE_READY_HOLD_FRAMES = 10;

/**
 * Maximum milliseconds the user has to complete a blink after the challenge
 * prompt is shown. If no blink is detected within this window, reset to IDLE.
 */
export const BLINK_CHALLENGE_TIMEOUT_MS = 5000;

/**
 * Milliseconds to hold in BLINK_DETECTED state before advancing to
 * LIVENESS_VERIFIED. Gives the UI time to show the "Blink Detected" message.
 */
export const BLINK_CONFIRM_HOLD_MS = 800;

/**
 * Number of consecutive no-face frames before resetting to IDLE.
 * Prevents jitter-resets on momentary tracking loss.
 */
export const FACE_LOST_RESET_FRAMES = 8;

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

/**
 * LivenessStateMachine — manages the blink challenge lifecycle.
 *
 * Consumed by LivenessScreen (or CameraScreen integration) via:
 *   const fsm = useRef(new LivenessStateMachine(callbacks)).current;
 *   fsm.onFaceFrame(isValidFace, blinkDetected);
 */
export class LivenessStateMachine {
  // ── Current state ─────────────────────────────────────────────────────────
  private _state: LivenessState = 'IDLE';

  // ── Frame counters (not time-based to stay worklet-friendly) ──────────────
  private faceReadyFrameCount: number = 0;
  private faceLostFrameCount: number = 0;

  // ── Challenge timing ───────────────────────────────────────────────────────
  private challengeStartTime: number = 0;
  private blinkConfirmStartTime: number = 0;

  // ── Callbacks ──────────────────────────────────────────────────────────────
  private readonly onStateChange: (data: LivenessStateData) => void;
  private readonly onLivenessVerified: () => void;
  private readonly onBlinkChallengeStart: () => void;

  /**
   * @param onStateChange         Called every time state or progress changes
   * @param onLivenessVerified    Called once when LIVENESS_VERIFIED is reached
   * @param onBlinkChallengeStart Called when WAITING_FOR_BLINK begins (play audio)
   */
  constructor(
    onStateChange: (data: LivenessStateData) => void,
    onLivenessVerified: () => void,
    onBlinkChallengeStart: () => void,
  ) {
    this.onStateChange = onStateChange;
    this.onLivenessVerified = onLivenessVerified;
    this.onBlinkChallengeStart = onBlinkChallengeStart;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Read-only current state */
  get state(): LivenessState {
    return this._state;
  }

  /**
   * Primary update method — call once per camera frame from the JS thread.
   *
   * @param isValidFace    Whether Phase 2 quality checks passed this frame
   * @param blinkDetected  Whether BlinkDetector confirmed a full blink this frame
   */
  public onFaceFrame(isValidFace: boolean, blinkDetected: boolean): void {
    switch (this._state) {
      case 'IDLE':
        this.handleIdle(isValidFace);
        break;
      case 'FACE_READY':
        this.handleFaceReady(isValidFace);
        break;
      case 'WAITING_FOR_BLINK':
        this.handleWaitingForBlink(isValidFace, blinkDetected);
        break;
      case 'BLINK_DETECTED':
        this.handleBlinkDetected();
        break;
      case 'LIVENESS_VERIFIED':
        // Terminal state — no further transitions
        break;
    }
  }

  /**
   * Fully resets the machine to IDLE.
   * Call when navigating away or starting a new verification session.
   */
  public reset(): void {
    this.faceReadyFrameCount = 0;
    this.faceLostFrameCount = 0;
    this.challengeStartTime = 0;
    this.blinkConfirmStartTime = 0;
    this.transitionTo('IDLE');
  }

  // ── Private State Handlers ─────────────────────────────────────────────────

  private handleIdle(isValidFace: boolean): void {
    if (isValidFace) {
      this.faceLostFrameCount = 0;
      this.faceReadyFrameCount += 1;

      // Advance to FACE_READY after a few stable frames to avoid jitter entry
      if (this.faceReadyFrameCount >= 3) {
        this.faceReadyFrameCount = 0;
        this.transitionTo('FACE_READY');
      } else {
        this.emitProgress('IDLE', 'Position Your Face', this.faceReadyFrameCount / 3);
      }
    } else {
      this.faceReadyFrameCount = 0;
      this.emitProgress('IDLE', 'No Face Detected', 0);
    }
  }

  private handleFaceReady(isValidFace: boolean): void {
    if (!isValidFace) {
      this.faceLostFrameCount += 1;
      if (this.faceLostFrameCount >= FACE_LOST_RESET_FRAMES) {
        this.resetToIdle();
      } else {
        // Brief hold before resetting — smooths over single-frame detection gaps
        this.emitProgress('FACE_READY', 'Face Ready', this.faceReadyFrameCount / FACE_READY_HOLD_FRAMES);
      }
      return;
    }

    this.faceLostFrameCount = 0;
    this.faceReadyFrameCount += 1;
    const progress = Math.min(this.faceReadyFrameCount / FACE_READY_HOLD_FRAMES, 1);
    this.emitProgress('FACE_READY', 'Face Ready', progress);

    if (this.faceReadyFrameCount >= FACE_READY_HOLD_FRAMES) {
      this.faceReadyFrameCount = 0;
      this.challengeStartTime = Date.now();
      this.transitionTo('WAITING_FOR_BLINK');
      this.onBlinkChallengeStart(); // Trigger audio prompt
    }
  }

  private handleWaitingForBlink(isValidFace: boolean, blinkDetected: boolean): void {
    const elapsed = Date.now() - this.challengeStartTime;
    const remaining = Math.max(0, BLINK_CHALLENGE_TIMEOUT_MS - elapsed);
    const progress = elapsed / BLINK_CHALLENGE_TIMEOUT_MS;

    // ── Timeout ─────────────────────────────────────────────────────────────
    if (elapsed >= BLINK_CHALLENGE_TIMEOUT_MS) {
      console.warn('[LivenessStateMachine] Blink challenge timed out — resetting');
      this.resetToIdle();
      return;
    }

    // ── Face lost ────────────────────────────────────────────────────────────
    if (!isValidFace) {
      this.faceLostFrameCount += 1;
      if (this.faceLostFrameCount >= FACE_LOST_RESET_FRAMES) {
        this.resetToIdle();
        return;
      }
    } else {
      this.faceLostFrameCount = 0;
    }

    // ── Blink confirmed ──────────────────────────────────────────────────────
    if (blinkDetected) {
      this.blinkConfirmStartTime = Date.now();
      this.transitionTo('BLINK_DETECTED');
      return;
    }

    // ── Still waiting ────────────────────────────────────────────────────────
    this.emitData({
      state: 'WAITING_FOR_BLINK',
      message: 'Palk Jhapkayein',
      progress,
      blinkChallengeRemainingMs: remaining,
    });
  }

  private handleBlinkDetected(): void {
    const elapsed = Date.now() - this.blinkConfirmStartTime;
    this.emitData({
      state: 'BLINK_DETECTED',
      message: 'Blink Detected',
      progress: Math.min(elapsed / BLINK_CONFIRM_HOLD_MS, 1),
      blinkChallengeRemainingMs: 0,
    });

    if (elapsed >= BLINK_CONFIRM_HOLD_MS) {
      this.transitionTo('LIVENESS_VERIFIED');
      this.onLivenessVerified();
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private resetToIdle(): void {
    this.faceReadyFrameCount = 0;
    this.faceLostFrameCount = 0;
    this.challengeStartTime = 0;
    this.transitionTo('IDLE');
  }

  private transitionTo(next: LivenessState): void {
    this._state = next;

    // Emit with default progress on transition
    const defaultMessages: Record<LivenessState, string> = {
      IDLE: 'No Face Detected',
      FACE_READY: 'Face Ready',
      WAITING_FOR_BLINK: 'Palk Jhapkayein',
      BLINK_DETECTED: 'Blink Detected',
      LIVENESS_VERIFIED: 'Liveness Verified',
    };

    this.emitData({
      state: next,
      message: defaultMessages[next],
      progress: next === 'LIVENESS_VERIFIED' ? 1 : 0,
      blinkChallengeRemainingMs:
        next === 'WAITING_FOR_BLINK' ? BLINK_CHALLENGE_TIMEOUT_MS : 0,
    });
  }

  private emitProgress(
    state: LivenessState,
    message: string,
    progress: number,
  ): void {
    this.emitData({ state, message, progress, blinkChallengeRemainingMs: 0 });
  }

  private emitData(data: LivenessStateData): void {
    this.onStateChange(data);
  }
}
