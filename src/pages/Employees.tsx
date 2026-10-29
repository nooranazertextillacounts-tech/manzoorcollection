import { UsersRound, Plus, Trash2, Edit2, Printer, X, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useSettings } from '../context/SettingsContext';
import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc, Timestamp, getDocs, setDoc, getDoc, runTransaction, writeBatch, addDoc, updateDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { printInvoice } from '../lib/print';
import { safeFormat } from '../lib/utils';

interface Employee {
  id: string;
  name: string;
  fatherName?: string;
  cnic?: string;
  joiningDate?: string;
  post?: string;
  role: string;
  phone: string;
  dailyWage: number;
  monthlySalary: number;
  advanceBalance?: number;
  status: 'active' | 'inactive';
  branchId: string;
}

export function Employees() { 
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payslips, setPayslips] = useState<any[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [advanceLedgerRecords, setAdvanceLedgerRecords] = useState<any[]>([]);
  const [employeePurchasesList, setEmployeePurchasesList] = useState<any[]>([]);
  const [employeeReturnsList, setEmployeeReturnsList] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Advance Modal State
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceEmp, setAdvanceEmp] = useState<Employee | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceDesc, setAdvanceDesc] = useState('');
  const [advanceDate, setAdvanceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [advanceHistory, setAdvanceHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [currentPrintRecord, setCurrentPrintRecord] = useState<any>(null);
  const [showSlipPreviewModal, setShowSlipPreviewModal] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [cnic, setCnic] = useState('');
  const [joiningDate, setJoiningDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [post, setPost] = useState('');
  const [role, setRole] = useState('Labour');
  const [phone, setPhone] = useState('');
  const [wage, setWage] = useState('');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!showAdvanceModal || 0) {
      setAdvanceHistory([]);
      return;
    }

    setLoadingHistory(true);
    let isSubscribed = true;

    const fetchHistory = async () => {
      try {
        const ledgerQuery = query(collection(db, 'ledger'), where('reference', '==', 'Advance'));
        const payrollQuery = query(collection(db, 'payroll'), where('employeeId', '==', advanceEmp.id), where('advances', '>', 0));

        const [ledgerSnap, payrollSnap] = await Promise.all([
          safeGetDocs(ledgerQuery),
          safeGetDocs(payrollQuery)
        ]);

        if (!isSubscribed) return;

        const history: any[] = [];

        ledgerSnap.forEach((docSnap: any) => {
          const data = docSnap.data() as any;
          if (data.employeeId === advanceEmp.id) {
             const isReturn = data.type === 'IN' || String(data.description || '').toLowerCase().includes('return');
             history.push({
               id: docSnap.id,
               date: data.date,
               type: isReturn ? 'return' : 'issue',
               amount: Number(data.amount) || 0,
               previousAdvance: data.previousAdvance,
               totalAdvance: data.totalAdvance,
               desc: data.description,
               refId: docSnap.id
             });
          }
        });

        employeeReturnsList.forEach((ret: any) => {
          if (ret.employeeId === advanceEmp.id) {
            const alreadyInLedger = history.some(h => String(h.desc || '').includes(ret.returnNo));
            if (!alreadyInLedger) {
              history.push({
                id: `ret-${ret.id}`,
                date: ret.date,
                type: 'return',
                amount: Number(ret.total) || 0,
                desc: `Employee Return (Ret: ${ret.returnNo})`,
                refId: ret.id
              });
            }
          }
        });

        payrollSnap.forEach((docSnap: any) => {
          const data = docSnap.data() as any;
          history.push({
            id: `payroll-${docSnap.id}`,
            date: data.date,
            type: 'deduction',
            amount: data.advances,
            desc: `Payroll Deduction (${data.period})`,
            refId: docSnap.id
          });
        });

        history.sort((a, b) => b.date - a.date);
        setAdvanceHistory(history);
      } catch (err) {
        console.error("Error fetching history:", err);
      } finally {
        if (isSubscribed) setLoadingHistory(false);
      }
    };

    fetchHistory();

    return () => { isSubscribed = false; };
  }, [showAdvanceModal, advanceEmp, user]);

  useEffect(() => {
    if (showAdd && !selectedBranchId) {
      if (activeBranchId) setSelectedBranchId(activeBranchId);
      else if (branches.length > 0) setSelectedBranchId(branches[0].id);
    }
  }, [showAdd, activeBranchId, branches]);

  useEffect(() => {
    if (!activeBranchId) return;

    const q = user?.role === 'super_admin' && !activeBranchId
      ? collection(db, 'employees')
      : query(collection(db, 'employees'), where('branchId', '==', activeBranchId));

    const unsubEmp = safeCollectionSnapshot(q, (snap) => {
      setEmployees(snap.docs.map(d => ({ ...(d.data() as any), id: d.id } as Employee)));
    });

    const slipQ = user?.role === 'super_admin' && !activeBranchId
      ? collection(db, 'payroll')
      : query(collection(db, 'payroll'), where('branchId', '==', activeBranchId));

    const unsubSlip = safeCollectionSnapshot(slipQ, (snap) => {
      const list = snap.docs
        .map(d => ({ ...(d.data() as any), id: d.id }))
        .sort((a: any, b: any) => (b.date || 0) - (a.date || 0));
      setPayslips(list);
    });

    const attQ = user?.role === 'super_admin' && !activeBranchId
      ? collection(db, 'attendance')
      : query(collection(db, 'attendance'), where('branchId', '==', activeBranchId));

    const unsubAtt = safeCollectionSnapshot(attQ, (snap) => {
      setAttendanceRecords(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })));
    });

    const advLedgerQ = query(collection(db, 'ledger'), where('reference', '==', 'Advance'));
    const unsubAdvLedger = safeCollectionSnapshot(advLedgerQ, (snap) => {
      setAdvanceLedgerRecords(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })));
    });

    const empPurchQ = user?.role === 'super_admin' && !activeBranchId
      ? collection(db, 'employeePurchases')
      : query(collection(db, 'employeePurchases'), where('branchId', '==', activeBranchId));
    const unsubEmpPurch = safeCollectionSnapshot(empPurchQ, (snap) => {
      setEmployeePurchasesList(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })));
    });

    const empRetQ = user?.role === 'super_admin' && !activeBranchId
      ? collection(db, 'employeeReturns')
      : query(collection(db, 'employeeReturns'), where('branchId', '==', activeBranchId));
    const unsubEmpRet = safeCollectionSnapshot(empRetQ, (snap) => {
      setEmployeeReturnsList(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })));
    });

    return () => {
      unsubEmp();
      unsubSlip();
      unsubAtt();
      unsubAdvLedger();
      unsubEmpPurch();
      unsubEmpRet();
    };
  }, [user, activeBranchId]);

  const resetForm = () => {
    setName('');
    setFatherName('');
    setCnic('');
    setJoiningDate(format(new Date(), 'yyyy-MM-dd'));
    setPost('');
    setRole('Labour');
    setPhone('');
    setWage('');
    setMonthlySalary('');
    setStatus('active');
    setEditingId(null);
    setShowAdd(false);
  };

  const handleEditInit = (emp: Employee) => {
    setName(emp.name);
    setFatherName(emp.fatherName || '');
    setCnic(emp.cnic || '');
    setJoiningDate(emp.joiningDate || format(new Date(), 'yyyy-MM-dd'));
    setPost(emp.post || '');
    setRole(emp.role);
    setPhone(emp.phone || '');
    setWage(emp.dailyWage?.toString() || '');
    setMonthlySalary(emp.monthlySalary?.toString() || '');
    setStatus(emp.status || 'active');
    setEditingId(emp.id);
    setShowAdd(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const branchToUse = selectedBranchId || activeBranchId;
    if (!branchToUse) {
      alert("Please select a specific branch to add employees.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, 'employees', editingId), {
          name,
          role,
          phone,
          dailyWage: Number(wage) || 0,
          monthlySalary: Number(monthlySalary) || 0,
          status,
          updatedAt: Timestamp.now()
        });
      } else {
        await addDoc(collection(db, 'employees'), {
          branchId: branchToUse,
          name,
          role,
          phone,
          dailyWage: Number(wage) || 0,
          monthlySalary: Number(monthlySalary) || 0,
          status,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });
      }
      resetForm();
      setSelectedBranchId(activeBranchId || 0);
    } catch (err: any) {
      alert("Error saving employee: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to remove this employee/labour?")) {
      try {
        await deleteDoc(doc(db, 'employees', id));
      } catch(err: any) {
        alert("Error deleting employee: " + err.message);
      }
    }
  };

  const handleAddAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advanceEmp) return;
    setIsSubmitting(true);
    try {
      const amount = Number(advanceAmount);
      const dateVal = new Date(advanceDate).getTime();
      const desc = `Advance to ${advanceEmp.name} ${advanceDesc ? '('+advanceDesc+')' : ''}`;
      
      const pInfoBefore = getEmployeePayrollInfo(advanceEmp);
      const previousAdvance = pInfoBefore.totalAdvanceTaken;
      const totalAdvance = previousAdvance + amount;
      const payrollSalary = pInfoBefore.grossEarned;
      const remainingNetPay = payrollSalary - totalAdvance;

      // Update employee's advance balance
      const newAdvanceBalance = (Number(advanceEmp.advanceBalance) || 0) + amount;
      await updateDoc(doc(db, 'employees', advanceEmp.id), {
        advanceBalance: newAdvanceBalance,
        updatedAt: Timestamp.now()
      });
      setAdvanceEmp({ ...advanceEmp, advanceBalance: newAdvanceBalance });
      // Add to Ledger as Cash OUT
      const ledgerDoc = await addDoc(collection(db, 'ledger'), {
        branchId: advanceEmp.branchId,
        employeeId: advanceEmp.id,
        date: dateVal,
        description: desc,
        category: 'Payment',
        type: 'OUT',
        amount: amount,
        previousAdvance: previousAdvance,
        totalAdvance: totalAdvance,
        reference: 'Advance',
        createdAt: Timestamp.now(),
        tenantId: user?.tenantId || user?.uid
      });

      // Show receipt for printing
      const newRecord = {
        id: ledgerDoc.id,
        date: dateVal,
        amount: amount,
        previousAdvance: previousAdvance,
        totalAdvance: totalAdvance,
        payrollSalary: payrollSalary,
        remainingNetPay: remainingNetPay,
        desc: desc,
        note: advanceDesc || 'Cash Advance',
        employeeName: advanceEmp.name,
        employeeRole: advanceEmp.post || advanceEmp.role,
        employeePhone: advanceEmp.phone || '-'
      };
      
      setCurrentPrintRecord(newRecord);
      setShowSlipPreviewModal(true);
      setAdvanceHistory(prev => [
        {
          id: ledgerDoc.id,
          date: dateVal,
          type: 'issue',
          amount: amount,
          previousAdvance: previousAdvance,
          totalAdvance: totalAdvance,
          desc: desc,
          refId: ledgerDoc.id
        },
        ...prev
      ]);
      
      setAdvanceAmount('');
      setAdvanceDesc('');
      setAdvanceDate(format(new Date(), 'yyyy-MM-dd'));
    } catch (err: any) {
      alert("Error adding advance: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintAdvanceReceipt = (record: any, empOverride?: Employee) => {
    const targetEmp = empOverride || advanceEmp;
    const pInfo = targetEmp ? getEmployeePayrollInfo(targetEmp) : null;

    let prevAdv = record.previousAdvance;
    let totAdv = record.totalAdvance;
    const currAdv = Number(record.amount) || 0;

    if (prevAdv === undefined || totAdv === undefined) {
      // Compute historical running balance up to this record if available in advanceHistory
      if (advanceHistory.length > 0 && advanceHistory.some(h => h.id === record.id)) {
        const sorted = [...advanceHistory].sort((a, b) => a.date - b.date);
        let running = 0;
        for (const item of sorted) {
          if (item.id === record.id) {
            prevAdv = Math.max(0, running);
            totAdv = prevAdv + currAdv;
            break;
          }
          if (item.type === 'issue') running += (Number(item.amount) || 0);
          else running -= (Number(item.amount) || 0);
        }
      }
      if (prevAdv === undefined || totAdv === undefined) {
        const currentTotalAdv = pInfo ? pInfo.totalAdvanceTaken : (Number(targetEmp?.advanceBalance) || 0);
        totAdv = currentTotalAdv;
        prevAdv = Math.max(0, currentTotalAdv - currAdv);
      }
    }

    const payrollSalary = record.payrollSalary !== undefined ? record.payrollSalary : (pInfo ? pInfo.grossEarned : (Number(targetEmp?.monthlySalary) || 0));
    const remainingNetPay = payrollSalary - totAdv;

    setCurrentPrintRecord({
      ...record,
      amount: currAdv,
      previousAdvance: prevAdv,
      totalAdvance: totAdv,
      payrollSalary,
      remainingNetPay,
      employeeName: targetEmp?.name || record.employeeName,
      employeeRole: targetEmp?.post || targetEmp?.role || record.employeeRole || 'Labour',
      employeePhone: targetEmp?.phone || record.employeePhone || '-'
    });
    setShowSlipPreviewModal(true);
  };

  const handlePrintEmployeeThermalSlip = (emp: Employee) => {
    const pInfo = getEmployeePayrollInfo(emp);
    const empAdvances = advanceLedgerRecords
      .filter(l => l.employeeId === emp.id && l.type !== 'IN' && !String(l.description || '').toLowerCase().includes('return'))
      .sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));

    const latestRec = empAdvances[0];
    const currentTotalAdv = pInfo.totalAdvanceTaken;
    const latestAmt = latestRec ? (Number(latestRec.amount) || 0) : 0;
    const prevAdv = latestRec
      ? (latestRec.previousAdvance !== undefined ? Number(latestRec.previousAdvance) : Math.max(0, currentTotalAdv - latestAmt))
      : currentTotalAdv;
    const totAdv = latestRec
      ? (latestRec.totalAdvance !== undefined ? Number(latestRec.totalAdvance) : currentTotalAdv)
      : currentTotalAdv;

    setAdvanceEmp(emp);
    setCurrentPrintRecord({
      id: latestRec?.id || `ADV-${emp.id.slice(-4)}`,
      date: latestRec?.date || Date.now(),
      amount: latestAmt,
      previousAdvance: prevAdv,
      totalAdvance: totAdv,
      payrollSalary: pInfo.grossEarned,
      remainingNetPay: pInfo.netPayable,
      desc: latestRec?.description || 'Advance Summary Slip',
      employeeName: emp.name,
      employeeRole: emp.post || emp.role,
      employeePhone: emp.phone || '-'
    });
    setShowSlipPreviewModal(true);
  };

  const handlePrintWorkerSummary = () => {
    if (!advanceEmp) return;
    printInvoice('employee-summary-print', `${advanceEmp.name} - Advance Summary`, 'a4');
  };

  const activeEmployees = employees.filter(emp => emp.status === 'active');

  const currentMonthStr = format(new Date(), 'yyyy-MM');

  // Helper to compute each employee's payroll breakdown (Last Payroll + Attendance/Leave Cut + Advance Deduction)
  const getEmployeePayrollInfo = (emp: Employee) => {
    const empSlips = payslips
      .filter(s => s.employeeId === emp.id)
      .sort((a, b) => (b.month || '').localeCompare(a.month || '') || (b.date || 0) - (a.date || 0));
    const lastSlip = empSlips[0] || null;

    const targetMonth = lastSlip?.month || currentMonthStr;
    // Standard fixed 30-day formula for all months (salary always divided by 30)
    const daysInMonth = 30;

    // Attendance records for current month (or target month)
    const currMonthAtt = attendanceRecords.filter(
      r => r.employeeId === emp.id && (r.month === currentMonthStr || (r.date && String(r.date).startsWith(currentMonthStr)))
    );

    const absentCount = currMonthAtt.filter(r => r.status === 'Absent').length;
    const leaveCount = currMonthAtt.filter(r => r.status === 'Leave').length;
    const halfDayCount = currMonthAtt.filter(r => r.status === 'Half Day').length;
    const presentCount = currMonthAtt.filter(r => r.status === 'Present' || r.status === 'Late').length;

    // Total chutiyan (Absent + Unpaid Leave + 0.5 Half Day)
    const chutiDays = absentCount + leaveCount + (halfDayCount * 0.5);

    const monthlyRate = Number(emp.monthlySalary) || 0;
    // Always calculate daily rate based on fixed 30 days
    const dailyRate = monthlyRate > 0 ? (monthlyRate / 30) : (Number(emp.dailyWage) || 0);

    // Chuti / absence deduction amount from current attendance (based on 30-day daily rate)
    const chutiCutAmount = Math.round(chutiDays * dailyRate);

    // Base earned salary:
    // If a last payroll slip exists, use its generated salary (baseSalary, which already reflects working days of that payroll)
    // and if there are new current-month chutiyan not yet in that slip, deduct them if slip isn't for currentMonth
    let grossEarned = monthlyRate;
    let workingDays = Math.max(0, 30 - chutiDays);
    let lastPayrollNet = lastSlip ? Number(lastSlip.netPayable || 0) : null;
    let lastPayrollBase = lastSlip ? Number(lastSlip.baseSalary || 0) : null;
    let lastPayrollMonth = lastSlip?.month || null;
    let lastPayrollDays = lastSlip?.days !== undefined ? Number(lastSlip.days) : null;

    if (lastSlip) {
      // Start from the last generated payroll base salary (or netPayable before live advances)
      // If lastSlip was generated with `days` working days, `lastSlip.baseSalary` already has that month's days cut!
      grossEarned = lastPayrollBase !== null ? lastPayrollBase : monthlyRate;
      if (lastPayrollMonth !== currentMonthStr && chutiCutAmount > 0) {
        grossEarned = Math.max(0, grossEarned - chutiCutAmount);
      } else if (lastPayrollMonth === currentMonthStr && currMonthAtt.length > 0 && lastPayrollDays >= 30 && chutiCutAmount > 0) {
        grossEarned = Math.max(0, monthlyRate - chutiCutAmount);
      }
    } else {
      if (monthlyRate > 0) {
        grossEarned = Math.max(0, Math.round(monthlyRate - chutiCutAmount));
      } else if (emp.dailyWage > 0 && presentCount + halfDayCount > 0) {
        grossEarned = Math.round((presentCount + halfDayCount * 0.5) * emp.dailyWage);
      }
    }

    const rawAdvBal = Number(emp.advanceBalance) || 0;
    const payrollMonthStr = lastPayrollMonth || currentMonthStr;

    const empReturns = employeeReturnsList.filter(r => r.employeeId === emp.id);
    const empPurchases = employeePurchasesList.filter(p => p.employeeId === emp.id);

    // Employee Returns in the payroll month (or current month)
    const monthReturnsFromCol = empReturns
      .filter(r => {
        try {
          const dStr = format(new Date(Number(r.date)), 'yyyy-MM');
          return dStr === payrollMonthStr || dStr === currentMonthStr;
        } catch {
          return false;
        }
      })
      .reduce((sum, r) => sum + (Number(r.total) || 0), 0);

    const monthLedgerEntries = advanceLedgerRecords.filter(l => {
      if (l.employeeId !== emp.id) return false;
      try {
        const dStr = format(new Date(Number(l.date)), 'yyyy-MM');
        return dStr === payrollMonthStr || dStr === currentMonthStr;
      } catch {
        return false;
      }
    });

    const monthGrossIssued = monthLedgerEntries
      .filter(l => l.type !== 'IN' && !String(l.description || '').toLowerCase().includes('return'))
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

    const monthLedgerReturns = monthLedgerEntries
      .filter(l => l.type === 'IN' || String(l.description || '').toLowerCase().includes('return'))
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

    const monthReturnsTotal = Math.max(monthReturnsFromCol, monthLedgerReturns);
    const monthIssuedAdvances = Math.max(0, monthGrossIssued - monthReturnsTotal);

    const slipMonthDeducted = lastSlip ? Number(lastSlip.advances || 0) : 0;

    // Compute live total advance for this payroll period (including any new bills/advances and subtracting any employee returns)
    let slipMonthAdvance = 0;
    let postSlipBillsAndAdv = 0;
    let postSlipReturns = 0;

    if (lastSlip) {
      const slipDate = Number(lastSlip.date || 0);
      postSlipReturns = empReturns
        .filter(r => Number(r.date) > slipDate)
        .reduce((s, r) => s + (Number(r.total) || 0), 0);

      const postSlipLedgerReturns = advanceLedgerRecords
        .filter(l => l.employeeId === emp.id && Number(l.date) > slipDate && (l.type === 'IN' || String(l.description || '').toLowerCase().includes('return')))
        .reduce((s, l) => s + (Number(l.amount) || 0), 0);
      postSlipReturns = Math.max(postSlipReturns, postSlipLedgerReturns);

      const postSlipPurchases = empPurchases
        .filter(p => Number(p.date) > slipDate)
        .reduce((s, p) => s + (Number(p.total) || 0), 0);

      const postSlipCashAdv = advanceLedgerRecords
        .filter(l => {
          if (l.employeeId !== emp.id || Number(l.date) <= slipDate) return false;
          const desc = String(l.description || '');
          if (l.type === 'IN' || desc.toLowerCase().includes('return')) return false;
          if (desc.includes('Employee Purchase')) return false;
          if (desc.includes('Advance Given with Salary')) return false;
          return true;
        })
        .reduce((s, l) => s + (Number(l.amount) || 0), 0);

      postSlipBillsAndAdv = postSlipPurchases + postSlipCashAdv;
      const remAtSlip = Number(lastSlip.remainingAdvance || 0);
      const computedPostSlipBal = remAtSlip + postSlipBillsAndAdv - postSlipReturns;

      // If rawAdvBal was clamped to 0 when a return occurred after the slip, use computedPostSlipBal
      const effectivePostSlipBal = (rawAdvBal === 0 && computedPostSlipBal < 0)
        ? computedPostSlipBal
        : rawAdvBal;

      let combinedAdv = slipMonthDeducted + effectivePostSlipBal;

      // If a return happened in the month before the slip was saved, and slipMonthDeducted took the full gross advance without subtracting the return
      if (monthReturnsTotal > 0 && postSlipReturns === 0 && combinedAdv === monthGrossIssued) {
        combinedAdv -= monthReturnsTotal;
      }

      slipMonthAdvance = Math.max(0, combinedAdv);
    } else {
      if (monthGrossIssued > 0 && monthReturnsTotal > 0 && rawAdvBal === monthGrossIssued) {
        slipMonthAdvance = Math.max(0, rawAdvBal - monthReturnsTotal);
      } else if (rawAdvBal > 0) {
        slipMonthAdvance = rawAdvBal;
      } else {
        slipMonthAdvance = monthIssuedAdvances;
      }
    }

    const advBal = slipMonthAdvance;

    // Net Payable = Payroll Salary (after Chuti cut) - Payroll Month Advance (after Return cut & New Bills)
    const netPayable = grossEarned - slipMonthAdvance;
    const overAdvanceAmount = Math.max(0, slipMonthAdvance - grossEarned);

    const slipDayCut = lastSlip && monthlyRate > lastSlip.baseSalary ? Math.round(monthlyRate - lastSlip.baseSalary) : 0;
    const totalDayCutAmount = (lastSlip && lastPayrollMonth === currentMonthStr && slipDayCut > 0)
      ? slipDayCut
      : (slipDayCut + chutiCutAmount);

    return {
      lastSlip,
      lastPayrollNet,
      lastPayrollBase,
      lastPayrollMonth,
      lastPayrollDays,
      payrollMonthStr,
      monthlyRate,
      dailyRate,
      daysInMonth,
      workingDays,
      chutiDays,
      absentCount,
      leaveCount,
      halfDayCount,
      chutiCutAmount,
      totalDayCutAmount,
      grossEarned,
      advBal,
      rawAdvBal,
      monthReturnsTotal,
      postSlipBillsAndAdv,
      overAdvanceAmount,
      totalAdvanceTaken: slipMonthAdvance,
      empDeductedAdvances: slipMonthDeducted,
      netPayable
    };
  };

  const latestPayrollMonth = payslips.length > 0 ? payslips[0].month : null;

  const totalGrossSalary = activeEmployees
    .reduce((sum, emp) => sum + getEmployeePayrollInfo(emp).grossEarned, 0);

  const totalLastMonthPayrollNet = payslips
    .filter(s => latestPayrollMonth && s.month === latestPayrollMonth)
    .reduce((sum, s) => sum + (Number(s.netPayable) || 0), 0);

  const totalAdvances = activeEmployees
    .reduce((sum, emp) => sum + getEmployeePayrollInfo(emp).advBal, 0);

  const totalAllAdvancesTaken = activeEmployees
    .reduce((sum, emp) => sum + getEmployeePayrollInfo(emp).totalAdvanceTaken, 0);

  const totalChutiCut = activeEmployees
    .reduce((sum, emp) => sum + getEmployeePayrollInfo(emp).totalDayCutAmount, 0);

  const totalNetPayroll = activeEmployees
    .reduce((sum, emp) => sum + getEmployeePayrollInfo(emp).netPayable, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center mb-2 md:mb-0">
            <UsersRound className="w-6 h-6 mr-3 text-blue-600" />
            Payroll & Staff (Labour)
          </h2>
          {latestPayrollMonth && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Last Generated Payroll Month: <span className="font-bold text-sky-600 dark:text-sky-400 font-mono">{latestPayrollMonth}</span> (Total Slip Net: <span className="font-bold font-mono">PKR {totalLastMonthPayrollNet.toLocaleString()}</span>)
            </p>
          )}
          <div className="md:hidden mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
             <div className="text-xs bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5 rounded-md border border-slate-100 dark:border-slate-800/50">
               <span className="block text-slate-400 uppercase tracking-wider text-[9px] font-bold">Payroll Salary (After Days Cut)</span>
               <span className="font-bold text-slate-800 dark:text-slate-100 font-mono">Rs {totalGrossSalary.toLocaleString()}</span>
             </div>
             <div className="text-xs bg-amber-50/60 dark:bg-amber-950/30 px-2.5 py-1.5 rounded-md border border-amber-200 dark:border-amber-900/50">
               <span className="block text-amber-600 uppercase tracking-wider text-[9px] font-bold">Days / Chuti Cut</span>
               <span className="font-bold text-amber-700 dark:text-amber-400 font-mono">Rs {totalChutiCut.toLocaleString()}</span>
             </div>
             <div className="text-xs bg-rose-50/60 dark:bg-rose-950/30 px-2.5 py-1.5 rounded-md border border-rose-100 dark:border-rose-900/50">
               <span className="block text-rose-500 uppercase tracking-wider text-[9px] font-bold">Advance (Dr)</span>
               <span className="font-bold text-rose-600 dark:text-rose-400 font-mono">Rs {totalAdvances.toLocaleString()}</span>
               <span className="block text-[9px] text-orange-600 dark:text-orange-400 font-mono mt-0.5">Total Adv: Rs {totalAllAdvancesTaken.toLocaleString()}</span>
             </div>
             <div className="text-xs bg-emerald-50/60 dark:bg-emerald-950/30 px-2.5 py-1.5 rounded-md border border-emerald-200 dark:border-emerald-900/50">
               <span className="block text-emerald-600 uppercase tracking-wider text-[9px] font-bold">Net Payable Payroll</span>
               <span className="font-bold text-emerald-700 dark:text-emerald-300 font-mono">Rs {totalNetPayroll.toLocaleString()}</span>
             </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto mt-4 md:mt-0">
          {latestPayrollMonth && (
            <div className="hidden md:flex flex-col items-end px-3 py-1.5 bg-sky-50/60 dark:bg-sky-950/30 rounded-md border border-sky-200 dark:border-sky-900/50">
               <span className="text-sky-600 dark:text-sky-400 uppercase tracking-widest text-[10px] font-bold">Last Payroll ({latestPayrollMonth})</span>
               <span className="font-bold text-sky-700 dark:text-sky-300 font-mono">PKR {totalLastMonthPayrollNet.toLocaleString()}</span>
            </div>
          )}
          <div className="hidden md:flex flex-col items-end px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 rounded-md border border-slate-100 dark:border-slate-800/50">
             <span className="text-slate-400 uppercase tracking-widest text-[10px] font-bold">Earned Salary (After Chuti)</span>
             <span className="font-bold text-slate-800 dark:text-slate-100 font-mono">PKR {totalGrossSalary.toLocaleString()}</span>
          </div>
          {totalChutiCut > 0 && (
            <div className="hidden md:flex flex-col items-end px-3 py-1.5 bg-amber-50/60 dark:bg-amber-950/30 rounded-md border border-amber-200 dark:border-amber-900/50">
               <span className="text-amber-600 dark:text-amber-400 uppercase tracking-widest text-[10px] font-bold">Chuti / Days Cut</span>
               <span className="font-bold text-amber-700 dark:text-amber-400 font-mono">-PKR {totalChutiCut.toLocaleString()}</span>
            </div>
          )}
          <div className="hidden md:flex flex-col items-end px-3 py-1.5 bg-rose-50/60 dark:bg-rose-950/30 rounded-md border border-rose-200 dark:border-rose-900/50">
             <span className="text-rose-500 uppercase tracking-widest text-[10px] font-bold">Advance (Dr)</span>
             <span className="font-bold text-rose-600 dark:text-rose-400 font-mono">PKR {totalAdvances.toLocaleString()}</span>
             <span className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 font-mono">Month Adv ({latestPayrollMonth || currentMonthStr}): PKR {totalAllAdvancesTaken.toLocaleString()}</span>
          </div>
          <div className="hidden md:flex flex-col items-end px-3 py-1.5 bg-orange-50/60 dark:bg-orange-950/30 rounded-md border border-orange-200 dark:border-orange-900/50">
             <span className="text-orange-600 dark:text-orange-400 uppercase tracking-widest text-[10px] font-bold">Payroll Adv ({latestPayrollMonth || currentMonthStr})</span>
             <span className="font-bold text-orange-700 dark:text-orange-300 font-mono">PKR {totalAllAdvancesTaken.toLocaleString()}</span>
          </div>
          <div className="hidden md:flex flex-col items-end px-3.5 py-1.5 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-md border border-emerald-300 dark:border-emerald-800">
             <span className="text-emerald-600 dark:text-emerald-400 uppercase tracking-widest text-[10px] font-bold">Overall Net Payable</span>
             <span className="font-bold text-emerald-700 dark:text-emerald-300 font-mono">PKR {totalNetPayroll.toLocaleString()}</span>
          </div>
          <button
            onClick={() => printInvoice('employees-print-content', 'Staff & Labour List', 'a4')}
            className="flex-1 md:flex-none flex items-center justify-center px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 transition shadow-sm print:hidden"
          >
            <Printer className="w-5 h-5 md:mr-2" />
            <span className="hidden md:inline">Print</span>
          </button>
          <button
            onClick={() => { resetForm(); setShowAdd(!showAdd); }}
            className="flex-1 md:flex-none flex items-center justify-center px-4 py-2 bg-[#1e293b] text-sky-400 font-medium rounded-md hover:bg-slate-800 transition shadow-sm print:hidden"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Labour / Employee
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleSave} className="card p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 print:hidden">
          {user?.role === 'super_admin' && !activeBranchId && (
            <div className="md:col-span-2 xl:col-span-4 mb-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Assign to Branch *</label>
              <select 
                required 
                value={selectedBranchId} 
                onChange={e => setSelectedBranchId(e.target.value)} 
                className="input-field"
              >
                <option value="" disabled>Select a branch</option>
                <option value="main">Main Branch (HQ)</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          
          <div className="md:col-span-2 xl:col-span-4 border-b border-slate-100 dark:border-slate-800 pb-2 mb-2">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Personal Information</h3>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Full Name</label>
            <input type="text" required value={name} onChange={e => setName(e.target.value)} className="input-field" placeholder="John Doe" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Father's Name</label>
            <input type="text" value={fatherName} onChange={e => setFatherName(e.target.value)} className="input-field" placeholder="Father Name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">CNIC Number</label>
            <input type="text" value={cnic} onChange={e => setCnic(e.target.value)} className="input-field" placeholder="00000-0000000-0" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="input-field" placeholder="03XX-XXXXXXX" />
          </div>
          
          <div className="md:col-span-2 xl:col-span-4 border-b border-slate-100 dark:border-slate-800 pb-2 mb-2 mt-4">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Employment Details</h3>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Date of Joining</label>
            <input type="date" value={joiningDate} onChange={e => setJoiningDate(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">System Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="input-field">
              <option value="Labour">Labour</option>
              <option value="Staff">Staff</option>
              <option value="Manager">Manager</option>
              <option value="Online Team">Online Team</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Post / Designation</label>
            <input type="text" value={post} onChange={e => setPost(e.target.value)} className="input-field" placeholder="e.g. Master, Helper, Cutter" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Monthly Salary (Base)</label>
            <input type="number" value={monthlySalary} onChange={e => setMonthlySalary(e.target.value)} className="input-field" placeholder="0" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Daily Wage (If applicable)</label>
            <input type="number" value={wage} onChange={e => setWage(e.target.value)} className="input-field" placeholder="0" />
          </div>
          <div className="md:col-span-2 xl:col-span-3 flex items-end space-x-2">
            <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
              {isSubmitting ? 'Saving...' : (editingId ? 'Update Employee' : 'Save Employee')}
            </button>
            <button type="button" onClick={resetForm} disabled={isSubmitting} className="btn btn-secondary flex-1">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div id="employees-print-content" className="space-y-6 print:space-y-4 print:bg-white print:p-0 print:w-full print:static print:z-auto print:h-auto">
        <div className="hidden print:block text-center border-b border-slate-200 dark:border-slate-700 pb-4 mb-4">
          <h1 className="text-2xl font-bold font-serif uppercase tracking-widest text-slate-900 dark:text-slate-50">
            {activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || 0)}
          </h1>
          <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-1 uppercase tracking-widest">Labour & Staff List</h2>
          <p className="text-xs text-slate-400 mt-2">Printed on {new Date().toLocaleString()}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 shadow-sm rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Labour / Employee Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Role & Post</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Salary Details</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wider">Advance (Dr)</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider bg-orange-50/40 dark:bg-orange-950/20">Payroll Month Adv</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider bg-sky-50/40 dark:bg-sky-950/20">Payroll Salary</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider bg-emerald-50/40 dark:bg-emerald-950/20">Net Pay (Payroll - Adv)</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider print:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">
                    No labour or employees found for this branch. Click "Add Labour" to create one.
                  </td>
                </tr>
              ) : (
                employees.map((emp) => {
                  const pInfo = getEmployeePayrollInfo(emp);
                  const advBal = pInfo.advBal;
                  const totalAdv = pInfo.totalAdvanceTaken;
                  const payrollSalaryAmt = pInfo.grossEarned;
                  const netPayrollAmt = pInfo.netPayable;
                  const hasOverAdvance = netPayrollAmt < 0;

                  return (
                  <tr key={emp.id} className={hasOverAdvance ? "bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-50/70 dark:hover:bg-rose-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-bold ${hasOverAdvance ? 'text-rose-700 dark:text-rose-400' : 'text-slate-900 dark:text-slate-50'}`}>{emp.name}</span>
                          {hasOverAdvance && (
                            <span className="px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded bg-rose-600 text-white">
                              Adv Due
                            </span>
                          )}
                        </div>
                        {emp.fatherName && <span className="text-xs text-slate-500">S/O {emp.fatherName}</span>}
                        {emp.cnic && <span className="text-xs font-mono text-slate-400 mt-0.5">CNIC: {emp.cnic}</span>}
                        <span className="text-xs text-slate-500 mt-0.5">{emp.phone || '-'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        {emp.post && <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{emp.post}</span>}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          emp.role === 'Labour' ? 'bg-orange-100 text-orange-800' : 
                          emp.role === 'Online Team' ? 'bg-purple-100 text-purple-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {emp.role}
                        </span>
                        {emp.joiningDate && <span className="text-xs text-slate-500 mt-1">Joined: {new Date(emp.joiningDate).toLocaleDateString()}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      <div className="flex flex-col items-end">
                        {emp.monthlySalary > 0 && <span className="text-sm font-bold text-slate-900 dark:text-slate-50 font-mono">Rs {emp.monthlySalary.toLocaleString()} /mo</span>}
                        {emp.dailyWage > 0 && <span className="text-xs text-slate-500 font-mono">Rs {emp.dailyWage.toLocaleString()} /day</span>}
                        {!emp.monthlySalary && !emp.dailyWage && <span className="text-xs text-slate-400">-</span>}
                        {pInfo.chutiDays > 0 && (
                          <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5 font-mono">
                            Chuti: {pInfo.chutiDays}d (-Rs {pInfo.chutiCutAmount.toLocaleString()})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right font-mono">
                      <div className="flex flex-col items-end">
                        <span className={`text-sm font-bold ${advBal > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                          {advBal > 0 ? `Rs ${advBal.toLocaleString()}` : 'Rs 0'}
                        </span>
                        {pInfo.monthReturnsTotal > 0 && (
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                            Return Minus: -Rs {pInfo.monthReturnsTotal.toLocaleString()}
                          </span>
                        )}
                        {hasOverAdvance && (
                          <span className="text-[10px] font-extrabold text-rose-600 dark:text-rose-400 mt-0.5">
                            Emp Ki Taraf Adv: Rs {Math.abs(netPayrollAmt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right bg-orange-50/20 dark:bg-orange-950/10 font-mono">
                      <div className="flex flex-col items-end">
                        <span className={`text-sm font-extrabold px-2.5 py-1 rounded border ${
                          hasOverAdvance
                            ? 'text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700 bg-rose-100/80 dark:bg-rose-950/60'
                            : 'text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40'
                        }`}>
                          Rs {totalAdv.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Month: {pInfo.payrollMonthStr}
                        </span>
                        {pInfo.postSlipBillsAndAdv > 0 && (
                          <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                            +New Bill/Adv: Rs {pInfo.postSlipBillsAndAdv.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right bg-sky-50/20 dark:bg-sky-950/10 font-mono">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-sm font-extrabold text-sky-700 dark:text-sky-300 px-2.5 py-1 rounded border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40">
                          Rs {payrollSalaryAmt.toLocaleString()}
                        </span>
                        {pInfo.lastSlip ? (
                          <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                            Payroll ({pInfo.lastPayrollMonth}) {pInfo.lastPayrollDays ? `• ${pInfo.lastPayrollDays}d` : ''}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            Earned ({pInfo.workingDays}d)
                          </span>
                        )}
                        {pInfo.totalDayCutAmount > 0 && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                            Days Cut: -Rs {pInfo.totalDayCutAmount.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right bg-emerald-50/20 dark:bg-emerald-950/10 font-mono">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`text-sm font-extrabold px-2.5 py-1 rounded border ${
                          netPayrollAmt < 0
                            ? 'bg-rose-600 text-white border-rose-700 shadow-sm'
                            : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        }`}>
                          Rs {netPayrollAmt.toLocaleString()}
                        </span>
                        <span className={`text-[10px] font-semibold ${netPayrollAmt < 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-500 dark:text-slate-400'}`}>
                          {payrollSalaryAmt.toLocaleString()} - Adv {totalAdv.toLocaleString()}
                        </span>
                        {netPayrollAmt < 0 && (
                          <span className="text-[10px] font-extrabold text-rose-600 dark:text-rose-400">
                            Adv Balance Due: Rs {Math.abs(netPayrollAmt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        emp.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100'
                      }`}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm print:hidden">
                      <div className="flex justify-end items-center space-x-2">
                        <button onClick={() => { setAdvanceEmp(emp); setShowAdvanceModal(true); }} className="text-emerald-700 bg-emerald-100 dark:bg-emerald-900/50 hover:bg-emerald-200 px-2 py-1 rounded text-xs font-semibold transition-colors">
                          Add Advance
                        </button>
                        <button
                          onClick={() => handlePrintEmployeeThermalSlip(emp)}
                          className="text-amber-800 bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 px-2 py-1 rounded text-xs font-semibold transition-colors flex items-center"
                          title="Print Thermal Advance Slip (Current + Previous + Total Advance)"
                        >
                          <Receipt className="w-3 h-3 mr-1" />
                          Adv Slip
                        </button>
                        <button 
                          onClick={() => {
                            setAdvanceEmp(emp);
                            setShowAdvanceModal(true);
                            setTimeout(() => handlePrintWorkerSummary(), 500);
                          }} 
                          className="text-blue-700 bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 px-2 py-1 rounded text-xs font-semibold transition-colors flex items-center"
                        >
                          <Printer className="w-3 h-3 mr-1" />
                          Hissab
                        </button>
                        <button onClick={() => handleEditInit(emp)} className="text-sky-600 bg-sky-50 p-1.5 rounded hover:bg-sky-100 transition-colors"><Edit2 className="w-4 h-4" /></button>
                        {user?.role === 'super_admin' && enableDeletion && (
                          <button onClick={() => handleDelete(emp.id)} className="text-rose-600 bg-rose-50 p-1.5 rounded hover:bg-rose-100 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
            {employees.length > 0 && (
              <tfoot className="bg-slate-50 dark:bg-slate-800/80 border-t-2 border-slate-200 dark:border-slate-700 font-bold text-sm">
                <tr>
                  <td colSpan={2} className="px-4 py-3.5 text-right uppercase tracking-wider text-xs text-slate-500 dark:text-slate-400">
                    Total Active Payroll Summary:
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-slate-800 dark:text-slate-100">
                    Rs {activeEmployees.reduce((sum, e) => sum + (Number(e.monthlySalary) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-rose-600 dark:text-rose-400">
                    <div>Rs {totalAdvances.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                      Month Adv: Rs {totalAllAdvancesTaken.toLocaleString()}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-orange-700 dark:text-orange-400 bg-orange-50/40 dark:bg-orange-950/30">
                    Rs {totalAllAdvancesTaken.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-sky-700 dark:text-sky-300 bg-sky-50/40 dark:bg-sky-950/30">
                    Rs {totalGrossSalary.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/30">
                    <div className={totalNetPayroll < 0 ? 'text-rose-600 dark:text-rose-400' : ''}>Rs {totalNetPayroll.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                      {totalGrossSalary.toLocaleString()} - {totalAllAdvancesTaken.toLocaleString()}
                    </div>
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      </div>

      {showAdvanceModal && advanceEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-2xl overflow-hidden my-auto">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Issue Advance to {advanceEmp.name}</h3>
              <button 
                onClick={() => {
                  setShowAdvanceModal(false);
                  setCurrentPrintRecord(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200/50 rounded-full transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
              <form onSubmit={handleAddAdvance} className="p-6">
                {(() => {
                  const modalPInfo = getEmployeePayrollInfo(advanceEmp);
                  const prevAdv = modalPInfo.totalAdvanceTaken;
                  const newAdvInput = Number(advanceAmount) || 0;
                  const newTotalAdv = prevAdv + newAdvInput;
                  const newRemPayroll = modalPInfo.grossEarned - newTotalAdv;
                  return (
                    <div className="space-y-2 mb-4 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500">
                            Previous Advance
                          </label>
                          <div className="text-sm font-mono font-bold text-slate-800 dark:text-slate-100">
                            Rs {prevAdv.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-amber-600">
                            + Current Advance
                          </label>
                          <div className="text-sm font-mono font-bold text-amber-600">
                            Rs {newAdvInput.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider font-bold text-rose-600">
                            = Total Advance
                          </label>
                          <div className="text-sm font-mono font-extrabold text-rose-600">
                            Rs {newTotalAdv.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-between items-center pt-1 text-xs">
                        <div>
                          <span className="text-slate-500 font-semibold">
                            {modalPInfo.lastSlip ? `Payroll (${modalPInfo.lastPayrollMonth}): ` : 'Payroll Salary: '}
                          </span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                            Rs {modalPInfo.grossEarned.toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 font-semibold">Net Balance: </span>
                          <span className={`font-mono font-extrabold ${newRemPayroll < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            Rs {newRemPayroll.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                    Advance Date
                  </label>
                  <input
                    type="date"
                    required
                    value={advanceDate}
                    onChange={(e) => setAdvanceDate(e.target.value)}
                    className="w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                    New Advance Amount (Rs)
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={advanceAmount}
                    onChange={(e) => setAdvanceAmount(e.target.value)}
                    className="w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    placeholder="e.g. 5000"
                  />
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                    Description / Note
                  </label>
                  <input
                    type="text"
                    value={advanceDesc}
                    onChange={(e) => setAdvanceDesc(e.target.value)}
                    className="w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    placeholder="Optional note"
                  />
                </div>

                <div className="space-y-3">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-bold shadow-lg disabled:opacity-50 flex items-center justify-center"
                  >
                    <Receipt className="w-5 h-5 mr-2" />
                    {isSubmitting ? 'Saving...' : 'ISSUE ADVANCE & PRINT THERMAL SLIP'}
                  </button>
                  
                  {currentPrintRecord && (
                    <button
                      type="button"
                      onClick={() => handlePrintAdvanceReceipt(currentPrintRecord)}
                      className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all font-bold shadow-lg flex items-center justify-center"
                    >
                      <Printer className="w-5 h-5 mr-2" />
                      RE-PRINT THERMAL ADVANCE SLIP
                    </button>
                  )}
                </div>
              </form>

              <div className="p-6 bg-slate-50 dark:bg-slate-800/50 flex flex-col h-[400px]">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center">
                    Advance History
                    {loadingHistory && <span className="ml-3 text-xs text-blue-500 animate-pulse">Loading...</span>}
                  </h4>
                  {advanceHistory.length > 0 && (
                    <button 
                      onClick={handlePrintWorkerSummary}
                      className="text-xs flex items-center text-blue-600 hover:text-blue-800 font-medium"
                    >
                      <Printer className="w-3 h-3 mr-1" />
                      Print All
                    </button>
                  )}
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                  {advanceHistory.length === 0 && !loadingHistory ? (
                    <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
                      No advance history found.
                    </div>
                  ) : (
                    advanceHistory.map(record => (
                      <div key={record.id} className="bg-white dark:bg-slate-900 p-3 rounded border border-slate-200 dark:border-slate-700 text-sm group relative">
                        <div className="flex justify-between items-start mb-1">
                          <span className={`font-medium ${record.type === 'issue' ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {record.type === 'issue' ? 'Issued' : record.type === 'return' ? 'Return (Minus)' : 'Deducted'} Rs {record.amount.toLocaleString()}
                          </span>
                          <span className="text-xs text-slate-400">
                            {new Date(record.date).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 pr-20">
                          {record.desc}
                        </p>
                        {record.previousAdvance !== undefined && record.totalAdvance !== undefined && (
                          <div className="text-[10px] font-mono text-slate-500 mt-1">
                            Prev: Rs {Number(record.previousAdvance).toLocaleString()} + Curr: Rs {Number(record.amount).toLocaleString()} = Total: Rs {Number(record.totalAdvance).toLocaleString()}
                          </div>
                        )}
                        {record.type === 'issue' && (
                          <button 
                            onClick={() => handlePrintAdvanceReceipt(record)}
                            className="absolute right-2 bottom-2 px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded text-[10px] font-bold flex items-center gap-1 transition-colors"
                            title="Print Thermal Slip"
                          >
                            <Printer className="w-3 h-3" />
                            Slip
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Advance Receipt Thermal Print Preview Modal (80mm Thermal Slip) */}
      {showSlipPreviewModal && currentPrintRecord && (() => {
        const currAdvAmt = Number(currentPrintRecord.amount) || 0;
        const prevAdvAmt = currentPrintRecord.previousAdvance !== undefined
          ? Number(currentPrintRecord.previousAdvance)
          : Math.max(0, (advanceEmp ? getEmployeePayrollInfo(advanceEmp).totalAdvanceTaken : currAdvAmt) - currAdvAmt);
        const totalAdvAmt = currentPrintRecord.totalAdvance !== undefined
          ? Number(currentPrintRecord.totalAdvance)
          : (prevAdvAmt + currAdvAmt);
        const salaryAmt = currentPrintRecord.payrollSalary !== undefined
          ? Number(currentPrintRecord.payrollSalary)
          : (advanceEmp ? getEmployeePayrollInfo(advanceEmp).grossEarned : 0);
        const netBalAmt = salaryAmt - totalAdvAmt;

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 print:bg-transparent print:static print:inset-auto print:block print:z-auto backdrop-blur-sm print:backdrop-blur-none p-4 print:p-0">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-[86mm] max-w-[95vw] max-h-[92vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none print:block print:h-auto print:min-h-0 print:w-[80mm] print:m-0 border border-slate-200 dark:border-slate-700 print:border-0">
              {/* Preview Modal Header - Hidden in Print */}
              <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 dark:border-slate-800 print:hidden shrink-0 bg-slate-50 dark:bg-slate-800/70 rounded-t-lg">
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-slate-700 dark:text-slate-200" />
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100">
                    Thermal Slip Preview (80mm)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSlipPreviewModal(false)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-200/60 dark:bg-slate-700 p-1 rounded-full transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Printable 80mm Thermal Slip Content */}
              <div className="overflow-y-auto print:overflow-visible p-3 print:p-0 bg-slate-100 dark:bg-slate-950 print:bg-white flex-1 flex justify-center">
                <div
                  id="advance-receipt-print"
                  className="p-3 print:p-2 text-black bg-white shadow-sm print:shadow-none border border-slate-300 print:border-0"
                  style={{ fontFamily: 'monospace', width: '76mm', margin: '0 auto', color: '#000000' }}
                >
                  <div className="text-center mb-2">
                    <h1 className="text-base font-extrabold uppercase tracking-wide text-black">
                      {activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || 'Business')}
                    </h1>
                    <p className="text-xs font-extrabold uppercase border-2 border-black inline-block px-2.5 py-0.5 mt-1 text-black">
                      LABOUR ADVANCE SLIP
                    </p>
                    <div className="border-b-2 border-black border-dashed my-2"></div>
                  </div>

                  <div className="space-y-1 text-xs text-black">
                    <div className="flex justify-between">
                      <span className="font-bold">Date:</span>
                      <span className="font-bold">{safeFormat(currentPrintRecord.date, 'dd-MMM-yyyy hh:mm a')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-bold">Slip #:</span>
                      <span className="font-bold">{String(currentPrintRecord.id || '').slice(-6).toUpperCase()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-bold">Labour Name:</span>
                      <span className="font-extrabold uppercase">{currentPrintRecord.employeeName || advanceEmp?.name}</span>
                    </div>
                    {(currentPrintRecord.employeeRole || advanceEmp?.post || advanceEmp?.role) && (
                      <div className="flex justify-between">
                        <span className="font-bold">Role / Post:</span>
                        <span className="font-bold">{currentPrintRecord.employeeRole || advanceEmp?.post || advanceEmp?.role}</span>
                      </div>
                    )}

                    <div className="border-b-2 border-black border-dashed my-2"></div>

                    {/* Clear Advance Breakdown: Previous + Current = Total Advance */}
                    <div className="space-y-1.5 py-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold">Previous Advance (سابقہ ایڈوانس):</span>
                        <span className="font-extrabold">Rs {prevAdvAmt.toLocaleString()}</span>
                      </div>

                      <div className="flex justify-between items-center py-1.5 px-1.5 border-2 border-black bg-gray-100">
                        <span className="font-extrabold text-xs">Current Advance (موجودہ ایڈوانس):</span>
                        <span className="text-sm font-extrabold">+ Rs {currAdvAmt.toLocaleString()}</span>
                      </div>

                      <div className="border-t-2 border-b-2 border-black py-1.5 flex justify-between items-center">
                        <span className="font-extrabold text-xs uppercase">Total Advance (کل ایڈوانس):</span>
                        <span className="text-base font-extrabold">Rs {totalAdvAmt.toLocaleString()}</span>
                      </div>
                    </div>

                    {salaryAmt > 0 && (
                      <div className="pt-1 space-y-1 border-b-2 border-black border-dashed pb-2">
                        <div className="flex justify-between text-[11px]">
                          <span className="font-bold">Payroll Salary:</span>
                          <span className="font-extrabold">Rs {salaryAmt.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-[11px] font-extrabold">
                          <span>{netBalAmt < 0 ? 'Emp Ki Taraf Adv Due:' : 'Remaining Net Salary:'}</span>
                          <span>Rs {netBalAmt.toLocaleString()}</span>
                        </div>
                      </div>
                    )}

                    <div className="mt-1.5 pt-1">
                      <span className="font-bold">Note / Description:</span>
                      <div className="text-[11px] font-bold break-words">{currentPrintRecord.desc || 'Advance Payment'}</div>
                    </div>
                  </div>

                  <div className="mt-8 flex justify-between px-1 pt-4 border-t-2 border-black border-dashed">
                    <div className="text-center">
                      <div className="w-24 border-b-2 border-black mb-1"></div>
                      <p className="text-[10px] font-extrabold">Issued By</p>
                    </div>
                    <div className="text-center">
                      <div className="w-24 border-b-2 border-black mb-1"></div>
                      <p className="text-[10px] font-extrabold">Labour Sign</p>
                    </div>
                  </div>

                  <div className="mt-4 text-center text-[9px] font-bold border-t border-black border-dotted pt-1">
                    <p>Printed: {format(new Date(), 'dd-MMM-yyyy hh:mm a')}</p>
                  </div>
                </div>
              </div>

              {/* Preview Modal Footer Actions - Hidden in Print */}
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 flex items-center justify-between gap-2 shrink-0 print:hidden rounded-b-lg">
                <button
                  type="button"
                  onClick={() => setShowSlipPreviewModal(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xs"
                >
                  Close
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => printInvoice('advance-receipt-print', `Advance Slip - ${currentPrintRecord.employeeName || advanceEmp?.name || 'Labour'}`, 'thermal')}
                  className="flex-1 flex items-center justify-center px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white rounded font-bold transition-colors shadow-sm text-xs"
                >
                  <Printer className="w-4 h-4 mr-1.5" />
                  Print Thermal Slip (80mm)
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Employee Advance Summary A4 Print */}
      <div id="employee-summary-print" className="hidden">
        {advanceEmp && (
          <div className="p-8 text-black bg-white">
            <div className="flex justify-between items-start mb-8 border-b-2 border-black pb-4">
              <div>
                <h1 className="text-3xl font-bold uppercase">{activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || 'Business')}</h1>
                <p className="text-gray-600">Employee Advance & Ledger Summary</p>
              </div>
              <div className="text-right">
                <p className="font-bold">Date: {format(new Date(), 'dd MMMM yyyy')}</p>
                <p className="text-sm">Time: {format(new Date(), 'hh:mm a')}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8 mb-8 bg-gray-50 p-4 rounded-lg">
              <div>
                <h2 className="text-sm uppercase text-gray-500 font-bold mb-2">Employee Details</h2>
                <p className="text-xl font-bold">{advanceEmp.name}</p>
                {advanceEmp.fatherName && <p>S/O: {advanceEmp.fatherName}</p>}
                <p>Post: {advanceEmp.post || advanceEmp.role}</p>
                <p>Phone: {advanceEmp.phone || '-'}</p>
              </div>
              <div className="text-right">
                <h2 className="text-sm uppercase text-gray-500 font-bold mb-2">Account Summary</h2>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Monthly Salary:</span>
                    <span className="font-bold">Rs {advanceEmp.monthlySalary.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xl text-rose-600 pt-2 border-t border-gray-200">
                    <span className="font-bold">Outstanding Advance:</span>
                    <span className="font-bold underline">Rs {getEmployeePayrollInfo(advanceEmp).totalAdvanceTaken.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            <h3 className="text-lg font-bold mb-4 uppercase border-b border-gray-200 pb-2">Transaction History</h3>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-2 text-left">Date</th>
                  <th className="border p-2 text-left">Description</th>
                  <th className="border p-2 text-right">Debit (Issue)</th>
                  <th className="border p-2 text-right">Credit (Deduct)</th>
                  <th className="border p-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let runningBalance = 0;
                  // We need the history in chronological order for correct running balance
                  const sortedHistory = [...advanceHistory].sort((a, b) => a.date - b.date);
                  return sortedHistory.map((record, index) => {
                    if (record.type === 'issue') runningBalance += record.amount;
                    else runningBalance -= record.amount;
                    
                    return (
                      <tr key={index}>
                        <td className="border p-2">{safeFormat(record.date, 'dd-MM-yyyy')}</td>
                        <td className="border p-2">{record.desc}</td>
                        <td className="border p-2 text-right text-rose-600">{record.type === 'issue' ? `Rs ${record.amount.toLocaleString()}` : '-'}</td>
                        <td className="border p-2 text-right text-emerald-600">{record.type !== 'issue' ? `Rs ${record.amount.toLocaleString()}` : '-'}</td>
                        <td className="border p-2 text-right font-bold">Rs {runningBalance.toLocaleString()}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>

            <div className="mt-12 grid grid-cols-2 gap-12 pt-8">
              <div className="text-center border-t border-black pt-2">
                <p className="font-bold italic">Accountant Signature</p>
              </div>
              <div className="text-center border-t border-black pt-2">
                <p className="font-bold italic">Labour Signature</p>
              </div>
            </div>

            <div className="mt-12 text-center text-xs text-gray-400 border-t border-gray-100 pt-4">
              <p>This is a computer generated summary.</p>
              <p>Branch ID: {activeBranchId} | Printed By: {user?.email}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  ); 
}
