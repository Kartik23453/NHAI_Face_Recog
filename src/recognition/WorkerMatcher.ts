/**
 * @file WorkerMatcher.ts
 * @description Offline face-matching engine for NetraSetu Phase 4.
 *
 * WorkerMatcher is the final step in the recognition pipeline:
 *   1. Load all enrolled workers from SQLite (once, then cached in memory).
 *   2. For a live face embedding, compute cosine similarity against every entry.
 *   3. Return the best match if similarity ≥ RECOGNITION_THRESHOLD.
 *
 * Architecture (mobile-developer skill — offline-first):
 *   The worker embedding cache is loaded from SQLite into memory on first call
 *   (or explicitly via loadWorkerCache()). All matching happens in JS with no
 *   network calls — fully air-gapped operation.
 *
 * Performance:
 *   - O(N) scan per recognition event (N = number of enrolled workers).
 *   - Uses dotProductSimilarity (fast path) since GhostFaceNet outputs
 *     L2-normalised embeddings — skips magnitude computation per pair.
 *   - Cache is invalidated and reloaded after registerWorker() calls so new
 *     enrollments are reflected immediately.
 *
 * TypeScript discipline (frontend-expert skill):
 *   - No `any` — all worker data is typed via WorkerEmbeddingEntry.
 *   - Explicit return types on every exported function.
 *   - JSON.parse errors caught and logged per-worker without crashing.
 */

import { getAllWorkers } from '../database/workerRepository';
import { dotProductSimilarity, normaliseEmbedding, l2Norm } from './CosineSimilarity';
import { generateEmbedding } from './FaceRecognitionService';
import {
  RECOGNITION_THRESHOLD,
  type FaceEmbedding,
  type PreprocessedFace,
  type RecognitionResult,
  type WorkerEmbeddingEntry,
} from './RecognitionTypes';

// ---------------------------------------------------------------------------
// In-Memory Cache
// ---------------------------------------------------------------------------

/**
 * In-memory cache of workers whose face_embedding has been parsed.
 * Workers with an empty or invalid embedding are excluded.
 *
 * Populated by loadWorkerCache() — call this on app start and after
 * every registerWorker() to keep it fresh.
 */
let _workerCache: WorkerEmbeddingEntry[] = [];

/** Whether the cache has been populated at least once */
let _cacheLoaded = false;

// ---------------------------------------------------------------------------
// Cache Management
// ---------------------------------------------------------------------------

/**
 * Loads all enrolled workers from SQLite and parses their face embeddings
 * into the in-memory cache.
 *
 * Should be called:
 *   1. On app startup (after FaceRecognitionService.initialize()).
 *   2. After any registerWorker() call to reflect new enrollments.
 *
 * Workers without a valid embedding (empty string or malformed JSON) are
 * silently skipped so one bad record can't block all recognition.
 *
 * @returns Number of workers successfully loaded into the cache
 */
export async function loadWorkerCache(): Promise<number> {
  console.log('[WorkerMatcher] Loading worker embeddings from SQLite…');

  try {
    const workers = await getAllWorkers();
    const cache: WorkerEmbeddingEntry[] = [];

    for (const worker of workers) {
      // Skip unenrolled workers (face_embedding is '' until enrolled)
      if (!worker.face_embedding || worker.face_embedding.trim() === '') {
        continue;
      }

      let embedding: number[];

      try {
        embedding = JSON.parse(worker.face_embedding) as number[];
      } catch {
        console.warn(
          '[WorkerMatcher] Failed to parse embedding for worker',
          worker.worker_id,
          '— skipping',
        );
        continue;
      }

      if (!Array.isArray(embedding) || embedding.length === 0) {
        console.warn(
          '[WorkerMatcher] Invalid embedding array for worker',
          worker.worker_id,
          '— skipping',
        );
        continue;
      }

      // Normalise stored embeddings in case they were written without unit norm
      const norm = l2Norm(embedding);
      const normalisedEmbedding = norm > 1 + 1e-4 || norm < 1 - 1e-4
        ? normaliseEmbedding(embedding)
        : embedding;

      cache.push({
        worker_id: worker.worker_id,
        name: worker.name,
        embedding: normalisedEmbedding,
      });
    }

    _workerCache = cache;
    _cacheLoaded = true;

    console.log(
      `[WorkerMatcher] Cache loaded: ${cache.length} enrolled worker(s)`,
    );
    return cache.length;
  } catch (error) {
    console.error('[WorkerMatcher] Failed to load worker cache:', error);
    throw new Error(
      `Worker cache load failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Returns the current cache size. Use to check if any workers are enrolled
 * before attempting recognition.
 */
export function getCachedWorkerCount(): number {
  return _workerCache.length;
}

/**
 * Invalidates the in-memory cache. The next findBestMatch() call will
 * automatically reload from SQLite if auto-reload is desired.
 * Primarily used in tests.
 */
export function invalidateCache(): void {
  _workerCache = [];
  _cacheLoaded = false;
}

// ---------------------------------------------------------------------------
// Core Matching
// ---------------------------------------------------------------------------

/**
 * Compares a live face embedding against all cached worker embeddings and
 * returns the best match if it exceeds RECOGNITION_THRESHOLD.
 *
 * Algorithm: linear scan with dot-product similarity (O(N × D) where
 * D = embedding dimension = 512).
 *
 * For N < 10,000 workers this runs in well under 1ms on a modern Android device.
 * For larger deployments a KD-tree or HNSW index should be used instead.
 *
 * @param liveEmbedding - L2-normalised embedding from generateEmbedding()
 * @returns              RecognitionResult (discriminated union)
 */
export function matchEmbedding(liveEmbedding: FaceEmbedding): RecognitionResult {
  if (_workerCache.length === 0) {
    console.warn('[WorkerMatcher] No enrolled workers in cache — no match possible');
    return { matched: false };
  }

  let bestScore = -1;
  let bestEntry: WorkerEmbeddingEntry | null = null;

  // Linear scan — fast for N < 10,000; replace with ANN index for larger fleets
  for (const entry of _workerCache) {
    // dotProductSimilarity is the fast path for unit-normalised embeddings
    const score = dotProductSimilarity(liveEmbedding, entry.embedding);

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry === null || bestScore < RECOGNITION_THRESHOLD) {
    console.log(
      `[WorkerMatcher] No match. Best score: ${bestScore.toFixed(4)} < threshold ${RECOGNITION_THRESHOLD}`,
    );
    return { matched: false };
  }

  console.log(
    `[WorkerMatcher] Match found: ${bestEntry.name} (${bestEntry.worker_id}), confidence: ${bestScore.toFixed(4)}`,
  );

  return {
    matched: true,
    workerId: bestEntry.worker_id,
    workerName: bestEntry.name,
    confidence: bestScore,
  };
}

// ---------------------------------------------------------------------------
// Full Recognition Pipeline
// ---------------------------------------------------------------------------

/**
 * End-to-end recognition pipeline: preprocessed face → RecognitionResult.
 *
 * Sequence:
 *   1. Ensure worker cache is loaded (auto-loads if not yet populated).
 *   2. Generate GhostFaceNet embedding from the preprocessed face tensor.
 *   3. Match the embedding against all cached workers.
 *   4. Return the recognition decision.
 *
 * This is the primary entry point called by the UI after liveness verification.
 *
 * @param face - Preprocessed face tensor from FacePreprocessor.preprocessFace()
 * @returns     RecognitionResult — caller checks result.matched
 * @throws      If the TFLite model is not ready or inference fails
 */
export async function findBestMatch(face: PreprocessedFace): Promise<RecognitionResult> {
  // Auto-load cache if not yet populated
  if (!_cacheLoaded) {
    await loadWorkerCache();
  }

  const startTime = Date.now();

  // Step 1: Generate embedding via GhostFaceNet
  const liveEmbedding = await generateEmbedding(face);

  // Step 2: Match against cache (synchronous — no await needed)
  const result = matchEmbedding(liveEmbedding);

  const elapsed = Date.now() - startTime;
  console.log(`[WorkerMatcher] Recognition completed in ${elapsed}ms`);

  return result;
}

// ---------------------------------------------------------------------------
// Utility — Direct embedding match (for testing / batch operations)
// ---------------------------------------------------------------------------

/**
 * Matches a pre-computed embedding directly against the cache.
 * Useful for testing the matching logic without running the full camera pipeline.
 *
 * @param embedding - Pre-computed L2-normalised embedding
 * @returns          RecognitionResult
 */
export function matchPrecomputedEmbedding(
  embedding: FaceEmbedding,
): RecognitionResult {
  return matchEmbedding(embedding);
}
