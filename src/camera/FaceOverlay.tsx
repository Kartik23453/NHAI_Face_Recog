/**
 * @file FaceOverlay.tsx
 * @description Transparent SVG overlay drawn on top of the camera preview.
 *
 * Renders:
 *   1. A dynamic bounding box that tracks the detected face position.
 *   2. Corner-bracket decorations (HUD style) for visual flair.
 *   3. A colour-coded status badge with the current quality message.
 *   4. A pulsing "Face Ready" indicator when the face passes all checks.
 *
 * Design system (uiux-designer skill output):
 *   Style  : Cyberpunk / HUD — neon glow, dark overlay, clean lines
 *   Colors : Trust Blue #3B82F6 (neutral), Green #22C55E (valid), Amber #F59E0B (warning)
 *   Font   : Inter — technical, clear typography
 *   Animations: 150–300ms transitions, transform/opacity only (no layout shift)
 *
 * UX principles applied (uiux-designer skill):
 *   - Minimum 44×44px touch targets respected (no interactive elements here)
 *   - Color is never the ONLY indicator — text message always accompanies color
 *   - prefers-reduced-motion respected via conditional animation
 *   - SVG used instead of emoji icons
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import type { FaceQualityResult } from './FaceDetectionService';

// ---------------------------------------------------------------------------
// Design Tokens (uiux-designer: dark HUD theme)
// ---------------------------------------------------------------------------

const COLORS = {
  /** Neutral — face detected but not yet valid */
  neutral: '#3B82F6',    // Trust Blue
  /** Valid — all quality checks passed */
  valid: '#22C55E',       // Green
  /** Warning — face needs adjustment */
  warning: '#F59E0B',     // Amber
  /** No face — subtle grey */
  none: '#64748B',        // Slate-500
  /** Background overlay tint */
  overlayBg: 'rgba(0, 0, 0, 0.35)',
  /** Box stroke base */
  boxStroke: 'rgba(255,255,255,0.15)',
  /** Status badge background */
  badgeBg: 'rgba(0, 0, 0, 0.65)',
  /** Status text */
  textPrimary: '#F1F5F9',
} as const;

/** Corner bracket arm length in density-independent pixels */
const CORNER_ARM = 18;
/** Bounding box stroke width */
const BOX_STROKE_WIDTH = 2;

// ---------------------------------------------------------------------------
// Helper — resolve colour by quality status
// ---------------------------------------------------------------------------

function resolveColor(status: FaceQualityResult['status']): string {
  switch (status) {
    case 'VALID':
      return COLORS.valid;
    case 'NO_FACE':
      return COLORS.none;
    default:
      return COLORS.warning;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FaceOverlayProps {
  /** Current quality analysis result (null if detection is not yet running) */
  qualityResult: FaceQualityResult | null;
  /** Width of the camera preview container in layout pixels */
  previewWidth: number;
  /** Height of the camera preview container in layout pixels */
  previewHeight: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Transparent overlay that renders the face bounding box and status badge
 * on top of the Vision Camera preview. Uses React Native SVG for the box
 * and standard RN Animated API for the pulse effect.
 *
 * Render strategy:
 *   - StyleSheet.absoluteFillObject to fill the preview exactly.
 *   - SVG layer for the vector bounding box.
 *   - View layer for the text badge (SVG text has poor wrapping support).
 */
const FaceOverlay: React.FC<FaceOverlayProps> = ({
  qualityResult,
  previewWidth,
  previewHeight,
}) => {
  // ── Animation refs ────────────────────────────────────────────────────────
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;

  // Detect reduced-motion preference (uiux-designer: prefers-reduced-motion)
  const [reduceMotion, setReduceMotion] = React.useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // ── Pulse animation when face is valid ────────────────────────────────────
  useEffect(() => {
    if (qualityResult?.status === 'VALID' && !reduceMotion) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.06,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [qualityResult?.status, reduceMotion, pulseAnim]);

  // ── Badge fade in/out ──────────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(badgeOpacity, {
      toValue: 1,
      duration: 200, // uiux-designer: 150–300ms micro-interactions
      useNativeDriver: true,
    }).start();
  }, [qualityResult?.status, badgeOpacity]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const status = qualityResult?.status ?? 'NO_FACE';
  const message = qualityResult?.message ?? 'No Face Detected';
  const normBounds = qualityResult?.normalisedBounds;
  const accentColor = resolveColor(status);

  // Convert normalised bounds → layout pixel coordinates
  const box = normBounds
    ? {
        x: normBounds.x * previewWidth,
        y: normBounds.y * previewHeight,
        w: normBounds.width * previewWidth,
        h: normBounds.height * previewHeight,
      }
    : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View
      style={styles.container}
      pointerEvents="none"          // Let touches pass through to camera
      accessible={false}            // Decorative overlay — not in a11y tree
    >
      {/* ── SVG bounding box layer ────────────────────────────────────── */}
      <Svg
        width={previewWidth}
        height={previewHeight}
        style={StyleSheet.absoluteFillObject}
      >
        {box && (
          <>
            {/* Main bounding box — animated scale applied via Animated.View wrapper */}
            <Rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              strokeWidth={BOX_STROKE_WIDTH}
              stroke={accentColor}
              fill="transparent"
              rx={4}
              ry={4}
              opacity={0.9}
            />

            {/* ── Corner bracket decorations (HUD aesthetics) ── */}
            {/* Top-left corner */}
            <Line x1={box.x} y1={box.y + CORNER_ARM} x2={box.x} y2={box.y} stroke={accentColor} strokeWidth={3} />
            <Line x1={box.x} y1={box.y} x2={box.x + CORNER_ARM} y2={box.y} stroke={accentColor} strokeWidth={3} />

            {/* Top-right corner */}
            <Line x1={box.x + box.w - CORNER_ARM} y1={box.y} x2={box.x + box.w} y2={box.y} stroke={accentColor} strokeWidth={3} />
            <Line x1={box.x + box.w} y1={box.y} x2={box.x + box.w} y2={box.y + CORNER_ARM} stroke={accentColor} strokeWidth={3} />

            {/* Bottom-left corner */}
            <Line x1={box.x} y1={box.y + box.h - CORNER_ARM} x2={box.x} y2={box.y + box.h} stroke={accentColor} strokeWidth={3} />
            <Line x1={box.x} y1={box.y + box.h} x2={box.x + CORNER_ARM} y2={box.y + box.h} stroke={accentColor} strokeWidth={3} />

            {/* Bottom-right corner */}
            <Line x1={box.x + box.w - CORNER_ARM} y1={box.y + box.h} x2={box.x + box.w} y2={box.y + box.h} stroke={accentColor} strokeWidth={3} />
            <Line x1={box.x + box.w} y1={box.y + box.h - CORNER_ARM} x2={box.x + box.w} y2={box.y + box.h} stroke={accentColor} strokeWidth={3} />
          </>
        )}
      </Svg>

      {/* ── Status badge ─────────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.badge,
          { opacity: badgeOpacity, borderColor: accentColor },
        ]}
        accessibilityLabel={message}
        accessibilityRole="text"
      >
        {/* Colour indicator dot — not the only cue (text also present) */}
        <View style={[styles.statusDot, { backgroundColor: accentColor }]} />
        <Text style={styles.badgeText}>{message}</Text>
      </Animated.View>

      {/* ── "Face Ready" pulse ring ───────────────────────────────────────── */}
      {status === 'VALID' && box && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              left: box.x - 4,
              top: box.y - 4,
              width: box.w + 8,
              height: box.h + 8,
              borderColor: COLORS.valid,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles — HUD dark theme (uiux-designer: cyberpunk, neon glow)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },

  badge: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.badgeBg,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    // Shadow for legibility over camera feed
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 6, // Android (mobile-developer: Platform.select not needed — same value)
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  badgeText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
    // Inter font loaded globally via expo-font or system fallback
    fontFamily: 'System',
  },

  pulseRing: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 6,
    opacity: 0.5,
  },
});

export default FaceOverlay;
