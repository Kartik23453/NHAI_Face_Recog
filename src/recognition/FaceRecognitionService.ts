/**
 * @file FaceRecognitionService.ts
 * @description GhostFaceNet TFLite model singleton — load once, reuse interpreter.
 *
 * Responsibilities:
 *   1. Load the GhostFaceNet .tflite model from the app bundle on startup.
 *   2. Maintain a single TFLite interpreter for the app's lifetime.
 *   3. Expose generateEmbedding() to convert a preprocessed face tensor
 *      into a 512-dimensional L2-normalised embedding vector.
 *   4. Expose registerWorker() to store a newly generated embedding in SQLite.
 *
 * Performance (mobile-developer skill):
 *   - Model is loaded ONCE via initialize() — called from App startup.
 *   - Interpreter is reused across all calls — no re-init per recognition event.
 *   - generateEmbedding() is async but non-blocking (TFLite runs on its own thread).
 *   - Memory is explicitly released in dispose() for testing / hot-reload.
 *
 * TFLite integration uses `react-native-fast-tflite` which provides:
 *   - loadTensorflowModel() — loads model from bundle asset
 *   - model.run()          — synchronous inference
 *   - model.close()        — releases native memory
 *
 * Offline-first (mobile-developer skill):
 *   The model runs entirely on-device. No network call is ever made.
 *   Embeddings are stored in SQLite immediately after generation.
 */

import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { getAllWorkers, createWorker, updateWorker } from '../database/workerRepository';
import type { Worker } from '../database/models';
import {
  EMBEDDING_DIMENSION,
  MODEL_ASSET_PATH,
  MODEL_INPUT,
  type FaceEmbedding,
  type ServiceState,
} from './RecognitionTypes';
import { normaliseEmbedding, l2Norm } from './CosineSimilarity';
import { type PreprocessedFace } from './RecognitionTypes';

// ---------------------------------------------------------------------------
// Singleton State
// ---------------------------------------------------------------------------

/** The single TFLite model interpreter instance for this process */
let _model: TensorflowModel | null = null;

/** Current lifecycle state of the service */
let _serviceState: ServiceState = {
  status: 'uninitialized',
  errorMessage: null,
};

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Loads the GhostFaceNet TFLite model from the app bundle.
 *
 * Must be called ONCE during app startup (e.g. in App.tsx useEffect) before
 * any generateEmbedding() calls are made. Subsequent calls are no-ops if the
 * model is already loaded.
 *
 * Recommended startup pattern:
 *   await FaceRecognitionService.initialize();
 *
 * @throws Does NOT throw — errors are captured in the service state.
 *         Callers should check getServiceState().status === 'ready' before use.
 */
export async function initialize(): Promise<void> {
  // Idempotent — skip if already loaded
  if (_serviceState.status === 'ready' || _serviceState.status === 'loading') {
    return;
  }

  _serviceState = { status: 'loading', errorMessage: null };
  console.log('[FaceRecognitionService] Loading GhostFaceNet model…');

  try {
    // react-native-fast-tflite expects the model in:
    //   Android: android/app/src/main/assets/
    //   iOS:     Xcode bundle (Copy Bundle Resources)
    // Place ghostfacenet.tflite in android/app/src/main/assets/
    _model = await loadTensorflowModel(
      require('../../assets/models/ghostfacenet.tflite'),
    );

    _serviceState = { status: 'ready', errorMessage: null };
    console.log('[FaceRecognitionService] Model loaded successfully.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    _serviceState = { status: 'error', errorMessage: message };
    console.error('[FaceRecognitionService] Model load failed:', message);
    // Intentionally does not rethrow — callers check getServiceState()
  }
}

/**
 * Returns the current lifecycle state of the service.
 * Use this to gate UI actions (e.g. don't start recognition until 'ready').
 */
export function getServiceState(): ServiceState {
  return _serviceState;
}

/**
 * Releases the TFLite interpreter and resets the service to uninitialized.
 * Call this during testing teardown or app shutdown.
 */
export async function dispose(): Promise<void> {
  if (_model) {
    _model.close();
    _model = null;
    console.log('[FaceRecognitionService] Model disposed.');
  }
  _serviceState = { status: 'uninitialized', errorMessage: null };
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/**
 * Runs GhostFaceNet inference on a preprocessed 112×112 face crop and returns
 * a 512-dimensional L2-normalised embedding vector.
 *
 * The embedding is normalised after inference to guarantee unit magnitude,
 * enabling the dotProductSimilarity fast path in WorkerMatcher.
 *
 * @param face - Preprocessed face tensor from FacePreprocessor.preprocessFace()
 * @returns     512-dimensional embedding vector (L2-normalised)
 * @throws      If the model is not loaded or inference fails
 */
export async function generateEmbedding(face: PreprocessedFace): Promise<FaceEmbedding> {
  if (!_model || _serviceState.status !== 'ready') {
    throw new Error(
      '[FaceRecognitionService] Model not ready. Call initialize() first.',
    );
  }

  if (face.tensor.length !== MODEL_INPUT.tensorSize) {
    throw new Error(
      `[FaceRecognitionService] Tensor size mismatch: expected ${MODEL_INPUT.tensorSize}, got ${face.tensor.length}`,
    );
  }

  // react-native-fast-tflite model.run() accepts an array of input tensors
  // and returns an array of output tensors.
  // GhostFaceNet: 1 input [1, 112, 112, 3], 1 output [1, 512]
  const outputs = _model.run([face.tensor]);

  const rawOutput = outputs[0] as Float32Array;

  if (rawOutput.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `[FaceRecognitionService] Unexpected output dimension: ${rawOutput.length} (expected ${EMBEDDING_DIMENSION})`,
    );
  }

  // Convert to plain number array
  const rawEmbedding: number[] = Array.from(rawOutput);

  // L2-normalise — GhostFaceNet usually outputs unit vectors, but we normalise
  // explicitly to guard against any model variant that doesn't
  const norm = l2Norm(rawEmbedding);
  const embedding = norm > 1e-8 ? normaliseEmbedding(rawEmbedding) : rawEmbedding;

  console.log(
    `[FaceRecognitionService] Embedding generated. Norm: ${l2Norm(embedding).toFixed(6)}`,
  );

  return embedding;
}

// ---------------------------------------------------------------------------
// Worker Registration
// ---------------------------------------------------------------------------

/**
 * Generates a face embedding for the provided preprocessed face and stores it
 * against a worker record in SQLite.
 *
 * Supports two modes:
 *   1. NEW worker: pass `name` only — a new Worker row is created.
 *   2. EXISTING worker: pass `workerId` — the existing row's face_embedding
 *      is updated (re-enrollment).
 *
 * The embedding is serialised as JSON.stringify(number[]) before storage, which
 * matches the face_embedding TEXT column defined in Phase 1's schema.
 *
 * @param face       - Preprocessed 112×112 face tensor
 * @param name       - Worker display name (used when creating a new record)
 * @param workerId   - Existing worker_id (if re-enrolling; omit for new)
 * @returns           The upserted Worker record with the embedding stored
 * @throws            If embedding generation or database write fails
 */
export async function registerWorker(
  face: PreprocessedFace,
  name: string,
  workerId?: string,
): Promise<Worker> {
  const embedding = await generateEmbedding(face);
  const embeddingJson = JSON.stringify(embedding);

  if (workerId) {
    // Re-enrollment: update existing worker's embedding
    const updated = await updateWorker(workerId, {
      face_embedding: embeddingJson,
      sync_status: 0, // Mark as unsynced — Phase 5 will upload
    });
    console.log(
      '[FaceRecognitionService] Updated embedding for worker:',
      workerId,
    );
    return updated;
  } else {
    // New enrollment: create a worker record with the embedding
    const created = await createWorker({
      name: name.trim(),
      face_embedding: embeddingJson,
    });
    console.log(
      '[FaceRecognitionService] Registered new worker:',
      created.worker_id,
    );
    return created;
  }
}
