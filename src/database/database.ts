/**
 * @file database.ts
 * @description SQLite database initialization and singleton management for NetraSetu.
 *
 * This module is responsible for:
 *   1. Opening / creating the SQLite database file via expo-sqlite.
 *   2. Running all CREATE TABLE DDL migrations on first launch.
 *   3. Exporting a typed singleton accessor used by all repository modules.
 *
 * Offline-first principle (from mobile-developer skill):
 *   The database is the primary data source. All reads come from here first;
 *   network sync is scheduled non-blocking after local writes succeed.
 *
 * Usage:
 *   import { getDatabase } from '@/database/database';
 *   const db = await getDatabase();
 */

import * as SQLite from 'expo-sqlite';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name of the SQLite database file stored in the app's documents directory. */
const DATABASE_NAME = 'netrasetu.db';

// ---------------------------------------------------------------------------
// Database schema DDL
// ---------------------------------------------------------------------------

/**
 * Workers table DDL.
 *
 * face_embedding – stored as JSON string (TEXT) so the embedding float array
 * survives serialisation without requiring a BLOB codec.
 *
 * sync_status:
 *   0 = local-only / pending upload
 *   1 = successfully synced
 *   2 = sync failed
 */
const CREATE_WORKERS_TABLE = `
  CREATE TABLE IF NOT EXISTS workers (
    worker_id   TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    face_embedding TEXT NOT NULL DEFAULT '',
    sync_status INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
`.trim();

/**
 * Attendance table DDL.
 *
 * ON DELETE CASCADE ensures that deleting a worker automatically removes
 * all their attendance records, maintaining referential integrity.
 */
const CREATE_ATTENDANCE_TABLE = `
  CREATE TABLE IF NOT EXISTS attendance (
    attendance_id TEXT PRIMARY KEY NOT NULL,
    worker_id     TEXT NOT NULL,
    timestamp     INTEGER NOT NULL,
    sync_status   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (worker_id) REFERENCES workers(worker_id) ON DELETE CASCADE
  );
`.trim();

/**
 * Performance indexes to speed up common query patterns:
 *   - Looking up attendance by worker
 *   - Querying unsynced records for background upload
 */
const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_attendance_worker_id
     ON attendance(worker_id);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_sync_status
     ON attendance(sync_status);`,
  `CREATE INDEX IF NOT EXISTS idx_workers_sync_status
     ON workers(sync_status);`,
];

// ---------------------------------------------------------------------------
// Singleton management
// ---------------------------------------------------------------------------

/** Cached database instance – null until first call to getDatabase(). */
let _db: SQLite.SQLiteDatabase | null = null;

/**
 * Opens the database and runs schema migrations exactly once per app session.
 * Subsequent calls return the cached instance immediately.
 *
 * @returns Initialised SQLiteDatabase instance
 * @throws  If the database cannot be opened or migrations fail
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db !== null) {
    return _db;
  }

  try {
    // expo-sqlite v14+ uses openDatabaseAsync for the async API
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

    // Enable WAL mode for better concurrent read performance and crash safety
    await db.execAsync('PRAGMA journal_mode = WAL;');

    // Enforce foreign-key constraints (disabled by default in SQLite)
    await db.execAsync('PRAGMA foreign_keys = ON;');

    // Create tables if they don't exist yet (idempotent migrations)
    await db.execAsync(CREATE_WORKERS_TABLE);
    await db.execAsync(CREATE_ATTENDANCE_TABLE);

    // Create performance indexes
    for (const indexDDL of CREATE_INDEXES) {
      await db.execAsync(indexDDL);
    }

    _db = db;
    console.log('[Database] Initialised successfully:', DATABASE_NAME);
    return _db;
  } catch (error) {
    console.error('[Database] Initialisation failed:', error);
    throw new Error(
      `Failed to initialise NetraSetu database: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Closes the database connection and clears the singleton cache.
 * Call this when the app is being torn down or during testing teardown.
 */
export async function closeDatabase(): Promise<void> {
  if (_db !== null) {
    await _db.closeAsync();
    _db = null;
    console.log('[Database] Connection closed.');
  }
}

/**
 * Returns the cached database instance without initialising.
 * Throws if the database has not been opened yet.
 * Useful in synchronous contexts where you know init has already run.
 *
 * @throws If getDatabase() has not been called and awaited first
 */
export function getDatabaseSync(): SQLite.SQLiteDatabase {
  if (_db === null) {
    throw new Error(
      '[Database] Database not initialised. Call and await getDatabase() first.',
    );
  }
  return _db;
}
