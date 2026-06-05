/**
 * @file RecognitionTypes.ts
 * @description Shared TypeScript types for the Phase 4 face recognition module.
 *
 * These types are the single source of truth for the recognition pipeline.
 * All other files in /src/recognition import from here rather than defining
 * their own local interfaces, ensuring zero duplication.
 *
 * Type discipline (frontend-expert skill):
 *   - No `any` types — every boundary is explicitly typed.
 *   - Input/Output types are separate from domain model types.
 *   - Readonly arrays used for embedding vectors to prevent accidental mutation.
 */

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * A 512-dimensional L2-normalised float vector produced by GhostFaceNet.
 * Stored as a plain JS number array for simplicity; computations are done
 * directly without allocating typed arrays on the critical path.
 *
 * Stored in SQLite as JSON.stringify(embedding) in the face_embedding column.
 */
export type FaceEmbedding = readonly number[];

/** Expected output dimension of the GhostFaceNet model */
export const EMBEDDING_DIMENSION = 512;

// ---------------------------------------------------------------------------
// TFLite model configuration
// ---------------------------------------------------------------------------

/**
 * GhostFaceNet input tensor specification.
 * The model expects a 112×112 RGB image, pixel values normalised to [-1, 1].
 */
export interface ModelInputSpec {
  /** Width of the expected input image */
  width: 112;
  /** Height of the expected input image */
  height: 112;
  /** Number of colour channels (RGB = 3) */
  channels: 3;
  /** Total number of float values in one input tensor */
  tensorSize: number; // 112 * 112 * 3 = 37632
}

export const MODEL_INPUT: ModelInputSpec = {
  width: 112,
  height: 112,
  channels: 3,
  tensorSize: 112 * 112 * 3,
} as const;

/** Asset path for the bundled GhostFaceNet .tflite model */
export const MODEL_ASSET_PATH = 'ghostfacenet.tflite';

// ---------------------------------------------------------------------------
// Recognition Decision
// ---------------------------------------------------------------------------

/** Minimum cosine similarity score to consider two embeddings a match */
export const RECOGNITION_THRESHOLD = 0.85;

/**
 * Result returned by WorkerMatcher.findBestMatch().
 *
 * Discriminated union pattern — callers check `matched` before accessing
 * `workerId` and `confidence`.
 */
export type RecognitionResult =
  | {
      matched: true;
      /** UUID of the worker whose stored embedding is the closest match */
      workerId: string;
      /** Display name of the matched worker (for immediate UI rendering) */
      workerName: string;
      /** Cosine similarity score [0, 1]. Values ≥ RECOGNITION_THRESHOLD = match */
      confidence: number;
    }
  | {
      matched: false;
    };

// ---------------------------------------------------------------------------
// Worker embedding cache entry
// ---------------------------------------------------------------------------

/**
 * In-memory representation of a worker whose embedding has been loaded and
 * parsed from SQLite. Kept separate from the DB `Worker` type so the
 * recognition layer doesn't import the database layer.
 *
 * (Offline-first: cache loaded once from SQLite, matched entirely in-process.)
 */
export interface WorkerEmbeddingEntry {
  worker_id: string;
  name: string;
  /** Parsed embedding vector (deserialized from JSON string in SQLite) */
  embedding: FaceEmbedding;
}

// ---------------------------------------------------------------------------
// Preprocessing output
// ---------------------------------------------------------------------------

/**
 * Output of FacePreprocessor.preprocessFace().
 * A flat Float32Array ready to be written directly into the TFLite input tensor.
 */
export interface PreprocessedFace {
  /**
   * Float32 pixel values in HWC order (Height × Width × Channels).
   * Shape: [112, 112, 3], values in [-1.0, 1.0].
   */
  tensor: Float32Array;
  /** Width that the face was resized to (always 112) */
  width: number;
  /** Height that the face was resized to (always 112) */
  height: number;
}

// ---------------------------------------------------------------------------
// Service status
// ---------------------------------------------------------------------------

/** Lifecycle status of the FaceRecognitionService */
export type ServiceStatus =
  | 'uninitialized'  // Model not yet loaded
  | 'loading'        // Model load in progress
  | 'ready'          // Model loaded, interpreter live
  | 'error';         // Model failed to load

export interface ServiceState {
  status: ServiceStatus;
  /** Non-null when status === 'error' */
  errorMessage: string | null;
}
