import { openDB, IDBPDatabase } from 'idb';

export interface LocalDoc {
  key: string; // `${collection}::${id}`
  collection: string;
  id: string;
  data: any;
  updatedAt: number;
}

export interface CachedQuery {
  cacheKey: string;
  collection: string;
  docs: Array<{ id: string; data: any }>;
  timestamp: number;
}

export interface SyncQueueItem {
  queueId?: number;
  opType: 'add' | 'set' | 'update' | 'delete' | 'batch';
  collection: string;
  docId: string;
  data?: any;
  merge?: boolean;
  writes?: any[];
  description?: string;
  timestamp: number;
  retryCount?: number;
}

const DB_NAME = 'pos_offline_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is only available in browser environment'));
  }

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 1. Documents store
        if (!db.objectStoreNames.contains('documents')) {
          const docStore = db.createObjectStore('documents', { keyPath: 'key' });
          docStore.createIndex('by_collection', 'collection', { unique: false });
          docStore.createIndex('by_id', 'id', { unique: false });
          docStore.createIndex('by_updated', 'updatedAt', { unique: false });
        }

        // 2. Query cache store
        if (!db.objectStoreNames.contains('queries')) {
          db.createObjectStore('queries', { keyPath: 'cacheKey' });
        }

        // 3. Sync queue store
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'queueId', autoIncrement: true });
          syncStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        }

        // 4. Metadata store
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      }
    });
  }

  return dbPromise;
}

// -------------------------------------------------------------
// Document Storage Operations
// -------------------------------------------------------------

export async function saveDocLocally(collectionName: string, id: string, data: any): Promise<void> {
  try {
    const db = await getDB();
    const key = `${collectionName}::${id}`;
    const entry: LocalDoc = {
      key,
      collection: collectionName,
      id,
      data,
      updatedAt: Date.now()
    };
    await db.put('documents', entry);
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to save doc locally ${collectionName}/${id}:`, err);
  }
}

export async function getDocLocally(collectionName: string, id: string): Promise<any | null> {
  try {
    const db = await getDB();
    const key = `${collectionName}::${id}`;
    const entry = await db.get('documents', key);
    return entry ? entry.data : null;
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to get doc locally ${collectionName}/${id}:`, err);
    return null;
  }
}

export async function deleteDocLocally(collectionName: string, id: string): Promise<void> {
  try {
    const db = await getDB();
    const key = `${collectionName}::${id}`;
    await db.delete('documents', key);
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to delete doc locally ${collectionName}/${id}:`, err);
  }
}

export async function getAllDocsInCollection(collectionName: string): Promise<Array<{ id: string; data: any }>> {
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex('documents', 'by_collection', collectionName);
    return all.map(item => ({ id: item.id, data: item.data }));
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to get collection docs ${collectionName}:`, err);
    return [];
  }
}

// -------------------------------------------------------------
// Query Storage & Local Query Engine
// -------------------------------------------------------------

export async function saveQueryLocally(
  collectionName: string,
  cacheKey: string,
  docs: Array<{ id: string; data: any }>
): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(['documents', 'queries'], 'readwrite');
    
    // 1. Save all documents individually
    for (const doc of docs) {
      const key = `${collectionName}::${doc.id}`;
      await tx.objectStore('documents').put({
        key,
        collection: collectionName,
        id: doc.id,
        data: doc.data,
        updatedAt: Date.now()
      });
    }

    // 2. Save query result
    await tx.objectStore('queries').put({
      cacheKey,
      collection: collectionName,
      docs,
      timestamp: Date.now()
    });

    await tx.done;
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to save query locally ${collectionName}:`, err);
  }
}

export function matchFilter(docData: any, filter: { field: string; op: string; val: any }): boolean {
  if (!docData) return false;
  const { field, op, val } = filter;
  const actual = docData[field];

  switch (op) {
    case '==':
    case '===':
      if (val === null || val === undefined) {
        return actual === null || actual === undefined;
      }
      return actual == val;
    case '!=':
    case '!==':
      return actual != val;
    case '>':
      return Number(actual) > Number(val);
    case '>=':
      return Number(actual) >= Number(val);
    case '<':
      return Number(actual) < Number(val);
    case '<=':
      return Number(actual) <= Number(val);
    case 'in':
      return Array.isArray(val) && val.map(String).includes(String(actual));
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(val);
    default:
      return actual == val;
  }
}

export async function getQueryLocally(
  collectionName: string,
  filters: any[] = [],
  orderByField?: string,
  orderByDirection?: 'asc' | 'desc',
  limitVal?: number,
  cacheKey?: string
): Promise<Array<{ id: string; data: any }>> {
  try {
    const db = await getDB();

    // 1. If direct query cache exists and is fresh enough, check it
    if (cacheKey) {
      const cached = await db.get('queries', cacheKey);
      if (cached && Array.isArray(cached.docs) && cached.docs.length > 0) {
        // Also fetch any newly created local documents in this collection that might match the filters
        const allLocal = await getAllDocsInCollection(collectionName);
        const cachedIds = new Set(cached.docs.map((d: any) => d.id));
        const missingNewDocs = allLocal.filter(d => !cachedIds.has(d.id));

        if (missingNewDocs.length === 0) {
          return cached.docs;
        }
      }
    }

    // 2. Fetch all local documents for this collection and apply filters
    const all = await getAllDocsInCollection(collectionName);
    let matched = all.filter(item => {
      for (const f of filters) {
        if (!matchFilter(item.data, f)) {
          return false;
        }
      }
      return true;
    });

    // 3. Apply sorting
    if (orderByField) {
      matched.sort((a, b) => {
        const valA = a.data ? a.data[orderByField] : undefined;
        const valB = b.data ? b.data[orderByField] : undefined;
        if (valA === valB) return 0;
        if (valA === undefined) return 1;
        if (valB === undefined) return -1;
        const comp = valA > valB ? 1 : -1;
        return orderByDirection === 'desc' ? -comp : comp;
      });
    }

    // 4. Apply limit
    if (limitVal && limitVal > 0) {
      matched = matched.slice(0, limitVal);
    }

    return matched;
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to query locally ${collectionName}:`, err);
    return [];
  }
}

// -------------------------------------------------------------
// Offline Sync Queue Operations
// -------------------------------------------------------------

export async function enqueueSyncOp(op: Omit<SyncQueueItem, 'queueId'>): Promise<number> {
  try {
    const db = await getDB();
    const id = await db.add('syncQueue', {
      ...op,
      timestamp: op.timestamp || Date.now(),
      retryCount: 0
    });
    return id as number;
  } catch (err) {
    console.error("[OfflineStorage] Failed to enqueue sync op:", err);
    throw err;
  }
}

export async function getPendingSyncQueue(): Promise<SyncQueueItem[]> {
  try {
    const db = await getDB();
    const all = await db.getAll('syncQueue');
    return all.sort((a, b) => (a.queueId || 0) - (b.queueId || 0));
  } catch (err) {
    console.warn("[OfflineStorage] Failed to get sync queue:", err);
    return [];
  }
}

export async function removeSyncOp(queueId: number): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('syncQueue', queueId);
  } catch (err) {
    console.warn(`[OfflineStorage] Failed to remove sync op ${queueId}:`, err);
  }
}

export async function getPendingQueueCount(): Promise<number> {
  try {
    const db = await getDB();
    return await db.count('syncQueue');
  } catch (err) {
    return 0;
  }
}

export async function clearSyncQueue(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear('syncQueue');
  } catch (err) {
    console.warn("[OfflineStorage] Failed to clear sync queue:", err);
  }
}
