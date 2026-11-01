import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { collection, query, where, onSnapshot, Timestamp, doc, setDoc, updateDoc, getDocs, getDoc, runTransaction, writeBatch, addDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { FileText, Plus, Trash2, Calendar, Search, Tag, Wallet, Printer, X, Edit, AlertCircle } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { safeFormat } from '../lib/utils';
import { recordActivityLog } from '../lib/activityLogger';
import toast from 'react-hot-toast';

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

  // In-app Delete Confirmation Modal State
  const [deleteExpenseItem, setDeleteExpenseItem] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Edit Expense State
  const [editExpenseItem, setEditExpenseItem] = useState<any | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    date: '',
    account: '',
    description: '',
    amount: ''
  });
  
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

      toast.success("Expense recorded successfully! / خرچہ محفوظ ہو گیا");
      setIsAdding(false);
      setNewExpense({
        date: format(new Date(), 'yyyy-MM-dd'),
        account: '',
        description: '',
        amount: '',
        paidByVendorId: ''
      });
    } catch (err: any) {
      console.error(err);
      toast.error('Error adding expense: ' + (err?.message || ''));
    }
  };

  const confirmDeleteExpense = async () => {
    if (!deleteExpenseItem || isDeleting) return;
    setIsDeleting(true);
    const target = deleteExpenseItem;
    const id = target.id;
    try {
      // 1. Delete main expense entry from ledger
      await deleteDoc(doc(db, 'ledger', id));

      // 2. If this expense was paid by a vendor, check if there was a matching vendor IN entry
      try {
        const vendorMatchingDesc = `Paid for Expense (${target.reference}): ${target.description?.replace(/^Paid via .*? - .*?: /, '')}`;
        const qLinked = query(
          collection(db, 'ledger'),
          where('branchId', '==', target.branchId || activeBranchId),
          where('category', '==', 'Vendor Receipt'),
          where('type', '==', 'IN')
        );
        const linkedSnap = await safeGetDocs(qLinked);
        for (const lDoc of linkedSnap.docs) {
          const lData = lDoc.data();
          if (
            Math.abs(Number(lData.amount) - Number(target.amount)) < 0.01 &&
            (lData.description === vendorMatchingDesc || (target.reference && lData.reference?.includes(target.reference)))
          ) {
            await deleteDoc(doc(db, 'ledger', lDoc.id));
            break;
          }
        }
      } catch (linkedErr) {
        console.warn("Could not clean up linked vendor entry:", linkedErr);
      }

      // Optimistic update so it immediately vanishes from screen
      setExpenses(prev => prev.filter(e => e.id !== id));

      recordActivityLog({
        action: 'Delete Expense',
        category: 'Expenses',
        details: `Deleted expense "${target.reference || 'General'}" - PKR ${Number(target.amount || 0).toLocaleString()} (${target.description || 'No description'})`,
        metadata: {
          expenseId: id,
          amount: Number(target.amount),
          reference: target.reference,
          branchId: target.branchId || activeBranchId
        },
        branchId: target.branchId || activeBranchId,
        user
      }).catch(() => {});

      toast.success("Expense deleted successfully! / خرچہ ڈیلیٹ ہو گیا");
      setDeleteExpenseItem(null);
    } catch (err: any) {
      console.error("Failed to delete expense:", err);
      toast.error("Failed to delete expense: " + (err.message || 'Unknown error'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenEdit = (expense: any) => {
    setEditExpenseItem(expense);
    const dStr = expense.date ? safeFormat(expense.date, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
    setEditForm({
      date: dStr,
      account: expense.reference || '',
      description: expense.description || '',
      amount: String(expense.amount || '')
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editExpenseItem || isEditing) return;
    if (!editForm.amount || Number(editForm.amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    setIsEditing(true);
    const target = editExpenseItem;
    try {
      const [py, pm, pd] = editForm.date.split('-');
      const newTimestamp = new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime();
      const newAmt = Number(editForm.amount);
      const newRef = editForm.account.trim() || 'General';
      const newDesc = editForm.description.trim() || newRef;

      await updateDoc(doc(db, 'ledger', target.id), {
        date: newTimestamp,
        reference: newRef,
        description: newDesc,
        amount: newAmt
      });

      setExpenses(prev => prev.map(item => item.id === target.id ? {
        ...item,
        date: newTimestamp,
        reference: newRef,
        description: newDesc,
        amount: newAmt
      } : item));

      recordActivityLog({
        action: 'Update Expense',
        category: 'Expenses',
        details: `Updated expense "${newRef}" - PKR ${newAmt.toLocaleString()} (${newDesc})`,
        metadata: {
          expenseId: target.id,
          amount: newAmt,
          account: newRef,
          branchId: target.branchId || activeBranchId
        },
        branchId: target.branchId || activeBranchId,
        user
      }).catch(() => {});

      toast.success("Expense updated successfully! / خرچہ تبدیل ہو گیا");
      setEditExpenseItem(null);
    } catch (err: any) {
      console.error("Failed to update expense:", err);
      toast.error("Failed to update expense: " + (err.message || 'Unknown error'));
    } finally {
      setIsEditing(false);
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
                      <td className="px-4 py-3 print:hidden text-center flex justify-center space-x-1.5">
                        <button 
                          onClick={() => handleOpenEdit(expense)}
                          className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                          title="Edit Expense"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setPrintExpense(expense)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                          title="Print Voucher"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setDeleteExpenseItem(expense)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                          title="Delete Expense"
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

      {/* Delete Confirmation Modal */}
      {deleteExpenseItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800 p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  Delete Expense? / خرچہ ڈیلیٹ کریں
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Are you sure you want to permanently delete this expense entry? This action cannot be undone.
                </p>
              </div>
            </div>

            {/* Expense details summary card */}
            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3.5 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Account:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">{deleteExpenseItem.reference || 'General'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">{safeFormat(deleteExpenseItem.date || 0, 'dd MMM yyyy')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Description:</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 text-right max-w-[200px] truncate">{deleteExpenseItem.description || '-'}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 text-sm font-bold">
                <span className="text-slate-700 dark:text-slate-300">Amount:</span>
                <span className="text-rose-600 font-mono">PKR {Number(deleteExpenseItem.amount || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteExpenseItem(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              >
                Cancel / منسوخ
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={confirmDeleteExpense}
                className="px-4 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg transition shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                {isDeleting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Yes, Delete / ڈیلیٹ کریں</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Expense Modal */}
      {editExpenseItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Edit className="w-4 h-4 text-sky-500" />
                Edit Expense / خرچہ تبدیل کریں
              </h3>
              <button
                type="button"
                onClick={() => setEditExpenseItem(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={editForm.date}
                  onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Account Name (کھاتہ / نام)</label>
                <input
                  type="text"
                  required
                  value={editForm.account}
                  onChange={e => setEditForm({ ...editForm, account: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                  list="expense-accounts"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Description / تفصیل</label>
                <input
                  type="text"
                  required
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Amount (PKR) / رقم</label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="any"
                  value={editForm.amount}
                  onChange={e => setEditForm({ ...editForm, amount: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-semibold text-rose-600 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={isEditing}
                  onClick={() => setEditExpenseItem(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel / منسوخ
                </button>
                <button
                  type="submit"
                  disabled={isEditing}
                  className="px-4 py-2 text-sm font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg transition shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  {isEditing ? 'Saving...' : 'Save Changes / محفوظ کریں'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
