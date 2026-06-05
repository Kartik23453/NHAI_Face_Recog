/**
 * @file CameraScreen.tsx
 * @description Main camera screen for Phase 2 of NetraSetu.
 *
 * Responsibilities:
 *   1. Request and handle camera permission states.
 *   2. Render a full-screen Vision Camera preview on the rear camera.
 *   3. Run the face detection frame processor on every camera frame.
 *   4. Feed detection results through FaceDetectionService for quality analysis.
 *   5. Render FaceOverlay to display bounding box and status messages.
 *   6. Fire the onValidFaceDetected callback (logging "VALID_FACE_DETECTED")
 *      after VALID_FRAMES_REQUIRED consecutive valid frames.
 *
 * PHASE 2 BOUNDARY — this file deliberately stops at:
 *   ✅ Camera preview
 *   ✅ Face detection + bounding box
 *   ✅ Quality validation (centred, size, bounds)
 *   ✅ VALID_FACE_DETECTED log + callback
 *   ❌ No image saving
 *   ❌ No face recognition
 *   ❌ No database writes
 *   ❌ No attendance marking
 *
 * Design system (uiux-designer skill):
 *   Dark HUD theme, Trust Blue + Green + Amber palette, Inter typography.
 *   Touch targets ≥ 44×44px, transitions 150–300ms, SVG icons.
 *
 * Architecture (mobile-developer skill):
 *   Feature-based module under src/camera/.
 *   Platform-specific code isolated to CameraPermissions.ts.
 *   No inline business logic — delegated to FaceDetectionService.ts.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useFrameProcessor,
  type Frame,
} from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { ensureCameraPermission } from './CameraPermissions';
import {
  analyseFaceQuality,
  noFaceResult,
  ValidFrameCounter,
  VALID_FRAMES_REQUIRED,
  type FaceQualityResult,
  type FaceBounds,
} from './FaceDetectionService';
import FaceOverlay from './FaceOverlay';

// ---------------------------------------------------------------------------
// Design Tokens
// ---------------------------------------------------------------------------

const COLORS = {
  background: '#0F172A',         // Slate-900 — dark HUD background
  surface: 'rgba(30,41,59,0.92)', // Slate-800 translucent
  primary: '#3B82F6',             // Trust Blue
  success: '#22C55E',             // Green — valid state
  error: '#EF4444',               // Red — permission denied
  textPrimary: '#F1F5F9',         // Slate-100
  textMuted: '#94A3B8',           // Slate-400
  border: 'rgba(148,163,184,0.15)',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CameraScreenProps {
  /**
   * Called when a valid face is detected for VALID_FRAMES_REQUIRED consecutive frames.
   * Phase 3 will hook into this to trigger facial recognition.
   */
  onValidFaceDetected?: () => void;
}

type PermissionState = 'loading' | 'granted' | 'denied';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CameraScreen — root screen for face-detection workflow.
 *
 * State machine:
 *   loading → (permission request) → granted | denied
 *
 * Render branches:
 *   loading  → ActivityIndicator
 *   denied   → Instructional UI with Settings deep-link
 *   granted  → Full-screen camera + FaceOverlay
 */
const CameraScreen: React.FC<CameraScreenProps> = ({ onValidFaceDetected }) => {
  // ── Permission state ───────────────────────────────────────────────────────
  const [permissionState, setPermissionState] = useState<PermissionState>('loading');

  // ── Camera preview layout dimensions ──────────────────────────────────────
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  // ── Current face quality result (updated per frame, triggers re-render) ───
  const [qualityResult, setQualityResult] = useState<FaceQualityResult | null>(null);

  // ── Consecutive valid frame counter (NOT state — must not cause re-renders) ─
  const frameCounter = useRef(new ValidFrameCounter()).current;

  // ── Cooldown flag to prevent callback flooding after trigger ──────────────
  const captureOnCooldown = useRef(false);

  // ── Vision Camera device — rear camera ────────────────────────────────────
  const device = useCameraDevice('back');

  // ── Face detector plugin ──────────────────────────────────────────────────
  const { detectFaces } = useFaceDetector({
    performanceMode: 'fast',        // Optimise for real-time detection
    landmarkMode: 'none',           // Phase 2 doesn't need landmarks
    contourMode: 'none',
    classificationMode: 'none',
  });

  // ── Camera format — prefer 720p for balance of accuracy and performance ───
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  /** Request camera permission on mount */
  useEffect(() => {
    let cancelled = false;

    ensureCameraPermission()
      .then((result) => {
        if (!cancelled) {
          setPermissionState(result.granted ? 'granted' : 'denied');
        }
      })
      .catch((err) => {
        console.error('[CameraScreen] Permission error:', err);
        if (!cancelled) setPermissionState('denied');
      });

    return () => {
      cancelled = true;
      frameCounter.reset();
    };
  }, [frameCounter]);

  // ---------------------------------------------------------------------------
  // Callbacks
  // ---------------------------------------------------------------------------

  /**
   * Handles a valid face detection trigger.
   * Runs on the JS thread (called via runOnJS from the worklet).
   * Implements a 2-second cooldown to prevent repeated logging.
   */
  const handleValidFaceDetected = useCallback(() => {
    if (captureOnCooldown.current) return;

    captureOnCooldown.current = true;
    console.log('VALID_FACE_DETECTED');
    onValidFaceDetected?.();

    // Reset cooldown after 2 seconds to allow re-detection
    setTimeout(() => {
      captureOnCooldown.current = false;
    }, 2000);
  }, [onValidFaceDetected]);

  /**
   * Updates React state with the latest quality result.
   * Must be called via runOnJS since frame processors run in a Reanimated worklet.
   */
  const updateQualityResult = useCallback((result: FaceQualityResult) => {
    setQualityResult(result);

    if (frameCounter.record(result.isValid)) {
      handleValidFaceDetected();
    }
  }, [frameCounter, handleValidFaceDetected]);

  const updateQualityResultJS = Worklets.createRunOnJS(updateQualityResult);

  /**
   * Vision Camera frame processor.
   * Runs on every camera frame in a Reanimated worklet (not the JS thread).
   * All JS-thread side effects must go through runOnJS().
   *
   * Performance note (mobile-developer skill):
   *   Keep worklet body allocation-free. No closures over large objects.
   */
  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';

      const faces = detectFaces(frame);

      if (faces.length === 0) {
        // No face — pass a no-face result to JS thread
        updateQualityResultJS(noFaceResult());
        return;
      }

      // Use the first (largest, most prominent) detected face
      const face = faces[0];
      const bounds: FaceBounds = {
        x: face.bounds.x,
        y: face.bounds.y,
        width: face.bounds.width,
        height: face.bounds.height,
      };

      const frameDimensions = {
        width: frame.width,
        height: frame.height,
      };

      const result = analyseFaceQuality(bounds, frameDimensions);
      updateQualityResultJS(result);
    },
    [detectFaces, updateQualityResultJS],
  );

  // ---------------------------------------------------------------------------
  // Render branches
  // ---------------------------------------------------------------------------

  /** Loading — permission request in progress */
  if (permissionState === 'loading') {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Requesting camera access…</Text>
      </View>
    );
  }

  /** Denied — explain and link to Settings */
  if (permissionState === 'denied') {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        {/* SVG camera-off icon */}
        <View style={styles.iconContainer} accessibilityElementsHidden>
          <Text style={styles.iconPlaceholder}>⊘</Text>
        </View>

        <Text style={styles.deniedTitle}>Camera Access Required</Text>
        <Text style={styles.deniedBody}>
          NetraSetu needs camera access to detect and verify worker identity.
          Please enable camera permission in your device Settings.
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.settingsButton,
            pressed && styles.settingsButtonPressed,
          ]}
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open device settings to grant camera permission"
        >
          <Text style={styles.settingsButtonText}>Open Settings</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  /** No camera device found (emulator or unusual hardware) */
  if (!device) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.deniedTitle}>No Camera Found</Text>
        <Text style={styles.deniedBody}>
          A rear-facing camera is required to run NetraSetu.
        </Text>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Main camera preview (permission === 'granted' && device exists)
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.cameraContainer}>
      {/* ── Camera preview ──────────────────────────────────────────────── */}
      <Camera
        style={StyleSheet.absoluteFillObject}
        device={device}
        isActive={true}
        format={format}
        frameProcessor={frameProcessor}
        onLayout={(e) =>
          setPreviewSize({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }
        // Accessibility: camera is decorative; overlay provides the live text feedback
        accessible={false}
      />

      {/* ── Face bounding box + status badge overlay ─────────────────────── */}
      {previewSize.width > 0 && (
        <FaceOverlay
          qualityResult={qualityResult}
          previewWidth={previewSize.width}
          previewHeight={previewSize.height}
        />
      )}

      {/* ── Top HUD header bar ───────────────────────────────────────────── */}
      <SafeAreaView style={styles.hudHeader} pointerEvents="none">
        <View style={styles.hudBadge}>
          <View
            style={[
              styles.recordingDot,
              { backgroundColor: qualityResult?.status === 'VALID' ? COLORS.success : COLORS.primary },
            ]}
          />
          <Text style={styles.hudTitle}>NetraSetu</Text>
        </View>
        <Text style={styles.hudSubtitle}>Face Detection Active</Text>
      </SafeAreaView>

      {/* ── Bottom instruction bar ───────────────────────────────────────── */}
      <View style={styles.instructionBar} pointerEvents="none">
        <Text style={styles.instructionText} accessibilityLiveRegion="polite">
          {qualityResult?.message ?? 'Initialising…'}
        </Text>
        {qualityResult?.status !== 'NO_FACE' && qualityResult?.status !== undefined && (
          <Text style={styles.statusDetail}>
            {qualityResult.status === 'VALID'
              ? `Confirming… (${VALID_FRAMES_REQUIRED} frames required)`
              : 'Adjust position to continue'}
          </Text>
        )}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles — dark HUD theme (uiux-designer: cyberpunk, neon glow)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // ── Shared ────────────────────────────────────────────────────────────────
  centeredContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },

  loadingText: {
    marginTop: 16,
    color: COLORS.textMuted,
    fontSize: 14,
    fontFamily: 'System',
  },

  // ── Permission denied ──────────────────────────────────────────────────────
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },

  iconPlaceholder: {
    fontSize: 32,
    color: COLORS.error,
  },

  deniedTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'System',
  },

  deniedBody: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,  // uiux-designer: 1.5–1.75 line-height for body text
    marginBottom: 32,
    fontFamily: 'System',
  },

  settingsButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14, // ≥ 44px touch target satisfied by total height
    minWidth: 160,
    alignItems: 'center',
    // uiux-designer: elevation for depth
    ...Platform.select({
      android: { elevation: 4 },
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
      },
    }),
  },

  settingsButtonPressed: {
    opacity: 0.8, // uiux-designer: hover/press feedback
  },

  settingsButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'System',
  },

  // ── Camera view ────────────────────────────────────────────────────────────
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },

  // ── Top HUD ────────────────────────────────────────────────────────────────
  hudHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  hudBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  hudTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontFamily: 'System',
  },

  hudSubtitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.5,
    fontFamily: 'System',
  },

  // ── Bottom instruction bar ─────────────────────────────────────────────────
  instructionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  instructionText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: 'System',
  },

  statusDetail: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
    fontFamily: 'System',
  },
});

export default CameraScreen;
