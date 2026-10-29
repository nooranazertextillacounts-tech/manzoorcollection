import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, query, where, onSnapshot, Timestamp, doc, setDoc, updateDoc, getDocs, getDoc, runTransaction, writeBatch, addDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { Building2, Plus, Trash2, Mail, Phone, MapPin, Printer, Pencil } from 'lucide-react';
import { printInvoice } from '../lib/print';

interface Vendor {
  id: string;
  branchId: string;
  name: string;
  phone: string;
  email: string;
  address?: string;
  createdAt: any;
}

export function Vendors() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);

  // Calculate dynamic months list for the last 12 months
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
  const [selectedMonth, setSelectedMonth] = useState(monthsList[0]?.value || 0);

  useEffect(() => {
    if (!activeBranchId) return;

    let qLedger: any = collection(db, 'ledger');
    let qPurchases: any = collection(db, 'purchases');
    let qSales: any = collection(db, 'sales');

    if (activeBranchId) {
      qLedger = query(qLedger, where('branchId', '==', activeBranchId));
      qPurchases = query(qPurchases, where('branchId', '==', activeBranchId));
      qSales = query(qSales, where('branchId', '==', activeBranchId));
    }

    const unsubLedger = safeCollectionSnapshot(qLedger, (snap) => {
      setLedgerEntries(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unsubPurchases = safeCollectionSnapshot(qPurchases, (snap) => {
      setPurchases(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    const unsubSales = safeCollectionSnapshot(qSales, (snap) => {
      setSales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });

    return () => {
      unsubLedger();
      unsubPurchases();
      unsubSales();
    };
  }, [activeBranchId, user]);

  useEffect(() => {
    if (showAdd && !selectedBranchId) {
      if (activeBranchId) setSelectedBranchId(activeBranchId);
      else if (branches.length > 0) setSelectedBranchId(branches[0].id);
    }
  }, [showAdd, activeBranchId, branches]);

  useEffect(() => {
    if (!activeBranchId) return;

    const tenantId = user?.tenantId || user?.uid;
    let q: any = collection(db, 'vendors');

    const unsubscribe = safeCollectionSnapshot(q, (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Vendor));
      if (tenantId) {
        list = list.filter(v => !v.tenantId || v.tenantId === tenantId);
      }
      if (activeBranchId) {
        list = list.filter(v => !v.branchId || v.branchId === activeBranchId || (activeBranchId === 'main' && !v.branchId) || v.isCourier || v.isGlobal);
      }
      setVendors(list);
    });
    
    return () => unsubscribe();
  }, [activeBranchId, user]);

  const handleAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const branchToUse = selectedBranchId || activeBranchId;
    if (!branchToUse) {
      alert("Please select a specific branch to add a vendor.");
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (editingVendor) {
        await updateDoc(doc(db, 'vendors', editingVendor.id), {
          branchId: branchToUse,
          name,
          phone,
          email,
          address,
          updatedAt: Timestamp.now()
        });
        setEditingVendor(null);
      } else {
        await addDoc(collection(db, 'vendors'), {
          branchId: branchToUse,
          name,
          phone,
          email,
          address,
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });
      }
      setShowAdd(false);
      setName('');
      setPhone('');
      setEmail('');
      setAddress('');
      setSelectedBranchId(activeBranchId || '');
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setName(vendor.name);
    setPhone(vendor.phone);
    setEmail(vendor.email || '');
    setAddress(vendor.address || '');
    setSelectedBranchId(vendor.branchId);
    setShowAdd(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this vendor?')) {
      try {
        await deleteDoc(doc(db, 'vendors', id));
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  // Helper calculations
  const getVendorBalance = (vendorId: string) => {
    const vendorEntries = ledgerEntries.filter(e => e.vendorId === vendorId);
    const totalIn = vendorEntries.filter(e => e.type === 'IN').reduce((acc, curr) => acc + curr.amount, 0);
    const totalOut = vendorEntries.filter(e => e.type === 'OUT').reduce((acc, curr) => acc + curr.amount, 0);
    return totalIn - totalOut;
  };

  // Build map of item names/ids to vendors
  const itemToVendorMap = new Map<string, { id: string; name: string }>();
  purchases.forEach(p => {
    if (p.vendorId) {
      (p.items || []).forEach((item: any) => {
        const cleanName = String(item.name || '').trim().toLowerCase();
        const cleanId = String(item.id || '').trim();
        if (cleanName) {
          itemToVendorMap.set(cleanName, { id: p.vendorId, name: p.vendorName });
        }
        if (cleanId) {
          itemToVendorMap.set(cleanId, { id: p.vendorId, name: p.vendorName });
        }
      });
    }
  });

  const getMonthlyVendorSales = (vendorId: string, startTs: number, endTs: number) => {
    let totalSales = 0;
    sales.forEach(sale => {
      const saleDate = sale.date;
      if (!saleDate) return;

      const isReturn = sale.transactionType === 'Return';
      (sale.items || []).forEach((item: any) => {
        const cleanName = String(item.name || '').trim().toLowerCase();
        const cleanId = String(item.id || '').trim();
        const mappedVendor = itemToVendorMap.get(cleanName);
        
        if (mappedVendor && mappedVendor?.id === vendorId) {
          const itemTotal = (item.qty || 0) * (item.price || 0);
          if (isReturn) {
            totalSales -= itemTotal;
          } else {
            totalSales += itemTotal;
          }
        }
      });
    });
    return totalSales;
  };

  const getMonthlyVendorPayments = (vendorId: string, startTs: number, endTs: number) => {
    return ledgerEntries
      .filter(e => e.vendorId === vendorId && e.date >= startTs && e.date <= endTs)
      .filter(e => e.category === 'Vendor Payment')
      .reduce((acc, curr) => acc + curr.amount, 0);
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

  const totalPayable = vendors
    .map(v => getVendorBalance(v.id))
    .filter(b => b < 0)
    .reduce((sum, b) => sum + Math.abs(b), 0);

  const totalReceivable = vendors
    .map(v => getVendorBalance(v.id))
    .filter(b => b > 0)
    .reduce((sum, b) => sum + b, 0);

  return (
    <>
      <div className="space-y-6 print:hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center card p-4 flex-1 w-full md:w-auto">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
              <Building2 className="w-5 h-5 mr-3 text-slate-500 dark:text-slate-400" />
              Vendors Directory
            </h2>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center px-4 py-2 bg-[#1e293b] text-sky-400 rounded-md hover:bg-slate-800 transition shadow-sm w-full md:w-auto justify-center">
            <Plus className="w-5 h-5 mr-2" /> Add Vendor
          </button>
        </div>

        {/* Summary Boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Total Vendors</div>
            <div className="text-2xl font-black text-slate-800 dark:text-slate-100">{vendors.length}</div>
            <div className="text-[10px] text-slate-500 mt-1">Active supplier profiles</div>
          </div>

          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 text-rose-500">Total Payable (دینا ہے)</div>
            <div className="text-2xl font-black text-rose-600">PKR {totalPayable.toLocaleString()}</div>
            <div className="text-[10px] text-slate-500 mt-1">Out of {vendors.filter(v => getVendorBalance(v.id) < 0).length} vendors</div>
          </div>

          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 text-emerald-500">Total Receivable (لینا ہے)</div>
            <div className="text-2xl font-black text-emerald-600">PKR {totalReceivable.toLocaleString()}</div>
            <div className="text-[10px] text-slate-500 mt-1">From {vendors.filter(v => getVendorBalance(v.id) > 0).length} vendors</div>
          </div>

          <div className="card p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 text-sky-500">Net Balance</div>
            <div className={`text-2xl font-black ${(totalReceivable - totalPayable) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              PKR {Math.abs(totalReceivable - totalPayable).toLocaleString()}
              <span className="text-xs ml-1 font-bold">{(totalReceivable - totalPayable) >= 0 ? '(Cr)' : '(Dr)'}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Portfolio net position</div>
          </div>
        </div>

        {showAdd && (
          <div className="card p-6 bg-slate-50 dark:bg-slate-800/50">
            <h3 className="font-semibold mb-4 text-slate-800 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">
              {editingVendor ? 'Edit Vendor Profile' : 'New Vendor Profile'}
            </h3>
            <form onSubmit={handleAddVendor} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {user?.role === 'super_admin' && !activeBranchId && (
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Assign to Branch *</label>
                  <select 
                    required 
                    value={selectedBranchId} 
                    onChange={e => setSelectedBranchId(e.target.value)} 
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
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
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Company / Rep Name *</label>
                <input required type="text" value={name} onChange={e => setName(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900" placeholder="Vendor Name" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Phone Number *</label>
                <input required type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900" placeholder="+92 300 1234567" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900" placeholder="vendor@example.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Business Address</label>
                <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900" placeholder="Street, City" />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                <button 
                  type="button" 
                  onClick={() => {
                    setShowAdd(false);
                    setEditingVendor(null);
                    setName('');
                    setPhone('');
                    setEmail('');
                    setAddress('');
                  }} 
                  disabled={isSubmitting} 
                  className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-sky-600 text-white rounded font-medium hover:bg-sky-700 transition disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : editingVendor ? 'Update Vendor' : 'Save Vendor'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Vendors Reporting & Analytics Section */}
        <div className="card p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-100 dark:border-slate-800/50 pb-4 mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Vendors Monthly Analytics & Reports</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Track vendor purchases, product sales, payments, and balances.
              </p>
            </div>
            
            <div className="flex flex-wrap gap-3 mt-4 md:mt-0">
              {/* Month Selection */}
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800/50 font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {monthsList.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              {/* Print All Balances Button */}
              <button
                onClick={() => printInvoice('vendor-balances-print', `All_Vendors_Balances_${selectedMonth}`, 'a4')}
                className="flex items-center px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded font-medium text-sm transition shadow-sm text-slate-700 dark:text-slate-200"
              >
                <Printer className="w-4 h-4 mr-2 animate-pulse text-indigo-500" /> Print All Balances
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3">Vendor Name</th>
                  <th className="px-4 py-3 text-right">{selectedMonthLabel} Sales</th>
                  <th className="px-4 py-3 text-right">{selectedMonthLabel} Payments</th>
                  <th className="px-4 py-3 text-center">Shortcuts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {vendors.map(v => {
                  const monthlySales = getMonthlyVendorSales(v.id, startTimestamp, endTimestamp);
                  const monthlyPayments = getMonthlyVendorPayments(v.id, startTimestamp, endTimestamp);

                  return (
                    <tr key={v.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3.5 font-medium text-slate-800 dark:text-slate-100">
                        {v.name}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-650 font-medium">
                        PKR {monthlySales.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-emerald-600 font-medium">
                        PKR {monthlyPayments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          onClick={() => navigate('/ledger', { state: { viewMode: 'vendor', vendorId: v.id } })}
                          className="text-xs text-sky-600 hover:underline inline-flex items-center gap-1 font-medium"
                        >
                          View Ledger
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {vendors.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-slate-400">
                      No vendors listed in directory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
          <h3 className="text-xs font-bold text-slate-400 mb-4 uppercase tracking-widest">Vendors Profiles Directory</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {vendors.map(v => {
              const bName = branches.find(b => b.id === v.branchId)?.name || 'Unknown Branch';
              return (
                <div key={v.id} className="card p-5 group flex flex-col bg-white dark:bg-slate-900">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg mr-3">
                        <Building2 className="w-5 h-5 text-indigo-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100">{v.name}</h3>
                        <div className="text-[10px] text-slate-400 uppercase tracking-widest">{bName}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEditClick(v)} className="text-slate-400 hover:text-sky-500 transition opacity-0 group-hover:opacity-100 p-1">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {user?.role === 'super_admin' && enableDeletion && (
                        <button onClick={() => handleDelete(v.id)} className="text-slate-300 hover:text-rose-500 transition opacity-0 group-hover:opacity-100 p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2 flex-1 mt-2">
                    <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                      <Phone className="w-4 h-4 mr-2 text-slate-400" />
                      {v.phone}
                    </div>
                    {v.email && (
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        <Mail className="w-4 h-4 mr-2 text-slate-400" />
                        {v.email}
                      </div>
                    )}
                    {v.address && (
                      <div className="flex items-center text-sm text-slate-600 dark:text-slate-300">
                        <MapPin className="w-4 h-4 mr-2 text-slate-400" />
                        {v.address}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/50 flex justify-between items-center text-xs">
                     <span className="text-slate-400 font-mono">ID: {v.id.substring(0,6)}</span>
                     <span onClick={() => navigate('/ledger', { state: { viewMode: 'vendor', vendorId: v.id } })} className="text-sky-600 font-medium hover:underline cursor-pointer">View Ledger History</span>
                  </div>
                </div>
              );
            })}
            {vendors.length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 card border-dashed">
                No vendors found. Click "Add Vendor" to start building your supplier list.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden Printable document for All Print */}
      <div id="vendor-balances-print" className="hidden print:block print:bg-white print:w-full print:static print:z-auto print:h-auto print:p-0 font-sans text-black">
        <div className="flex justify-between items-start border-b-[3px] border-black pb-3 mb-6">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wider text-black">
              {activeBranchId === 'main' ? 'MAIN BRANCH (HQ)' : (branches.find(b => b.id === activeBranchId)?.name?.toUpperCase() || 0)}
            </h1>
            <p className="text-sm font-bold uppercase tracking-widest text-slate-700 dark:text-slate-200">
              Vendors Outstanding Balances Statement
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-black">Date: {new Date().toLocaleDateString()}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{new Date().toLocaleTimeString()}</p>
          </div>
        </div>

        <table className="w-full text-left border-collapse mt-4 text-sm text-black">
          <thead>
            <tr className="border-b-2 border-black text-xs font-bold uppercase tracking-wider text-black">
              <th className="py-2.5">#</th>
              <th className="py-2.5">Vendor Name</th>
              <th className="py-2.5 text-right">Outstanding Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300">
            {vendors.map((v, index) => {
              const bal = getVendorBalance(v.id);
              return (
                <tr key={v.id} className="text-black">
                  <td className="py-3 font-medium font-mono text-black">{index + 1}</td>
                  <td className="py-3 font-semibold text-black">{v.name}</td>
                  <td className="py-3 text-right font-mono font-bold text-black font-sans">
                    PKR {bal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    {bal < 0 ? ' (We Owe)' : bal > 0 ? ' (Prepaid)' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-8 border-t-2 border-black pt-4 space-y-2 text-black">
          <div className="flex justify-between items-center">
            <div className="font-bold uppercase text-xs text-rose-700">Total Payable (Payable to Vendors):</div>
            <div className="font-mono font-bold text-sm text-rose-700">
              PKR {totalPayable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="font-bold uppercase text-xs text-emerald-700">Total Receivable (Advance/Credit):</div>
            <div className="font-mono font-bold text-sm text-emerald-700">
              PKR {totalReceivable.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-slate-300">
            <div className="font-bold uppercase text-sm">Net Outstanding Portfolio Balance:</div>
            <div className="font-mono font-black text-lg font-sans">
              PKR {(totalReceivable - totalPayable).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
