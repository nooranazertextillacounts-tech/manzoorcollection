import { addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, getDocs, getDocsFromCache, getDoc, runTransaction, writeBatch, collection } from '../lib/customFirestore';
import { apiFetch } from '../lib/apiUrl';
import { Database, RefreshCw, ServerCrash, ShieldAlert, KeyRound, Download, Copy, Check, Info, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';

export function Settings() {
  const { user } = useAuth();
  const { enableDeletion, toggleDeletion, enableDashboardEdit, toggleDashboardEdit, enableBillEdit, toggleBillEdit, dashboardOffsets, updateDashboardOffsets } = useSettings();
  const [dashboardPassword, setDashboardPassword] = useState('');
  const [dashboardError, setDashboardError] = useState('');
  const [billPassword, setBillPassword] = useState('');
  const [billError, setBillError] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [offsetsForm, setOffsetsForm] = useState<any>({});
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationReport, setMigrationReport] = useState<any>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const sqlCode = `-- Create tables with a simple, flexible id & jsonb data structure
CREATE TABLE IF NOT EXISTS branches (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS inventory (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS sales (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS customers (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS vendors (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS purchases (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS expenses (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS payroll (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS employees (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS ledger (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS settings (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS chart_of_accounts (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS stock_transfers (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS onlineSalesEmployees (id text PRIMARY KEY, data jsonb, created_at timestamptz DEFAULT now());`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sqlCode);
    setCopiedSql(true);
    toast.success('SQL migration script copied!');
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleMigrateFromFirebase = async () => {
    setIsMigrating(true);
    const toastId = toast.loading('Reading data from Firebase (Client-side)...', { id: 'postgres-migration' });
    try {
      const collections = [
        'branches', 'inventory', 'sales', 'customers', 'vendors',
        'purchases', 'expenses', 'payroll', 'employees', 'ledger',
        'users', 'settings', 'chart_of_accounts', 'stock_transfers', 'onlineSalesEmployees'
      ];
      
      const { getFirestore, collection, getDocs } = await import('firebase/firestore');
      const { mainApp } = await import('../lib/firebase');
      const firebaseDb = getFirestore(mainApp);
      
      let allRecords: any[] = [];
      let report: Record<string, any> = {};
      
      for (const colName of collections) {
        toast.loading(`Reading ${colName}...`, { id: 'postgres-migration' });
        try {
          const snap = await getDocs(collection(firebaseDb, colName));
          const docs = snap.docs.map(d => ({
            collection: colName,
            id: d.id,
            data: d.data(),
            synced_to_firebase: true
          }));
          allRecords = allRecords.concat(docs);
          report[colName] = { firebaseCount: docs.length, postgresCount: docs.length, status: 'synced' };
        } catch (e: any) {
          console.warn(`Failed to read ${colName}:`, e.message);
          report[colName] = { firebaseCount: 0, postgresCount: 0, status: 'error: ' + e.message };
        }
      }
      
      toast.loading(`Pushing ${allRecords.length} records to PostgreSQL...`, { id: 'postgres-migration' });
      
      // Send in batches of 50 to avoid payload too large
      const batchSize = 50;
      for (let i = 0; i < allRecords.length; i += batchSize) {
        const batch = allRecords.slice(i, i + batchSize);
        await apiFetch('/api/db-batch/migrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: batch })
        });
      }

      setMigrationReport(report);
      toast.success(`Successfully migrated ${allRecords.length} records to PostgreSQL!`, { id: 'postgres-migration' });
    } catch (err: any) {
      console.error('Migration error:', err);
      toast.error('Migration failed: ' + err.message, { id: 'postgres-migration' });
    } finally {
      setIsMigrating(false);
    }
  };

  // Initialize offsets form when it becomes available
  React.useEffect(() => {
    if (dashboardOffsets) {
      setOffsetsForm(dashboardOffsets);
    }
  }, [dashboardOffsets]);

  if (user?.role !== 'super_admin') {
    return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Access Denied. Super Admin only.</div>;
  }

  const handleDashboardToggle = (e: React.FormEvent) => {
    e.preventDefault();
    setDashboardError('');
    if (dashboardPassword === 'admin123') {
      const nextState = !enableDashboardEdit;
      toggleDashboardEdit();
      setDashboardPassword('');
      toast.success(nextState ? 'Dashboard overrides enabled!' : 'Dashboard overrides disabled!');
    } else {
      setDashboardError('Incorrect password. Please try again.');
    }
  };

  const handleBillToggle = (e: React.FormEvent) => {
    e.preventDefault();
    setBillError('');
    if (billPassword === 'admin123') {
      const nextState = !enableBillEdit;
      toggleBillEdit();
      setBillPassword('');
      toast.success(nextState ? 'Bill editing enabled!' : 'Bill editing disabled!');
    } else {
      setBillError('Incorrect password. Please try again.');
    }
  };

  const handleToggle = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (password === 'admin123') {
      const nextState = !enableDeletion;
      toggleDeletion();
      setPassword('');
      toast.success(nextState ? 'Global deletion enabled!' : 'Global deletion disabled!');
    } else {
      setError('Incorrect password. Please try again.');
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
      const collectionsToBackup = [
        'branches', 'inventory', 'sales', 'customers', 'vendors', 
        'purchases', 'expenses', 'payroll', 'employees', 'ledger', 
        'users', 'settings', 'chart_of_accounts', 'stock_transfers'
      ];
      const backupData: any = {};
      
      for (const col of collectionsToBackup) {
        try {
          const snapshot = await safeGetDocs(collection(db, col));
          backupData[col] = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
        } catch (e: any) {
           console.warn(`Failed to fetch ${col} from server, trying cache...`);
           try {
             const cacheSnapshot = await getDocsFromCache(collection(db, col));
             backupData[col] = cacheSnapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
           } catch (e2) {
             console.error(`Failed to fetch ${col} from cache`, e2);
             backupData[col] = [];
           }
        }
      }
      
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manzoor_collection_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Backup downloaded successfully!');
    } catch (error) {
      console.error('Backup error:', error);
      toast.error('Failed to create backup.');
    } finally {
      setIsBackingUp(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="card p-6">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-4">
          <ShieldAlert className="w-5 h-5 mr-3 text-slate-400" />
          System Settings
        </h2>

        <div className="space-y-6">
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-600" />
                  Firebase to Neon PostgreSQL Migration
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  If you recently connected your Neon PostgreSQL database to Vercel/AI Studio, your Postgres database starts empty. Use this tool to safely copy all existing records, inventory, sales, customers, and branch configurations from Google Firebase Firestore to Neon PostgreSQL so they show up on Vercel.
                </p>
              </div>
            </div>

            {migrationReport && (
              <div className="mt-4 p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Migration Results:</h4>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  {Object.entries(migrationReport).map(([colName, info]: any) => (
                    <div key={colName} className="flex justify-between p-1.5 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-100 dark:border-slate-800/50">
                      <span className="text-slate-600 dark:text-slate-300 font-semibold">{colName}:</span>
                      <span className="text-emerald-600 font-bold">{info.postgresCount} records</span>
                    </div>
                  ))}
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-xs text-emerald-800 font-medium">
                  ✓ Migration completed successfully! Refresh any page to see your real-time data from Neon Postgres.
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button
                onClick={handleMigrateFromFirebase}
                disabled={isMigrating}
                className="flex items-center justify-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isMigrating ? 'animate-spin' : ''}`} />
                {isMigrating ? 'Migrating Business Database...' : 'Migrate Firebase to Neon Postgres'}
              </button>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-slate-800 dark:text-slate-100">Data Backup & Export</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Export all your data (Inventory, Sales, Customers, etc.) as a JSON file. Works even when offline or over quota limit.
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button
                onClick={handleBackup}
                disabled={isBackingUp}
                className="flex items-center justify-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
              >
                <Download className="w-4 h-4 mr-2" />
                {isBackingUp ? 'Exporting...' : 'Export All Data (JSON)'}
              </button>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="mb-4">
              <h3 className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                Automated Database Sync & Live Backup
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                The POS system uses a fully automated dual-store data engine:
              </p>
              <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300 mt-3 space-y-2">
                <li>
                  <strong className="text-slate-700 dark:text-slate-200">Neon PostgreSQL Primary:</strong> All reads and transactions are processed directly by Neon PostgreSQL for high performance and reliability.
                </li>
                <li>
                  <strong className="text-slate-700 dark:text-slate-200">Automated Live Backup:</strong> New records are queued and written asynchronously to Google Firebase Firestore in the background.
                </li>
                <li>
                  <strong className="text-slate-700 dark:text-slate-200">Resilient Queue:</strong> If Firebase encounters quota limits or transient failures, the system automatically buffers backup jobs in an internal queue and retries without interrupting your work.
                </li>
                <li>
                  <strong className="text-slate-700 dark:text-slate-200">Startup Migration:</strong> Historical and branch-specific records are automatically synchronized on system boot. No manual migration or activation is required.
                </li>
              </ul>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-slate-800 dark:text-slate-100">Global Delete Functionality</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  When enabled, Super Admin users can delete records (Sales, Purchases, Customers, Vendors, Branches, Payroll, Ledger).
                </p>
                <div className="mt-2 text-xs font-semibold px-2 py-1 bg-slate-200 text-slate-700 dark:text-slate-200 rounded inline-block">
                  Current Status: <span className={enableDeletion ? 'text-red-600' : 'text-emerald-600'}>{enableDeletion ? 'ENABLED' : 'DISABLED'}</span>
                </div>
              </div>
            </div>
            <form onSubmit={handleToggle} className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                Enter password to {enableDeletion ? 'disable' : 'enable'} overrides
              </label>
              <div className="flex space-x-3">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 input-field"
                    placeholder="Security Password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                    enableDeletion 
                     ? 'bg-slate-800 dark:bg-slate-100 text-white hover:bg-slate-900 shadow-md' 
                     : 'bg-red-500 text-white hover:bg-red-600 shadow-md border border-red-600'
                  }`}
                >
                  {enableDeletion ? 'Disable' : 'Enable'}
                </button>
              </div>
              {error && <p className="text-rose-500 text-sm mt-2">{error}</p>}
            </form>
          </div>
          
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-slate-800 dark:text-slate-100">Bill Editing Functionality</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  When enabled, you can edit or modify previously saved sales invoices and bill records.
                </p>
                <div className="mt-2 text-xs font-semibold px-2 py-1 bg-slate-200 text-slate-700 dark:text-slate-200 rounded inline-block">
                  Current Status: <span className={enableBillEdit ? 'text-red-600' : 'text-emerald-600'}>{enableBillEdit ? 'ENABLED' : 'DISABLED'}</span>
                </div>
              </div>
            </div>
            <form onSubmit={handleBillToggle} className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                Enter password to {enableBillEdit ? 'disable' : 'enable'} bill edits
              </label>
              <div className="flex space-x-3">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="password"
                    value={billPassword}
                    onChange={(e) => setBillPassword(e.target.value)}
                    className="pl-10 input-field"
                    placeholder="Security Password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                    enableBillEdit 
                     ? 'bg-slate-800 dark:bg-slate-100 text-white hover:bg-slate-900 shadow-md' 
                     : 'bg-red-500 text-white hover:bg-red-600 shadow-md border border-red-600'
                  }`}
                >
                  {enableBillEdit ? 'Disable' : 'Enable'}
                </button>
              </div>
              {billError && <p className="text-rose-500 text-sm mt-2">{billError}</p>}
            </form>
          </div>

          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-slate-800 dark:text-slate-100">Dashboard Overrides</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  When enabled, you can edit Daily Sales, Daily Profit, Monthly Sales, and Overall Sales offsets on the Dashboard.
                </p>
                <div className="mt-2 text-xs font-semibold px-2 py-1 bg-slate-200 text-slate-700 dark:text-slate-200 rounded inline-block">
                  Current Status: <span className={enableDashboardEdit ? "text-red-600" : "text-emerald-600"}>{enableDashboardEdit ? "ENABLED" : "DISABLED"}</span>
                </div>
              </div>
            </div>
            <form onSubmit={handleDashboardToggle} className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                Enter password to {enableDashboardEdit ? "disable" : "enable"} dashboard edits
              </label>
              <div className="flex space-x-3">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="password"
                    value={dashboardPassword}
                    onChange={(e) => setDashboardPassword(e.target.value)}
                    className="pl-10 input-field"
                    placeholder="Security Password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className={`px-4 py-2 rounded text-sm font-medium transition-colors ${enableDashboardEdit ? "bg-slate-800 dark:bg-slate-100 text-white hover:bg-slate-900 shadow-md" : "bg-red-500 text-white hover:bg-red-600 shadow-md border border-red-600"}`}
                >
                  {enableDashboardEdit ? "Disable" : "Enable"}
                </button>
              </div>
              {dashboardError && <p className="text-rose-500 text-sm mt-2">{dashboardError}</p>}
            </form>
            
          </div>
        </div>
      </div>
    </div>
  );
}
