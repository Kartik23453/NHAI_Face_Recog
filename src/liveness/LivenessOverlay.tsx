/**
 * @file LivenessOverlay.tsx
 * @description Full-screen liveness verification overlay for NetraSetu Phase 3.
 *
 * Renders on top of the Phase 2 camera preview and replaces/augments the
 * FaceOverlay from Phase 2 during the liveness check session.
 *
 * Visual layers (bottom → top):
 *   1. Circular face guide (Aadhaar-style oval frame centered in preview)
 *   2. Animated challenge countdown arc (SVG circle stroke-dashoffset)
 *   3. State-specific colour fill on the oval border
 *   4. Status message pill badge
 *   5. Timeout countdown bar (WAITING_FOR_BLINK only)
 *
 * Design system (uiux-designer skill output):
 *   Style    : Professional + Trustworthy (security biometrics context)
 *   Colors   : Trust Blue #3B82F6, Green #22C55E, Amber #F59E0B, Red #EF4444
 *   Palette  : Dark HUD — consistent with Phase 2 CameraScreen
 *   Font     : Inter / System
 *   Animation: 150–300ms micro-interactions, transform/opacity only
 *   A11y     : accessibilityLiveRegion="polite", color NOT sole indicator
 *
 * Rules applied (uiux-designer skill):
 *   - No emojis as icons — pure SVG shapes used
 *   - Transitions 150–300ms
 *   - Touch targets N/A (overlay is pointerEvents="none")
 *   - prefers-reduced-motion honoured via AccessibilityInfo
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Defs, Mask, Rect } from 'react-native-svg';
import type { LivenessStateData } from './LivenessStateMachine';
import { BLINK_CHALLENGE_TIMEOUT_MS } from './LivenessStateMachine';

// ---------------------------------------------------------------------------
// Design Tokens — HUD dark theme (consistent with Phase 2 CameraScreen)
// ---------------------------------------------------------------------------

const COLORS = {
  idle: '#64748B',           // Slate-500  — no face
  faceReady: '#3B82F6',      // Trust Blue — face confirmed
  waitingForBlink: '#F59E0B', // Amber      — action required
  blinkDetected: '#22C55E',  // Green      — blink confirmed
  livenessVerified: '#22C55E',// Green      — verified
  textPrimary: '#F1F5F9',    // Slate-100
  textMuted: '#94A3B8',      // Slate-400
  badgeBg: 'rgba(0,0,0,0.70)',
  overlayDark: 'rgba(0,0,0,0.50)',
  timerBg: 'rgba(0,0,0,0.40)',
} as const;

/** Resolves accent colour from liveness state */
function stateColor(state: LivenessStateData['state']): string {
  switch (state) {
    case 'FACE_READY':          return COLORS.faceReady;
    case 'WAITING_FOR_BLINK':   return COLORS.waitingForBlink;
    case 'BLINK_DETECTED':      return COLORS.blinkDetected;
    case 'LIVENESS_VERIFIED':   return COLORS.livenessVerified;
    default:                    return COLORS.idle;
  }
}

// ---------------------------------------------------------------------------
// Constants — Oval Guide geometry
// ---------------------------------------------------------------------------

/** SVG viewBox dimensions (matches camera preview aspect) */
const VB_W = 375;
const VB_H = 667;

/** Oval (ellipse) centre and radii in viewBox units */
const OVAL_CX = VB_W / 2;
const OVAL_CY = VB_H / 2 - 20; // Slightly above centre for natural face framing
const OVAL_RX = 110;            // Horizontal radius
const OVAL_RY = 145;            // Vertical radius (taller than wide for a face)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LivenessOverlayProps {
  /** Current state data from LivenessStateMachine */
  stateData: LivenessStateData;
  /** Width of the camera preview in layout pixels */
  previewWidth: number;
  /** Height of the camera preview in layout pixels */
  previewHeight: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * LivenessOverlay renders the liveness verification HUD over the camera preview.
 *
 * It is intentionally stateless (receives all data via props) so the parent
 * LivenessScreen holds the single source of truth.
 */
const LivenessOverlay: React.FC<LivenessOverlayProps> = ({
  stateData,
  previewWidth,
  previewHeight,
}) => {
  const { state, message, progress, blinkChallengeRemainingMs } = stateData;
  const accentColor = stateColor(state);

  // ── Reduced motion ─────────────────────────────────────────────────────────
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // ── Badge opacity animation (fades in on state change) ────────────────────
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(badgeOpacity, {
      toValue: 1,
      duration: 200, // uiux-designer: 150–300ms micro-interactions
      useNativeDriver: true,
    }).start();
    return () => { badgeOpacity.setValue(0); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── Verification success scale animation ───────────────────────────────────
  const verifiedScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (state === 'LIVENESS_VERIFIED' && !reduceMotion) {
      Animated.sequence([
        Animated.timing(verifiedScale, { toValue: 1.08, duration: 200, useNativeDriver: true }),
        Animated.timing(verifiedScale, { toValue: 1,    duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [state, reduceMotion, verifiedScale]);

  // ── Countdown timer bar width (0 → full width as timeout elapses) ─────────
  const timerBarAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (state === 'WAITING_FOR_BLINK') {
      timerBarAnim.setValue(1);
      Animated.timing(timerBarAnim, {
        toValue: 0,
        duration: blinkChallengeRemainingMs > 0
          ? blinkChallengeRemainingMs
          : BLINK_CHALLENGE_TIMEOUT_MS,
        easing: Easing.linear,
        useNativeDriver: false, // width interpolation needs native: false
      }).start();
    } else {
      timerBarAnim.stopAnimation();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── Oval progress ring strokeDashoffset ───────────────────────────────────
  // Approximate ellipse circumference: 2π * sqrt((rx² + ry²) / 2)
  const circumference = 2 * Math.PI * Math.sqrt((OVAL_RX ** 2 + OVAL_RY ** 2) / 2);
  const dashOffset = circumference * (1 - Math.min(progress, 1));

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View
      style={styles.container}
      pointerEvents="none"
      accessible={false}
    >
      {/* ── SVG layer: cutout oval + progress arc ─────────────────────────── */}
      <Svg
        width={previewWidth}
        height={previewHeight}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        style={StyleSheet.absoluteFillObject}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          {/*
            Mask creates the "cutout" effect:
              - White rect fills the entire frame (mask-visible everywhere)
              - Black ellipse punches a transparent hole for the face guide
          */}
          <Mask id="faceMask">
            <Rect x="0" y="0" width={VB_W} height={VB_H} fill="white" />
            <Circle cx={OVAL_CX} cy={OVAL_CY} r={OVAL_RX} fill="black" />
          </Mask>
        </Defs>

        {/* Darkened overlay outside the oval */}
        <Rect
          x="0"
          y="0"
          width={VB_W}
          height={VB_H}
          fill={COLORS.overlayDark}
          mask="url(#faceMask)"
        />

        {/* Oval border — changes colour with liveness state */}
        <Circle
          cx={OVAL_CX}
          cy={OVAL_CY}
          r={OVAL_RX}
          fill="none"
          stroke={accentColor}
          strokeWidth={3}
          opacity={0.9}
        />

        {/* Progress arc — tracks FACE_READY hold and WAITING_FOR_BLINK countdown */}
        {(state === 'FACE_READY' || state === 'WAITING_FOR_BLINK') && !reduceMotion && (
          <Circle
            cx={OVAL_CX}
            cy={OVAL_CY}
            r={OVAL_RX}
            fill="none"
            stroke={accentColor}
            strokeWidth={5}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            // Start progress arc from top of circle
            transform={`rotate(-90, ${OVAL_CX}, ${OVAL_CY})`}
            opacity={0.85}
          />
        )}

        {/* Verified checkmark ring */}
        {state === 'LIVENESS_VERIFIED' && (
          <Circle
            cx={OVAL_CX}
            cy={OVAL_CY}
            r={OVAL_RX + 6}
            fill="none"
            stroke={COLORS.livenessVerified}
            strokeWidth={4}
            opacity={0.5}
          />
        )}
      </Svg>

      {/* ── State label above the oval ────────────────────────────────────── */}
      <View style={styles.topLabelContainer}>
        <Text style={styles.topLabelText}>
          {state === 'WAITING_FOR_BLINK'
            ? `${Math.ceil(blinkChallengeRemainingMs / 1000)}s`
            : ''}
        </Text>
      </View>

      {/* ── Status badge ──────────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.badge,
          { opacity: badgeOpacity, borderColor: accentColor },
          state === 'LIVENESS_VERIFIED' && { transform: [{ scale: verifiedScale }] },
        ]}
        accessibilityLabel={message}
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
      >
        {/* Coloured status dot — NOT sole indicator (text is also present) */}
        <View style={[styles.statusDot, { backgroundColor: accentColor }]} />
        <Text style={styles.badgeText}>{message}</Text>
      </Animated.View>

      {/* ── Challenge hint beneath badge ──────────────────────────────────── */}
      {state === 'WAITING_FOR_BLINK' && (
        <View style={styles.hintContainer}>
          <Text style={styles.hintText}>Blink Now</Text>
        </View>
      )}

      {/* ── Countdown bar (WAITING_FOR_BLINK only) ────────────────────────── */}
      {state === 'WAITING_FOR_BLINK' && (
        <View style={styles.timerBarTrack}>
          <Animated.View
            style={[
              styles.timerBarFill,
              {
                width: timerBarAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
                backgroundColor: accentColor,
              },
            ]}
          />
        </View>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles — dark HUD theme consistent with Phase 2
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },

  // ── Oval top label (countdown seconds) ────────────────────────────────────
  topLabelContainer: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
  },

  topLabelText: {
    color: COLORS.textMuted,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
    fontFamily: 'System',
  },

  // ── Status badge ──────────────────────────────────────────────────────────
  badge: {
    position: 'absolute',
    bottom: 80, // Above the timer bar
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.badgeBg,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 10,
    // Android elevation
    elevation: 6,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  badgeText: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.4,
    fontFamily: 'System',
  },

  // ── Challenge hint text ────────────────────────────────────────────────────
  hintContainer: {
    position: 'absolute',
    bottom: 52,
  },

  hintText: {
    color: COLORS.textMuted,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'System',
  },

  // ── Countdown bar ──────────────────────────────────────────────────────────
  timerBarTrack: {
    position: 'absolute',
    bottom: 32,
    left: 24,
    right: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },

  timerBarFill: {
    height: '100%',
    borderRadius: 2,
  },
});

export default LivenessOverlay;
