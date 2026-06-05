/**
 * @file EARCalculator.ts
 * @description Eye Aspect Ratio (EAR) calculation engine for liveness detection.
 *
 * Background:
 *   The Eye Aspect Ratio was introduced by Soukupová & Čech (2016) as a simple
 *   and efficient metric for real-time blink detection.
 *
 *   EAR = (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||)
 *
 *   Where p1..p6 are the six eye landmark points in order:
 *     p1 = outer corner (left)
 *     p2 = upper-outer lid
 *     p3 = upper-inner lid
 *     p4 = inner corner (right)
 *     p5 = lower-inner lid
 *     p6 = lower-outer lid
 *
 *   When the eye is OPEN  → EAR ≈ 0.30–0.40
 *   When the eye is CLOSED → EAR ≈ 0.00–0.15
 *   Threshold region       → 0.15–0.25 (transition zone)
 *
 * MLKit Landmark mapping (react-native-vision-camera-face-detector):
 *   The plugin exposes per-eye contour points. This module maps them to the
 *   canonical 6-point EAR representation by selecting the correct indices from
 *   the contour arrays returned by the SDK.
 *
 * Design principle (mobile-developer skill):
 *   Pure, side-effect-free functions only — usable directly in Reanimated
 *   worklets if needed, and trivially unit-testable.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 2D point in frame pixel space */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * Six landmark points representing a single eye in EAR order:
 *   [outerCorner, upperOuter, upperInner, innerCorner, lowerInner, lowerOuter]
 *
 * For the LEFT eye  (face's left):  p1=leftmost, p4=rightmost
 * For the RIGHT eye (face's right): p1=rightmost, p4=leftmost
 * (The formula is symmetric — direction doesn't affect the ratio value.)
 */
export interface EyeLandmarks {
  p1: Point2D; // outer corner
  p2: Point2D; // upper-outer lid
  p3: Point2D; // upper-inner lid
  p4: Point2D; // inner corner
  p5: Point2D; // lower-inner lid
  p6: Point2D; // lower-outer lid
}

/** EAR results for both eyes and their average */
export interface EARResult {
  leftEAR: number;
  rightEAR: number;
  /** Average of left and right — primary signal for blink detection */
  averageEAR: number;
  /** Whether the landmark set was complete enough to compute EAR */
  isValid: boolean;
}

// ---------------------------------------------------------------------------
// Euclidean Distance
// ---------------------------------------------------------------------------

/**
 * Computes the Euclidean distance between two 2D points.
 * Inlined for performance — this runs on every camera frame.
 *
 * @param a - First point
 * @param b - Second point
 * @returns  Distance in pixels
 */
export function euclideanDistance(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// EAR Formula
// ---------------------------------------------------------------------------

/**
 * Computes the Eye Aspect Ratio for a single eye given its six landmark points.
 *
 * Formula:
 *   EAR = (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||)
 *
 * The denominator uses p1-p4 (horizontal eye width) to normalise for face
 * distance, making the metric scale-invariant.
 *
 * @param eye - Six landmark points in EAR canonical order
 * @returns   EAR value in [0, 1] range (clamped for safety)
 */
export function computeEAR(eye: EyeLandmarks): number {
  const vertical1 = euclideanDistance(eye.p2, eye.p6);
  const vertical2 = euclideanDistance(eye.p3, eye.p5);
  const horizontal = euclideanDistance(eye.p1, eye.p4);

  // Guard against degenerate faces (eye width near zero)
  if (horizontal < 1e-6) {
    return 0;
  }

  const ear = (vertical1 + vertical2) / (2.0 * horizontal);

  // Clamp to [0, 1] — EAR cannot exceed 1 geometrically but guard for noise
  return Math.min(Math.max(ear, 0), 1);
}

// ---------------------------------------------------------------------------
// MLKit Contour → EAR Landmark Mapping
// ---------------------------------------------------------------------------

/**
 * MLKit eye contour point count and the indices we extract for EAR.
 *
 * MLKit provides 16 points per eye going clockwise from the outer corner:
 *   Index 0  = outer corner         → p1
 *   Index 3  = upper-outer lid      → p2
 *   Index 7  = upper-inner lid      → p3 (approx centre-top)
 *   Index 8  = inner corner         → p4
 *   Index 11 = lower-inner lid      → p5
 *   Index 13 = lower-outer lid      → p6
 *
 * These indices are chosen to span the eye geometry as evenly as possible
 * from the 16-point contour shape.
 */
const MLKIT_EYE_CONTOUR_INDICES = {
  p1: 0,  // outer corner
  p2: 3,  // upper-outer
  p3: 7,  // upper-inner
  p4: 8,  // inner corner
  p5: 11, // lower-inner
  p6: 13, // lower-outer
} as const;

/** Minimum required contour points to attempt EAR calculation */
const MIN_CONTOUR_POINTS = 14;

/**
 * Converts an MLKit eye contour point array into the canonical EyeLandmarks
 * structure needed by computeEAR().
 *
 * @param contourPoints - Array of {x, y} points from MLKit face contour
 * @returns              EyeLandmarks if enough points exist, or null
 */
export function contourToEyeLandmarks(
  contourPoints: Point2D[],
): EyeLandmarks | null {
  if (contourPoints.length < MIN_CONTOUR_POINTS) {
    return null;
  }

  const idx = MLKIT_EYE_CONTOUR_INDICES;
  return {
    p1: contourPoints[idx.p1],
    p2: contourPoints[idx.p2],
    p3: contourPoints[idx.p3],
    p4: contourPoints[idx.p4],
    p5: contourPoints[idx.p5],
    p6: contourPoints[idx.p6],
  };
}

// ---------------------------------------------------------------------------
// Dual-Eye EAR
// ---------------------------------------------------------------------------

/**
 * Computes EAR for both eyes and returns an averaged result.
 *
 * Using the average of both eyes is more robust than a single eye because:
 *   1. It cancels out single-eye noise / landmark jitter.
 *   2. A genuine blink closes BOTH eyes simultaneously.
 *   3. Partial occlusion of one eye is less likely to cause a false positive.
 *
 * @param leftContour  - MLKit left eye contour points
 * @param rightContour - MLKit right eye contour points
 * @returns            EARResult with per-eye values and averaged signal
 */
export function computeBinocularEAR(
  leftContour: Point2D[],
  rightContour: Point2D[],
): EARResult {
  const leftLandmarks = contourToEyeLandmarks(leftContour);
  const rightLandmarks = contourToEyeLandmarks(rightContour);

  if (!leftLandmarks || !rightLandmarks) {
    return { leftEAR: 0, rightEAR: 0, averageEAR: 0, isValid: false };
  }

  const leftEAR = computeEAR(leftLandmarks);
  const rightEAR = computeEAR(rightLandmarks);
  const averageEAR = (leftEAR + rightEAR) / 2;

  return { leftEAR, rightEAR, averageEAR, isValid: true };
}

// ---------------------------------------------------------------------------
// EAR Thresholds
// ---------------------------------------------------------------------------

/**
 * EAR threshold values used by BlinkDetector.
 * Exported so they can be displayed in debug UIs or overridden in tests.
 *
 * These defaults are calibrated for MLKit 16-point eye contours at 720p.
 * Adjust MIN_EAR_OPEN upward for stricter open-eye requirements (less
 * susceptible to partial closure false positives).
 */
export const EAR_THRESHOLDS = {
  /** EAR above this → eye is considered OPEN */
  MIN_EAR_OPEN: 0.25,

  /** EAR below this → eye is considered CLOSED */
  MAX_EAR_CLOSED: 0.21,
} as const;
