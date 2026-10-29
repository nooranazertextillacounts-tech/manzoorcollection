import { collection, addDoc } from './customFirestore';
import { db } from './firebase';
import { Timestamp } from 'firebase/firestore';

export type LogCategory = 
  | 'Auth'
  | 'Sales'
  | 'Inventory'
  | 'Purchases'
  | 'Expenses'
  | 'Customers'
  | 'Vendors'
  | 'HR & Payroll'
  | 'Ledger'
  | 'Stock Transfer'
  | 'Settings'
  | 'Users';

export interface ActivityLog {
  id?: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  branchId: string;
  action: string;
  category: LogCategory;
  details: string;
  metadata?: Record<string, any>;
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:mm:ss (24-hour format)
  timestamp: number;
  tenantId?: string;
  createdAt?: any;
}

export function format24HourTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function formatDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function recordActivityLog(params: {
  action: string;
  category: LogCategory;
  details: string;
  metadata?: Record<string, any>;
  branchId?: string | null;
  user?: {
    uid?: string;
    email?: string | null;
    name?: string;
    role?: string;
    tenantId?: string;
  } | null;
}): Promise<void> {
  try {
    const now = new Date();
    const dateStr = formatDateStr(now);
    const timeStr = format24HourTime(now);
    const timestamp = now.getTime();

    // Retrieve active cached user if not explicitly passed
    let activeUser = params.user;
    if (!activeUser) {
      try {
        const demoUser = sessionStorage.getItem('demo_app_user');
        if (demoUser) {
          activeUser = JSON.parse(demoUser);
        } else {
          // Check all local storage keys for appUser
          const keys = Object.keys(localStorage);
          for (const k of keys) {
            if (k.startsWith('appUser_')) {
              const u = JSON.parse(localStorage.getItem(k) || '{}');
              if (u && (u.email || u.name)) {
                activeUser = u;
                break;
              }
            }
          }
        }
      } catch (e) {
        // ignore parse error
      }
    }

    const logEntry = {
      userId: activeUser?.uid || 'anonymous',
      userEmail: activeUser?.email || 'system@app.com',
      userName: activeUser?.name || activeUser?.email?.split('@')[0] || 'System / Staff',
      userRole: activeUser?.role || 'staff',
      branchId: params.branchId || 'main',
      action: params.action,
      category: params.category,
      details: params.details,
      metadata: params.metadata || {},
      dateStr,
      timeStr,
      timestamp,
      tenantId: activeUser?.tenantId || 'CzUMfpmdGJWpFhJYaFdjRBGI1vH3',
      createdAt: Timestamp.now(),
    };

    // Save to Firestore
    await addDoc(collection(db, 'activity_logs'), logEntry);
  } catch (err) {
    // Non-blocking catch to ensure app workflow never halts
    console.warn('Could not record activity log:', err);
  }
}
