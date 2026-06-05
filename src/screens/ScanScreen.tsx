/**
 * @file ScanScreen.tsx
 * @description Navigation wrapper for the primary scanning flow.
 *
 * This screen mounts LivenessScreen — which itself contains:
 *   Phase 2: Camera preview + face detection
 *   Phase 3: Blink liveness challenge
 *   Phase 4: Face recognition (GhostFaceNet)
 *   Phase 5: Attendance marking
 *   Phase 6: Hindi voice guidance
 *
 * After liveness is verified, recognition and attendance marking flow are
 * handled internally by LivenessScreen + AttendanceStateMachine.
 *
 * The onLivenessVerified callback is a no-op here because the attendance
 * flow is wired directly inside LivenessScreen in Phase 4/5.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import LivenessScreen from '../liveness/LivenessScreen';

export default function ScanScreen() {
  return (
    <View style={styles.container}>
      <LivenessScreen
        onLivenessVerified={() => {
          // LivenessScreen handles recognition + attendance internally.
          // This callback fires after LIVENESS_VERIFIED but before Phase 4
          // recognition runs — kept as a hook for future analytics.
          console.log('[ScanScreen] Liveness verified — recognition in progress.');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
