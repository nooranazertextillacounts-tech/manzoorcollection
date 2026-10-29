import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { collection, query, where, doc, setDoc, writeBatch, Timestamp } from '../lib/customFirestore';
import { db, safeCollectionSnapshot } from '../lib/firebase';
import {
  CalendarCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Coffee,
  Printer,
  ChevronLeft,
  ChevronRight,
  Search,
  Save,
  Users,
  Calendar,
  FileSpreadsheet,
  Sparkles
} from 'lucide-react';
import { format, addDays, subDays, parseISO, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import clsx from 'clsx';

export type AttendanceStatus = 'Present' | 'Absent' | 'Half Day' | 'Leave' | 'Late';

interface Employee {
  id: string;
  name: string;
  role: string;
  phone: string;
  dailyWage: number;
  monthlySalary: number;
  status: 'active' | 'inactive';
  branchId: string;
}

export interface AttendanceRecord {
  id: string;
  branchId: string;
  employeeId: string;
  employeeName: string;
  employeeRole?: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  status: AttendanceStatus;
  checkIn?: string;
  checkOut?: string;
  remarks?: string;
  updatedAt?: any;
}

const STATUS_OPTIONS: {
  value: AttendanceStatus;
  label: string;
  short: string;
  urdu: string;
  bgActive: string;
  badgeClass: string;
  icon: any;
}[] = [
  {
    value: 'Present',
    label: 'Present',
    short: 'P',
    urdu: 'حاضر',
    bgActive: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
    badgeClass: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    icon: CheckCircle2
  },
  {
    value: 'Absent',
    label: 'Absent',
    short: 'A',
    urdu: 'غیر حاضر',
    bgActive: 'bg-rose-600 text-white border-rose-600 shadow-sm',
    badgeClass: 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    icon: XCircle
  },
  {
    value: 'Half Day',
    label: 'Half Day',
    short: 'HD',
    urdu: 'ہاف ڈے',
    bgActive: 'bg-amber-500 text-white border-amber-500 shadow-sm',
    badgeClass: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    icon: Clock
  },
  {
    value: 'Leave',
    label: 'Leave',
    short: 'L',
    urdu: 'چھٹی',
    bgActive: 'bg-sky-600 text-white border-sky-600 shadow-sm',
    badgeClass: 'bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    icon: Coffee
  },
  {
    value: 'Late',
    label: 'Late',
    short: 'LT',
    urdu: 'لیٹ',
    bgActive: 'bg-purple-600 text-white border-purple-600 shadow-sm',
    badgeClass: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    icon: Clock
  }
];

export function Attendance() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();

  const [viewTab, setViewTab] = useState<'daily' | 'monthly'>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [searchQuery, setSearchQuery] = useState('');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceDocs, setAttendanceDocs] = useState<AttendanceRecord[]>([]);
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  const [savingEmpId, setSavingEmpId] = useState<string | null>(null);

  // Local draft state for remarks & time per employee on selectedDate
  const [draftEdits, setDraftEdits] = useState<Record<string, { checkIn?: string; checkOut?: string; remarks?: string }>>({});

  useEffect(() => {
    if (!activeBranchId) return;

    const empQ = query(collection(db, 'employees'), where('branchId', '==', activeBranchId));
    const attQ = query(collection(db, 'attendance'), where('branchId', '==', activeBranchId));

    const unsubEmp = safeCollectionSnapshot(empQ, (snap) => {
      const list = snap.docs
        .map((d) => ({ ...(d.data() as any), id: d.id } as Employee))
        .filter((e) => e.status !== 'inactive')
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setEmployees(list);
    });

    const unsubAtt = safeCollectionSnapshot(attQ, (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id } as AttendanceRecord));
      setAttendanceDocs(list);
    });

    return () => {
      unsubEmp();
      unsubAtt();
    };
  }, [activeBranchId]);

  // Map of employeeId -> AttendanceRecord for selectedDate
  const dailyMap = useMemo(() => {
    const map: Record<string, AttendanceRecord> = {};
    attendanceDocs.forEach((rec) => {
      if (rec.date === selectedDate) {
        map[rec.employeeId] = rec;
      }
    });
    return map;
  }, [attendanceDocs, selectedDate]);

  // Keep draft inputs synced when date or records change
  useEffect(() => {
    const nextDrafts: Record<string, { checkIn?: string; checkOut?: string; remarks?: string }> = {};
    employees.forEach((emp) => {
      const rec = dailyMap[emp.id];
      nextDrafts[emp.id] = {
        checkIn: rec?.checkIn || '09:00',
        checkOut: rec?.checkOut || '21:00',
        remarks: rec?.remarks || ''
      };
    });
    setDraftEdits(nextDrafts);
  }, [selectedDate, dailyMap, employees]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        (e.name || '').toLowerCase().includes(q) ||
        (e.role || '').toLowerCase().includes(q) ||
        (e.phone || '').toLowerCase().includes(q)
    );
  }, [employees, searchQuery]);

  // Quick 1-click status change (saves immediately to database)
  const handleMarkAttendance = async (emp: Employee, status: AttendanceStatus) => {
    if (!activeBranchId) {
      toast.error('Please select a branch first');
      return;
    }
    const docId = `${activeBranchId}_${selectedDate}_${emp.id}`;
    const draft = draftEdits[emp.id] || {};
    const existing = dailyMap[emp.id];
    const monthStr = selectedDate.substring(0, 7);

    setSavingEmpId(emp.id);
    try {
      await setDoc(
        doc(db, 'attendance', docId),
        {
          id: docId,
          branchId: activeBranchId,
          employeeId: emp.id,
          employeeName: emp.name,
          employeeRole: emp.role || 'Staff',
          date: selectedDate,
          month: monthStr,
          status,
          checkIn: draft.checkIn !== undefined ? draft.checkIn : existing?.checkIn || '09:00',
          checkOut: draft.checkOut !== undefined ? draft.checkOut : existing?.checkOut || '21:00',
          remarks: draft.remarks !== undefined ? draft.remarks : existing?.remarks || '',
          updatedAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        },
        { merge: true }
      );
      toast.success(`${emp.name}: ${status}`, { duration: 1500 });
    } catch (err: any) {
      toast.error('Failed to save attendance: ' + err.message);
    } finally {
      setSavingEmpId(null);
    }
  };

  // Save time / remarks for a single row when blurred or clicked
  const handleSaveDetails = async (emp: Employee) => {
    if (!activeBranchId) return;
    const existing = dailyMap[emp.id];
    const statusToUse: AttendanceStatus = existing?.status || 'Present';
    await handleMarkAttendance(emp, statusToUse);
  };

  // Bulk mark all active employees for selectedDate
  const handleMarkAll = async (status: AttendanceStatus, onlyUnmarked: boolean = false) => {
    if (!activeBranchId) {
      toast.error('Please select a branch first');
      return;
    }
    if (employees.length === 0) {
      toast.error('No active employees found in this branch');
      return;
    }

    const targets = onlyUnmarked ? employees.filter((e) => !dailyMap[e.id]) : employees;
    if (targets.length === 0) {
      toast.success('All employees are already marked for today!');
      return;
    }

    setIsSavingBulk(true);
    try {
      const batch = writeBatch(db);
      const monthStr = selectedDate.substring(0, 7);

      targets.forEach((emp) => {
        const docId = `${activeBranchId}_${selectedDate}_${emp.id}`;
        const existing = dailyMap[emp.id];
        const draft = draftEdits[emp.id] || {};
        batch.set(
          doc(db, 'attendance', docId),
          {
            id: docId,
            branchId: activeBranchId,
            employeeId: emp.id,
            employeeName: emp.name,
            employeeRole: emp.role || 'Staff',
            date: selectedDate,
            month: monthStr,
            status,
            checkIn: draft.checkIn || existing?.checkIn || '09:00',
            checkOut: draft.checkOut || existing?.checkOut || '21:00',
            remarks: draft.remarks || existing?.remarks || '',
            updatedAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid
          },
          { merge: true }
        );
      });

      await batch.commit();
      toast.success(`Marked ${targets.length} employees as ${status}! / حاضری محفوظ ہو گئی`);
    } catch (err: any) {
      toast.error('Failed to mark all: ' + err.message);
    } finally {
      setIsSavingBulk(false);
    }
  };

  // Daily stats
  const dailyStats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let halfDay = 0;
    let leave = 0;
    let late = 0;
    let unmarked = 0;

    employees.forEach((emp) => {
      const rec = dailyMap[emp.id];
      if (!rec) {
        unmarked++;
      } else if (rec.status === 'Present') {
        present++;
      } else if (rec.status === 'Absent') {
        absent++;
      } else if (rec.status === 'Half Day') {
        halfDay++;
      } else if (rec.status === 'Leave') {
        leave++;
      } else if (rec.status === 'Late') {
        late++;
      }
    });

    return { total: employees.length, present, absent, halfDay, leave, late, unmarked };
  }, [employees, dailyMap]);

  // Monthly summary per employee
  const monthlySummary = useMemo(() => {
    const monthRecords = attendanceDocs.filter(
      (r) => (r.month === selectedMonth || (r.date && r.date.startsWith(selectedMonth)))
    );

    return employees.map((emp) => {
      const empRecs = monthRecords.filter((r) => r.employeeId === emp.id);
      const present = empRecs.filter((r) => r.status === 'Present').length;
      const late = empRecs.filter((r) => r.status === 'Late').length;
      const halfDay = empRecs.filter((r) => r.status === 'Half Day').length;
      const leave = empRecs.filter((r) => r.status === 'Leave').length;
      const absent = empRecs.filter((r) => r.status === 'Absent').length;
      // Effective working days: Present + Late + (Half Day * 0.5) + Leave (paid leave)
      const effectiveDays = present + late + halfDay * 0.5;

      return {
        emp,
        present,
        late,
        halfDay,
        leave,
        absent,
        totalMarked: empRecs.length,
        effectiveDays
      };
    });
  }, [employees, attendanceDocs, selectedMonth]);

  const changeDateBy = (delta: number) => {
    try {
      const current = parseISO(selectedDate);
      if (isValid(current)) {
        const next = delta > 0 ? addDays(current, delta) : subDays(current, Math.abs(delta));
        setSelectedDate(format(next, 'yyyy-MM-dd'));
      }
    } catch {}
  };

  const activeBranchName =
    activeBranchId === 'main'
      ? 'Main Branch'
      : branches.find((b) => b.id === activeBranchId)?.name || 'Branch';

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="card p-5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 print:hidden">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
            <CalendarCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <span>Daily Attendance System (روزانہ حاضری رجسٹر)</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            One-click daily attendance for all staff & labour. Automatically calculates monthly working days for Payroll.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-end">
          <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewTab('daily')}
              className={clsx(
                'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition',
                viewTab === 'daily'
                  ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              )}
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              Daily Register (آج کی حاضری)
            </button>
            <button
              type="button"
              onClick={() => setViewTab('monthly')}
              className={clsx(
                'px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition',
                viewTab === 'monthly'
                  ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              )}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Monthly Report (ماہانہ رپورٹ)
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 transition"
          >
            <Printer className="w-4 h-4" />
            Print Sheet
          </button>
        </div>
      </div>

      {viewTab === 'daily' ? (
        <>
          {/* Date Controls & Quick Bulk Actions */}
          <div className="card p-4 flex flex-col xl:flex-row justify-between items-stretch xl:items-center gap-4 print:hidden">
            {/* Date Picker with Prev / Today / Next */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => changeDateBy(-1)}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 transition"
                title="Previous Day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="relative flex items-center">
                <Calendar className="w-4 h-4 text-emerald-600 absolute left-3 pointer-events-none" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => changeDateBy(1)}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 transition"
                title="Next Day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
                className={clsx(
                  'px-3 py-2 rounded-lg text-xs font-bold border transition',
                  selectedDate === format(new Date(), 'yyyy-MM-dd')
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                )}
              >
                Today (آج)
              </button>

              <button
                type="button"
                onClick={() => setSelectedDate(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 transition"
              >
                Yesterday (کل)
              </button>
            </div>

            {/* Search & One-Click Mark All */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 sm:w-56">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search employee..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {dailyStats.unmarked > 0 && (
                <button
                  type="button"
                  disabled={isSavingBulk}
                  onClick={() => handleMarkAll('Present', true)}
                  className="px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Mark Unmarked Present ({dailyStats.unmarked})
                </button>
              )}

              <button
                type="button"
                disabled={isSavingBulk}
                onClick={() => handleMarkAll('Present', false)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                {isSavingBulk ? 'Saving...' : 'Mark All Present (سب حاضر)'}
              </button>
            </div>
          </div>

          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 print:hidden">
            <div className="card p-3.5 border-l-4 border-l-slate-600">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Staff</div>
              <div className="text-2xl font-bold font-mono text-slate-800 dark:text-white mt-0.5">{dailyStats.total}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-emerald-500">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Present (حاضر)</div>
              <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">{dailyStats.present}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-rose-500">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Absent (غیر حاضر)</div>
              <div className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-0.5">{dailyStats.absent}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Half Day (ہاف ڈے)</div>
              <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-0.5">{dailyStats.halfDay}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-sky-500">
              <div className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">Leave / Late</div>
              <div className="text-2xl font-bold font-mono text-sky-600 dark:text-sky-400 mt-0.5">{dailyStats.leave + dailyStats.late}</div>
            </div>
            <div className="card p-3.5 border-l-4 border-l-orange-400">
              <div className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">Pending / Unmarked</div>
              <div className="text-2xl font-bold font-mono text-orange-600 dark:text-orange-400 mt-0.5">{dailyStats.unmarked}</div>
            </div>
          </div>

          {/* Print Header */}
          <div className="hidden print:block text-center mb-4 border-b-2 border-black pb-2">
            <h1 className="text-2xl font-black uppercase">{activeBranchName} — Daily Attendance Sheet</h1>
            <p className="text-sm font-bold">Date: {selectedDate} | Total Staff: {dailyStats.total} | Present: {dailyStats.present} | Absent: {dailyStats.absent}</p>
          </div>

          {/* Daily Attendance Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="p-3.5">#</th>
                    <th className="p-3.5">Employee / Labour Name</th>
                    <th className="p-3.5 text-center">One-Click Attendance Status (حاضری لگائیں)</th>
                    <th className="p-3.5 print:hidden">Time In / Out</th>
                    <th className="p-3.5">Remarks / Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {filteredEmployees.map((emp, index) => {
                    const rec = dailyMap[emp.id];
                    const currentStatus = rec?.status;
                    const draft = draftEdits[emp.id] || { checkIn: '09:00', checkOut: '21:00', remarks: '' };

                    return (
                      <tr
                        key={emp.id}
                        className={clsx(
                          'hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors',
                          !currentStatus && 'bg-amber-50/20 dark:bg-amber-950/10'
                        )}
                      >
                        <td className="p-3.5 font-mono text-xs text-slate-400">{index + 1}</td>
                        <td className="p-3.5">
                          <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <span>{emp.name}</span>
                            {currentStatus ? (
                              <span
                                className={clsx(
                                  'text-[10px] px-2 py-0.5 rounded-full font-bold border',
                                  STATUS_OPTIONS.find((s) => s.value === currentStatus)?.badgeClass
                                )}
                              >
                                {currentStatus}
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                                Not Marked
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {emp.role} {emp.phone ? `• ${emp.phone}` : ''}
                          </div>
                        </td>

                        {/* 1-Click Status Buttons */}
                        <td className="p-3.5">
                          <div className="flex flex-wrap items-center justify-center gap-1.5 print:hidden">
                            {STATUS_OPTIONS.map((opt) => {
                              const isSelected = currentStatus === opt.value;
                              const Icon = opt.icon;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  disabled={savingEmpId === emp.id}
                                  onClick={() => handleMarkAttendance(emp, opt.value)}
                                  className={clsx(
                                    'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 cursor-pointer select-none',
                                    isSelected
                                      ? opt.bgActive
                                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  )}
                                >
                                  <Icon className="w-3.5 h-3.5" />
                                  <span>{opt.label}</span>
                                  <span className="text-[10px] opacity-80 hidden sm:inline">({opt.urdu})</span>
                                </button>
                              );
                            })}
                          </div>
                          <div className="hidden print:block text-center font-bold">
                            {currentStatus || 'Unmarked'}
                          </div>
                        </td>

                        {/* Check-in / Check-out */}
                        <td className="p-3.5 print:hidden">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="time"
                              value={draft.checkIn || '09:00'}
                              onChange={(e) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [emp.id]: { ...prev[emp.id], checkIn: e.target.value }
                                }))
                              }
                              onBlur={() => rec && handleSaveDetails(emp)}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-900"
                            />
                            <span className="text-slate-400 text-xs">to</span>
                            <input
                              type="time"
                              value={draft.checkOut || '21:00'}
                              onChange={(e) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [emp.id]: { ...prev[emp.id], checkOut: e.target.value }
                                }))
                              }
                              onBlur={() => rec && handleSaveDetails(emp)}
                              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-900"
                            />
                          </div>
                        </td>

                        {/* Remarks */}
                        <td className="p-3.5">
                          <div className="flex items-center gap-1.5 print:hidden">
                            <input
                              type="text"
                              placeholder="Add note (e.g. sick, short leave)..."
                              value={draft.remarks || ''}
                              onChange={(e) =>
                                setDraftEdits((prev) => ({
                                  ...prev,
                                  [emp.id]: { ...prev[emp.id], remarks: e.target.value }
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSaveDetails(emp);
                                }
                              }}
                              className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-900"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveDetails(emp)}
                              title="Save Note"
                              className="p-1.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 text-slate-600 dark:text-slate-300 hover:text-emerald-600 border border-slate-200 dark:border-slate-700"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className="hidden print:inline text-xs">{draft.remarks || '-'}</span>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-slate-500 dark:text-slate-400">
                        <Users className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                        <p className="font-medium">No active employees found for this branch.</p>
                        <p className="text-xs mt-1">Add staff in the Labour / Employees section first.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Monthly Attendance Report Tab */
        <div className="space-y-4">
          <div className="card p-4 flex flex-wrap justify-between items-center gap-4 print:hidden">
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Select Month (مہینہ منتخب کریں):
              </label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold"
              />
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Showing monthly attendance summary for <strong>{selectedMonth}</strong> (Half Day = 0.5 working day)
            </div>
          </div>

          <div className="hidden print:block text-center mb-4 border-b-2 border-black pb-2">
            <h1 className="text-2xl font-black uppercase">{activeBranchName} — Monthly Attendance Summary</h1>
            <p className="text-sm font-bold">Month: {selectedMonth}</p>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="p-3.5">#</th>
                    <th className="p-3.5">Employee Name</th>
                    <th className="p-3.5 text-center text-emerald-600">Present (P)</th>
                    <th className="p-3.5 text-center text-purple-600">Late (LT)</th>
                    <th className="p-3.5 text-center text-amber-600">Half Day (HD)</th>
                    <th className="p-3.5 text-center text-sky-600">Leave (L)</th>
                    <th className="p-3.5 text-center text-rose-600">Absent (A)</th>
                    <th className="p-3.5 text-right">Net Working Days (For Salary)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {monthlySummary.map((row, idx) => (
                    <tr key={row.emp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3.5 font-mono text-xs text-slate-400">{idx + 1}</td>
                      <td className="p-3.5">
                        <div className="font-bold text-slate-800 dark:text-slate-100">{row.emp.name}</div>
                        <div className="text-xs text-slate-500">{row.emp.role}</div>
                      </td>
                      <td className="p-3.5 text-center font-mono font-bold text-emerald-600">{row.present}</td>
                      <td className="p-3.5 text-center font-mono font-bold text-purple-600">{row.late}</td>
                      <td className="p-3.5 text-center font-mono font-bold text-amber-600">{row.halfDay}</td>
                      <td className="p-3.5 text-center font-mono font-bold text-sky-600">{row.leave}</td>
                      <td className="p-3.5 text-center font-mono font-bold text-rose-600">{row.absent}</td>
                      <td className="p-3.5 text-right font-mono font-bold text-base text-slate-800 dark:text-slate-100">
                        <span className="px-2.5 py-1 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {row.effectiveDays} Days
                        </span>
                      </td>
                    </tr>
                  ))}
                  {monthlySummary.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-500">
                        No employees found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
