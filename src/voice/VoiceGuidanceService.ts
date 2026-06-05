/**
 * @file VoiceGuidanceService.ts
 * @description Voice guidance service for NetraSetu using Expo Speech.
 *
 * This service provides the foundation for an audio-first user experience,
 * speaking Hindi prompts to assist workers with minimal digital literacy.
 *
 * Key features:
 *   - Uses `expo-speech` for native TTS.
 *   - Configured for Hindi ('hi-IN') with optimized rate and pitch.
 *   - Prevents overlapping speech by stopping any ongoing utterance before
 *     starting a new one.
 *   - Fully asynchronous, promise-based API with error handling.
 */

import * as Speech from 'expo-speech';
import { getVoiceEnabled } from './VoiceSettingsService';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Standard Hindi language code for India */
const HINDI_LANGUAGE_CODE = 'hi-IN';

/** Slightly slower rate (default is 1.0) ensures clearer pronunciation for workers */
const SPEECH_RATE = 0.9;

/** Standard pitch */
const SPEECH_PITCH = 1.0;

// ---------------------------------------------------------------------------
// Core Voice Functions
// ---------------------------------------------------------------------------

/**
 * Speaks the provided text in Hindi.
 *
 * If the device is already speaking, this function stops the current speech
 * immediately before starting the new one. This prevents overlapping audio
 * (e.g., if multiple recognition frames trigger consecutive prompts).
 *
 * @param text - The Hindi text to speak (e.g., "Palk jhapkayein")
 * @returns    A promise that resolves when the TTS engine is instructed to speak.
 */
export async function speak(text: string): Promise<void> {
  try {
    const isVoiceEnabled = await getVoiceEnabled();
    if (!isVoiceEnabled) {
      return;
    }

    const currentlySpeaking = await isSpeaking();

    // Prevent overlapping speech
    if (currentlySpeaking) {
      await stop();
    }

    console.log(`[VoiceGuidanceService] Speaking: "${text}"`);

    Speech.speak(text, {
      language: HINDI_LANGUAGE_CODE,
      rate: SPEECH_RATE,
      pitch: SPEECH_PITCH,
      onStart: () => console.log('[VoiceGuidanceService] Speech started'),
      onDone: () => console.log('[VoiceGuidanceService] Speech finished'),
      onError: (error: Error | string) => {
        console.error('[VoiceGuidanceService] Speech error:', error);
      },
    });
  } catch (error) {
    console.error('[VoiceGuidanceService] Failed to speak:', error);
  }
}

/**
 * Stops any currently ongoing speech.
 *
 * @returns A promise that resolves when the speech has been successfully stopped.
 */
export async function stop(): Promise<void> {
  try {
    await Speech.stop();
    console.log('[VoiceGuidanceService] Speech stopped');
  } catch (error) {
    console.error('[VoiceGuidanceService] Failed to stop speech:', error);
  }
}

/**
 * Checks whether the device is currently speaking an utterance.
 *
 * @returns A promise that resolves to true if the TTS engine is active, false otherwise.
 */
export async function isSpeaking(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync();
  } catch (error) {
    console.error('[VoiceGuidanceService] Failed to check speaking status:', error);
    // Fail-safe: assume not speaking if the query fails, to avoid deadlocking the audio queue
    return false;
  }
}
