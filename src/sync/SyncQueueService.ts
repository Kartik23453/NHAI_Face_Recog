import {
  getPendingAttendance,
  countPendingAttendance
} from '../database/attendanceRepository';
import type { Attendance } from '../database/models';

export interface QueueStats {
  pendingCount: number;
  oldestRecordTimestamp?: number;
}

/**
 * Retrieves all pending attendance records currently in the queue.
 * Safe default limit applied to avoid out-of-memory errors on massive offline queues.
 */
export async function getPendingRecords(): Promise<Attendance[]> {
  try {
    // 10,000 represents a massive multi-month offline backlog. 
    // Usually, getPendingRecordsBatch is preferred.
    return await getPendingAttendance(10000); 
  } catch (error) {
    console.error('[SyncQueueService] getPendingRecords failed:', error);
    return [];
  }
}

/**
 * Counts the total number of pending records in the queue.
 */
export async function countPendingRecords(): Promise<number> {
  try {
    return await countPendingAttendance();
  } catch (error) {
    console.error('[SyncQueueService] countPendingRecords failed:', error);
    return 0; // Safe default
  }
}

/**
 * Checks if there are any records currently waiting in the queue.
 */
export async function hasPendingRecords(): Promise<boolean> {
  try {
    const count = await countPendingRecords();
    return count > 0;
  } catch (error) {
    console.error('[SyncQueueService] hasPendingRecords failed:', error);
    return false; // Safe default
  }
}

/**
 * Retrieves a specific batch size of pending records, ordered oldest first.
 * Essential for chunked or paginated cloud uploads.
 *
 * @param limit The maximum number of records to return in this batch.
 */
export async function getPendingRecordsBatch(limit: number): Promise<Attendance[]> {
  try {
    return await getPendingAttendance(limit);
  } catch (error) {
    console.error('[SyncQueueService] getPendingRecordsBatch failed:', error);
    return []; // Safe default
  }
}

/**
 * Retrieves the absolute oldest pending record in the queue.
 * Useful for monitoring sync latency (e.g. "We haven't synced since Tuesday").
 */
export async function getOldestPendingRecord(): Promise<Attendance | null> {
  try {
    const records = await getPendingAttendance(1);
    return records.length > 0 ? records[0] : null;
  } catch (error) {
    console.error('[SyncQueueService] getOldestPendingRecord failed:', error);
    return null; // Safe default
  }
}

/**
 * Retrieves high-level queue statistics.
 * Used for dashboards or UI indicators showing the health of the offline queue.
 */
export async function getQueueStats(): Promise<QueueStats> {
  try {
    const count = await countPendingRecords();
    
    // Fast path: if empty, return early
    if (count === 0) {
      return { pendingCount: 0 };
    }

    const oldest = await getOldestPendingRecord();
    
    return {
      pendingCount: count,
      oldestRecordTimestamp: oldest?.timestamp,
    };
  } catch (error) {
    console.error('[SyncQueueService] getQueueStats failed:', error);
    return { pendingCount: 0 }; // Safe default
  }
}
