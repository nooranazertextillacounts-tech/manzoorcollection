import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, query, where, Timestamp, doc, updateDoc, addDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeCollectionSnapshot } from '../lib/firebase';
import { 
  Users, Plus, Trash2, Mail, Phone, MapPin, Edit, Search, X, Check, 
  Printer, ArrowDownUp, Filter, Wallet, ArrowUpRight, ArrowDownLeft 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { printInvoice } from '../lib/print';

interface Customer {
  id: string;
  branchId: string;
  name: string;
  phone: string;
  email: string;
  address?: string;
  city?: string;
  createdAt: any;
  tenantId?: string;
}

export function Customers() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  const navigate = useNavigate();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'ALL' | 'DUE' | 'ADVANCE'>('ALL');
  const [showAdd, setShowAdd] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Customer State
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editBranchId, setEditBranchId] = useState('');

  // Generate dynamic months list for last 12 months (identical to Vendors)
  const generateMonthsList = () => {
    const list = [];
    const currDate = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(currDate.getFullYear(), currDate.getMonth() - i, 1);
      const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      list.push({ label, value, year: d.getFullYear(), month: d.getMonth() });
    }
    return list;
  };

  const monthsList = generateMonthsList();
  const [selectedMonth, setSelectedMonth] = useState(monthsList[0]?.value || '');

  useEffect(() => {
    if (showAdd && !selectedBranchId) {
      if (activeBranchId) setSelectedBranchId(activeBranchId);
      else if (branches.length > 0) setSelectedBranchId(branches[0].id);
    }
  }, [showAdd, activeBranchId, branches]);

  // Load Customers
  useEffect(() => {
    let q: any = collection(db, 'customers');
    if (activeBranchId) {
      q = query(q, where('branchId', '==', activeBranchId));
    }

    const unsubscribe = safeCollectionSnapshot(q, (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Customer)));
    });
    
    return () => unsubscribe();
  }, [activeBranchId, user]);

  // Load Ledger & Sales for Real Balance & Activity Calculations
  useEffect(() => {
    let qLedger: any = collection(db, 'ledger');
    let qSales: any = collection(db, 'sales');

    if (activeBranchId) {
      qLedger = query(qLedger, where('branchId', '==', activeBranchId));
      qSales = query(qSales, where('branchId', '==', activeBranchId));
    }

    const unsubLedger = safeCollectionSnapshot(qLedger, (snap) => {
      setLedgerEntries(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unsubSales = safeCollectionSnapshot(qSales, (snap) => {
      setSales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    return () => {
      unsubLedger();
      unsubSales();
    };
  }, [activeBranchId, user]);

  // Helper calculation for Customer Balance
  // Ledger convention: type 'IN' is payment/advance from customer (+),
  // type 'OUT' is sale invoice / goods given to customer (-)
  // Net balance = totalIn - totalOut
  // If balance < 0, customer owes us money => Receivable (لینا ہے) = Math.abs(balance)
  // If balance > 0, customer has deposited advance => Advance / Prepaid (جمع) = balance
  const getCustomerBalance = (customerId: string) => {
    const custEntries = ledgerEntries.filter(e => e.customerId === customerId);
    if (custEntries.length > 0) {
      const totalIn = custEntries.filter(e => e.type === 'IN').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const totalOut = custEntries.filter(e => e.type === 'OUT').reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      return totalIn - totalOut;
    }

    // Fallback to sales collection if ledger entries have not been generated
    const custSales = sales.filter(s => s.customerId === customerId);
    if (custSales.length > 0) {
      let net = 0;
      custSales.forEach(s => {
        const tot = Number(s.total) || 0;
        const rec = Number(s.received !== undefined ? s.received : tot) || 0;
        net += (rec - tot);
      });
      return net;
    }
    return 0;
  };

  const selectedMonthObj = monthsList.find(m => m.value === selectedMonth);
  let startTimestamp = 0;
  let endTimestamp = Number.MAX_SAFE_INTEGER;
  let selectedMonthLabel = '';

  if (selectedMonthObj) {
    const start = new Date(selectedMonthObj.year, selectedMonthObj.month, 1);
    const end = new Date(selectedMonthObj.year, selectedMonthObj.month + 1, 0, 23, 59, 59, 999);
    startTimestamp = start.getTime();
    endTimestamp = end.getTime();
    selectedMonthLabel = start.toLocaleString('default', { month: 'short' });
  }

  // Monthly activity helpers
  const getMonthlyCustomerSales = (customerId: string, startTs: number, endTs: number) => {
    const matchingSales = sales.filter(s => {
      if (s.customerId !== customerId) return false;
      const sDate = s.date || (s.createdAt?.toMillis ? s.createdAt.toMillis() : (s.createdAt?.seconds ? s.createdAt.seconds * 1000 : 0));
      return sDate >= startTs && sDate <= endTs;
    });

    if (matchingSales.length > 0) {
      return matchingSales.reduce((sum, s) => {
        const isReturn = s.transactionType === 'Return';
        const tot = Number(s.total) || 0;
        return sum + (isReturn ? -tot : tot);
      }, 0);
    }

    // Fallback to ledger OUT entries for this customer in selected month
    return ledgerEntries
      .filter(e => {
        if (e.customerId !== customerId) return false;
        const eDate = e.date || (e.createdAt?.toMillis ? e.createdAt.toMillis() : (e.createdAt?.seconds ? e.createdAt.seconds * 1000 : 0));
        return eDate >= startTs && eDate <= endTs && e.type === 'OUT';
      })
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  };

  const getMonthlyCustomerPayments = (customerId: string, startTs: number, endTs: number) => {
    return ledgerEntries
      .filter(e => {
        if (e.customerId !== customerId) return false;
        const eDate = e.date || (e.createdAt?.toMillis ? e.createdAt.toMillis() : (e.createdAt?.seconds ? e.createdAt.seconds * 1000 : 0));
        return eDate >= startTs && eDate <= endTs && e.type === 'IN';
      })
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  };

  // Portfolio Totals
  const totalReceivable = customers
    .map(c => getCustomerBalance(c.id))
    .filter(b => b < 0)
    .reduce((sum, b) => sum + Math.abs(b), 0);

  const totalAdvance = customers
    .map(c => getCustomerBalance(c.id))
    .filter(b => b > 0)
    .reduce((sum, b) => sum + b, 0);

  const customersWithReceivable = customers.filter(c => getCustomerBalance(c.id) < 0);
  const customersWithAdvance = customers.filter(c => getCustomerBalance(c.id) > 0);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const branchToUse = selectedBranchId || activeBranchId || (branches.length > 0 ? branches[0].id : '');
    if (!branchToUse) {
      toast.error("Please select a specific branch to add a customer.");
      return;
    }
    
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'customers'), {
        branchId: branchToUse,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        city: city.trim(),
        createdAt: Timestamp.now(),
        tenantId: user?.tenantId || user?.uid
      });
      toast.success("Customer added successfully!");
      setShowAdd(false);
      setName('');
      setPhone('');
      setEmail('');
      setAddress('');
      setCity('');
      setSelectedBranchId(activeBranchId || '');
    } catch (e: any) {
      toast.error(e.message || "Failed to add customer");
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (c: Customer) => {
    setEditingCustomer(c);
    setEditName(c.name || '');
    setEditPhone(c.phone || '');
    setEditEmail(c.email || '');
    setEditAddress(c.address || '');
    setEditCity(c.city || '');
    setEditBranchId(c.branchId || '');
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || isSubmitting) return;
    if (!editName.trim()) {
      toast.error("Customer name is required.");
      return;
    }

    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'customers', editingCustomer.id), {
        name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim(),
        address: editAddress.trim(),
        city: editCity.trim(),
        ...(editBranchId ? { branchId: editBranchId } : {})
      });
      toast.success("Customer updated successfully!");
      setEditingCustomer(null);
    } catch (e: any) {
      toast.error(e.message || "Failed to update customer");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this customer?')) {
      try {
        await deleteDoc(doc(db, 'customers', id));
        toast.success("Customer deleted.");
      } catch (e: any) {
        toast.error(e.message || "Failed to delete customer");
      }
    }
  };

  // Filtered customers for both Table and Grid
  const filteredCustomers = customers.filter(c => {
    const bal = getCustomerBalance(c.id);
    if (balanceFilter === 'DUE' && bal >= 0) return false;
    if (balanceFilter === 'ADVANCE' && bal <= 0) return false;

    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.city || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q) ||
      (c.id || '').toLowerCase().includes(q)
    );
  });

  const activeBranchName = activeBranchId === 'main' 
    ? 'MAIN BRANCH (HQ)' 
    : (branches.find(b => b.id === activeBranchId)?.name || 'ALL BRANCHES');

  const currentBranchObj = branches.find(b => b.id === activeBranchId);

  return (
    <>
      <div className="space-y-6 print:hidden">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 card p-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
              <Users className="w-5 h-5 mr-3 text-sky-600 dark:text-sky-400" />
              Customer Directory & Accounts Receivable (کسٹمرز و وصول طلب کھاتہ)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Total {customers.length} registered customers | Active Branch: <span className="font-semibold text-slate-700 dark:text-slate-200">{activeBranchName}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button 
              onClick={() => setShowAdd(!showAdd)} 
              className="flex items-center px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition shadow-sm text-sm font-semibold shrink-0 cursor-pointer w-full sm:w-auto justify-center"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add Customer (نیا کسٹمر بنائیں)
            </button>
          </div>
        </div>

        {/* Summary Statistics Boxes (Identical to Vendors Payable/Receivable) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Total Customers</div>
            <div className="text-2xl font-black text-slate-800 dark:text-slate-100">{customers.length}</div>
            <div className="text-[10px] text-slate-500 mt-1">Active customer profiles</div>
          </div>

          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
            <div className="text-xs font-bold uppercase tracking-widest mb-1 text-rose-500 flex items-center justify-between">
              <span>Total Receivable (لینا ہے)</span>
              <ArrowDownLeft className="w-3.5 h-3.5 text-rose-500" />
            </div>
            <div className="text-2xl font-black text-rose-600">PKR {totalReceivable.toLocaleString()}</div>
            <div className="text-[10px] text-slate-500 mt-1">Pending from {customersWithReceivable.length} customers</div>
          </div>

          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
            <div className="text-xs font-bold uppercase tracking-widest mb-1 text-emerald-500 flex items-center justify-between">
              <span>Customer Advance (جمع ایڈوانس)</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="text-2xl font-black text-emerald-600">PKR {totalAdvance.toLocaleString()}</div>
            <div className="text-[10px] text-slate-500 mt-1">Prepaid by {customersWithAdvance.length} customers</div>
          </div>

          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
            <div className="text-xs font-bold uppercase tracking-widest mb-1 text-sky-500">Net Portfolio Position</div>
            <div className={`text-2xl font-black ${(totalReceivable - totalAdvance) >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              PKR {Math.abs(totalReceivable - totalAdvance).toLocaleString()}
              <span className="text-xs ml-1 font-bold">{(totalReceivable - totalAdvance) >= 0 ? '(Dr / Receivable)' : '(Cr / Advance)'}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Overall accounts receivable balance</div>
          </div>
        </div>

        {/* Add Customer Form */}
        {showAdd && (
          <div className="card p-6 bg-slate-50 dark:bg-slate-800/50 border border-sky-100 dark:border-sky-900/40">
            <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-sky-600" /> New Customer Profile (نیا کسٹمر)
              </h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddCustomer} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {user?.role === 'super_admin' && !activeBranchId && (
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Assign to Branch *</label>
                  <select 
                    required 
                    value={selectedBranchId} 
                    onChange={e => setSelectedBranchId(e.target.value)} 
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm"
                  >
                    <option value="" disabled>Select a branch</option>
                    <option value="main">Main Branch (HQ)</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Full Name * (کسٹمر کا نام)</label>
                <input required type="text" value={name} onChange={e => setName(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm" placeholder="Customer Name" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Phone Number (فون نمبر)</label>
                <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm" placeholder="+92 300 1234567" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm" placeholder="customer@example.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">City (شہر)</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm" placeholder="e.g. Lahore, Karachi" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Shipping / Billing Address (پتہ)</label>
                <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm" placeholder="Street / Area Address" />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowAdd(false)} disabled={isSubmitting} className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition disabled:opacity-50 text-sm cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-sky-600 text-white rounded font-medium hover:bg-sky-700 transition disabled:opacity-50 text-sm cursor-pointer">
                  {isSubmitting ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Edit Customer Modal */}
        {editingCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-700 relative animate-in fade-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-slate-700 pb-3">
                <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Edit className="w-5 h-5 text-sky-600" /> Edit Customer Profile (کسٹمر کا نام تبدیل کریں)
                </h3>
                <button onClick={() => setEditingCustomer(null)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleUpdateCustomer} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Customer Name * (کسٹمر کا نام)
                  </label>
                  <input
                    required
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                    placeholder="Enter full name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Phone (فون نمبر)
                    </label>
                    <input
                      type="text"
                      value={editPhone}
                      onChange={e => setEditPhone(e.target.value)}
                      className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                      placeholder="Phone number"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      City (شہر)
                    </label>
                    <input
                      type="text"
                      value={editCity}
                      onChange={e => setEditCity(e.target.value)}
                      className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                      placeholder="City"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Email</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                    placeholder="Email"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Address (پتہ)</label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={e => setEditAddress(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                    placeholder="Address"
                  />
                </div>

                {user?.role === 'super_admin' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Branch</label>
                    <select 
                      value={editBranchId} 
                      onChange={e => setEditBranchId(e.target.value)} 
                      className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm"
                    >
                      <option value="" disabled>Select branch</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEditingCustomer(null)}
                    disabled={isSubmitting}
                    className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 bg-sky-600 text-white rounded-md text-sm font-semibold hover:bg-sky-700 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    {isSubmitting ? 'Updating...' : 'Update Customer (محفوظ کریں)'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* CUSTOMER RECEIVABLE REPORT & MONTHLY ACTIVITY TABLE (Identical pattern to Vendors) */}
        <div className="card overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-slate-50/50 dark:bg-slate-800/40">
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base flex items-center gap-2">
                <Wallet className="w-5 h-5 text-sky-600" />
                Customer Accounts Receivable & Monthly Activity Report (کسٹمر واجبات رپورٹ)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Overview of customer billing, recovery payments, and current outstanding balances
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
              {/* Search Box */}
              <div className="relative flex-1 sm:w-56">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter customer..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-7 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Status / Balance Filter Tabs */}
              <div className="flex rounded-md border border-slate-200 dark:border-slate-700 text-xs overflow-hidden bg-white dark:bg-slate-900">
                <button 
                  onClick={() => setBalanceFilter('ALL')} 
                  className={`px-3 py-1.5 font-medium transition-colors cursor-pointer ${balanceFilter === 'ALL' ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  All ({customers.length})
                </button>
                <button 
                  onClick={() => setBalanceFilter('DUE')} 
                  className={`px-3 py-1.5 font-medium border-l border-slate-200 dark:border-slate-700 transition-colors cursor-pointer ${balanceFilter === 'DUE' ? 'bg-rose-600 text-white' : 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30'}`}
                >
                  Receivables Only ({customersWithReceivable.length})
                </button>
                <button 
                  onClick={() => setBalanceFilter('ADVANCE')} 
                  className={`px-3 py-1.5 font-medium border-l border-slate-200 dark:border-slate-700 transition-colors cursor-pointer ${balanceFilter === 'ADVANCE' ? 'bg-emerald-600 text-white' : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'}`}
                >
                  Advance ({customersWithAdvance.length})
                </button>
              </div>

              {/* Month Selection */}
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm bg-white dark:bg-slate-900 font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
              >
                {monthsList.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              {/* Print All Balances Button (Triggering printInvoice) */}
              <button
                onClick={() => printInvoice('customer-receivable-print', `Customer_Receivables_${selectedMonth || 'Statement'}`, 'a4')}
                className="flex items-center px-4 py-1.5 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-slate-300 dark:border-slate-600 rounded font-semibold text-sm transition shadow-sm text-slate-800 dark:text-slate-100 cursor-pointer shrink-0"
                title="Print Customer Accounts Receivable Report (A4 Statement)"
              >
                <Printer className="w-4 h-4 mr-2 text-indigo-500 animate-pulse" /> Print Receivable Report (پرنٹ رپورٹ)
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Customer Name</th>
                  <th className="px-4 py-3">Phone & City</th>
                  <th className="px-4 py-3 text-right">{selectedMonthLabel} Sales / Bills</th>
                  <th className="px-4 py-3 text-right">{selectedMonthLabel} Paid / Recovery</th>
                  <th className="px-4 py-3 text-right">Outstanding Balance (بقایا)</th>
                  <th className="px-4 py-3 text-center">Shortcuts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filteredCustomers.map((c, idx) => {
                  const bal = getCustomerBalance(c.id);
                  const monthlySales = getMonthlyCustomerSales(c.id, startTimestamp, endTimestamp);
                  const monthlyPayments = getMonthlyCustomerPayments(c.id, startTimestamp, endTimestamp);

                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3.5 text-xs text-slate-400 font-mono">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3.5 font-medium text-slate-800 dark:text-slate-100">
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{c.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">ID: {c.id.substring(0, 6)}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 dark:text-slate-300">
                        {c.phone ? <div className="font-mono">{c.phone}</div> : <span className="text-slate-400 italic">No phone</span>}
                        {c.city && <div className="text-[11px] text-slate-400">{c.city}</div>}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-700 dark:text-slate-200 font-medium">
                        PKR {monthlySales.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-emerald-600 font-medium">
                        PKR {monthlyPayments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {bal < 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40">
                            PKR {Math.abs(bal).toLocaleString(undefined, { minimumFractionDigits: 2 })} (لینا ہے)
                          </span>
                        ) : bal > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/40">
                            PKR {bal.toLocaleString(undefined, { minimumFractionDigits: 2 })} (جمع ایڈوانس)
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono text-slate-500 bg-slate-100 dark:bg-slate-800">
                            PKR 0.00 (Clear)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          onClick={() => navigate('/ledger', { state: { viewMode: 'customer', customerId: c.id } })}
                          className="text-xs text-sky-600 dark:text-sky-400 hover:underline font-semibold cursor-pointer inline-flex items-center gap-1"
                        >
                          View Ledger (کھاتہ) &rarr;
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-slate-400">
                      {searchQuery || balanceFilter !== 'ALL'
                        ? 'No customers match the current filter or search criteria.'
                        : 'No customer accounts registered yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* CUSTOMER DIRECTORY CARDS */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Customer Profiles Directory (کسٹمر پروفائلز)
            </h3>
            <span className="text-xs text-slate-500">
              Showing {filteredCustomers.length} of {customers.length}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredCustomers.map(c => {
              const bName = branches.find(b => b.id === c.branchId)?.name || 'Unknown Branch';
              const bal = getCustomerBalance(c.id);

              return (
                <div key={c.id} className="card p-5 group flex flex-col bg-white dark:bg-slate-900 hover:border-sky-300 dark:hover:border-sky-700 transition-all">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-full bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 flex items-center justify-center text-sky-700 dark:text-sky-300 font-bold text-lg mr-3 shadow-xs">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base">
                          {c.name}
                        </h3>
                        <div className="text-[10px] text-slate-400 uppercase tracking-widest">{bName}</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1">
                      <button 
                        onClick={() => startEdit(c)} 
                        title="Edit Customer Name / Profile"
                        className="text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      {user?.role === 'super_admin' && enableDeletion && (
                        <button 
                          onClick={() => handleDelete(c.id)} 
                          title="Delete Customer"
                          className="text-slate-300 hover:text-rose-500 transition p-1.5 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Customer Balance Badge on Card */}
                  <div className="mb-3 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Balance (کھاتہ):</span>
                    {bal < 0 ? (
                      <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                        PKR {Math.abs(bal).toLocaleString()} (Receivable / لینا ہے)
                      </span>
                    ) : bal > 0 ? (
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        PKR {bal.toLocaleString()} (Advance / جمع)
                      </span>
                    ) : (
                      <span className="font-mono text-slate-500">PKR 0 (Clear)</span>
                    )}
                  </div>
                  
                  <div className="space-y-2 flex-1">
                    {c.phone ? (
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        <Phone className="w-4 h-4 mr-2 text-slate-400" />
                        <span className="font-mono">{c.phone}</span>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic">No phone number</div>
                    )}
                    {c.email && (
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        <Mail className="w-4 h-4 mr-2 text-slate-400" />
                        {c.email}
                      </div>
                    )}
                    {c.address && (
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        <MapPin className="w-4 h-4 mr-2 text-slate-400" />
                        {c.address}{c.city ? `, ${c.city}` : ''}
                      </div>
                    )}
                    {!c.address && c.city && (
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        <MapPin className="w-4 h-4 mr-2 text-slate-400" />
                        {c.city}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/50 flex justify-between items-center text-xs">
                    <button
                      onClick={() => startEdit(c)}
                      className="text-sky-600 dark:text-sky-400 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Edit className="w-3 h-3" /> Edit Name
                    </button>
                    <span 
                      onClick={() => navigate('/ledger', { state: { viewMode: 'customer', customerId: c.id } })} 
                      className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium hover:underline cursor-pointer"
                    >
                      View Ledger History &rarr;
                    </span>
                  </div>
                </div>
              );
            })}
            {filteredCustomers.length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 card border-dashed">
                {searchQuery ? `No customer found matching "${searchQuery}".` : 'No customers found. Click "Add Customer" to begin building your CRM.'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* HIDDEN PRINTABLE DOCUMENT FOR ALL CUSTOMER RECEIVABLE REPORT (Mirrors vendor-balances-print) */}
      <div id="customer-receivable-print" className="hidden print:block print:bg-white print:w-full print:static print:z-auto print:h-auto print:p-0 font-sans text-black">
        {/* Print Header */}
        <div className="flex justify-between items-start border-b-[3px] border-black pb-3 mb-6">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wider text-black">
              {activeBranchName}
            </h1>
            {(currentBranchObj?.phone || currentBranchObj?.phone2) && (
              <p className="text-xs font-semibold text-black">
                Phone: {currentBranchObj?.phone || ''} {currentBranchObj?.phone2 ? `| ${currentBranchObj.phone2}` : ''}
              </p>
            )}
            {currentBranchObj?.address && (
              <p className="text-xs text-black">
                {currentBranchObj.address}
              </p>
            )}
            <p className="text-sm font-bold uppercase tracking-widest text-slate-800 mt-1">
              Customer Accounts Receivable & Outstanding Statement
            </p>
            <p className="text-xs font-semibold text-slate-700">
              کسٹمر وصول طلب واجبات و بقایا کھاتہ رپورٹ {selectedMonthObj ? `(${selectedMonthObj.label})` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-black">Date: {new Date().toLocaleDateString()}</p>
            <p className="text-sm text-slate-600">{new Date().toLocaleTimeString()}</p>
            <p className="text-xs text-slate-500 mt-1">Period: {selectedMonthObj?.label || 'All-time'}</p>
          </div>
        </div>

        {/* Printable Table */}
        <table className="w-full text-left border-collapse mt-4 text-sm text-black">
          <thead>
            <tr className="border-b-2 border-black text-xs font-bold uppercase tracking-wider text-black bg-slate-100">
              <th className="py-2.5 px-2">#</th>
              <th className="py-2.5 px-2">Customer Name</th>
              <th className="py-2.5 px-2">Phone / City</th>
              <th className="py-2.5 px-2 text-right">{selectedMonthLabel || 'Month'} Sales</th>
              <th className="py-2.5 px-2 text-right">{selectedMonthLabel || 'Month'} Recovery</th>
              <th className="py-2.5 px-2 text-right">Outstanding Balance (بقایا)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300">
            {filteredCustomers.map((c, index) => {
              const bal = getCustomerBalance(c.id);
              const monthlySales = getMonthlyCustomerSales(c.id, startTimestamp, endTimestamp);
              const monthlyPayments = getMonthlyCustomerPayments(c.id, startTimestamp, endTimestamp);

              return (
                <tr key={c.id} className="text-black">
                  <td className="py-2 px-2 font-medium font-mono text-black">{index + 1}</td>
                  <td className="py-2 px-2 font-bold text-black">{c.name}</td>
                  <td className="py-2 px-2 text-xs text-black">
                    {c.phone || '-'}{c.city ? `, ${c.city}` : ''}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-black">
                    PKR {monthlySales.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-black font-semibold">
                    PKR {monthlyPayments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-2 text-right font-mono font-bold text-black font-sans">
                    {bal < 0 ? (
                      `PKR ${Math.abs(bal).toLocaleString(undefined, { minimumFractionDigits: 2 })} (Receivable / لینا ہے)`
                    ) : bal > 0 ? (
                      `PKR ${bal.toLocaleString(undefined, { minimumFractionDigits: 2 })} (Advance / جمع)`
                    ) : (
                      'PKR 0.00'
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredCustomers.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-500 italic">
                  No customer records found matching report criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Printable Grand Summary Footer (Mirrors Vendors Summary) */}
        <div className="mt-8 border-t-2 border-black pt-4 space-y-2 text-black">
          <div className="flex justify-between items-center">
            <div className="font-bold uppercase text-xs text-rose-700">
              Total Receivable (Receivable from Customers / کسٹمرز سے لینا ہے):
            </div>
            <div className="font-mono font-bold text-sm text-rose-700">
              PKR {totalReceivable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="font-bold uppercase text-xs text-emerald-700">
              Total Customer Advance (Customer Credit / پیشگی جمع ایڈوانس):
            </div>
            <div className="font-mono font-bold text-sm text-emerald-700">
              PKR {totalAdvance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-slate-300">
            <div className="font-bold uppercase text-sm">
              Net Outstanding Portfolio Balance:
            </div>
            <div className="font-mono font-black text-lg font-sans">
              PKR {Math.abs(totalReceivable - totalAdvance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              <span className="text-xs ml-2 font-bold font-sans">
                {(totalReceivable - totalAdvance) >= 0 ? '(Net Receivable / واجب الوصول)' : '(Net Customer Advance / جمع)'}
              </span>
            </div>
          </div>
        </div>

        {/* Official Signatures */}
        <div className="mt-14 pt-8 grid grid-cols-2 gap-8 text-black">
          <div className="border-t border-black text-center pt-2">
            <p className="text-xs font-bold uppercase tracking-wider text-black">Prepared By (اکاؤنٹنٹ)</p>
          </div>
          <div className="border-t border-black text-center pt-2">
            <p className="text-xs font-bold uppercase tracking-wider text-black">Authorized Stamp / Sign (منظور شدہ)</p>
          </div>
        </div>
      </div>
    </>
  );
}
