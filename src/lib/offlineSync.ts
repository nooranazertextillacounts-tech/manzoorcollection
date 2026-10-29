import { useState } from 'react';

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  syncError: string | null;
}

const defaultStatus: SyncStatus = {
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncTime: null,
  syncError: null
};

export function getSyncStatus(): SyncStatus {
  return { ...defaultStatus };
}

export function subscribeToSyncStatus(_listener: (status: SyncStatus) => void): () => void {
  return () => {};
}

export async function updatePendingCount(): Promise<number> {
  return 0;
}

export async function checkServerConnectivity(): Promise<boolean> {
  return true;
}

export async function triggerSync(): Promise<void> {}

export function useSyncStatus(): SyncStatus & { triggerSync: () => Promise<void> } {
  const [status] = useState<SyncStatus>(defaultStatus);
  return {
    ...status,
    triggerSync
  };
}
