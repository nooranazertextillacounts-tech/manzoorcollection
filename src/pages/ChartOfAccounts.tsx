import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { collection, query, where, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc, runTransaction, writeBatch } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { WalletCards, TrendingUp, TrendingDown, Users, Component, Receipt } from 'lucide-react';
import { format, startOfDay, endOfDay, startOfMonth, parseISO, isWithinInterval, isValid } from 'date-fns';
import { safeFormat } from '../lib/utils';

export function ChartOfAccounts() {
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  
  const [sales, setSales] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'thisMonth' | 'custom'>('all');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfDay(new Date()), 'yyyy-MM-dd'));

  useEffect(() => {
    if (!activeBranchId) return;

    let sQ: any = collection(db, 'sales');
    let lQ: any = collection(db, 'ledger');
    let pQ: any = collection(db, 'purchases');

    if (activeBranchId) {
      sQ = query(sQ, where('branchId', '==', activeBranchId));
      lQ = query(lQ, where('branchId', '==', activeBranchId));
      pQ = query(pQ, where('branchId', '==', activeBranchId));
    }

    const unsubS = safeCollectionSnapshot(sQ, snap => setSales(snap.docs.map(d => ({id: d.id, ...(d.data() as any)}))));
    const unsubL = safeCollectionSnapshot(lQ, snap => setLedger(snap.docs.map(d => ({id: d.id, ...(d.data() as any)}))));
    const unsubP = safeCollectionSnapshot(pQ, snap => setPurchases(snap.docs.map(d => ({id: d.id, ...(d.data() as any)}))));

    return () => { unsubS(); unsubL(); unsubP(); }
  }, [activeBranchId, user]);

  const getDateRange = () => {
    let start, end;
    const now = new Date();
    if (dateFilter === 'today') {
      start = startOfDay(now);
      end = endOfDay(now);
    } else if (dateFilter === 'thisMonth') {
      start = startOfMonth(now);
      end = endOfDay(now);
    } else if (dateFilter === 'custom') {
      const [sy, sm, sd] = safeFormat(startDate || new Date(), 'yyyy-MM-dd').split('-');
      start = new Date(Number(sy), Number(sm) - 1, Number(sd));
      start.setHours(0, 0, 0, 0);
      const [ey, em, ed] = safeFormat(endDate || new Date(), 'yyyy-MM-dd').split('-');
      end = new Date(Number(ey), Number(em) - 1, Number(ed));
      end.setHours(23, 59, 59, 999);
    }
    return { start, end };
  };

  const isWithinDate = (timestamp: any) => {
    if (dateFilter === 'all') return true;
    const { start, end } = getDateRange();
    const d = new Date(timestamp);
    return isWithinInterval(d, { start: start!, end: end! });
  };

  // Filter data
  const filteredSales = sales.filter(s => {
    const d = s.date || 0;
    return isWithinDate(d);
  });
  
  const filteredLedger = ledger.filter(l => {
    const d = l.date || 0;
    return isWithinDate(d);
  });

  const filteredPurchases = purchases.filter(p => {
    const d = p.date || 0;
    return isWithinDate(d);
  });

  // Calculate metrics
  let totalGrossSales = 0;
  let cashReceivedAtSale = 0;
  let udharGivenAtSale = 0;
  let ownerCapitalIn = 0;
  let ownerWithdrawalsOut = 0;

  filteredSales.forEach(s => {
    if (s.transactionType === 'Return') {
       totalGrossSales -= s.total;
       cashReceivedAtSale -= s.total;
    } else {
       totalGrossSales += s.total;
       const received = s.received !== undefined ? Number(s.received) : s.total;
       cashReceivedAtSale += received;
       if (s.total > received) {
         udharGivenAtSale += (s.total - received);
       }
    }
  });

  let totalExpenses = 0;
  let salariesAndPayroll = 0;
  let customerCollections = 0;
  let otherReceipts = 0;

  filteredLedger.forEach(l => {
    if (l.type === 'IN') {
      if (l.category === 'Sale Payment' || l.category === 'Sale Return Invoice' || l.category === 'Purchase Invoice') {
        // Already handled in Sales loop (cashReceivedAtSale). We skip these to avoid double counting.
      } else if (l.category === 'Customer Payment') {
        customerCollections += Number(l.amount);
      } else if (l.category === 'Owner Capital') {
        ownerCapitalIn += Number(l.amount);
      } else {
        otherReceipts += Number(l.amount);
      }
    } else if (l.type === 'OUT') {
      if (l.category === 'Sale Return' || l.category === 'Sale Invoice' || l.category === 'Purchase Invoice' || l.category === 'Purchase Return' || l.category === 'Sale Return Invoice') {
        // Skip, handled elsewhere
      } else if (l.category === 'Owner Withdrawal') {
        ownerWithdrawalsOut += Number(l.amount);
      } else {
        totalExpenses += Number(l.amount);
        if (l.category === 'Payroll') {
           salariesAndPayroll += Number(l.amount);
        }
      }
    }
  });

  // Calculate remaining Udhar (approximation for the period)
  let pendingUdhar = Math.max(0, udharGivenAtSale - customerCollections);
  
  // Cash in hand
  const actualCashInHand = cashReceivedAtSale + customerCollections + otherReceipts + ownerCapitalIn - totalExpenses - ownerWithdrawalsOut;
  const netIncome = totalGrossSales - totalExpenses; // Just Sales and Expenses (Accrual basis)

  const COLORS = ['#38bdf8', '#fb7185', '#34d399', '#fbbf24', '#a78bfa'];
  
  const chartData = [
    { name: 'Total Sales', value: totalGrossSales > 0 ? totalGrossSales : 0 },
    { name: 'Total Expenses', value: totalExpenses > 0 ? totalExpenses : 0 },
    { name: 'Pending Udhar', value: pendingUdhar > 0 ? pendingUdhar : 0 },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 card p-4">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
          <WalletCards className="w-5 h-5 mr-3 text-sky-500" />
          Roznamcha / Daybook & Accounts
        </h2>
        
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <select 
            value={dateFilter} 
            onChange={e => setDateFilter(e.target.value as any)}
            className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 text-sm"
          >
            <option value="today">Today</option>
            <option value="thisMonth">This Month</option>
            <option value="custom">Custom Range</option>
            <option value="all">All Time</option>
          </select>
          
          {dateFilter === 'custom' && (
            <div className="flex gap-2">
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="rounded border px-2 py-1 text-sm text-slate-600 dark:text-slate-300" />
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="rounded border px-2 py-1 text-sm text-slate-600 dark:text-slate-300" />
            </div>
          )}
          
          <button onClick={() => window.print()} className="print:hidden px-4 py-1.5 bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-200 font-medium rounded-md hover:bg-slate-200 transition shadow-sm border border-slate-200 dark:border-slate-700">
            Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-6 bg-gradient-to-br from-white to-slate-50 border-emerald-100 border-[1px]">
          <div className="flex items-center text-emerald-600 mb-2">
            <TrendingUp className="w-5 h-5 mr-2" />
            <h3 className="font-semibold text-sm uppercase tracking-wider">Total Gross Sales</h3>
          </div>
          <p className="text-3xl font-bold font-mono text-slate-800 dark:text-slate-100">PKR {totalGrossSales.toLocaleString()}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Overall total sales amount.</p>
        </div>
        
        <div className="card p-6 bg-gradient-to-br from-white to-slate-50 border-rose-100 border-[1px]">
          <div className="flex items-center text-rose-600 mb-2">
            <TrendingDown className="w-5 h-5 mr-2" />
            <h3 className="font-semibold text-sm uppercase tracking-wider">Total Expenses</h3>
          </div>
          <p className="text-3xl font-bold font-mono text-slate-800 dark:text-slate-100">PKR {totalExpenses.toLocaleString()}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Purchases, payroll & all payouts.</p>
        </div>

        <div className="card p-6 bg-gradient-to-br from-sky-50 to-white border-sky-100 border-[1px]">
          <div className="flex items-center text-sky-600 mb-2">
            <Users className="w-5 h-5 mr-2" />
            <h3 className="font-semibold text-sm uppercase tracking-wider">Pending Udhar</h3>
          </div>
          <p className="text-3xl font-bold font-mono text-sky-700">PKR {pendingUdhar.toLocaleString()}</p>
          <p className="text-xs text-sky-600/70 mt-2">Amount pending from customers.</p>
        </div>

        <div className={`card p-6 bg-gradient-to-br border-[1px] ${actualCashInHand >= 0 ? 'from-emerald-50 to-white border-emerald-100' : 'from-rose-50 to-white border-rose-100'}`}>
          <div className={`flex items-center mb-2 ${actualCashInHand >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            <WalletCards className="w-5 h-5 mr-2" />
            <h3 className="font-semibold text-sm uppercase tracking-wider">Net Cash Remaining</h3>
          </div>
          <p className={`text-3xl font-bold font-mono ${actualCashInHand >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>PKR {actualCashInHand.toLocaleString()}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Cash Recv - All Expenses & Purchases.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-6 flex items-center">
            <Component className="w-5 h-5 mr-2 text-slate-400"/>
            Financial Breakdown
          </h3>
          <div className="h-64 sm:h-80 w-full flex justify-center items-center">
             {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(val) => `PKR ${Number(val).toLocaleString()}`} />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
             ) : (
               <div className="text-slate-400 flex flex-col items-center">
                  <Receipt className="w-12 h-12 mb-2 opacity-50" />
                  <p>No financial data for selected period</p>
               </div>
             )}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">
            Statement Summary (P&L)
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-slate-50">
              <span className="text-slate-600 dark:text-slate-300 font-medium">Total Gross Sales</span>
              <span className="font-bold font-mono text-emerald-600">PKR {totalGrossSales.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-50 text-xs pl-4">
              <span className="text-slate-500 dark:text-slate-400">(-) Udhar Given During Sales</span>
              <span className="font-mono text-rose-500">PKR {udharGivenAtSale.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-50 bg-slate-50/50 px-2 rounded">
              <span className="text-slate-700 dark:text-slate-200 font-medium">(=) Cash Received From Sales</span>
              <span className="font-bold font-mono text-slate-800 dark:text-slate-100">PKR {cashReceivedAtSale.toLocaleString()}</span>
            </div>

            <div className="flex justify-between items-center py-2 border-b border-slate-50 mt-2">
              <span className="text-slate-600 dark:text-slate-300 font-medium">(+) Customer Cash Collections (Recovery)</span>
              <span className="font-bold font-mono text-emerald-600">PKR {customerCollections.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-50">
              <span className="text-slate-600 dark:text-slate-300 font-medium">(+) Other Receipts (Incomes)</span>
              <span className="font-bold font-mono text-emerald-600">PKR {otherReceipts.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-50">
              <span className="text-slate-600 dark:text-slate-300 font-medium">(+) Owner Capital (Investment)</span>
              <span className="font-bold font-mono text-emerald-600">PKR {ownerCapitalIn.toLocaleString()}</span>
            </div>
            
            <div className="pt-4"></div>
            
            <div className="flex justify-between items-center py-2 border-b border-slate-50">
              <span className="text-slate-600 dark:text-slate-300 font-medium">(-) All Expenses & Payments</span>
              <span className="font-bold font-mono text-rose-500">PKR {totalExpenses.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-50 text-xs pl-4">
              <span className="text-slate-500 dark:text-slate-400">Includes Salaries, Payroll, Purchases & Accounts</span>
              <span className="font-mono text-slate-500 dark:text-slate-400">PKR {salariesAndPayroll.toLocaleString()}</span>
            </div>
             <div className="flex justify-between items-center py-2 border-b border-slate-50">
              <span className="text-slate-600 dark:text-slate-300 font-medium">(-) Owner Cash Withdrawals</span>
              <span className="font-bold font-mono text-rose-500">PKR {ownerWithdrawalsOut.toLocaleString()}</span>
            </div>
            
            <div className={`mt-4 p-4 rounded-lg flex justify-between items-center ${netIncome >= 0 ? 'bg-indigo-50 border border-indigo-100' : 'bg-orange-50 border border-orange-100'}`}>
              <div className="flex flex-col">
                <span className={`font-bold ${netIncome >= 0 ? 'text-indigo-800' : 'text-orange-800'}`}>Net Profit (Sales - Expenses)</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest">Accrual Basis</span>
              </div>
              <span className={`text-xl font-bold font-mono ${netIncome >= 0 ? 'text-indigo-700' : 'text-orange-700'}`}>PKR {netIncome.toLocaleString()}</span>
            </div>

            <div className={`mt-2 p-4 rounded-lg flex justify-between items-center ${actualCashInHand >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-rose-50 border border-rose-100'}`}>
              <div className="flex flex-col">
                <span className={`font-bold ${actualCashInHand >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>Net Cash Flow</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest">(In - Out)</span>
              </div>
              <span className={`text-xl font-bold font-mono ${actualCashInHand >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>PKR {actualCashInHand.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-8 text-center text-xs font-bold text-black uppercase print:block hidden"></div>
    </div>
  );
}
