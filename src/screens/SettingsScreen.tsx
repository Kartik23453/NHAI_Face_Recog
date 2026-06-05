/**
 * @file SettingsScreen.tsx
 * @description Settings screen — voice guidance toggle and app metadata.
 *
 * Houses the VoiceSettings component from Phase 6.4.
 */

import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import VoiceSettings from '../voice/VoiceSettings';

const COLORS = {
  background: '#0F172A',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
  textDim: '#475569',
} as const;

export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          Manage voice guidance and application preferences.
        </Text>

        {/* Voice settings card — VoiceSettings already renders its own header */}
        <VoiceSettings />

        {/* App version footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>NetraSetu v1.0.0</Text>
          <Text style={styles.footerText}>NHAI · Offline Attendance System</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingTop: 32,
    paddingBottom: 48,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textPrimary,
    fontFamily: 'System',
    letterSpacing: 0.3,
    marginBottom: 8,
    paddingHorizontal: 24,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontFamily: 'System',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 24,
  },
  footer: {
    marginTop: 48,
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 12,
    color: COLORS.textDim,
    fontFamily: 'System',
    letterSpacing: 0.4,
  },
});
