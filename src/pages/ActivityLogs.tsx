import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { db, safeCollectionSnapshot } from '../lib/firebase';
import { collection, query, orderBy, limit, deleteDoc, doc, getDocs } from '../lib/customFirestore';
import { ActivityLog, LogCategory, formatDateStr, format24HourTime, recordActivityLog } from '../lib/activityLogger';
import { 
  History, 
  Search, 
  Filter, 
  Calendar, 
  Clock, 
  User, 
  Shield, 
  ArrowUpDown, 
  Download, 
  RefreshCw, 
  Trash2, 
  Eye, 
  CheckCircle2, 
  AlertCircle, 
  ShoppingCart, 
  Package, 
  Truck, 
  Wallet, 
  Users, 
  Building2, 
  Settings as SettingsIcon, 
  FileText,
  Lock,
  Layers,
  Sparkles
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';

export function ActivityLogs() {
  const { user } = useAuth();
  const { branches } = useBranch();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters State
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [dateFilterMode, setDateFilterMode] = useState<'24h' | 'today' | 'yesterday' | '7days' | '30days' | 'all' | 'custom'>('24h');
  const [startDate, setStartDate] = useState<string>(formatDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [endDate, setEndDate] = useState<string>(formatDateStr(new Date()));
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Selected log for detailed view
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    // Listen to real-time activity_logs collection
    const logsRef = collection(db, 'activity_logs');
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(1500));

    const unsubscribe = safeCollectionSnapshot(
      q,
      (snapshot) => {
        const fetchedLogs: ActivityLog[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            ...data,
            timestamp: data.timestamp || (data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now()),
            dateStr: data.dateStr || formatDateStr(new Date(data.timestamp || Date.now())),
            timeStr: data.timeStr || format24HourTime(new Date(data.timestamp || Date.now())),
          };
        });

        setLogs(fetchedLogs);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading activity logs:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Distinct users for dropdown
  const distinctUsers = useMemo(() => {
    const userMap = new Map<string, { email: string; name: string; role: string }>();
    logs.forEach((log) => {
      if (log.userEmail && !userMap.has(log.userEmail)) {
        userMap.set(log.userEmail, {
          email: log.userEmail,
          name: log.userName || log.userEmail.split('@')[0],
          role: log.userRole || 'staff',
        });
      }
    });
    return Array.from(userMap.values());
  }, [logs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    const now = Date.now();
    const todayStr = formatDateStr(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = formatDateStr(yesterdayDate);

    return logs.filter((log) => {
      // 1. User Filter
      if (selectedUserEmail !== 'ALL' && log.userEmail.toLowerCase() !== selectedUserEmail.toLowerCase()) {
        return false;
      }

      // 2. Category Filter
      if (selectedCategory !== 'ALL' && log.category !== selectedCategory) {
        return false;
      }

      // 3. Branch Filter
      if (selectedBranch !== 'ALL' && log.branchId !== selectedBranch) {
        return false;
      }

      // 4. Date Filter Mode
      if (dateFilterMode === '24h') {
        const past24HoursTimestamp = now - 24 * 60 * 60 * 1000;
        if (log.timestamp < past24HoursTimestamp) return false;
      } else if (dateFilterMode === 'today') {
        if (log.dateStr !== todayStr) return false;
      } else if (dateFilterMode === 'yesterday') {
        if (log.dateStr !== yesterdayStr) return false;
      } else if (dateFilterMode === '7days') {
        const past7Days = now - 7 * 24 * 60 * 60 * 1000;
        if (log.timestamp < past7Days) return false;
      } else if (dateFilterMode === '30days') {
        const past30Days = now - 30 * 24 * 60 * 60 * 1000;
        if (log.timestamp < past30Days) return false;
      } else if (dateFilterMode === 'custom') {
        if (startDate && log.dateStr < startDate) return false;
        if (endDate && log.dateStr > endDate) return false;
      }

      // 5. Keyword search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inDetails = log.details?.toLowerCase().includes(q);
        const inAction = log.action?.toLowerCase().includes(q);
        const inEmail = log.userEmail?.toLowerCase().includes(q);
        const inName = log.userName?.toLowerCase().includes(q);
        const inCategory = log.category?.toLowerCase().includes(q);
        return inDetails || inAction || inEmail || inName || inCategory;
      }

      return true;
    });
  }, [logs, selectedUserEmail, selectedCategory, dateFilterMode, startDate, endDate, selectedBranch, searchQuery]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const past24hTime = Date.now() - 24 * 60 * 60 * 1000;
    const logs24h = logs.filter((l) => l.timestamp >= past24hTime);
    const loginCount24h = logs24h.filter((l) => l.category === 'Auth' || l.action.includes('LOGIN')).length;
    const salesCount24h = logs24h.filter((l) => l.category === 'Sales').length;
    const inventoryCount24h = logs24h.filter((l) => l.category === 'Inventory' || l.category === 'Stock Transfer').length;

    return {
      totalFiltered: filteredLogs.length,
      total24h: logs24h.length,
      logins24h: loginCount24h,
      sales24h: salesCount24h,
      inventory24h: inventoryCount24h,
    };
  }, [logs, filteredLogs]);

  // Export CSV
  const handleExportCSV = () => {
    if (filteredLogs.length === 0) {
      toast.error('No logs to export');
      return;
    }

    const headers = ['Date', 'Time (24h)', 'User Name', 'User Email', 'Role', 'Category', 'Action', 'Details', 'Branch'];
    const rows = filteredLogs.map((l) => [
      `"${l.dateStr}"`,
      `"${l.timeStr}"`,
      `"${(l.userName || '').replace(/"/g, '""')}"`,
      `"${l.userEmail || ''}"`,
      `"${l.userRole || ''}"`,
      `"${l.category || ''}"`,
      `"${l.action || ''}"`,
      `"${(l.details || '').replace(/"/g, '""')}"`,
      `"${l.branchId || 'main'}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `activity_logs_${dateFilterMode}_${formatDateStr(new Date())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Activity logs exported successfully!');
  };

  // Helper for Category badge & icon
  const getCategoryBadge = (category: LogCategory) => {
    switch (category) {
      case 'Auth':
        return { bg: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800', icon: Lock };
      case 'Sales':
        return { bg: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800', icon: ShoppingCart };
      case 'Inventory':
        return { bg: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800', icon: Package };
      case 'Purchases':
        return { bg: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800', icon: Truck };
      case 'Expenses':
        return { bg: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800', icon: Wallet };
      case 'Customers':
      case 'Vendors':
      case 'Users':
      case 'HR & Payroll':
        return { bg: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800', icon: Users };
      case 'Settings':
        return { bg: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700', icon: SettingsIcon };
      default:
        return { bg: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800', icon: FileText };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 bg-sky-50 dark:bg-sky-950/60 rounded-xl text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-800/60 shadow-sm">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Logs Activity
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  24/7 Live Tracking
                </span>
              </h1>
              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
                مکمل سسٹم لاگز، ہر لاگ اِن (Login) کی تاریخ وار 24 گھنٹے کی سرگرمیاں اور آڈٹ ٹریل
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl shadow-sm transition active:scale-95"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-2">
            <span>Last 24 Hours Activity</span>
            <Clock className="w-4 h-4 text-sky-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{metrics.total24h}</div>
          <div className="text-[11px] text-sky-600 dark:text-sky-400 mt-1 flex items-center gap-1 font-medium">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500"></span>
            Past 24 Hours Events
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-2">
            <span>Logins & Sessions</span>
            <Lock className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{metrics.logins24h}</div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1 font-medium">
            <span>{distinctUsers.length} Unique Active Users</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-2">
            <span>Sales & Bill Operations</span>
            <ShoppingCart className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{metrics.sales24h}</div>
          <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 flex items-center gap-1 font-medium">
            <span>Created / Modified Invoices</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium mb-2">
            <span>Filtered Logs View</span>
            <Layers className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{metrics.totalFiltered}</div>
          <div className="text-[11px] text-purple-600 dark:text-purple-400 mt-1 flex items-center gap-1 font-medium">
            <span>Matching Current Filters</span>
          </div>
        </div>
      </div>

      {/* Filters Control Card */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        {/* Quick Date Pills */}
        <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mr-2 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Date / Time:
          </span>
          {[
            { id: '24h', label: 'Last 24 Hours (24 گھنٹے)' },
            { id: 'today', label: 'Today (آج)' },
            { id: 'yesterday', label: 'Yesterday (کل)' },
            { id: '7days', label: 'Last 7 Days' },
            { id: '30days', label: 'Last 30 Days' },
            { id: 'all', label: 'All Time' },
            { id: 'custom', label: 'Custom Range' },
          ].map((pill) => (
            <button
              key={pill.id}
              onClick={() => setDateFilterMode(pill.id as any)}
              className={clsx(
                'px-3 py-1.5 rounded-xl text-xs font-medium transition active:scale-95',
                dateFilterMode === pill.id
                  ? 'bg-sky-600 text-white shadow-sm shadow-sky-600/20'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Custom Range Inputs if custom selected */}
        {dateFilterMode === 'custom' && (
          <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">From:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">To:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200"
              />
            </div>
          </div>
        )}

        {/* Main Filters Row: Specific User / Login + Category + Branch + Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Specific User / Login Selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
              Select Specific Login (صارف کا انتخاب)
            </label>
            <div className="relative">
              <select
                value={selectedUserEmail}
                onChange={(e) => setSelectedUserEmail(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none"
              >
                <option value="ALL">👥 All Logins & Staff (تمام لاگ اِن)</option>
                {distinctUsers.map((u) => (
                  <option key={u.email} value={u.email}>
                    👤 {u.name} ({u.email}) - {u.role}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Category Filter */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
              Activity Category (کیٹیگری)
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none"
            >
              <option value="ALL">📂 All Categories (سب اقسام)</option>
              <option value="Auth">🔐 Auth & Login / Logout</option>
              <option value="Sales">🛒 Sales & Invoices</option>
              <option value="Inventory">📦 Inventory & Stock</option>
              <option value="Stock Transfer">🔄 Stock Transfers</option>
              <option value="Purchases">🚚 Purchases & Orders</option>
              <option value="Expenses">💵 Expenses & Payments</option>
              <option value="Customers">👥 Customers</option>
              <option value="Vendors">🏢 Vendors</option>
              <option value="HR & Payroll">💼 Labour & Payroll</option>
              <option value="Ledger">📖 Ledger</option>
              <option value="Settings">⚙️ System Settings</option>
              <option value="Users">👤 User Management</option>
            </select>
          </div>

          {/* Branch Filter */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
              Branch (برانچ)
            </label>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-sky-500 focus:outline-none"
            >
              <option value="ALL">🏢 All Branches</option>
              <option value="main">Main Branch (HQ)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Keyword Search */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
              Search Details (تلاش کریں)
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search invoice, SKU, user, details..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:ring-2 focus:ring-sky-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Activity Logs Records ({filteredLogs.length})
            </h3>
            {selectedUserEmail !== 'ALL' && (
              <span className="text-xs bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 px-2 py-0.5 rounded-full font-medium">
                User: {selectedUserEmail}
              </span>
            )}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Ordered by newest timestamp (24h standard)
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2 text-sky-500" />
            <p className="text-xs">Loading activity logs...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            <History className="w-8 h-8 mx-auto text-slate-400 mb-2 opacity-50" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No activity logs found</p>
            <p className="text-xs text-slate-400 mt-1">
              اس منتخب فلٹر کے لیے کوئی لاگز دستیاب نہیں ہیں۔ فلٹر تبدیل کر کے دوبارہ چیک کریں۔
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4 w-44">Date & 24h Time</th>
                  <th className="py-3 px-4 w-52">User / Login</th>
                  <th className="py-3 px-4 w-36">Category</th>
                  <th className="py-3 px-4 w-44">Action</th>
                  <th className="py-3 px-4">Activity Details</th>
                  <th className="py-3 px-4 w-28">Branch</th>
                  <th className="py-3 px-4 w-16 text-center">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredLogs.map((log) => {
                  const badge = getCategoryBadge(log.category);
                  const Icon = badge.icon;
                  const logDate = new Date(log.timestamp);
                  const isRecent = Date.now() - log.timestamp < 3600 * 1000; // < 1 hour

                  return (
                    <tr 
                      key={log.id} 
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer"
                      onClick={() => setSelectedLog(log)}
                    >
                      {/* Date & 24h Time */}
                      <td className="py-3 px-4 align-top">
                        <div className="flex flex-col font-mono text-[11px]">
                          <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {log.timeStr || format24HourTime(logDate)}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {log.dateStr || formatDateStr(logDate)}
                          </span>
                        </div>
                      </td>

                      {/* User Info */}
                      <td className="py-3 px-4 align-top">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold flex items-center justify-center text-[10px] shrink-0 border border-slate-300 dark:border-slate-700">
                            {(log.userName || log.userEmail || 'U').substring(0, 2).toUpperCase()}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {log.userName || 'Staff'}
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {log.userEmail}
                            </span>
                            <span className="text-[9px] uppercase font-bold text-slate-400">
                              {log.userRole?.replace('_', ' ') || 'STAFF'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Category Badge */}
                      <td className="py-3 px-4 align-top">
                        <span className={clsx('inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border', badge.bg)}>
                          <Icon className="w-3 h-3" />
                          {log.category}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 align-top">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                          {log.action}
                        </span>
                        {isRecent && (
                          <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">
                            Just Now
                          </span>
                        )}
                      </td>

                      {/* Details Description */}
                      <td className="py-3 px-4 align-top">
                        <p className="text-slate-700 dark:text-slate-300 line-clamp-2 leading-relaxed">
                          {log.details}
                        </p>
                      </td>

                      {/* Branch */}
                      <td className="py-3 px-4 align-top">
                        <span className="text-[11px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-medium">
                          {log.branchId === 'main' ? 'Main HQ' : (branches.find(b => b.id === log.branchId)?.name || log.branchId || 'Main')}
                        </span>
                      </td>

                      {/* View Details Action */}
                      <td className="py-3 px-4 align-top text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                          className="p-1.5 text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/60 rounded-lg transition"
                          title="View Full Log Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 rounded-lg">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Activity Log Audit Details</h3>
                  <p className="text-[11px] text-slate-500">Record ID: {selectedLog.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                <div>
                  <span className="text-slate-400 font-medium block text-[10px] uppercase">Timestamp (24h)</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {selectedLog.dateStr} {selectedLog.timeStr}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block text-[10px] uppercase">Category</span>
                  <span className="font-bold text-sky-600 dark:text-sky-400">{selectedLog.category}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block text-[10px] uppercase">User / Login</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{selectedLog.userName}</span>
                  <span className="block text-[10px] text-slate-500">{selectedLog.userEmail}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium block text-[10px] uppercase">Role & Branch</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 capitalize">
                    {selectedLog.userRole?.replace('_', ' ')}
                  </span>
                  <span className="block text-[10px] text-slate-500">Branch: {selectedLog.branchId}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-400 font-medium block text-[10px] uppercase mb-1">Action Name</span>
                <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl font-semibold text-slate-900 dark:text-white">
                  {selectedLog.action}
                </div>
              </div>

              <div>
                <span className="text-slate-400 font-medium block text-[10px] uppercase mb-1">Full Description</span>
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 leading-relaxed">
                  {selectedLog.details}
                </div>
              </div>

              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <span className="text-slate-400 font-medium block text-[10px] uppercase mb-1">Metadata / Parameters</span>
                  <pre className="p-3 bg-slate-900 text-emerald-400 rounded-xl font-mono text-[10px] overflow-x-auto max-h-40">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold rounded-xl text-xs hover:opacity-90 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
