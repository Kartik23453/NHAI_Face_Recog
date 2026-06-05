import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Pressable } from 'react-native';
import { getQueueStats, type QueueStats } from '../SyncQueueService';
import { getSyncedAttendance } from '../../database/attendanceRepository';

const COLORS = {
  background: '#0F172A',
  card: '#1E293B',
  primary: '#3B82F6',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
  statusGreen: '#22C55E',
  statusYellow: '#EAB308',
  statusRed: '#EF4444',
  border: 'rgba(255,255,255,0.08)',
};

export default function SyncStatusCard() {
  const [loading, setLoading] = useState<boolean>(true);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const queueStats = await getQueueStats();
      setStats(queueStats);

      // Fetch the single most recent synced record to determine "Last Sync" time
      const synced = await getSyncedAttendance(1);
      if (synced && synced.length > 0) {
        setLastSyncTime(synced[0].timestamp);
      } else {
        setLastSyncTime(null);
      }
    } catch (error) {
      console.error('[SyncStatusCard] Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const getStatusColor = (count: number) => {
    if (count === 0) return COLORS.statusGreen;
    if (count <= 50) return COLORS.statusYellow;
    return COLORS.statusRed;
  };

  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  };

  if (loading && !stats) {
    return (
      <View style={[styles.card, styles.centerContent]}>
        <ActivityIndicator color={COLORS.primary} size="small" />
        <Text style={styles.loadingText}>Loading queue information...</Text>
      </View>
    );
  }

  const pendingCount = stats?.pendingCount ?? 0;
  const statusColor = getStatusColor(pendingCount);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Offline Queue</Text>
        <View style={[styles.badge, { backgroundColor: statusColor }]} />
      </View>

      <View style={styles.content}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Pending Sync</Text>
          <Text style={styles.statValue}>
            {pendingCount === 0 ? 'All records synced' : pendingCount}
          </Text>
        </View>

        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Last Sync</Text>
          <Text style={styles.statValue}>
            {lastSyncTime ? formatTimeAgo(lastSyncTime) : 'Never Synced'}
          </Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={fetchStats}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Refresh queue statistics"
      >
        <Text style={styles.buttonText}>{loading ? 'Refreshing...' : 'Refresh'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 180,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 12,
    fontSize: 14,
    fontFamily: 'System',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'System',
    letterSpacing: 0.5,
  },
  badge: {
    width: 12,
    height: 12,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  content: {
    gap: 16,
    marginBottom: 24,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 15,
    fontFamily: 'System',
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'System',
  },
  button: {
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
  },
  buttonPressed: {
    opacity: 0.7,
    backgroundColor: 'rgba(59,130,246,0.25)',
  },
  buttonText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'System',
  },
});
