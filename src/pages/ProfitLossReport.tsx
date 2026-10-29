import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { collection, query, where, onSnapshot } from '../lib/customFirestore';
import { db, safeCollectionSnapshot } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { TrendingUp, Printer, Lock, Eye, EyeOff } from 'lucide-react';
import { format, startOfDay, endOfDay, subDays, isValid } from 'date-fns';
import { safeFormat } from '../lib/utils';

export function ProfitLossReport() {
  const { activeBranchId, setActiveBranchId, branches } = useBranch();
  const { user } = useAuth();
  
  const [isUnlocked, setIsUnlocked] = useState(() => sessionStorage.getItem('profit_loss_unlocked') === 'true');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  
  const [sales, setSales] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === 'superadmin@@') {
      sessionStorage.setItem('profit_loss_unlocked', 'true');
      setIsUnlocked(true);
      setPasswordError('');
      setPasswordInput('');
    } else {
      setPasswordError('Incorrect password! Please try again.');
    }
  };

  const handleLockAgain = () => {
    sessionStorage.removeItem('profit_loss_unlocked');
    setIsUnlocked(false);
  };

  useEffect(() => {
    setIsLoading(true);
    let qSales: any = collection(db, 'sales');
    let qLedger: any = collection(db, 'ledger');
    let qInv: any = collection(db, 'inventory');
    
    const [sy, sm, sd] = startDate.split('-');
    const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
    start.setHours(0, 0, 0, 0);
    
    const [ey, em, ed] = endDate.split('-');
    const end = new Date(Number(ey), Number(em) - 1, Number(ed));
    end.setHours(23, 59, 59, 999);
    
    qSales = query(qSales, where('date', '>=', start.getTime()), where('date', '<=', end.getTime()));
    qLedger = query(qLedger, where('date', '>=', start.getTime()), where('date', '<=', end.getTime()));
    
    if (activeBranchId && activeBranchId !== 'all') {
      qSales = query(qSales, where('branchId', '==', activeBranchId));
      qLedger = query(qLedger, where('branchId', '==', activeBranchId));
      qInv = query(qInv, where('branchId', '==', activeBranchId));
    }

    const unsubSales = safeCollectionSnapshot(qSales, (snap) => {
      setSales(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setIsLoading(false);
    });

    const unsubLedger = safeCollectionSnapshot(qLedger, (snap) => {
      const allLedger = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter for Expenses (OUT and category === 'Expense')
      const expData = allLedger.filter((e: any) => e.category === 'Expense' && e.type === 'OUT');
      setExpenses(expData);
    });
    
    return () => {
      unsubSales();
      unsubLedger();
    };
  }, [activeBranchId, startDate, endDate]);

  const generateReport = () => {
    const dailyMap = new Map<string, {
      revenue: number;
      grossProfit: number;
      expenses: number;
      netProfit: number;
    }>();

    // Initialize map for all dates in range
    const [sy, sm, sd] = startDate.split('-');
    const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
    
    const [ey, em, ed] = endDate.split('-');
    const end = new Date(Number(ey), Number(em) - 1, Number(ed));

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = safeFormat(d, 'yyyy-MM-dd');
      if (key) dailyMap.set(key, { revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0 });
    }

    // Process Sales
    sales.forEach(sale => {
      const sTime = sale.date || (sale.createdAt?.seconds ? sale.createdAt.seconds * 1000 : 0);
      if (!sTime) return;
      const dateKey = safeFormat(sTime, 'yyyy-MM-dd');
      if (!dateKey) return;
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0 });
      }
      
      const dayData = dailyMap.get(dateKey)!;
      const isReturn = sale.transactionType === 'Return';
      const amount = isReturn ? -Math.abs(Number(sale.total) || 0) : (Number(sale.total) || 0);
      
      let profit = 0;
      if (!isReturn) {
        const saleSubtotal = (sale.items || []).reduce((acc: number, item: any) => acc + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
        const cost = (sale.items || []).reduce((acc: number, item: any) => {
          let unitCost = item.cost;
          if (unitCost === undefined || unitCost === 0 || unitCost === null) {
             const invItem = inventory.find(inv => inv.id === item.id);
             unitCost = Number(invItem?.cost || 0);
          }
          return acc + (unitCost * (item.qty || 0));
        }, 0);
        const discount = Number(sale.discount) || 0;
        profit = Math.max(0, saleSubtotal - cost - discount);
      }
      
      dayData.revenue += amount;
      dayData.grossProfit += profit;
    });

    // Process Expenses
    expenses.forEach(exp => {
      const eTime = exp.date || (exp.createdAt?.seconds ? exp.createdAt.seconds * 1000 : 0);
      if (!eTime) return;
      const dateKey = safeFormat(eTime, 'yyyy-MM-dd');
      if (!dateKey) return;
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0 });
      }
      
      const dayData = dailyMap.get(dateKey)!;
      dayData.expenses += Number(exp.amount) || 0;
    });

    // Calculate Net Profit and convert to array
    const sortedDates = Array.from(dailyMap.keys()).sort((a, b) => b.localeCompare(a));
    const dailyData = sortedDates.map(date => {
      const data = dailyMap.get(date)!;
      return {
        date,
        ...data,
        netProfit: data.grossProfit - data.expenses
      };
    });

    const totals = dailyData.reduce((acc, day) => ({
      revenue: acc.revenue + day.revenue,
      grossProfit: acc.grossProfit + day.grossProfit,
      expenses: acc.expenses + day.expenses,
      netProfit: acc.netProfit + day.netProfit
    }), { revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0 });

    return { dailyData, totals };
  };

  const report = generateReport();

  if (!isUnlocked) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 text-center">
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-950/50 rounded-2xl flex items-center justify-center mx-auto mb-5 text-amber-600 dark:text-amber-400 shadow-inner">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Profit & Loss Protected</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 mb-6">
            This financial report is password protected. Enter the authorization password to continue.
          </p>

          <form onSubmit={handleUnlock} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setPasswordError('');
                  }}
                  placeholder="Enter password..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {passwordError && (
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400 mt-2">
                  {passwordError}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" /> Unlock Profit & Loss
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <TrendingUp className="text-sky-500" />
            Profit & Loss Report
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Analyze your daily sales, gross profit, expenses, and net profit.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-center">
          <input 
            type="date" 
            value={startDate} 
            onChange={e => setStartDate(e.target.value)} 
            className="input-field"
          />
          <input 
            type="date" 
            value={endDate} 
            onChange={e => setEndDate(e.target.value)} 
            className="input-field"
          />
          <button 
            onClick={() => window.print()}
            className="btn btn-secondary flex items-center gap-2"
          >
            <Printer size={16} /> Print
          </button>
          <button 
            onClick={handleLockAgain}
            className="btn btn-secondary flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400"
            title="Lock Profit & Loss"
          >
            <Lock size={16} /> Lock
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Sales (Revenue)</p>
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">PKR {report.totals.revenue.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Gross Profit</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">PKR {report.totals.grossProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Expenses</p>
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">PKR {report.totals.expenses.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
        </div>
        <div className="card p-4 bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800">
          <p className="text-sm font-medium text-sky-700 dark:text-sky-300">Net Profit</p>
          <p className={`text-2xl font-bold mt-1 ${report.totals.netProfit >= 0 ? 'text-sky-700 dark:text-sky-300' : 'text-rose-600 dark:text-rose-400'}`}>
            PKR {report.totals.netProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="px-6 py-4 font-medium">Date</th>
                <th className="px-6 py-4 font-medium text-right">Daily Sales</th>
                <th className="px-6 py-4 font-medium text-right text-emerald-600">Gross Profit</th>
                <th className="px-6 py-4 font-medium text-right text-rose-600">Total Expenses</th>
                <th className="px-6 py-4 font-medium text-right text-sky-600">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {report.dailyData.map((day, idx) => (
                <tr key={day.date} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition">
                  <td className="px-6 py-3 font-medium text-slate-800 dark:text-slate-200">
                    {format(new Date(day.date), 'dd MMM, yyyy')}
                  </td>
                  <td className="px-6 py-3 text-right">
                    PKR {day.revenue.toLocaleString(undefined, {minimumFractionDigits: 2})}
                  </td>
                  <td className="px-6 py-3 text-right text-emerald-600 font-medium">
                    PKR {day.grossProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}
                  </td>
                  <td className="px-6 py-3 text-right text-rose-600 font-medium">
                    PKR {day.expenses.toLocaleString(undefined, {minimumFractionDigits: 2})}
                  </td>
                  <td className={`px-6 py-3 text-right font-bold ${day.netProfit >= 0 ? 'text-sky-600' : 'text-rose-600'}`}>
                    PKR {day.netProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}
                  </td>
                </tr>
              ))}
              {report.dailyData.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                    No data available for the selected date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
