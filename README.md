# NetraSetu
*Offline Facial Recognition & Liveness Detection | NHAI Field Attendance*

> “Most biometric systems are built for clean offices and fast Wi-Fi. We built NetraSetu for the chaos of NHAI highway construction. By compressing enterprise-grade AI to under 20 MB, bypassing traditional app bottlenecks, and replacing text with intuitive Hindi voice guidance, we deliver lightning-fast, 100% offline attendance for India’s most remote workers — all on a standard 3 GB RAM smartphone.”

## Overview
NetraSetu is a lightweight (<20 MB), completely offline React Native application designed for the National Highways Authority of India (NHAI). It performs facial recognition and liveness detection in under 1 second, syncing to AWS only when network connectivity is restored.

## Target Audience & UX Strategy (Zero-Literacy Design)
Field workers and supervisors cannot navigate complex menus or read error logs. The UX is built on Zero-Touch Operation and Primal Feedback:
- **Audio-First TTS**: No text warnings. Helmet detected: 🔊 “Kripya apna helmet hata lein.” Success: 🔊 “Rahul ki haaziri lag gayi.”
- **Blink Prompt**: On liveness stage, the screen shows a simple eye-icon animation and speaks “Palk jhapkayein” (blink). Auto-captures on confirmed blink.
- **Color-Coded Feedback**:
  - 🟩 **Solid Green + Ding**: Attendance logged.
  - 🟨 **Solid Yellow + Buzzer**: Environment issue (glare / dust).
  - 🟥 **Solid Red + Beep**: Spoofing detected or Twin Passback Lockout.
- **Auto-Capture**: No ‘Click to Scan’. Pipeline auto-triggers on face detection.

## Core Tech Stack
| Layer | Choice & Rationale |
| --- | --- |
| **Frontend UI** | React Native (Expo) — Android 8.0+ / iOS 12+. UI shell only; no JS in the hot path. |
| **Native Layer** | Kotlin (Android) + Swift (iOS) for camera & hardware. Heavy lifting moved out of JS. |
| **AI Inference** | TensorFlow Lite — W8A8 quantized GhostFaceNet (.tflite). On-device, fully offline. |
| **Camera Bridge** | C++ (JSI Frame Processor) — pre-capture CLAHE + EAR blink logic runs natively. |
| **Local DB** | SQLite — zero-dependency, ships natively, ~2 KB per worker. |
| **Cloud Sync** | AWS Amplify DataStore → AppSync → DynamoDB. Background sync on network restore. |

## AI Model Implementation (IDE-to-Edge Pipeline)
1. **Model Compression**: Open-source GhostFaceNet (~100MB FP32) compressed using W8A8 Post-Training Quantization (PTQ) to a <20MB `.tflite` file.
2. **Pre-processing Engine**: C++ JSI Frame processor runs CLAHE (Contrast Adaptive Histogram Equalization) and Luminosity gate to reject sun glare natively.
3. **Liveness Detection (v2.0)**:
   - **Primary Gate (EAR Blink Detection)**: Active challenge-response using Eye Aspect Ratio (EAR) calculated from GhostFaceNet’s landmark detector. EAR drops below 0.21 for 2-3 frames to confirm blink.
   - **Secondary Gate (Gyroscope)**: Bounding-box correlation against phone movement to prevent video-replay attacks.
4. **Native Architecture**: TFLite inference runs directly in the native stream via C++ JSI, bypassing the JS bridge for <1 second latency on mid-range devices.
5. **Vector Math & Edge Logic**: Cosine Similarity, Burst Mode (for occlusion), Dynamic Vector Averaging (to adapt to appearance changes), and Twin Passback Lockout.

## Database Design (Sync & Purge Architecture)
### Edge Database (SQLite) — 100% Offline
Storage footprint scales linearly (~20 MB for 10,000 workers).

| Field | Type | Purpose |
| --- | --- | --- |
| `worker_id` | String (UUID) | Primary key |
| `name` | String | Used for Hindi TTS confirmation |
| `face_vector` | Array[512] floats | Mathematical face map |
| `timestamp_log` | Unix Epoch | Anti-Passback Twin Lockout |
| `sync_status` | Boolean | False while offline |
| `is_medical_alias` | Boolean | True for bandaged-face temp registration |

### AWS Sync & Purge Flow
- **Queue**: Attendance logged locally with `sync_status = false`.
- **Restore**: Background task detects 4G/Wi-Fi and pushes queue to DynamoDB via AppSync.
- **Purge**: On successful sync (200 OK), app deletes local `timestamp_log` entries to ensure data privacy and clear storage.

## Project Structure
- `src/attendance`: Attendance logging and syncing logic.
- `src/camera`: Vision camera frame processors and C++ JSI bridges.
- `src/database`: SQLite database schema and operations.
- `src/liveness`: EAR blink detection and gyroscope correlation logic.
- `src/recognition`: TFLite model initialization and inference (cosine similarity).
- `src/screens`: Main UI components (Scan, Sync, Settings).
- `src/voice`: TTS engine integration.

## Getting Started
To run the project locally:
```bash
# Install dependencies
npm install

# Start Metro Bundler
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios
```
