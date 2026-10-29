import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { collection, query, where, onSnapshot, Timestamp, doc, setDoc, updateDoc, getDocs, getDoc, runTransaction, writeBatch, addDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { FileText, Plus, Trash2, Calendar, Search, Tag, Wallet, Printer, X } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { safeFormat } from '../lib/utils';
import { recordActivityLog } from '../lib/activityLogger';

export function Expenses() {
  const { activeBranchId, branches } = useBranch();
  const { user } = useAuth();
  
  const [expenses, setExpenses] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [printExpense, setPrintExpense] = useState<any>(null);
  
  const [isAdding, setIsAdding] = useState(false);
  const [targetBranchId, setTargetBranchId] = useState('');
  const [newExpense, setNewExpense] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    account: '',
    description: '',
    amount: '',
    paidByVendorId: ''
  });

  // Extract unique accounts for the filter dropdown
  const uniqueAccounts = Array.from(new Set(expenses.map(e => String(e.reference || '').split(' - ')[0] || 'General'))).sort();

  useEffect(() => {
    if (!activeBranchId) return;

    let q: any = collection(db, 'ledger');
    let vendorQ: any = collection(db, 'vendors');
    
    // We get all OUT entries mapped to Expense to manage them
    if (activeBranchId) {
      q = query(q, where('branchId', '==', activeBranchId), where('type', '==', 'OUT'));
      vendorQ = query(vendorQ, where('branchId', '==', activeBranchId));
    } else {
      q = query(q, where('type', '==', 'OUT'));
    }

    const unsubVendors = safeCollectionSnapshot(vendorQ, snap => {
       setVendors(snap.docs.map(d => ({id: d.id, ...(d.data() as any)})));
    });

    const unsub = safeCollectionSnapshot(q, snap => {
       const expData = snap.docs
         .map(d => ({id: d.id, ...(d.data() as any)}))
         .filter((e: any) => e.category === 'Expense' || 0);
       
       expData.sort((a: any, b: any) => (b.date || 0) - (a.date || 0));
       setExpenses(expData);
    });

    return () => { unsub(); unsubVendors(); };
  }, [activeBranchId, user]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpense.amount || 0) return;
    
    const branchToUse = activeBranchId || targetBranchId;
    if (!branchToUse) {
      alert("Please select a branch first before adding an expense.");
      return;
    }

    try {
      const vendorName = newExpense.paidByVendorId ? vendors.find(v => v.id === newExpense.paidByVendorId)?.name : null;
      
      // 1. Record the Expense as OUT from shop perspective (always recorded)
      await addDoc(collection(db, 'ledger'), {
        branchId: branchToUse,
        vendorId: null, // Keep shop cash entry separate from vendor ledger
        date: (() => { const [py, pm, pd] = newExpense.date.split('-'); return new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime(); })(),
        description: vendorName ? `Paid via ${vendorName} - ${newExpense.account}: ${newExpense.description}` : `${newExpense.account}: ${newExpense.description}`,
        category: 'Expense',
        type: 'OUT',
        amount: Number(newExpense.amount),
        reference: newExpense.account,
        createdAt: Timestamp.now(),
        tenantId: user?.tenantId || user?.uid
      });

      // 2. If paid by vendor, record an IN entry for the vendor (we owe them) to balance the books
      if (newExpense.paidByVendorId) {
        await addDoc(collection(db, 'ledger'), {
          branchId: branchToUse,
          vendorId: newExpense.paidByVendorId,
          date: (() => { const [py, pm, pd] = newExpense.date.split('-'); return new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime(); })(),
          description: `Paid for Expense (${newExpense.account}): ${newExpense.description}`,
          category: 'Vendor Receipt', 
          type: 'IN',
          amount: Number(newExpense.amount),
          reference: `Expense Payment by ${vendorName}`,
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });
      }

      recordActivityLog({
        action: 'Add Expense',
        category: 'Expenses',
        details: `Recorded expense "${newExpense.account || 'General'}" - PKR ${Number(newExpense.amount).toLocaleString()} (${newExpense.description || 'No description'})`,
        metadata: {
          account: newExpense.account,
          amount: Number(newExpense.amount),
          description: newExpense.description,
          branchId: branchToUse
        },
        branchId: branchToUse,
        user
      }).catch(() => {});

      setIsAdding(false);
      setNewExpense({
        date: format(new Date(), 'yyyy-MM-dd'),
        account: '',
        description: '',
        amount: '',
        paidByVendorId: ''
      });
    } catch (err) {
      console.error(err);
      alert('Error adding expense');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this expense?')) {
      try {
        await deleteDoc(doc(db, 'ledger', id));
      } catch (err) {
        console.error(err);
        alert('Error deleting');
      }
    }
  };

  const filteredExpenses = expenses.filter(e => {
    const acc = (e.reference || '').split(' - ')[0] || 'General';
    const matchesAccount = selectedAccount === 'All' || acc === selectedAccount;
    const matchesSearch = String(e.description).toLowerCase().includes(searchTerm.toLowerCase());
    
    let matchesDate = true;
    const expDate = e.date ? new Date(e.date).getTime() : 0;
    if (startDate) {
      const sDate = new Date(startDate);
      sDate.setHours(0,0,0,0);
      if (expDate < sDate.getTime()) matchesDate = false;
    }
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23,59,59,999);
      if (expDate > eDate.getTime()) matchesDate = false;
    }
    
    return matchesAccount && matchesSearch && matchesDate;
  });

  const totalExpenseAmount = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 card p-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
            <Wallet className="w-5 h-5 mr-3 text-rose-500" />
            Expenses Management
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage and track daily business expenses</p>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button 
            onClick={() => setIsAdding(!isAdding)} 
            className="flex-1 md:flex-none btn-primary flex items-center justify-center whitespace-nowrap"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Expense
          </button>
          <button onClick={() => window.print()} className="print:hidden px-4 py-2 bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-200 font-medium rounded-md hover:bg-slate-200 transition shadow-sm border border-slate-200 dark:border-slate-700">
            Print
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="card p-6 bg-slate-50 dark:bg-slate-800/50 border-rose-100 border print:hidden">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">Record New Expense</h3>
          <form onSubmit={handleAddExpense} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            {false && (
              <div className="lg:col-span-1">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Target Branch</label>
                <select 
                  required
                  value={targetBranchId}
                  onChange={e => setTargetBranchId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900"
                >
                  <option value="">-- Select Branch --</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="lg:col-span-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Date</label>
              <input 
                type="date" 
                required 
                value={newExpense.date} 
                onChange={e => setNewExpense({...newExpense, date: e.target.value})}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm" 
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Account Name (e.g., Tea, Electric)</label>
              <input 
                type="text" 
                required 
                placeholder="Account/Person"
                value={newExpense.account} 
                onChange={e => setNewExpense({...newExpense, account: e.target.value})}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm" 
                list="expense-accounts"
              />
              <datalist id="expense-accounts">
                <optgroup label="Account Heads">
                  {uniqueAccounts.map(a => <option key={a} value={a} />)}
                </optgroup>
                <optgroup label="Vendors">
                  {vendors.map(v => <option key={v.id} value={v.name} />)}
                </optgroup>
              </datalist>
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Description / Detail</label>
              <input 
                type="text" 
                required 
                placeholder="What was this for?"
                value={newExpense.description} 
                onChange={e => setNewExpense({...newExpense, description: e.target.value})}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm" 
              />
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Paid By (Optional)</label>
              <select 
                value={newExpense.paidByVendorId} 
                onChange={e => setNewExpense({...newExpense, paidByVendorId: e.target.value})}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm bg-white dark:bg-slate-900" 
              >
                <option value="">-- Cash In Hand (Shop) --</option>
                <optgroup label="Directly Paid By Vendor / Owner">
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="lg:col-span-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Amount (PKR)</label>
              <input 
                type="number" 
                required 
                min="0"
                placeholder="0.00"
                value={newExpense.amount} 
                onChange={e => setNewExpense({...newExpense, amount: e.target.value})}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-semibold text-rose-600" 
              />
            </div>
            <div className="lg:col-span-1 flex items-end">
              <button type="submit" className="w-full bg-rose-600 hover:bg-rose-700 text-white font-medium py-2 rounded-md transition shadow-sm">
                Save Expense
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 mb-4 print:hidden">
        <div className="relative flex-1">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search expenses by description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-md border border-slate-300 dark:border-slate-600 focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="date" 
            value={startDate} 
            onChange={e => setStartDate(e.target.value)} 
            className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
          />
          <span className="text-slate-400">to</span>
          <input 
            type="date" 
            value={endDate} 
            onChange={e => setEndDate(e.target.value)} 
            className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-slate-400" />
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300 hidden sm:inline">Filter by Account:</span>
          <select 
            value={selectedAccount} 
            onChange={e => setSelectedAccount(e.target.value)}
            className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2"
          >
            <option value="All">All Expense Accounts</option>
            <optgroup label="Account Heads">
              {uniqueAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
            <optgroup label="Vendors">
              {vendors.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </optgroup>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Account / Group</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium text-right">Amount (PKR)</th>
                <th className="px-4 py-3 font-medium w-20 print:hidden text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpenses.length > 0 ? (
                filteredExpenses.map((expense) => {
                  const acc = String(expense.reference || '').split(' - ')[0] || 'General';
                  return (
                    <tr key={expense.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 mr-2 text-slate-400" />
                          {safeFormat(expense.date || 0, 'dd MMM yyyy')}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">
                        <span className="bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-200 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs">
                          {acc}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{expense.description}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-rose-600 text-right">
                        {Number(expense.amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 print:hidden text-center flex justify-center space-x-2">
                        <button 
                          onClick={() => setPrintExpense(expense)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                          title="Print Voucher"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(expense.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    No expenses found for this account.
                  </td>
                </tr>
              )}
            </tbody>
            {filteredExpenses.length > 0 && (
              <tfoot className="bg-slate-50 dark:bg-slate-800/50 font-medium">
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">Total Selected Expenses:</td>
                  <td className="px-4 py-3 font-mono text-rose-600 font-bold text-right text-base">
                    PKR {totalExpenseAmount.toLocaleString()}
                  </td>
                  <td className="print:hidden"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <div className="mt-8 text-center text-xs font-bold text-black uppercase print:block hidden">
      </div>
      {/* Print Expense Modal */}
      {printExpense && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:backdrop-blur-none">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col print:shadow-none print:w-full print:max-w-none print:h-auto print:max-h-none overflow-hidden">
            {/* Modal Header - Hidden in Print */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800/50 shrink-0 print:hidden bg-white dark:bg-slate-900">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center">
                <Printer className="w-5 h-5 mr-2 text-indigo-500" />
                Print Expense Voucher
              </h3>
              <button 
                onClick={() => setPrintExpense(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Print Content */}
            <div className="p-8 print:p-4 flex-1 overflow-y-auto bg-white text-black font-mono">
               {/* Minimalist receipt style */}
               <div className="text-center mb-6 print:mb-4 border-b-[2px] border-black pb-4 print:pb-2">
                 <h1 className="text-2xl print:text-3xl font-black uppercase tracking-widest text-black mb-1">{branches.find(b => b.id === activeBranchId)?.name || 'COMPANY NAME'}</h1>
                 <p className="text-sm text-black font-bold mb-2">{branches.find(b => b.id === activeBranchId)?.address || ''}</p>
                 <h2 className="text-xl print:text-[20px] font-black uppercase tracking-widest text-black mt-2 bg-black text-white py-1 w-3/4 mx-auto">EXPENSE VOUCHER</h2>
               </div>
               
               <div className="text-sm print:text-[14px] font-bold text-black mb-4 print:mb-2 space-y-2">
                 <div className="flex justify-between border-b border-dashed border-black pb-1">
                   <span>Date:</span>
                   <span>{new Date(printExpense.date || 0).toLocaleDateString()}</span>
                 </div>
                 <div className="flex justify-between border-b border-dashed border-black pb-1">
                   <span>Account Head:</span>
                   <span>{String(printExpense.reference || '').split(' - ')[0] || 'General'}</span>
                 </div>
                 <div className="flex justify-between border-b border-dashed border-black pb-1">
                   <span>Description:</span>
                   <span className="text-right ml-4">{printExpense.description}</span>
                 </div>
                 {printExpense.vendorId && (
                   <div className="flex justify-between border-b border-dashed border-black pb-1">
                     <span>Paid By Vendor:</span>
                     <span>{vendors.find(v => v.id === printExpense.vendorId)?.name || 'Unknown'}</span>
                   </div>
                 )}
               </div>

               <div className="flex justify-between items-center pt-2 text-black mt-6 border-t-[2px] border-black">
                 <span className="text-[15px] font-black uppercase tracking-wider">Total Amount PKR</span>
                 <span className="text-[20px] font-black">{(printExpense.amount || 0).toFixed(0)}</span>
               </div>
               
               <div className="mt-12 pt-6 flex justify-between">
                  <div className="w-32 border-t border-black text-center text-xs font-bold pt-1">Prepared By</div>
                  <div className="w-32 border-t border-black text-center text-xs font-bold pt-1">Authorized By</div>
               </div>

               <div className="mt-8 print:mt-6 text-center text-[10px] font-bold text-black uppercase tracking-widest border-t-[2px] border-black pt-2">
                 Generated via System
               </div>
            </div>

            {/* Modal Actions - Hidden in Print */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-800/50 flex justify-end shrink-0 gap-3 print:hidden rounded-b-lg">
               <button 
                 onClick={() => {
                   setTimeout(() => {
                     window.print();
                   }, 300);
                 }}
                 className="flex-1 md:flex-none px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors shadow-sm flex items-center justify-center"
               >
                 <Printer className="w-4 h-4 mr-2" />
                 Print Voucher
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
