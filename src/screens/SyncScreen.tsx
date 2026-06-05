/**
 * @file SyncScreen.tsx
 * @description Sync status screen — displays the offline queue widget.
 *
 * Houses the SyncStatusCard component from Phase 7.3.
 * Shows pending record count and last sync timestamp.
 */

import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native';
import SyncStatusCard from '../sync/components/SyncStatusCard';

const COLORS = {
  background: '#0F172A',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
} as const;

export default function SyncScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Sync Status</Text>
        <Text style={styles.subtitle}>
          Attendance records pending upload to the cloud.
        </Text>

        <SyncStatusCard />
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
    padding: 24,
    paddingTop: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textPrimary,
    fontFamily: 'System',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontFamily: 'System',
    lineHeight: 20,
    marginBottom: 24,
  },
});
