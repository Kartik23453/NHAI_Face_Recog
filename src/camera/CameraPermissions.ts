/**
 * @file CameraPermissions.ts
 * @description Camera permission management for NetraSetu.
 *
 * Handles requesting and checking camera permissions using
 * react-native-vision-camera's built-in permission API.
 *
 * Platform note (mobile-developer skill):
 *   Android requires a runtime CAMERA permission request (API 23+).
 *   This module wraps the Vision Camera permission API to provide a
 *   clean, typed interface consumed by CameraScreen.tsx.
 */

import { Camera } from 'react-native-vision-camera';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All possible states of the camera permission */
export type CameraPermissionStatus =
  | 'granted'    // User has granted camera access
  | 'denied'     // User explicitly denied (may be redirected to Settings)
  | 'restricted' // Parental controls or MDM policy blocks access (iOS only)
  | 'not-determined'; // Permission has never been requested

export interface PermissionResult {
  /** Whether the app currently has active camera access */
  granted: boolean;
  /** The raw status string for conditional rendering */
  status: CameraPermissionStatus;
}

// ---------------------------------------------------------------------------
// Permission Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current camera permission status without triggering a prompt.
 * Use this to check status on mount before deciding whether to request.
 *
 * @returns Current PermissionResult
 */
export async function getCameraPermissionStatus(): Promise<PermissionResult> {
  const status = await Camera.getCameraPermissionStatus();
  return {
    granted: status === 'granted',
    status: status as CameraPermissionStatus,
  };
}

/**
 * Requests camera permission from the user.
 *
 * Behaviour:
 *   - If already granted: returns immediately without showing a dialog.
 *   - If not-determined: shows the system permission dialog.
 *   - If denied: on Android you can call this again to re-prompt (up to
 *     the system's limit); on iOS the user must go to Settings.
 *
 * @returns PermissionResult after the user responds (or immediately if cached)
 * @throws  If the underlying native call fails unexpectedly
 */
export async function requestCameraPermission(): Promise<PermissionResult> {
  try {
    const status = await Camera.requestCameraPermission();
    const granted = status === 'granted';

    if (!granted) {
      console.warn('[CameraPermissions] Camera permission not granted. Status:', status);
    } else {
      console.log('[CameraPermissions] Camera permission granted.');
    }

    return {
      granted,
      status: status as CameraPermissionStatus,
    };
  } catch (error) {
    console.error('[CameraPermissions] requestCameraPermission error:', error);
    throw new Error(
      `Failed to request camera permission: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Convenience function that checks current status and requests if needed.
 * This is the recommended single-call entry point for CameraScreen.
 *
 * Flow:
 *   1. Get current status.
 *   2. If already granted → return immediately.
 *   3. If not-determined → request and return result.
 *   4. If denied/restricted → return denied without prompting (user must
 *      visit Settings manually).
 *
 * @returns Final PermissionResult
 */
export async function ensureCameraPermission(): Promise<PermissionResult> {
  const current = await getCameraPermissionStatus();

  if (current.granted) {
    return current;
  }

  // Only prompt the system dialog for undetermined status
  if (current.status === 'not-determined') {
    return requestCameraPermission();
  }

  // denied or restricted — cannot prompt again automatically
  console.warn(
    '[CameraPermissions] Permission is',
    current.status,
    '— user must enable in device Settings.',
  );
  return current;
}
