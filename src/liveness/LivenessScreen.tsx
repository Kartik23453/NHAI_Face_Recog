/**
 * @file LivenessScreen.tsx
 * @description Liveness verification screen — Phase 3 of NetraSetu.
 *
 * This screen EXTENDS Phase 2's CameraScreen by:
 *   1. Enabling landmark/contour mode in the face detector (needed for EAR).
 *   2. Computing binocular EAR from eye contour points each frame.
 *   3. Running BlinkDetector per frame to detect genuine blinks.
 *   4. Driving LivenessStateMachine with face quality + blink signals.
 *   5. Rendering LivenessOverlay instead of Phase 2's FaceOverlay.
 *   6. Playing Expo Speech audio prompt "Palk Jhapkayein" on challenge start.
 *
 * PHASE 3 BOUNDARY — this file deliberately stops at:
 *   ✅ Camera permission (reused from Phase 2)
 *   ✅ Face quality validation (reused from Phase 2)
 *   ✅ EAR calculation + blink detection
 *   ✅ Liveness state machine (IDLE → LIVENESS_VERIFIED)
 *   ✅ Audio prompt ("Palk Jhapkayein")
 *   ✅ LIVENESS_VERIFIED callback
 *   ❌ No face recognition
 *   ❌ No TensorFlow Lite
 *   ❌ No database writes
 *   ❌ No attendance marking
 *
 * Integration note:
 *   Replace <CameraScreen> with <LivenessScreen> in your navigation stack.
 *   The onLivenessVerified callback bridges to Phase 4.
 *
 * Architecture (mobile-developer skill):
 *   Feature module under src/liveness/ with clean boundaries.
 *   Camera infra reused from src/camera/; no code duplication.
 */

import React, {
  useCallback,
  useEffect,
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
import { runOnJS } from 'react-native-reanimated';

// ── Phase 2 imports (reused) ─────────────────────────────────────────────────
import { ensureCameraPermission } from '../camera/CameraPermissions';
import {
  analyseFaceQuality,
  noFaceResult,
  type FaceBounds,
  type FaceQualityResult,
} from '../camera/FaceDetectionService';

// ── Phase 3 imports ───────────────────────────────────────────────────────────
import { computeBinocularEAR, type Point2D } from './EARCalculator';
import { BlinkDetector } from './BlinkDetector';
import * as VoiceGuidanceService from '../voice/VoiceGuidanceService';
import {
  LivenessStateMachine,
  type LivenessStateData,
} from './LivenessStateMachine';
import LivenessOverlay from './LivenessOverlay';

// ---------------------------------------------------------------------------
// Design Tokens — consistent with Phase 2 CameraScreen
// ---------------------------------------------------------------------------

const COLORS = {
  background: '#0F172A',
  primary: '#3B82F6',
  error: '#EF4444',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LivenessScreenProps {
  /**
   * Called once when LIVENESS_VERIFIED state is reached.
   * Phase 4 (face recognition) will hook into this callback.
   */
  onLivenessVerified?: () => void;
}

type PermissionState = 'loading' | 'granted' | 'denied';

// ---------------------------------------------------------------------------
// Frame Data bridged from worklet → JS thread
// ---------------------------------------------------------------------------

/**
 * Data extracted per frame in the worklet and sent to the JS thread via runOnJS.
 * Kept minimal to reduce bridge serialisation overhead.
 */
interface FrameAnalysis {
  qualityResult: FaceQualityResult;
  leftEyeContour: Point2D[];
  rightEyeContour: Point2D[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LivenessScreen: React.FC<LivenessScreenProps> = ({ onLivenessVerified }) => {
  // ── Permission state ───────────────────────────────────────────────────────
  const [permissionState, setPermissionState] = useState<PermissionState>('loading');

  // ── Camera preview layout dimensions ──────────────────────────────────────
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  // ── LivenessStateMachine state for rendering ───────────────────────────────
  const [stateData, setStateData] = useState<LivenessStateData>({
    state: 'IDLE',
    message: 'No Face Detected',
    progress: 0,
    blinkChallengeRemainingMs: 0,
  });

  // ── Refs for per-frame processing (avoid stale closure issues) ───────────
  const blinkDetector = useRef(new BlinkDetector()).current;
  const livenessFSM = useRef<LivenessStateMachine | null>(null);

  // ── Vision Camera ──────────────────────────────────────────────────────────
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);

  // ── Face detector — CONTOUR mode enabled for EAR landmark access ───────────
  const { detectFaces } = useFaceDetector({
    performanceMode: 'accurate', // Phase 3 needs contour points → accurate mode
    landmarkMode: 'all',         // Enable for eye landmark fallback
    contourMode: 'all',          // Required for 16-point eye contours (EAR)
    classificationMode: 'none',  // Not needed for blink detection
  });

  // ---------------------------------------------------------------------------
  // FSM + BlinkDetector initialisation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const fsm = new LivenessStateMachine(
      // onStateChange — update React state for rendering
      (data) => setStateData(data),

      // onLivenessVerified — callback to parent (Phase 4 entry point)
      () => {
        console.log('LIVENESS_VERIFIED');
        onLivenessVerified?.();
      },

      // onBlinkChallengeStart — play audio prompt
      () => {
        VoiceGuidanceService.speak('Palk jhapkayein');
      },
    );

    livenessFSM.current = fsm;

    return () => {
      fsm.reset();
      blinkDetector.reset();
      VoiceGuidanceService.stop();
    };
  }, [blinkDetector, onLivenessVerified]);

  // ---------------------------------------------------------------------------
  // Permission request
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    ensureCameraPermission()
      .then((result) => {
        if (!cancelled) setPermissionState(result.granted ? 'granted' : 'denied');
      })
      .catch(() => {
        if (!cancelled) setPermissionState('denied');
      });

    return () => { cancelled = true; };
  }, []);

  // ---------------------------------------------------------------------------
  // Frame analysis — JS thread handler (called via runOnJS)
  // ---------------------------------------------------------------------------

  /**
   * Processes one frame's worth of face data on the JS thread.
   * Runs the blink detector and feeds the FSM with both quality and blink signals.
   */
  const processFrameOnJS = useCallback((analysis: FrameAnalysis) => {
    if (!livenessFSM.current) return;

    const { qualityResult, leftEyeContour, rightEyeContour } = analysis;

    // ── EAR calculation ────────────────────────────────────────────────────
    const earResult = computeBinocularEAR(leftEyeContour, rightEyeContour);

    // ── Blink detection ────────────────────────────────────────────────────
    const blinkResult = blinkDetector.processFrame(earResult);

    // ── Feed FSM ───────────────────────────────────────────────────────────
    livenessFSM.current.onFaceFrame(qualityResult.isValid, blinkResult.blinkConfirmed);
  }, [blinkDetector]);

  // ---------------------------------------------------------------------------
  // Frame processor — runs in Reanimated worklet on camera thread
  // ---------------------------------------------------------------------------

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';

      const faces = detectFaces(frame);

      if (faces.length === 0) {
        const noFace: FrameAnalysis = {
          qualityResult: noFaceResult(),
          leftEyeContour: [],
          rightEyeContour: [],
        };
        runOnJS(processFrameOnJS)(noFace);
        return;
      }

      const face = faces[0];

      // ── Face quality check (Phase 2 logic reused) ──────────────────────
      const bounds: FaceBounds = {
        x: face.bounds.x,
        y: face.bounds.y,
        width: face.bounds.width,
        height: face.bounds.height,
      };
      const qualityResult = analyseFaceQuality(bounds, {
        width: frame.width,
        height: frame.height,
      });

      // ── Extract eye contour points ─────────────────────────────────────
      // react-native-vision-camera-face-detector exposes contours when
      // contourMode: 'all' is set. Type assertions used because the plugin's
      // TypeScript types may not enumerate all contour keys.
      const contours = (face as any).contours ?? {};

      const leftEyeContour: Point2D[] =
        (contours.leftEye as Point2D[] | undefined) ?? [];
      const rightEyeContour: Point2D[] =
        (contours.rightEye as Point2D[] | undefined) ?? [];

      const analysis: FrameAnalysis = {
        qualityResult,
        leftEyeContour,
        rightEyeContour,
      };

      runOnJS(processFrameOnJS)(analysis);
    },
    [detectFaces, processFrameOnJS],
  );

  // ---------------------------------------------------------------------------
  // Render branches
  // ---------------------------------------------------------------------------

  if (permissionState === 'loading') {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Requesting camera access…</Text>
      </View>
    );
  }

  if (permissionState === 'denied') {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <View style={styles.iconContainer} accessibilityElementsHidden>
          <Text style={styles.iconSymbol}>⊘</Text>
        </View>
        <Text style={styles.titleText}>Camera Access Required</Text>
        <Text style={styles.bodyText}>
          NetraSetu requires camera access to perform liveness verification.
          Please enable camera permission in Settings.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open device settings to grant camera permission"
        >
          <Text style={styles.buttonText}>Open Settings</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.titleText}>No Camera Found</Text>
        <Text style={styles.bodyText}>A rear camera is required.</Text>
      </View>
    );
  }

  // ── Main camera + liveness overlay ──────────────────────────────────────
  return (
    <View style={styles.cameraContainer}>
      {/* ── Camera preview ───────────────────────────────────────────────── */}
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
        accessible={false}
      />

      {/* ── Liveness overlay (replaces Phase 2's FaceOverlay) ───────────── */}
      {previewSize.width > 0 && (
        <LivenessOverlay
          stateData={stateData}
          previewWidth={previewSize.width}
          previewHeight={previewSize.height}
        />
      )}

      {/* ── HUD header ───────────────────────────────────────────────────── */}
      <SafeAreaView style={styles.hudHeader} pointerEvents="none">
        <View style={styles.hudBadge}>
          <View
            style={[
              styles.recordingDot,
              {
                backgroundColor:
                  stateData.state === 'LIVENESS_VERIFIED' ? '#22C55E' : COLORS.primary,
              },
            ]}
          />
          <Text style={styles.hudTitle}>NetraSetu</Text>
        </View>
        <Text style={styles.hudSubtitle}>Liveness Verification</Text>
      </SafeAreaView>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles — dark HUD theme (consistent with Phase 2)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
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

  iconSymbol: {
    fontSize: 32,
    color: COLORS.error,
  },

  titleText: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'System',
  },

  bodyText: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    fontFamily: 'System',
  },

  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    minWidth: 160,
    alignItems: 'center',
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

  buttonPressed: { opacity: 0.8 },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'System',
  },

  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },

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
});

export default LivenessScreen;
