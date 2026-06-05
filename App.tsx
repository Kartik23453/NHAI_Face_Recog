/**
 * @file App.tsx
 * @description Root application component for NetraSetu.
 *
 * Responsibilities:
 *   1. Initialize the SQLite database on first launch.
 *   2. Initialize the GhostFaceNet TFLite model.
 *   3. Configure React Navigation with a Bottom Tab navigator.
 *   4. Wire existing screen modules to their navigation routes.
 *   5. Show a boot splash screen while initialization is running.
 *
 * Navigation structure:
 *   BottomTabs
 *   ├── Scan       → LivenessScreen (camera + liveness + recognition + attendance)
 *   ├── Sync       → SyncScreen (SyncStatusCard)
 *   └── Settings   → SettingsScreen (VoiceSettings)
 *
 * Architecture note:
 *   App.tsx owns the initialization lifecycle only.
 *   All business logic lives in the feature modules under src/.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

import { getDatabase } from './src/database/database';
import * as FaceRecognitionService from './src/recognition/FaceRecognitionService';

// ── Screen imports ─────────────────────────────────────────────────────────
import ScanScreen from './src/screens/ScanScreen';
import SyncScreen from './src/screens/SyncScreen';
import SettingsScreen from './src/screens/SettingsScreen';

// ---------------------------------------------------------------------------
// Design tokens — matches dark HUD theme used across all feature screens
// ---------------------------------------------------------------------------

const COLORS = {
  background: '#0F172A',   // Slate-900
  surface: '#1E293B',      // Slate-800
  primary: '#3B82F6',      // Trust Blue
  success: '#22C55E',      // Green
  error: '#EF4444',        // Red
  textPrimary: '#F1F5F9',  // Slate-100
  textMuted: '#94A3B8',    // Slate-400
  tabBar: '#111827',       // Slightly deeper than surface
  tabBorder: 'rgba(255,255,255,0.07)',
  tabActive: '#3B82F6',
  tabInactive: '#475569',  // Slate-600
} as const;

// ---------------------------------------------------------------------------
// Tab Navigator
// ---------------------------------------------------------------------------

const Tab = createBottomTabNavigator();

// ---------------------------------------------------------------------------
// Tab bar icons (SVG — no emojis, per uiux-designer rule)
// ---------------------------------------------------------------------------

function ScanIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="10" r="4" stroke={color} strokeWidth="1.5" />
      <Path
        d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Scan lines */}
      <Path
        d="M2 7V4h3M22 7V4h-3M2 17v3h3M22 17v3h-3"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function SyncIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M23 4v6h-6"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M1 20v-6h6"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SettingsIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" />
      <Path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke={color}
        strokeWidth="1.5"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Boot splash — shown while DB + model are initializing
// ---------------------------------------------------------------------------

type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

function BootSplash({ state }: { state: BootState }) {
  return (
    <View style={bootStyles.container}>
      {/* Logo mark */}
      <View style={bootStyles.logoMark}>
        <Svg width={64} height={64} viewBox="0 0 64 64" fill="none">
          <Rect width={64} height={64} rx={16} fill="rgba(59,130,246,0.15)" />
          <Circle cx={32} cy={26} r={10} stroke={COLORS.primary} strokeWidth={2} />
          <Path
            d="M12 52c0-11 9-18 20-18s20 7 20 18"
            stroke={COLORS.primary}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      </View>

      <Text style={bootStyles.appName}>NetraSetu</Text>
      <Text style={bootStyles.tagline}>Offline Attendance System</Text>

      {state.status === 'loading' && (
        <View style={bootStyles.loadingRow}>
          <ActivityIndicator color={COLORS.primary} size="small" />
          <Text style={bootStyles.loadingText}>Initialising…</Text>
        </View>
      )}

      {state.status === 'error' && (
        <View style={bootStyles.errorBox}>
          <Text style={bootStyles.errorTitle}>Startup Failed</Text>
          <Text style={bootStyles.errorMessage}>{state.message}</Text>
        </View>
      )}

      <Text style={bootStyles.brand}>NHAI · नेत्र सेतु</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Root App component
// ---------------------------------------------------------------------------

export default function App() {
  const [bootState, setBootState] = useState<BootState>({ status: 'loading' });
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      try {
        // Step 1 — Open SQLite database and run schema migrations
        console.log('[App] Initialising database…');
        await getDatabase();
        console.log('[App] Database ready.');

        // Step 2 — Load TFLite model (non-blocking if it fails)
        console.log('[App] Loading face recognition model…');
        await FaceRecognitionService.initialize();

        const modelState = FaceRecognitionService.getServiceState();
        if (modelState.status !== 'ready') {
          // Model load is non-fatal at this stage — LivenessScreen will
          // check the model state before attempting recognition.
          console.warn(
            '[App] Face recognition model not ready:',
            modelState.errorMessage,
          );
        }

        setBootState({ status: 'ready' });
        console.log('[App] Boot complete.');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown startup error';
        console.error('[App] Boot failed:', message);
        setBootState({ status: 'error', message });
      }
    })();
  }, []);

  // Show boot splash until ready
  if (bootState.status !== 'ready') {
    return (
      <SafeAreaProvider>
        <GestureHandlerRootView style={styles.flex}>
          <BootSplash state={bootState} />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.flex}>
        <NavigationContainer>
          <Tab.Navigator
            initialRouteName="Scan"
            screenOptions={{
              headerShown: false,
              tabBarStyle: styles.tabBar,
              tabBarActiveTintColor: COLORS.tabActive,
              tabBarInactiveTintColor: COLORS.tabInactive,
              tabBarLabelStyle: styles.tabLabel,
              tabBarItemStyle: styles.tabItem,
            }}
          >
            <Tab.Screen
              name="Scan"
              component={ScanScreen}
              options={{
                title: 'Scan',
                tabBarIcon: ({ color, size }) => (
                  <ScanIcon color={color} size={size} />
                ),
              }}
            />
            <Tab.Screen
              name="Sync"
              component={SyncScreen}
              options={{
                title: 'Sync',
                tabBarIcon: ({ color, size }) => (
                  <SyncIcon color={color} size={size} />
                ),
              }}
            />
            <Tab.Screen
              name="Settings"
              component={SettingsScreen}
              options={{
                title: 'Settings',
                tabBarIcon: ({ color, size }) => (
                  <SettingsIcon color={color} size={size} />
                ),
              }}
            />
          </Tab.Navigator>
        </NavigationContainer>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  tabBar: {
    backgroundColor: COLORS.tabBar,
    borderTopColor: COLORS.tabBorder,
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: 'System',
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  tabItem: {
    paddingVertical: 2,
  },
});

const bootStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoMark: {
    marginBottom: 24,
  },
  appName: {
    fontSize: 34,
    fontWeight: '800',
    color: COLORS.textPrimary,
    letterSpacing: 1,
    fontFamily: 'System',
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontFamily: 'System',
    letterSpacing: 0.5,
    marginBottom: 48,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontFamily: 'System',
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    padding: 20,
    width: '100%',
    alignItems: 'center',
  },
  errorTitle: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    fontFamily: 'System',
  },
  errorMessage: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: 'System',
  },
  brand: {
    position: 'absolute',
    bottom: 40,
    fontSize: 12,
    color: COLORS.tabInactive,
    letterSpacing: 0.5,
    fontFamily: 'System',
  },
});
