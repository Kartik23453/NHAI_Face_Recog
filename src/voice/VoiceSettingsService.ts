import AsyncStorage from '@react-native-async-storage/async-storage';

const VOICE_ENABLED_KEY = '@voice_enabled';

/**
 * Retrieves the current voice enabled setting from AsyncStorage.
 * Defaults to true if no setting is found or if storage fails.
 */
export async function getVoiceEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(VOICE_ENABLED_KEY);
    if (value === null) {
      return true; // Default
    }
    return value === 'true';
  } catch (error) {
    console.warn('[VoiceSettingsService] Failed to read voice setting, defaulting to true:', error);
    return true;
  }
}

/**
 * Sets and persists the voice enabled setting.
 */
export async function setVoiceEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(VOICE_ENABLED_KEY, enabled.toString());
  } catch (error) {
    console.warn('[VoiceSettingsService] Failed to save voice setting:', error);
  }
}

/**
 * Toggles the current voice enabled setting and returns the new value.
 */
export async function toggleVoiceEnabled(): Promise<boolean> {
  try {
    const current = await getVoiceEnabled();
    const next = !current;
    await setVoiceEnabled(next);
    return next;
  } catch (error) {
    console.warn('[VoiceSettingsService] Failed to toggle voice setting:', error);
    return true; // Fail-safe default
  }
}
