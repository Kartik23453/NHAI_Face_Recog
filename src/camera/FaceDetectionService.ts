/**
 * @file FaceDetectionService.ts
 * @description Pure business-logic service for real-time face quality validation.
 *
 * This module is intentionally framework-agnostic (no React imports) so it can
 * be unit-tested in isolation. It works directly with Vision Camera's Face
 * object and the device screen dimensions to answer one question:
 *   "Is this face good enough to trigger an attendance capture?"
 *
 * Quality criteria (per Phase 2 requirements):
 *   1. Face is centred within an acceptable tolerance zone.
 *   2. Face occupies at least MIN_FACE_AREA_RATIO of the frame area.
 *   3. The bounding box does not extend outside the frame boundaries.
 *
 * Design note (mobile-developer skill):
 *   All computation happens synchronously on the JS thread frame callback.
 *   Keep functions pure and allocation-free to avoid frame drops.
 */

// ---------------------------------------------------------------------------
// Types — mirroring Vision Camera's Face shape (no package import needed here)
// ---------------------------------------------------------------------------

/**
 * Bounding box of a detected face, expressed in the camera frame's pixel
 * coordinate space (origin = top-left of the camera preview).
 *
 * These values are provided by react-native-vision-camera's face detection
 * frame processor plugin.
 */
export interface FaceBounds {
  x: number;      // Left edge of the bounding box
  y: number;      // Top edge of the bounding box
  width: number;  // Width of the bounding box
  height: number; // Height of the bounding box
}

/**
 * Dimensions of the camera preview frame.
 * Passed in from the camera layout event so the service stays stateless.
 */
export interface FrameDimensions {
  width: number;
  height: number;
}

/** All possible outcomes of face quality analysis */
export type FaceQualityStatus =
  | 'NO_FACE'        // No face detected in the frame
  | 'TOO_FAR'        // Face area too small — user needs to move closer
  | 'OFF_CENTER'     // Face is not centred in the frame
  | 'OUT_OF_BOUNDS'  // Part of the face is outside the preview area
  | 'VALID';         // All quality checks passed — ready for capture

/** Result returned by analyseFaceQuality */
export interface FaceQualityResult {
  status: FaceQualityStatus;
  /** Human-readable instruction to display in the UI */
  message: string;
  /** Whether the auto-capture callback should fire */
  isValid: boolean;
  /** Normalised (0-1) bounding box for overlay rendering */
  normalisedBounds?: NormalisedBounds;
}

/**
 * Bounding box normalised to the range [0, 1] relative to frame size.
 * Used by FaceOverlay.tsx to position the box regardless of screen size.
 */
export interface NormalisedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Tuning Constants
// ---------------------------------------------------------------------------

/**
 * Minimum fraction of the frame area the face must occupy.
 * 0.08 = face bounding box must be at least 8% of the total frame area.
 * Increase this value to require the user to be closer to the camera.
 */
const MIN_FACE_AREA_RATIO = 0.08;

/**
 * Maximum distance (as a fraction of frame dimension) the face centre
 * can deviate from the frame centre along each axis.
 * 0.20 = face centre must be within 20% of the frame's centre point.
 */
const MAX_CENTER_OFFSET_RATIO = 0.20;

/**
 * Minimum margin (fraction of frame dimension) from each frame edge
 * that the face bounding box must respect.
 * 0.02 = face box must not be within 2% of any edge.
 */
const EDGE_MARGIN_RATIO = 0.02;

// ---------------------------------------------------------------------------
// Core Analysis Function
// ---------------------------------------------------------------------------

/**
 * Analyses a single detected face against the current frame dimensions
 * and returns a quality result with UI messaging.
 *
 * This function is the single entry point for all quality logic.
 * It is called per-frame inside the Vision Camera frame processor callback.
 *
 * @param bounds - Face bounding box in frame pixel coordinates
 * @param frame  - Dimensions of the camera preview frame
 * @returns      FaceQualityResult with status, message, and validity flag
 */
export function analyseFaceQuality(
  bounds: FaceBounds,
  frame: FrameDimensions,
): FaceQualityResult {
  const frameArea = frame.width * frame.height;
  const faceArea = bounds.width * bounds.height;

  // Normalised bounds for overlay rendering (always computed for valid faces)
  const normalisedBounds: NormalisedBounds = {
    x: bounds.x / frame.width,
    y: bounds.y / frame.height,
    width: bounds.width / frame.width,
    height: bounds.height / frame.height,
  };

  // ── Check 1: Out-of-bounds ──────────────────────────────────────────────
  // Reject faces where the bounding box extends outside the frame
  const margin = {
    x: frame.width * EDGE_MARGIN_RATIO,
    y: frame.height * EDGE_MARGIN_RATIO,
  };

  const isOutOfBounds =
    bounds.x < margin.x ||
    bounds.y < margin.y ||
    bounds.x + bounds.width > frame.width - margin.x ||
    bounds.y + bounds.height > frame.height - margin.y;

  if (isOutOfBounds) {
    return {
      status: 'OUT_OF_BOUNDS',
      message: 'Center Your Face',
      isValid: false,
      normalisedBounds,
    };
  }

  // ── Check 2: Face size / distance ──────────────────────────────────────
  // Ensure the face is large enough relative to the frame
  const areaRatio = faceArea / frameArea;
  if (areaRatio < MIN_FACE_AREA_RATIO) {
    return {
      status: 'TOO_FAR',
      message: 'Move Closer',
      isValid: false,
      normalisedBounds,
    };
  }

  // ── Check 3: Centring ──────────────────────────────────────────────────
  // Compute the absolute offset between face centre and frame centre
  const faceCentreX = bounds.x + bounds.width / 2;
  const faceCentreY = bounds.y + bounds.height / 2;
  const frameCentreX = frame.width / 2;
  const frameCentreY = frame.height / 2;

  const offsetRatioX = Math.abs(faceCentreX - frameCentreX) / frame.width;
  const offsetRatioY = Math.abs(faceCentreY - frameCentreY) / frame.height;

  if (offsetRatioX > MAX_CENTER_OFFSET_RATIO || offsetRatioY > MAX_CENTER_OFFSET_RATIO) {
    return {
      status: 'OFF_CENTER',
      message: 'Center Your Face',
      isValid: false,
      normalisedBounds,
    };
  }

  // ── All checks passed ──────────────────────────────────────────────────
  return {
    status: 'VALID',
    message: 'Face Ready',
    isValid: true,
    normalisedBounds,
  };
}

/**
 * Returns the quality result for a "no face" frame.
 * Kept as a function (not a constant) to maintain a consistent return shape.
 */
export function noFaceResult(): FaceQualityResult {
  return {
    status: 'NO_FACE',
    message: 'No Face Detected',
    isValid: false,
  };
}

// ---------------------------------------------------------------------------
// Auto-Capture Debounce
// ---------------------------------------------------------------------------

/**
 * Minimum number of consecutive valid frames required before the
 * auto-capture callback fires. This prevents flickering triggers
 * from single-frame detections.
 */
export const VALID_FRAMES_REQUIRED = 3;

/**
 * Stateful frame counter used by CameraScreen to debounce the capture trigger.
 * Resets to 0 on any non-valid frame; increments on each valid frame.
 *
 * Usage in CameraScreen:
 *   const counter = useRef(new ValidFrameCounter());
 *   if (counter.current.record(qualityResult.isValid)) {
 *     onValidFaceDetected();
 *   }
 */
export class ValidFrameCounter {
  private count: number = 0;

  /**
   * Records a frame result and returns true when the threshold is reached.
   * Resets automatically after triggering to prevent repeated callbacks.
   *
   * @param isValid - Whether the current frame passed quality checks
   * @returns       true exactly once when VALID_FRAMES_REQUIRED is reached
   */
  public record(isValid: boolean): boolean {
    if (!isValid) {
      this.count = 0;
      return false;
    }

    this.count += 1;

    if (this.count >= VALID_FRAMES_REQUIRED) {
      this.count = 0; // Reset so it can trigger again after a gap
      return true;
    }

    return false;
  }

  /** Manually resets the counter (useful when leaving the screen). */
  public reset(): void {
    this.count = 0;
  }
}
