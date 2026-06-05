/**
 * @file AttendanceSuccessScreen.tsx
 * @description Attendance result screen for Phase 5 of NetraSetu.
 *
 * Renders immediately after the attendance FSM reaches ATTENDANCE_SUCCESS or
 * ATTENDANCE_REJECTED. It covers all four result states defined in Phase 5:
 *
 *   ✅ ATTENDANCE_SUCCESS   — Green card, worker name, time, "Attendance Marked"
 *   ⚠️  RECENT_ATTENDANCE   — Amber card, lockout message, last-seen time
 *   ❌  DB_ERROR            — Red card, technical error detail
 *   ❌  WORKER_NOT_FOUND    — Red card, recognition failure message
 *
 * Design system (uiux-designer skill output):
 *   Style    : Professional + Trustworthy (security / biometric context)
 *   Colors   : Trust Blue #3B82F6, Green #22C55E, Amber #F59E0B, Red #EF4444
 *   Font     : System (Inter equivalent on Android)
 *   Palette  : Dark HUD — consistent with Phases 2–4
 *   Animation: Scale-in on mount (150–300ms), reduced-motion respected
 *   A11y     : accessibilityLiveRegion, color not sole indicator, SVG icons
 *
 * Architecture (mobile-developer skill — feature-based module):
 *   Stateless display component — all data comes from props.
 *   No internal async calls; parent drives state via AttendanceStateMachine.
 */

import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import {
  formatAttendanceTime,
  formatAttendanceDate,
} from './AttendanceValidator';
import type { AttendanceRejectionReason } from './AttendanceService';
import type { Attendance } from '../database/models';

// ---------------------------------------------------------------------------
// Design Tokens — Dark HUD (consistent with Phases 2–4)
// ---------------------------------------------------------------------------

const COLORS = {
  background: '#0F172A',          // Slate-900
  surface: 'rgba(30,41,59,0.95)', // Slate-800 translucent
  success: '#22C55E',             // Green-500
  successBg: 'rgba(34,197,94,0.12)',
  successBorder: 'rgba(34,197,94,0.35)',
  warning: '#F59E0B',             // Amber-500
  warningBg: 'rgba(245,158,11,0.12)',
  warningBorder: 'rgba(245,158,11,0.35)',
  error: '#EF4444',               // Red-500
  errorBg: 'rgba(239,68,68,0.12)',
  errorBorder: 'rgba(239,68,68,0.35)',
  primary: '#3B82F6',             // Trust Blue
  textPrimary: '#F1F5F9',         // Slate-100
  textMuted: '#94A3B8',           // Slate-400
  textDim: '#64748B',             // Slate-500
  divider: 'rgba(148,163,184,0.15)',
} as const;

// ---------------------------------------------------------------------------
// SVG Icons (uiux-designer: no emojis — use SVG)
// ---------------------------------------------------------------------------

/** Checkmark circle icon for success state */
const CheckIcon: React.FC<{ size?: number; color: string }> = ({
  size = 64,
  color,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" />
    <Polyline
      points="8,12 11,15 16,9"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** Warning triangle icon for lockout / rejection states */
const WarningIcon: React.FC<{ size?: number; color: string }> = ({
  size = 64,
  color,
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M12 9v4M12 17h.01"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

/** User identification icon in the header */
const UserIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path
      d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <Circle cx="12" cy="7" r="4" stroke={color} strokeWidth="1.5" />
  </Svg>
);

/** Clock icon for timestamps */
const ClockIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" />
    <Path
      d="M12 6v6l4 2"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </Svg>
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AttendanceSuccessScreenProps {
  /** Flow outcome state */
  state: 'ATTENDANCE_SUCCESS' | 'ATTENDANCE_REJECTED';

  /** Worker display name */
  workerName: string;

  /** The created attendance record (non-null on SUCCESS) */
  attendanceRecord: Attendance | null;

  /** Rejection reason (non-null on REJECTED) */
  rejectionReason: AttendanceRejectionReason | null;

  /** Human-readable rejection message */
  rejectionMessage: string | null;

  /**
   * Called when the user taps "Scan Next Worker" / "Try Again".
   * Parent should reset the FSM and navigate back to the camera screen.
   */
  onDismiss: () => void;

  /** Confidence score from recognition (0–1, shown as %) */
  confidence?: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * AttendanceSuccessScreen — full-screen result card after attendance marking.
 *
 * Rendered by the parent screen when AttendanceStateMachine reaches
 * ATTENDANCE_SUCCESS or ATTENDANCE_REJECTED.
 */
const AttendanceSuccessScreen: React.FC<AttendanceSuccessScreenProps> = ({
  state,
  workerName,
  attendanceRecord,
  rejectionReason,
  rejectionMessage,
  onDismiss,
  confidence,
}) => {
  const isSuccess = state === 'ATTENDANCE_SUCCESS';
  const isLockout = rejectionReason === 'RECENT_ATTENDANCE';

  // ── Colour palette for current outcome ────────────────────────────────────
  const accent = isSuccess
    ? COLORS.success
    : isLockout
    ? COLORS.warning
    : COLORS.error;

  const accentBg = isSuccess
    ? COLORS.successBg
    : isLockout
    ? COLORS.warningBg
    : COLORS.errorBg;

  const accentBorder = isSuccess
    ? COLORS.successBorder
    : isLockout
    ? COLORS.warningBorder
    : COLORS.errorBorder;

  // ── Mount animation — scale-in (uiux-designer: 150–300ms) ─────────────────
  const cardScale = useRef(new Animated.Value(0.88)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let reducedMotion = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reducedMotion = v;
      if (!reducedMotion) {
        Animated.parallel([
          Animated.spring(cardScale, {
            toValue: 1,
            tension: 80,
            friction: 9,
            useNativeDriver: true,
          }),
          Animated.timing(cardOpacity, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        cardScale.setValue(1);
        cardOpacity.setValue(1);
      }
    });
  }, [cardOpacity, cardScale]);

  // ── Derived display strings ────────────────────────────────────────────────
  const timestamp = attendanceRecord?.timestamp ?? Date.now();
  const timeString = formatAttendanceTime(timestamp);
  const dateString = formatAttendanceDate(timestamp);
  const confidencePercent =
    confidence != null ? `${(confidence * 100).toFixed(1)}%` : null;

  const headingText = isSuccess
    ? 'Attendance Marked'
    : isLockout
    ? 'Already Marked'
    : 'Not Recognised';

  const subText = isSuccess
    ? 'Attendance recorded successfully'
    : isLockout
    ? (rejectionMessage ?? 'Attendance already exists for this period')
    : (rejectionMessage ?? 'Could not record attendance. Please try again.');

  const buttonLabel = isSuccess ? 'Scan Next Worker' : 'Try Again';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen}>
      {/* ── Animated card ──────────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.card,
          { borderColor: accentBorder, backgroundColor: accentBg },
          { transform: [{ scale: cardScale }], opacity: cardOpacity },
        ]}
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
        accessibilityLabel={`${headingText}. ${subText}`}
      >
        {/* ── Icon circle ──────────────────────────────────────────────────── */}
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: accentBg, borderColor: accentBorder },
          ]}
          accessibilityElementsHidden
        >
          {isSuccess ? (
            <CheckIcon size={56} color={accent} />
          ) : (
            <WarningIcon size={52} color={accent} />
          )}
        </View>

        {/* ── Heading ──────────────────────────────────────────────────────── */}
        <Text style={[styles.heading, { color: accent }]}>{headingText}</Text>
        <Text style={styles.subText}>{subText}</Text>

        {/* ── Divider ──────────────────────────────────────────────────────── */}
        <View style={styles.divider} />

        {/* ── Worker info row ──────────────────────────────────────────────── */}
        <View style={styles.infoRow}>
          <UserIcon color={COLORS.textMuted} />
          <View style={styles.infoText}>
            <Text style={styles.infoLabel}>Worker</Text>
            <Text style={styles.infoValue}>{workerName}</Text>
          </View>
          {confidencePercent && (
            <View style={[styles.confidenceBadge, { borderColor: accentBorder }]}>
              <Text style={[styles.confidenceText, { color: accent }]}>
                {confidencePercent}
              </Text>
            </View>
          )}
        </View>

        {/* ── Timestamp row (success only) ─────────────────────────────────── */}
        {isSuccess && attendanceRecord && (
          <View style={styles.infoRow}>
            <ClockIcon color={COLORS.textMuted} />
            <View style={styles.infoText}>
              <Text style={styles.infoLabel}>{dateString}</Text>
              <Text style={styles.infoValue}>{timeString}</Text>
            </View>
          </View>
        )}

        {/* ── Attendance ID (success, small — for audit trail) ─────────────── */}
        {isSuccess && attendanceRecord && (
          <Text style={styles.attendanceId} numberOfLines={1} ellipsizeMode="middle">
            ID: {attendanceRecord.attendance_id}
          </Text>
        )}

        {/* ── Sync badge ───────────────────────────────────────────────────── */}
        {isSuccess && (
          <View style={styles.syncBadge}>
            <View style={styles.syncDot} />
            <Text style={styles.syncText}>Saved · Pending sync</Text>
          </View>
        )}
      </Animated.View>

      {/* ── Action button ──────────────────────────────────────────────────── */}
      <Pressable
        style={({ pressed }) => [
          styles.actionButton,
          { borderColor: accentBorder },
          pressed && styles.actionButtonPressed,
        ]}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={buttonLabel}
      >
        <Text style={[styles.actionButtonText, { color: accent }]}>
          {buttonLabel}
        </Text>
      </Pressable>

      {/* ── Bottom branding ──────────────────────────────────────────────────── */}
      <Text style={styles.brandText}>NetraSetu · Offline Attendance</Text>
    </SafeAreaView>
  );
};

// ---------------------------------------------------------------------------
// Styles — Dark HUD theme (uiux-designer: Professional + Trustworthy)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },

  // ── Card ─────────────────────────────────────────────────────────────────
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: 'center',
    // Android elevation for depth
    ...Platform.select({
      android: { elevation: 8 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
      },
    }),
  },

  // ── Icon ─────────────────────────────────────────────────────────────────
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  // ── Typography ────────────────────────────────────────────────────────────
  heading: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: 'System',
  },

  subText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 21,  // uiux-designer: 1.5 line-height for body text
    paddingHorizontal: 8,
    fontFamily: 'System',
  },

  // ── Divider ───────────────────────────────────────────────────────────────
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: COLORS.divider,
    marginVertical: 24,
  },

  // ── Info rows ──────────────────────────────────────────────────────────────
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 12,
    marginBottom: 16,
  },

  infoText: {
    flex: 1,
  },

  infoLabel: {
    fontSize: 11,
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontFamily: 'System',
    marginBottom: 2,
  },

  infoValue: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.textPrimary,
    fontFamily: 'System',
  },

  // ── Confidence badge ───────────────────────────────────────────────────────
  confidenceBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  confidenceText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'System',
  },

  // ── Audit ID ───────────────────────────────────────────────────────────────
  attendanceId: {
    width: '100%',
    fontSize: 10,
    color: COLORS.textDim,
    fontFamily: 'System',
    letterSpacing: 0.3,
    marginTop: -8,
    marginBottom: 12,
    textAlign: 'left',
  },

  // ── Sync badge ─────────────────────────────────────────────────────────────
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(148,163,184,0.10)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 4,
  },

  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.textDim,
  },

  syncText: {
    fontSize: 11,
    color: COLORS.textDim,
    fontFamily: 'System',
  },

  // ── Action button ─────────────────────────────────────────────────────────
  actionButton: {
    marginTop: 28,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 16, // ≥ 44px touch target
    alignItems: 'center',
    backgroundColor: 'transparent',
  },

  actionButtonPressed: {
    opacity: 0.65, // uiux-designer: hover/press feedback
  },

  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'System',
    letterSpacing: 0.3,
  },

  // ── Branding ──────────────────────────────────────────────────────────────
  brandText: {
    marginTop: 24,
    fontSize: 11,
    color: COLORS.textDim,
    letterSpacing: 0.5,
    fontFamily: 'System',
  },
});

export default AttendanceSuccessScreen;
