import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { collection, query, where, onSnapshot, Timestamp, orderBy, doc, setDoc, getDocs, getDoc, runTransaction, writeBatch, addDoc, updateDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { ReceiptCent, Folder, ArrowLeft, Plus, Printer, Trash2, CheckCircle, Calendar } from 'lucide-react';
import { printInvoice } from '../lib/print';
import { useSettings } from '../context/SettingsContext';

interface Employee {
  id: string;
  name: string;
  role: string;
  dailyWage: number;
  monthlySalary?: number;
  advanceBalance?: number;
}

interface Payslip {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  month: string;
  days?: number;
  baseSalary: number;
  advances: number;
  netPayable: number;
  date: number;
  paymentStatus?: 'Pending' | 'Paid';
}

export function Payroll() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [targetBranchId, setTargetBranchId] = useState('');
  
  // Pending list for batch creation
  const [pendingSlips, setPendingSlips] = useState<any[]>([]);

  // Form State
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
  const [activeFolderMonth, setActiveFolderMonth] = useState<string | null>(null);
  const [newFolderMonth, setNewFolderMonth] = useState('');
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
  const [days, setDays] = useState('26');
  const [batchWorkingDays, setBatchWorkingDays] = useState<string>('26');
  const [baseSalary, setBaseSalary] = useState('');
  const [advances, setAdvances] = useState('');
  const [recentAdvance, setRecentAdvance] = useState('');
  
  const getDaysInMonth = (_mStr?: string) => '30';
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPrintSlip, setSelectedPrintSlip] = useState<any>(null);

  useEffect(() => {
    if (!activeBranchId) return;

    // Fetch Employees
    let empQ: any = collection(db, 'employees');
    if (activeBranchId) {
      empQ = query(collection(db, 'employees'), where('branchId', '==', activeBranchId));
    }
    const unsubEmp = safeCollectionSnapshot(empQ, (snap) => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Employee)));
    });

    // Fetch Payslips
    let slipQ: any = collection(db, 'payroll');
    if (activeBranchId) {
      slipQ = query(collection(db, 'payroll'), where('branchId', '==', activeBranchId));
    }
    const unsubSlip = safeCollectionSnapshot(slipQ, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Payslip)).sort((a,b) => b.date - a.date);
      setPayslips(data);
    });

    // Fetch Attendance for automatic working days calculation
    let attQ: any = collection(db, 'attendance');
    if (activeBranchId) {
      attQ = query(collection(db, 'attendance'), where('branchId', '==', activeBranchId));
    }
    const unsubAtt = safeCollectionSnapshot(attQ, (snap) => {
      setAttendanceRecords(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    return () => {
      unsubEmp();
      unsubSlip();
      unsubAtt();
    };
  }, [user, activeBranchId]);

  const handleCalculateBase = (empId: string, currentMonth: string | null = month) => {
    if (!currentMonth) currentMonth = month;
    setSelectedEmpId(empId);
    const emp = employees.find(e => e.id === empId);
    if (emp) {
      // Check if attendance records exist for this employee & month
      const empMonthAtt = attendanceRecords.filter(
        r => r.employeeId === empId && (r.month === currentMonth || (r.date && r.date.startsWith(currentMonth)))
      );
      let attendedDaysStr = '';
      if (empMonthAtt.length > 0) {
        const present = empMonthAtt.filter(r => r.status === 'Present' || r.status === 'Late').length;
        const halfDay = empMonthAtt.filter(r => r.status === 'Half Day').length;
        attendedDaysStr = (present + halfDay * 0.5).toString();
      }

      if (emp.monthlySalary) {
        const dToKeep = attendedDaysStr || days || batchWorkingDays || '26';
        setDays(dToKeep);
        // Fixed standard 30-day formula for all months
        const dailyEq = emp.monthlySalary / 30;
        setBaseSalary(Math.round(dailyEq * Number(dToKeep)).toString());
      } else if (emp.dailyWage) {
        if (attendedDaysStr) {
          setDays(attendedDaysStr);
          setBaseSalary(Math.round(emp.dailyWage * Number(attendedDaysStr)).toString());
        } else {
          setBaseSalary('');
          setDays('');
        }
      } else {
        setBaseSalary('');
        setDays('');
      }
    } else {
      setBaseSalary('');
      setDays('');
    }
  };

  const handleDaysChange = (val: string, currentMonth: string = month) => {
    setDays(val);
    const emp = employees.find(e => e.id === selectedEmpId);
    if (!emp) return;

    const d = Number(val) || 0;
    if (emp.monthlySalary) {
      // Fixed standard 30-day formula for all months
      const dailyEq = emp.monthlySalary / 30;
      setBaseSalary(Math.round(dailyEq * d).toString());
    } else if (emp.dailyWage) {
      setBaseSalary((emp.dailyWage * d).toString());
    }
  };

  const handleMonthChange = (val: string) => {
    setMonth(val);
    if (selectedEmpId) {
      handleCalculateBase(selectedEmpId, val);
    }
  };

  const handleAddToList = (e: React.FormEvent) => {
    e.preventDefault();
    const branchToUse = activeBranchId || targetBranchId;
    if (!branchToUse) {
      alert("Please select a branch first");
      return;
    }

    const emp = employees.find(x => x.id === selectedEmpId);
    if (!emp) return;

    if (pendingSlips.some(s => s.employeeId === emp.id)) {
      alert("Employee already added to the list for this batch.");
      return;
    }

    const bSal = Number(baseSalary) || 0;
    const adv = Number(advances) || 0;
    const recAdv = Number(recentAdvance) || 0;
    const d = Number(days) || 0;
    const net = bSal - adv;

    setPendingSlips([...pendingSlips, {
      id: Math.random().toString(), // temp id
      employeeId: emp.id,
      employeeName: emp.name,
      branchId: branchToUse,
      month,
      days: d,
      baseSalary: bSal,
      previousAdvance: emp.advanceBalance || 0,
      advances: adv,
      recentAdvance: recAdv,
      remainingAdvance: (emp.advanceBalance || 0) - adv + recAdv,
      netPayable: net,
    }]);

    setSelectedEmpId('');
    setBaseSalary('');
    setAdvances('');
    setRecentAdvance('');
    setDays(batchWorkingDays || '26');
  };

  const handleSaveAllSlips = async () => {
    if (pendingSlips.length === 0) return;
    setIsSubmitting(true);
    try {
      for (const slip of pendingSlips) {
        const emp = employees.find(x => x.id === slip.employeeId);
        if (!emp) continue;

        const newSlip = {
          employeeId: slip.employeeId,
          employeeName: slip.employeeName,
          branchId: slip.branchId,
          month: slip.month,
          days: slip.days,
          baseSalary: slip.baseSalary,
          previousAdvance: slip.previousAdvance || 0,
          advances: slip.advances,
          recentAdvance: slip.recentAdvance || 0,
          remainingAdvance: slip.remainingAdvance || 0,
          netPayable: slip.netPayable,
          date: new Date().getTime(),
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid,
          paymentStatus: 'Pending'
        };

        await addDoc(collection(db, 'payroll'), newSlip);

        if (slip.advances > 0 || '') {
          await updateDoc(doc(db, 'employees', emp.id), {
            advanceBalance: (emp.advanceBalance || 0) - slip.advances + (slip.recentAdvance || 0),
            updatedAt: Timestamp.now()
          });
        }
        
        if (slip.recentAdvance && slip.recentAdvance > 0) {
          await addDoc(collection(db, 'ledger'), {
            branchId: slip.branchId,
            employeeId: slip.employeeId,
            date: slip.recentAdvanceDate || new Date().getTime(),
            description: `Advance Given with Salary: ${slip.employeeName} (${slip.month})`,
            category: 'Advance',
            type: 'OUT',
            amount: slip.recentAdvance,
            reference: 'Advance',
            createdAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid
          });
        }
        
        await addDoc(collection(db, 'ledger'), {
          branchId: slip.branchId,
          employeeId: slip.employeeId,
          date: new Date().getTime(),
          description: `Salary Paid: ${slip.employeeName} (${slip.month})`,
          category: 'Salary',
          type: 'OUT',
          amount: slip.netPayable,
          reference: `PAYROLL-${slip.month}`,
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });
      }

      setPendingSlips([]);
      setShowAdd(false);
    } catch (err: any) {
      alert("Error saving payroll batch: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkAsPaid = async (id: string) => {
    try {
      await updateDoc(doc(db, 'payroll', id), {
        paymentStatus: 'Paid',
        updatedAt: Timestamp.now()
      });
    } catch (err: any) {
      alert("Failed to update payment status: " + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!enableDeletion || 0) return;
    if (confirm("Are you sure you want to delete this payslip record? WARNING: This will NOT delete the auto-generated ledger entry.")) {
      try {
        await deleteDoc(doc(db, 'payroll', id));
      } catch (err: any) {
        alert("Failed to delete payslip: " + err.message);
      }
    }
  };

  const handlePrintSlip = (slip: any, type: 'a4' | 'thermal' = 'a4') => {
    setSelectedPrintSlip(slip);
    setTimeout(() => {
      printInvoice(type === 'thermal' ? 'individual-payslip-thermal-print' : 'individual-payslip-print', `Payslip - ${slip.employeeName}`, type);
    }, 100);
  };

  const filteredPayslips = payslips.filter(s => s.month === (activeFolderMonth || filterMonth));
  const uniqueMonths = Array.from(new Set<string>(payslips.map(s => s.month))).sort((a, b) => b.localeCompare(a));
  
  // Calculate stats for folders
  const getFolderStats = (m) => {
     const slips = payslips.filter(s => s.month === m);
     return {
        count: slips.length,
        total: slips.reduce((sum, s) => sum + s.netPayable, 0),
        liveNet: slips.reduce((sum, s) => {
          const emp = employees.find(e => e.id === s.employeeId);
          const currentAdv = Number(emp?.advanceBalance || 0);
          return sum + Math.max(0, (Number(s.baseSalary) || 0) - currentAdv);
        }, 0)
     };
  };

  const latestPayrollMonth = uniqueMonths.length > 0 ? uniqueMonths[0] : null;
  const latestMonthStats = latestPayrollMonth ? getFolderStats(latestPayrollMonth) : null;

  const handleStartNewMonth = (e) => {
    e.preventDefault();
    if(newFolderMonth) {
      setActiveFolderMonth(newFolderMonth);
      setMonth(newFolderMonth);
    }
  };

  const paidEmployeeIds = new Set(filteredPayslips.map(s => s.employeeId));
  const unpaidEmployees = employees.filter(e => e.status === 'active' && !paidEmployeeIds.has(e.id));

  return (
    <div className="space-y-6">
      {!activeFolderMonth ? (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center card p-4 gap-4 print:hidden">
            <div>
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
                <ReceiptCent className="w-6 h-6 mr-3 text-emerald-600" />
                Payroll & Salaries (Folders)
              </h2>
              {latestPayrollMonth && latestMonthStats && (
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">
                    Last Generated Payroll (<strong className="text-sky-600 dark:text-sky-400 font-mono">{latestPayrollMonth}</strong>): <strong className="font-mono text-slate-800 dark:text-slate-100">PKR {latestMonthStats.total.toLocaleString()}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-bold font-mono">
                    Current Net Payable (After Advances): PKR {latestMonthStats.liveNet.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
            <form onSubmit={handleStartNewMonth} className="flex items-center space-x-2">
              <input type="month" required value={newFolderMonth} onChange={e => setNewFolderMonth(e.target.value)} className="input-field max-w-[200px]" />
              <button type="submit" className="btn btn-primary flex items-center">
                <Plus size={18} className="mr-1" /> New Payroll Month
              </button>
            </form>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
             {uniqueMonths.map(m => {
               const stats = getFolderStats(m);
               return (
                 <div 
                   key={m} 
                   onClick={() => { setActiveFolderMonth(m); setMonth(m); }}
                   className="card p-6 cursor-pointer hover:border-sky-500 hover:shadow-md transition-all flex flex-col items-center justify-center text-center group"
                 >
                   <Folder className="w-16 h-16 text-sky-400 mb-4 group-hover:text-sky-500 transition-colors" fill="currentColor" opacity={0.2} />
                   <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{m}</h3>
                   <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{stats.count} Slips Generated</p>
                   <p className="text-sm font-semibold text-emerald-600 mt-1">Slip Net: PKR {stats.total.toLocaleString()}</p>
                   {stats.liveNet !== stats.total && (
                     <p className="text-xs font-mono text-sky-600 dark:text-sky-400 mt-0.5">
                       Remaining Net: PKR {stats.liveNet.toLocaleString()}
                     </p>
                   )}
                 </div>
               );
             })}
             {uniqueMonths.length === 0 && (
               <div className="col-span-full text-center py-12 text-slate-500">
                  No payroll folders yet. Create a new month above.
               </div>
             )}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center card p-4 gap-4 print:hidden">
            <div className="flex items-center gap-3">
              <button onClick={() => setActiveFolderMonth(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500">
                 <ArrowLeft size={20} />
              </button>
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center">
                <Folder className="w-6 h-6 mr-3 text-sky-500" fill="currentColor" />
                Payroll Folder: {activeFolderMonth}
              </h2>
            </div>
            
            <div className="flex items-center space-x-4">
              <button onClick={() => { setSelectedPrintSlip(null); setTimeout(() => printInvoice('payroll-print-content', 'Payroll Report', 'a4'), 100); }} className="btn btn-secondary flex items-center shadow-sm">
                <Printer className="w-5 h-5 mr-2" /> Print All
              </button>
              <button onClick={() => setShowAdd(!showAdd)} className="flex items-center px-4 py-2 bg-[#1e293b] text-sky-400 rounded-md hover:bg-slate-800 transition shadow-sm">
                <Plus className="w-5 h-5 mr-2" /> {showAdd ? 'Close Form' : 'Generate Payslip'}
              </button>
            </div>
          </div>



      {showAdd && activeFolderMonth && (
        <div className="card p-6 bg-slate-50 dark:bg-slate-800/50 print:hidden space-y-4">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                Generate Payslips for {activeFolderMonth}
              </h3>
              <p className="text-sm text-slate-500">Unpaid Employees: {unpaidEmployees.length}</p>
            </div>
            
            <button onClick={handleSaveAllSlips} disabled={isSubmitting || pendingSlips.length === 0} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 shadow-md border-0">
              {isSubmitting ? 'Saving...' : `Save ${pendingSlips.length} Slips to Ledger`}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-sky-500" />
                Working Days:
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={batchWorkingDays}
                  onChange={(e) => setBatchWorkingDays(e.target.value)}
                  className="w-16 text-center input-field py-1 px-2 text-sm font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700 rounded focus:ring-2 focus:ring-sky-500"
                  placeholder="26"
                />
                <button
                  type="button"
                  onClick={() => setBatchWorkingDays('26')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border transition-colors ${batchWorkingDays === '26' ? 'bg-sky-600 text-white border-sky-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'}`}
                >
                  26 Days (Standard)
                </button>
                <button
                  type="button"
                  onClick={() => setBatchWorkingDays('30')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border transition-colors ${batchWorkingDays === '30' ? 'bg-sky-600 text-white border-sky-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'}`}
                >
                  30 Days (Full Month / 30 دن)
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Days entered on an employee row automatically carry over to next employees.
            </p>
          </div>
          
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 dark:bg-slate-800">
                 <tr className="text-xs uppercase text-slate-500 dark:text-slate-400 font-bold tracking-wider">
                   <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">Employee</th>
                   <th className="px-2 py-3 border-b border-slate-200 dark:border-slate-700 text-center">Days</th>
                   <th className="px-2 py-3 border-b border-slate-200 dark:border-slate-700 text-right">Salary</th>
                   <th className="px-2 py-3 border-b border-slate-200 dark:border-slate-700 text-right text-amber-600">Prev Adv</th>
                   <th className="px-2 py-3 border-b border-slate-200 dark:border-slate-700 text-right text-rose-600">Deduct</th>
                   <th className="px-2 py-3 border-b border-slate-200 dark:border-slate-700 text-right text-blue-600">New Adv</th>
                   <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-right text-emerald-600">Net</th>
                   <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-right w-24">Action</th>
                 </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                 {employees.filter(e => e.status === 'active').map(emp => {
                    const alreadyPaid = filteredPayslips.find(s => s.employeeId === emp.id);
                    const isPending = pendingSlips.find(s => s.employeeId === emp.id);
                    
                    if (alreadyPaid) {
                      return (
                        <tr key={emp.id} className="bg-slate-50 dark:bg-slate-800/40 opacity-60">
                          <td className="px-4 py-3 text-sm font-medium">{emp.name} <span className="text-xs text-slate-500">({emp.role} • {emp.monthlySalary ? `M: ${emp.monthlySalary.toLocaleString()}` : `D: ${emp.dailyWage?.toLocaleString()}`})</span></td>
                          <td colSpan={6} className="px-4 py-3 text-sm text-slate-500 text-center">
                            Paid on {new Date(alreadyPaid.date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex items-center justify-end text-emerald-600 font-bold text-sm w-full">
                              <CheckCircle className="w-5 h-5 mr-1" /> Paid
                            </span>
                          </td>
                        </tr>
                      )
                    }
                    
                    if (isPending) {
                      return (
                        <tr key={emp.id} className="bg-sky-50 dark:bg-sky-900/20">
                          <td className="px-4 py-3 text-sm font-medium text-sky-900 dark:text-sky-100">{emp.name} <span className="text-xs text-sky-600/70">({emp.role} • {emp.monthlySalary ? `M: ${emp.monthlySalary.toLocaleString()}` : `D: ${emp.dailyWage?.toLocaleString()}`})</span></td>
                          <td colSpan={6} className="px-4 py-3 text-sm text-sky-700 dark:text-sky-300 text-center font-medium">
                            Added to list — Net Payable: PKR {isPending.netPayable.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => setPendingSlips(pendingSlips.filter(s => s.employeeId !== emp.id))} className="text-rose-500 hover:text-rose-700 text-xs font-semibold px-2 py-1 border border-rose-200 rounded bg-white">
                              Undo
                            </button>
                          </td>
                        </tr>
                      )
                    }
                    
                    return (
                      <EmployeePayrollRow 
                        key={emp.id} 
                        emp={emp} 
                        month={activeFolderMonth as string} 
                        defaultWorkingDays={batchWorkingDays}
                        attendanceRecords={attendanceRecords}
                        onDaysChangedByUser={(newDays) => setBatchWorkingDays(newDays)}
                        onAdd={(slip) => setPendingSlips([...pendingSlips, { id: Math.random().toString(), ...slip }])} 
                      />
                    );
                 })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      <div className="space-y-6 print:hidden">
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 font-semibold text-slate-800 dark:text-slate-100">
            Payslip History
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <tr className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Employee</th>
                  <th className="px-6 py-3">Month</th>
                  <th className="px-6 py-3 text-center">Days</th>
                  <th className="px-6 py-3 text-right">This Month Salary</th>
                  <th className="px-6 py-3 text-right text-amber-600">Previous Advance</th>
                  <th className="px-6 py-3 text-right text-rose-600">Deductions</th>
                  <th className="px-6 py-3 text-right text-blue-600">Advance Given</th>
                  <th className="px-6 py-3 text-right text-amber-600">Remaining Adv</th>
                  <th className="px-6 py-3 text-right text-emerald-600 font-bold">Net Paid</th>
                  <th className="px-6 py-3 text-center">Status</th>
                  <th className="px-6 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                {filteredPayslips.length === 0 ? (
                  <tr><td colSpan={12} className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No payroll records found for this month.</td></tr>
                ) : (
                  filteredPayslips.map(slip => (
                    <tr key={slip.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 text-sm">
                      <td className="px-6 py-4 whitespace-nowrap text-slate-500 dark:text-slate-400">{new Date(slip.date).toLocaleDateString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-medium text-slate-900 dark:text-slate-50">{slip.employeeName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono">{slip.month}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-center font-mono">{slip.days || '-'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-slate-700 dark:text-slate-200">{slip.baseSalary.toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-amber-600">{(slip.previousAdvance !== undefined ? slip.previousAdvance : (employees.find(e => e.id === slip.employeeId)?.advanceBalance || 0)).toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-rose-600">{(slip.advances || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-blue-600">{(slip.recentAdvance || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-amber-600">{(slip.remainingAdvance !== undefined ? slip.remainingAdvance : ((employees.find(e => e.id === slip.employeeId)?.advanceBalance || 0) - (slip.advances || 0) + (slip.recentAdvance || 0))).toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-emerald-600 font-bold">PKR {slip.netPayable.toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {slip.paymentStatus === 'Paid' ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            <CheckCircle className="w-3 h-3 mr-1" /> Paid
                          </span>
                        ) : (
                          <button 
                            onClick={() => handleMarkAsPaid(slip.id)}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
                          >
                            Mark Paid
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right flex justify-end gap-2">
                        <button onClick={() => handlePrintSlip(slip, 'thermal')} title="Thermal Print" className="text-emerald-500 hover:text-emerald-700">
                          <ReceiptCent className="w-4 h-4" />
                        </button>
                        <button onClick={() => handlePrintSlip(slip, 'a4')} title="A4 Print" className="text-sky-500 hover:text-sky-700">
                          <Printer className="w-4 h-4" />
                        </button>
                        {user?.role === 'super_admin' && enableDeletion && (
                          <button onClick={() => handleDelete(slip.id)} className="text-red-500 hover:text-red-700">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
                {payslips.length > 0 && (
                  <tr className="bg-slate-100 dark:bg-slate-950 font-bold border-t-2 border-slate-200 dark:border-slate-700 text-sm">
                    <td colSpan={4} className="px-6 py-4 whitespace-nowrap text-right text-slate-800 dark:text-slate-100 uppercase tracking-wider">Total</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-slate-800 dark:text-slate-100">{filteredPayslips.reduce((sum, s) => sum + s.baseSalary, 0).toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-amber-600">{filteredPayslips.reduce((sum, s) => sum + (s.previousAdvance !== undefined ? s.previousAdvance : (employees.find(e => e.id === s.employeeId)?.advanceBalance || 0)), 0).toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-rose-600">{filteredPayslips.reduce((sum, s) => sum + (s.advances || 0), 0).toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-blue-600">{filteredPayslips.reduce((sum, s) => sum + (s.recentAdvance || 0), 0).toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-amber-600"></td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-mono text-emerald-600">PKR {filteredPayslips.reduce((sum, s) => sum + s.netPayable, 0).toLocaleString()}</td>
                    <td className="px-6 py-4"></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* DEDICATED ALL-COMBINED PRINT VIEW (ONLY VISIBLE ON PRINT) */}
      {!selectedPrintSlip && (
        <div id="payroll-print-content" className="hidden print:block print:bg-white print:w-full print:static print:z-auto print:h-auto print:p-0 text-black font-sans" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
          <div className="text-center border-b-2 border-black pb-4 mb-5">
            <h1 className="text-3xl font-black uppercase tracking-widest text-black mb-1" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
               {activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || 'Manzoor Collection')}
            </h1>
            <h2 className="text-xl font-black text-black mt-1 uppercase tracking-wider" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
              Payroll Register - {activeFolderMonth || month}
            </h2>
            <p className="text-xs font-bold text-black mt-1" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
              Printed on {new Date().toLocaleString()}
            </p>
          </div>

          <table className="w-full text-xs mb-8 border-2 border-black border-collapse" style={{ borderColor: '#000000' }}>
            <thead className="bg-slate-200 border-b-2 border-black">
              <tr className="text-left font-black text-black uppercase tracking-wider text-[11px]" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
                <th className="px-2.5 py-2.5 border-2 border-black font-black text-black">Employee Name</th>
                <th className="px-2 py-2.5 border-2 border-black text-center font-black text-black">Days</th>
                <th className="px-2.5 py-2.5 border-2 border-black text-right font-black text-black">Monthly Salary</th>
                <th className="px-2.5 py-2.5 border-2 border-black text-right font-black text-black">This Month Salary</th>
                <th className="px-2.5 py-2.5 border-2 border-black text-right font-black text-black">Previous Advance</th>
                <th className="px-2.5 py-2.5 border-2 border-black text-right font-black text-black">Deductions</th>
                <th className="px-2.5 py-2.5 border-2 border-black text-right font-black text-black">Advance Given</th>
                <th className="px-2.5 py-2.5 border-2 border-black text-right font-black text-black">Remaining Adv</th>
                <th className="px-2.5 py-2.5 border-2 border-black text-right font-black text-black">Net Payable</th>
                <th className="px-2 py-2.5 border-2 border-black text-center font-black text-black">Status</th>
                <th className="px-3 py-2.5 border-2 border-black text-center font-black text-black">Signature</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black text-black" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
              {payslips.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-black font-black text-lg border-2 border-black">No payroll records found.</td></tr>
              ) : (
                filteredPayslips.map(slip => (
                  <tr key={slip.id} className="border-b border-black text-black font-bold">
                    <td className="px-2.5 py-2.5 font-black text-black border-2 border-black">{slip.employeeName}</td>
                    <td className="px-2 py-2.5 text-center font-mono font-bold text-black border-2 border-black">{slip.days || '-'}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono font-bold text-black border-2 border-black">{(employees.find(e => e.id === slip.employeeId)?.monthlySalary || 0).toLocaleString()}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono font-bold text-black border-2 border-black">{slip.baseSalary.toLocaleString()}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono font-bold text-black border-2 border-black">{(slip.previousAdvance !== undefined ? slip.previousAdvance : (employees.find(e => e.id === slip.employeeId)?.advanceBalance || 0)).toLocaleString()}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono font-bold text-black border-2 border-black">{(slip.advances || 0).toLocaleString()}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono font-bold text-black border-2 border-black">{(slip.recentAdvance || 0).toLocaleString()}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono font-bold text-black border-2 border-black">{(slip.remainingAdvance !== undefined ? slip.remainingAdvance : ((employees.find(e => e.id === slip.employeeId)?.advanceBalance || 0) - (slip.advances || 0) + (slip.recentAdvance || 0))).toLocaleString()}</td>
                    <td className="px-2.5 py-2.5 text-right font-mono font-black text-black border-2 border-black">PKR {slip.netPayable.toLocaleString()}</td>
                    <td className="px-2 py-2.5 text-center border-2 border-black text-xs font-black uppercase text-black">
                       {slip.paymentStatus || 'Pending'}
                    </td>
                    <td className="px-2 py-2.5 text-center align-bottom border-2 border-black">
                      <div className="w-24 mx-auto border-b-2 border-black pt-4"></div>
                    </td>
                  </tr>
                ))
              )}
              {payslips.length > 0 && (
                <tr className="bg-slate-200 font-black border-t-2 border-b-2 border-black text-xs text-black" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
                  <td className="px-2.5 py-3 text-right text-black uppercase tracking-wider border-2 border-black font-black">Total Amounts</td>
                  <td className="px-2 py-3 text-center font-mono text-black border-2 border-black font-black">{filteredPayslips.reduce((sum, s) => sum + (s.days || 0), 0)}</td>
                  <td className="px-2.5 py-3 text-right font-mono text-black border-2 border-black font-black">{filteredPayslips.reduce((sum, s) => sum + (employees.find(e => e.id === s.employeeId)?.monthlySalary || 0), 0).toLocaleString()}</td>
                  <td className="px-2.5 py-3 text-right font-mono text-black border-2 border-black font-black">{filteredPayslips.reduce((sum, s) => sum + s.baseSalary, 0).toLocaleString()}</td>
                  <td className="px-2.5 py-3 text-right font-mono text-black border-2 border-black font-black">{filteredPayslips.reduce((sum, s) => sum + (s.previousAdvance !== undefined ? s.previousAdvance : (employees.find(e => e.id === s.employeeId)?.advanceBalance || 0)), 0).toLocaleString()}</td>
                  <td className="px-2.5 py-3 text-right font-mono text-black border-2 border-black font-black">{filteredPayslips.reduce((sum, s) => sum + (s.advances || 0), 0).toLocaleString()}</td>
                  <td className="px-2.5 py-3 text-right font-mono text-black border-2 border-black font-black">{filteredPayslips.reduce((sum, s) => sum + (s.recentAdvance || 0), 0).toLocaleString()}</td>
                  <td className="px-2.5 py-3 text-right font-mono text-black border-2 border-black font-black"></td>
                  <td className="px-2.5 py-3 text-right font-mono font-black text-black border-2 border-black">PKR {filteredPayslips.reduce((sum, s) => sum + s.netPayable, 0).toLocaleString()}</td>
                  <td className="px-2 py-3 border-2 border-black"></td>
                  <td className="px-2 py-3 border-2 border-black"></td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-12 flex justify-between items-end px-6 text-black" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
            <div className="text-center">
              <div className="w-52 border-b-2 border-black mb-1.5"></div>
              <p className="text-xs font-black uppercase tracking-wider text-black">Accountant / Manager Signature</p>
            </div>
            <div className="text-center">
              <div className="w-52 border-b-2 border-black mb-1.5"></div>
              <p className="text-xs font-black uppercase tracking-wider text-black">Director / Owner Signature</p>
            </div>
          </div>

          <div className="mt-8 text-center text-xs font-bold text-black italic" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
            This payroll register is a computer-generated official document.
          </div>
        </div>
      )}

      {selectedPrintSlip && (
        <div id="individual-payslip-print" className="hidden print:block print:bg-white print:w-full print:static print:z-auto print:h-auto print:p-0 text-black font-sans" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
          <div className="max-w-2xl mx-auto border-2 border-black p-8 text-black" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
            <div className="text-center border-b-2 border-black pb-6 mb-6">
              <h1 className="text-3xl font-black uppercase tracking-widest text-black mb-1" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
                {activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || 'Manzoor Collection')}
              </h1>
              {(branches.find(b => b.id === activeBranchId)?.phone || branches.find(b => b.id === activeBranchId)?.phone2) && (
                <p className="text-sm font-bold text-black mb-0.5" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
                  {branches.find(b => b.id === activeBranchId)?.phone && <span>Phone 1: {branches.find(b => b.id === activeBranchId)?.phone}</span>}
                  {branches.find(b => b.id === activeBranchId)?.phone && branches.find(b => b.id === activeBranchId)?.phone2 && <span> | </span>}
                  {branches.find(b => b.id === activeBranchId)?.phone2 && <span>Phone 2: {branches.find(b => b.id === activeBranchId)?.phone2}</span>}
                </p>
              )}
              {branches.find(b => b.id === activeBranchId)?.address && (
                <p className="text-sm font-bold text-black mb-1" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
                  {branches.find(b => b.id === activeBranchId)?.address}
                </p>
              )}
              {branches.find(b => b.id === activeBranchId)?.onlinePhone && (
                <p className="text-sm font-bold text-black mb-1" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
                  Online Support: {branches.find(b => b.id === activeBranchId)?.onlinePhone}
                </p>
              )}
              <p className="text-base font-black text-black uppercase tracking-widest mt-2 border-2 border-black py-1 inline-block px-5">SALARY SLIP</p>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6 text-sm border-b-2 border-black pb-4 text-black">
              <div>
                <p className="font-bold text-xs uppercase tracking-wider text-black mb-1">Employee Details</p>
                <p className="font-black text-xl text-black">{selectedPrintSlip.employeeName}</p>
                {employees.find(e => e.id === selectedPrintSlip.employeeId)?.role && (
                  <p className="text-xs font-bold text-black uppercase mt-0.5">{employees.find(e => e.id === selectedPrintSlip.employeeId)?.role}</p>
                )}
              </div>
              <div className="text-right">
                <p className="font-bold text-xs uppercase tracking-wider text-black mb-1">Payslip Period</p>
                <p className="font-black text-xl text-black">{selectedPrintSlip.month}</p>
                <p className="text-xs font-bold text-black mt-1 uppercase">
                  Status: <span className="font-black">{selectedPrintSlip.paymentStatus === 'Paid' ? 'PAID' : 'PENDING'}</span>
                </p>
              </div>
            </div>

            <table className="w-full text-sm mb-6 border-2 border-black border-collapse">
              <thead className="bg-slate-200 border-b-2 border-black text-black">
                <tr>
                  <th className="py-2.5 px-4 text-left font-black text-black uppercase tracking-wider border-r-2 border-black">Description</th>
                  <th className="py-2.5 px-4 text-right font-black text-black uppercase tracking-wider">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black text-black font-semibold">
                <tr className="border-b border-black">
                  <td className="py-3 px-4 font-bold text-black border-r-2 border-black">
                    Monthly Salary (Full Month Rate)
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-black">{(employees.find(e => e.id === selectedPrintSlip.employeeId)?.monthlySalary || 0).toLocaleString()}</td>
                </tr>
                <tr className="border-b border-black bg-slate-100 font-bold">
                  <td className="py-3 px-4 flex items-center justify-between text-black font-black border-r-2 border-black">
                    <span>This Month Salary</span>
                    {selectedPrintSlip.days && <span className="text-xs font-bold text-black ml-2">({selectedPrintSlip.days} Working Days)</span>}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-black text-black">{selectedPrintSlip.baseSalary.toLocaleString()}</td>
                </tr>
                {(selectedPrintSlip.previousAdvance !== undefined ? selectedPrintSlip.previousAdvance : (employees.find(e => e.id === selectedPrintSlip.employeeId)?.advanceBalance || '') > 0) && (
                  <tr className="border-b border-black">
                    <td className="py-3 px-4 font-bold text-black border-r-2 border-black">Previous Advance (Owed before this payroll)</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-black">{(selectedPrintSlip.previousAdvance !== undefined ? selectedPrintSlip.previousAdvance : (employees.find(e => e.id === selectedPrintSlip.employeeId)?.advanceBalance || 0)).toLocaleString()}</td>
                  </tr>
                )}
                {selectedPrintSlip.advances > 0 && (
                  <tr className="border-b border-black">
                    <td className="py-3 px-4 font-bold text-black border-r-2 border-black">Advance Deduction (Deducted from Salary)</td>
                    <td className="py-3 px-4 text-right font-mono font-black text-black">-{(selectedPrintSlip.advances || 0).toLocaleString()}</td>
                  </tr>
                )}
                {selectedPrintSlip.recentAdvance > 0 && (
                  <tr className="border-b border-black">
                    <td className="py-3 px-4 font-bold text-black border-r-2 border-black">New Advance Given Now</td>
                    <td className="py-3 px-4 text-right font-mono font-black text-black">+{(selectedPrintSlip.recentAdvance || 0).toLocaleString()}</td>
                  </tr>
                )}
                {((selectedPrintSlip.remainingAdvance !== undefined ? selectedPrintSlip.remainingAdvance : ((employees.find(e => e.id === selectedPrintSlip.employeeId)?.advanceBalance || 0) - (selectedPrintSlip.advances || 0) + (selectedPrintSlip.recentAdvance || 0))) > 0) && (
                  <tr className="border-t-2 border-b-2 border-black bg-slate-100 font-bold">
                    <td className="py-2.5 px-4 font-black text-black text-xs uppercase tracking-wider border-r-2 border-black">Remaining Advance Balance</td>
                    <td className="py-2.5 px-4 text-right font-mono font-black text-black">{(selectedPrintSlip.remainingAdvance !== undefined ? selectedPrintSlip.remainingAdvance : ((employees.find(e => e.id === selectedPrintSlip.employeeId)?.advanceBalance || 0) - (selectedPrintSlip.advances || 0) + (selectedPrintSlip.recentAdvance || 0))).toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="flex justify-end p-4 border-2 border-black rounded mb-8 bg-slate-100">
              <div className="text-right">
                <p className="text-xs font-black uppercase tracking-widest mb-1 text-black">NET PAYABLE AMOUNT</p>
                <p className="text-3xl font-black text-black font-mono">PKR {selectedPrintSlip.netPayable.toLocaleString()}</p>
              </div>
            </div>

            <div className="mt-12 flex justify-between items-end text-black">
              <div className="border-t-2 border-black pt-2 w-48 text-center text-xs font-black uppercase tracking-wider text-black">
                Employer Signature
              </div>
              <div className="border-t-2 border-black pt-2 w-48 text-center text-xs font-black uppercase tracking-wider text-black">
                Employee Signature
              </div>
            </div>
            
            <div className="text-center mt-8 text-xs font-bold text-black italic">
              This is a computer generated document and requires no stamp.
            </div>
          </div>
        </div>
      )}

      {selectedPrintSlip && (
        <div id="individual-payslip-thermal-print" className="hidden print:block print:bg-white text-black font-mono" style={{ color: '#000000', WebkitTextFillColor: '#000000', fontFamily: 'monospace' }}>
          <div className="p-3 text-black text-xs font-bold leading-tight" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
            <div className="text-center mb-3">
              <h1 className="text-base font-black uppercase tracking-wider text-black">{activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || 'Business')}</h1>
              <p className="text-sm font-black text-black">SALARY SLIP - {selectedPrintSlip.month}</p>
              <div className="border-b-2 border-black border-dashed my-2"></div>
            </div>

            <div className="space-y-1.5 font-bold text-black" style={{ color: '#000000', WebkitTextFillColor: '#000000' }}>
              <p><strong>Employee:</strong> <span className="font-black text-sm">{selectedPrintSlip.employeeName}</span></p>
              <p><strong>Date:</strong> {new Date(selectedPrintSlip.date).toLocaleDateString()}</p>
              {selectedPrintSlip.days && <p><strong>Days:</strong> {selectedPrintSlip.days} Working Days</p>}
              <div className="border-b-2 border-black border-dashed my-2"></div>

              <div className="flex justify-between font-bold text-black">
                <span>Base Salary:</span>
                <span className="font-black">{selectedPrintSlip.baseSalary.toLocaleString()}</span>
              </div>
              {selectedPrintSlip.advances > 0 && (
                <div className="flex justify-between font-bold text-black">
                  <span>Adv Deduction:</span>
                  <span className="font-black">-{selectedPrintSlip.advances.toLocaleString()}</span>
                </div>
              )}
              {selectedPrintSlip.recentAdvance > 0 && (
                <div className="flex justify-between font-bold text-black">
                  <span>New Advance:</span>
                  <span className="font-black">+{selectedPrintSlip.recentAdvance.toLocaleString()}</span>
                </div>
              )}
              {selectedPrintSlip.remainingAdvance > 0 && (
                <div className="flex justify-between font-bold text-black">
                  <span>Rem Advance:</span>
                  <span className="font-black">{selectedPrintSlip.remainingAdvance.toLocaleString()}</span>
                </div>
              )}
              <div className="border-b-2 border-black border-dashed my-2"></div>
              <div className="flex justify-between text-base font-black text-black">
                <span>NET PAYABLE:</span>
                <span>PKR {selectedPrintSlip.netPayable.toLocaleString()}</span>
              </div>
              <div className="border-b-2 border-black border-dashed my-2"></div>
              
              <div className="mt-6 flex justify-between pt-6 text-black font-bold">
                <div className="text-center">
                  <div className="w-20 border-b-2 border-black mb-1"></div>
                  <p className="text-[10px] font-black uppercase text-black">Employer</p>
                </div>
                <div className="text-center">
                  <div className="w-20 border-b-2 border-black mb-1"></div>
                  <p className="text-[10px] font-black uppercase text-black">Labour</p>
                </div>
              </div>
            </div>

            <div className="mt-4 text-center text-xs font-bold text-black">
              <p>Printed: {new Date().toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}


interface EmployeePayrollRowProps {
  emp: any;
  month: string;
  defaultWorkingDays?: string;
  attendanceRecords?: any[];
  onDaysChangedByUser?: (newDays: string) => void;
  onAdd: (slip: any) => void;
}

const EmployeePayrollRow: React.FC<EmployeePayrollRowProps> = ({ 
  emp, 
  month, 
  defaultWorkingDays, 
  attendanceRecords = [],
  onDaysChangedByUser, 
  onAdd 
}) => {
  const [days, setDays] = React.useState(defaultWorkingDays || '26');
  const [isCustomized, setIsCustomized] = React.useState(false);
  const [baseSalary, setBaseSalary] = React.useState('');
  const [deductions, setDeductions] = React.useState(emp.advanceBalance > 0 ? String(emp.advanceBalance) : '');
  const [newAdvance, setNewAdvance] = React.useState('');
  const [newAdvanceDate, setNewAdvanceDate] = React.useState(new Date().toISOString().substring(0, 10));

  const empAtt = React.useMemo(() => {
    const recs = (attendanceRecords || []).filter(
      (r: any) => r.employeeId === emp.id && (r.month === month || (r.date && String(r.date).startsWith(month)))
    );
    const absent = recs.filter((r: any) => r.status === 'Absent').length;
    const leave = recs.filter((r: any) => r.status === 'Leave').length;
    const halfDay = recs.filter((r: any) => r.status === 'Half Day').length;
    const present = recs.filter((r: any) => r.status === 'Present' || r.status === 'Late').length;
    const chutiDays = absent + leave + halfDay * 0.5;
    return { totalRecs: recs.length, absent, leave, halfDay, present, chutiDays };
  }, [attendanceRecords, emp.id, month]);

  React.useEffect(() => {
    if (!isCustomized) {
      // Standard fixed 30-day formula for all months (salary always divided by 30)
      const daysInMonth = 30;

      let activeDays = defaultWorkingDays || '26';
      if (empAtt.totalRecs > 0) {
        if (empAtt.chutiDays > 0 && emp.monthlySalary) {
          // Deduct chutiyan from standard 30 days (or default working days if lower)
          const baseTotalDays = Number(defaultWorkingDays) || 30;
          activeDays = Math.max(0, baseTotalDays - empAtt.chutiDays).toString();
        } else if (empAtt.present + empAtt.halfDay > 0 && !emp.monthlySalary) {
          activeDays = (empAtt.present + empAtt.halfDay * 0.5).toString();
        }
      }

      setDays(activeDays);
      const d = Number(activeDays) || 0;
      if (emp.monthlySalary) {
        // Always divide by 30
        const dailyEq = emp.monthlySalary / 30;
        setBaseSalary(Math.round(dailyEq * d).toString());
      } else if (emp.dailyWage) {
        setBaseSalary(Math.round(emp.dailyWage * d).toString());
      }
    }
  }, [defaultWorkingDays, isCustomized, emp, month, empAtt]);

  const handleDaysChange = (val: string) => {
    setDays(val);
    setIsCustomized(true);
    if (onDaysChangedByUser && val) {
      onDaysChangedByUser(val);
    }
    const d = Number(val) || 0;
    if (emp.monthlySalary) {
      // Always divide by 30
      const dailyEq = emp.monthlySalary / 30;
      setBaseSalary(Math.round(dailyEq * d).toString());
    } else if (emp.dailyWage) {
      setBaseSalary((emp.dailyWage * d).toString());
    }
  };

  const bSal = Number(baseSalary) || 0;
  const ded = Number(deductions) || 0;
  const newAdv = Number(newAdvance) || 0;
  const net = bSal - ded;
  const remAdv = (emp.advanceBalance || 0) - ded + newAdv;

  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <td className="px-4 py-3 text-sm font-bold text-slate-900 dark:text-slate-100">
        {emp.name} 
        <span className="block text-[10px] font-normal text-slate-500 uppercase tracking-wider">
          {emp.role} • {emp.monthlySalary ? `Monthly: ${emp.monthlySalary.toLocaleString()}` : `Daily: ${emp.dailyWage?.toLocaleString()}`}
        </span>
        {empAtt.chutiDays > 0 && (
          <span className="inline-block mt-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
            Chuti/Absent: {empAtt.chutiDays} days
          </span>
        )}
      </td>
      <td className="px-2 py-3 text-center">
        <input type="number" value={days} onChange={e => handleDaysChange(e.target.value)} className="w-12 text-center input-field py-1 px-1 text-sm bg-slate-50 dark:bg-slate-900 border-slate-200 shadow-inner" placeholder="0" />
      </td>
      <td className="px-2 py-3">
        <input type="number" value={baseSalary} onChange={e => setBaseSalary(e.target.value)} className="w-20 text-right input-field py-1 px-2 text-sm bg-slate-50 dark:bg-slate-900 border-slate-200 shadow-inner" placeholder="0" />
      </td>
      <td className="px-2 py-3 text-right text-sm text-amber-600 font-mono font-medium">
        {(emp.advanceBalance || 0).toLocaleString()}
      </td>
      <td className="px-2 py-3">
        <input type="number" value={deductions} onChange={e => setDeductions(e.target.value)} className="w-20 text-right input-field py-1 px-2 text-sm border-rose-200 bg-rose-50/50 dark:bg-rose-900/10 dark:border-rose-800 focus:border-rose-500 focus:ring-rose-500 shadow-inner" placeholder="0" />
      </td>
      <td className="px-2 py-3">
        <div className="flex flex-col gap-1">
          <input type="number" value={newAdvance} onChange={e => setNewAdvance(e.target.value)} className="w-20 text-right input-field py-1 px-2 text-sm border-blue-200 bg-blue-50/50 dark:bg-blue-900/10 dark:border-blue-800 focus:border-blue-500 focus:ring-blue-500 shadow-inner" placeholder="0" />
          {Number(newAdvance) > 0 && (
            <input type="date" value={newAdvanceDate} onChange={e => setNewAdvanceDate(e.target.value)} className="w-20 text-[10px] input-field py-0.5 px-1 bg-white" />
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right text-sm font-bold text-emerald-600 font-mono">
        {net.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right">
        <button 
          onClick={() => onAdd({
            employeeId: emp.id,
            employeeName: emp.name,
            branchId: emp.branchId,
            month: month,
            days: Number(days) || 0,
            baseSalary: bSal,
            previousAdvance: emp.advanceBalance || 0,
            advances: ded,
            recentAdvance: newAdv,
            recentAdvanceDate: new Date(newAdvanceDate).getTime(),
            remainingAdvance: remAdv,
            netPayable: net,
          })}
          className="btn btn-primary py-1.5 px-3 text-xs w-full font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-sm"
        >
          Add ➔
        </button>
      </td>
    </tr>
  )
}
