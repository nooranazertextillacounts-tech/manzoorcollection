import React, { useState } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle2, CloudUpload, Info, AlertTriangle } from 'lucide-react';
import { useSyncStatus } from '../lib/offlineSync';
import clsx from 'clsx';
import toast from 'react-hot-toast';

export function OfflineSyncBadge() {
  const { isOnline, isSyncing, pendingCount, lastSyncTime, syncError, triggerSync } = useSyncStatus();
  const [showModal, setShowModal] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  const handleManualSync = async () => {
    if (!isOnline) {
      toast.error("Cannot sync: Internet is still disconnected / انٹرنیٹ بند ہے", { duration: 3000 });
      return;
    }
    setIsManualSyncing(true);
    try {
      await triggerSync();
    } finally {
      setIsManualSyncing(false);
    }
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowModal(!showModal)}
          className={clsx(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all border shadow-xs cursor-pointer select-none",
            isSyncing
              ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-800 animate-pulse"
              : !isOnline
              ? "bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700 hover:bg-amber-100"
              : pendingCount > 0
              ? "bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700"
              : "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
          )}
          title="Click to view Offline & Auto-Sync status"
        >
          {isSyncing ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600 dark:text-sky-400" />
              <span>Syncing{pendingCount > 0 ? ` (${pendingCount})` : ''}...</span>
            </>
          ) : !isOnline ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Offline{pendingCount > 0 ? ` (${pendingCount} saved)` : ''}</span>
            </>
          ) : pendingCount > 0 ? (
            <>
              <CloudUpload className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>{pendingCount} Pending Sync</span>
            </>
          ) : (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Online</span>
            </>
          )}
        </button>

        {showModal && (
          <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 z-50 text-slate-800 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className={clsx(
                  "p-1.5 rounded-lg",
                  isOnline ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-600" : "bg-amber-100 dark:bg-amber-950 text-amber-600"
                )}>
                  {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                </div>
                <div>
                  <h4 className="font-bold text-sm leading-tight">
                    {isOnline ? "System Online" : "Offline Mode (Net Off)"}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isOnline ? "Connected & Sync Active" : "انٹرنیٹ بند ہے - لوکل موڈ"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <div className="py-3 space-y-2.5 text-xs">
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Pending Offline Entries:</span>
                <span className={clsx("font-bold text-sm", pendingCount > 0 ? "text-amber-600" : "text-emerald-600")}>
                  {pendingCount} {pendingCount === 1 ? 'entry' : 'entries'}
                </span>
              </div>

              {lastSyncTime && (
                <div className="flex justify-between text-slate-500 dark:text-slate-400 px-1">
                  <span>Last Cloud Sync:</span>
                  <span>{new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
              )}

              {syncError && (
                <div className="flex items-start gap-1.5 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 p-2 rounded border border-rose-200 dark:border-rose-900 text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{syncError}</span>
                </div>
              )}

              <div className="bg-blue-50 dark:bg-blue-950/30 p-2.5 rounded-lg text-blue-900 dark:text-blue-200 text-[11px] leading-relaxed">
                <p className="font-semibold flex items-center gap-1 mb-1">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  Automatic Offline Protection:
                </p>
                <p>
                  You can make sales, edit inventory, and record purchases without internet. Every entry is saved locally and will automatically upload as soon as your connection is restored.
                </p>
                <p className="mt-1 text-slate-600 dark:text-slate-300 text-[10px]">
                  نیٹ بند ہونے پر بھی بلنگ اور انٹریز جاری رہتی ہیں۔ نیٹ بحال ہونے پر سب کچھ خود بخود اپلوڈ ہو جائے گا۔
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex gap-2">
              <button
                onClick={handleManualSync}
                disabled={isSyncing || isManualSyncing || !isOnline}
                className={clsx(
                  "w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all",
                  !isOnline
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                    : "bg-sky-600 hover:bg-sky-700 text-white shadow-xs"
                )}
              >
                <RefreshCw className={clsx("w-3.5 h-3.5", (isSyncing || isManualSyncing) && "animate-spin")} />
                <span>{isSyncing || isManualSyncing ? "Syncing..." : "Sync Now (اپلوڈ کریں)"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function OfflineBanner() {
  const { isOnline, pendingCount, isSyncing } = useSyncStatus();

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className={clsx(
      "w-full px-4 py-2 text-xs font-medium flex items-center justify-between border-b transition-colors print:hidden",
      !isOnline
        ? "bg-amber-50 dark:bg-amber-950/80 text-amber-900 dark:text-amber-100 border-amber-200 dark:border-amber-900"
        : "bg-sky-50 dark:bg-sky-950/80 text-sky-900 dark:text-sky-100 border-sky-200 dark:border-sky-900"
    )}>
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
        ) : isSyncing ? (
          <RefreshCw className="w-4 h-4 text-sky-600 animate-spin shrink-0" />
        ) : (
          <CloudUpload className="w-4 h-4 text-amber-600 shrink-0" />
        )}
        <span>
          {!isOnline ? (
            <>
              <strong>Offline Mode Active:</strong> Internet is off. You can continue saving sales & entries. Records are safely stored on device and will auto-upload when internet reconnects.
              <span className="opacity-75 ml-2 font-normal">(انٹرنیٹ بند ہے - تمام انٹریز لوکل محفوظ ہو رہی ہیں)</span>
            </>
          ) : isSyncing ? (
            <>
              <strong>Internet Restored:</strong> Automatically uploading {pendingCount} offline {pendingCount === 1 ? 'entry' : 'entries'} to server...
              <span className="opacity-75 ml-2 font-normal">(انٹریز سرور پر اپلوڈ ہو رہی ہیں...)</span>
            </>
          ) : (
            <>
              <strong>Online:</strong> {pendingCount} offline {pendingCount === 1 ? 'entry' : 'entries'} queued for upload.
            </>
          )}
        </span>
      </div>

      {pendingCount > 0 && (
        <span className="bg-amber-200/60 dark:bg-amber-800/40 text-amber-900 dark:text-amber-100 px-2 py-0.5 rounded text-[11px] font-bold shrink-0">
          {pendingCount} saved locally
        </span>
      )}
    </div>
  );
}
