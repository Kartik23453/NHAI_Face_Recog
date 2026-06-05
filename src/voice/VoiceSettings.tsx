import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View, ActivityIndicator } from 'react-native';
import { getVoiceEnabled, setVoiceEnabled } from './VoiceSettingsService';

const COLORS = {
  background: '#0F172A',
  card: '#1E293B',
  primary: '#3B82F6',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
};

export default function VoiceSettings() {
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    // Load initial setting on mount
    getVoiceEnabled().then(setIsEnabled);
  }, []);

  const handleToggle = async (value: boolean) => {
    // Update local state instantly for responsive UI
    setIsEnabled(value);
    
    // Persist to storage in the background
    await setVoiceEnabled(value);
  };

  if (isEnabled === null) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Settings</Text>
      
      <View style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.title}>Voice Guidance</Text>
            <Text style={styles.description}>
              {isEnabled ? 'Hindi voice prompts are ON' : 'Voice prompts are OFF'}
            </Text>
          </View>
          
          <Switch
            trackColor={{ false: '#334155', true: '#3B82F6' }}
            thumbColor={isEnabled ? '#FFFFFF' : '#94A3B8'}
            ios_backgroundColor="#334155"
            onValueChange={handleToggle}
            value={isEnabled}
            accessibilityRole="switch"
            accessibilityLabel="Toggle voice guidance"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    backgroundColor: COLORS.background,
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 20,
    fontFamily: 'System',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingInfo: {
    flex: 1,
    paddingRight: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    fontFamily: 'System',
  },
  description: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontFamily: 'System',
    lineHeight: 20,
  },
});
