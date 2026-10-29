import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, query, where, onSnapshot, Timestamp, orderBy, doc, setDoc, getDocs, getDoc, runTransaction, writeBatch, addDoc, updateDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { BookText, Plus, ArrowDownRight, ArrowUpRight, Filter, Printer, Trash2, Edit, RefreshCw } from 'lucide-react';
import { printInvoice } from '../lib/print';
import { useLocation } from 'react-router';
import { format, startOfDay, endOfDay, parseISO, isWithinInterval, isValid } from 'date-fns';

const safeFormat = (date: any, formatStr: string) => {
  if (!date) return '';
  const d = new Date(date);
  if (!isValid(d)) return '';
  try {
    return format(d, formatStr);
  } catch (e) {
    return '';
  }
};

import { LedgerEntry } from '../types';

export function Ledger() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  const location = useLocation();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [saleTypeFilter, setSaleTypeFilter] = useState<'ALL' | 'Online' | 'In-Store'>('ALL');
  const [searchQuery, setSearchQuery] = useState((location.state as any)?.searchCustomer || '');
  const [customers, setCustomers] = useState<{id: string, name: string}[]>([]);
  const [vendors, setVendors] = useState<{id: string, name: string}[]>([]);

  // View modes
  const [viewMode, setViewMode] = useState<'general' | 'customer' | 'vendor' | 'stock_transfer'>((location.state as any)?.viewMode || 'general');
  const [selectedCustomerIdFilter, setSelectedCustomerIdFilter] = useState((location.state as any)?.customerId || '');
  const [selectedVendorIdFilter, setSelectedVendorIdFilter] = useState((location.state as any)?.vendorId || '');
  
  // Date filters
  const [startDate, setStartDate] = useState(format(startOfDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfDay(new Date()), 'yyyy-MM-dd'));

  // Form state
  const [targetBranchId, setTargetBranchId] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [description, setDescription] = useState('');
  const [referenceInput, setReferenceInput] = useState('');
  const [accountType, setAccountType] = useState<'customer' | 'vendor' | 'general' | 'owner'>('customer');
  const [ownerName, setOwnerName] = useState('');
  const [paidByVendorId, setPaidByVendorId] = useState('');
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [amount, setAmount] = useState<number | ''>('');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!activeBranchId) return;

    let q: any = collection(db, 'ledger');
    let custQ: any = collection(db, 'customers');
    let vendQ: any = collection(db, 'vendors');
    
    if (activeBranchId) {
      q = query(q, where('branchId', '==', activeBranchId));
    }

    const tenantId = user?.tenantId || user?.uid;

    const unsubscribe = safeCollectionSnapshot(q, (snap) => {
      const rawData = snap.docs.map(d => { 
        const dt = d.data() as any; 
        let t = dt.type; 
        let dDate = dt.date; 
        if (!dDate) dDate = dt.createdAt?.toMillis ? dt.createdAt.toMillis() : (dt.createdAt?.seconds ? dt.createdAt.seconds * 1000 : 0); 
        return { id: d.id, ...dt, type: t, date: dDate } as LedgerEntry; 
      });

      // Deduplicate entries by unique document ID
      const seenDocIds = new Set<string>();
      const dedupedData: LedgerEntry[] = [];

      for (const item of rawData) {
        if (!seenDocIds.has(item.id)) {
          seenDocIds.add(item.id);
          dedupedData.push(item);
        }
      }

      // Sort by date ascending (oldest first) to calculate running balance properly downward
      dedupedData.sort((a, b) => {
        if (a.date !== b.date) return a.date - b.date;
        const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
        const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
        return aTime - bTime;
      });

      setEntries(dedupedData);
    });

    const unsubCust = safeCollectionSnapshot(custQ, (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      if (tenantId) {
        list = list.filter(c => !c.tenantId || c.tenantId === tenantId);
      }
      if (activeBranchId) {
        list = list.filter(c => !c.branchId || c.branchId === activeBranchId || (activeBranchId === 'main' && !c.branchId));
      }
      setCustomers(list.map(d => ({ id: d.id, name: d.name })));
    });

    const unsubVend = safeCollectionSnapshot(vendQ, (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      if (tenantId) {
        list = list.filter(v => !v.tenantId || v.tenantId === tenantId);
      }
      if (activeBranchId) {
        list = list.filter(v => !v.branchId || v.branchId === activeBranchId || (activeBranchId === 'main' && !v.branchId) || v.isCourier || v.isGlobal);
      }
      setVendors(list.map(d => ({ id: d.id, name: d.name })));
    });
    
    return () => { unsubscribe(); unsubCust(); unsubVend(); };
  }, [activeBranchId, user, startDate, endDate]);

  useEffect(() => {
    const st = location.state as any;
    if (st) {
      if (st.viewMode) setViewMode(st.viewMode);
      if (st.customerId) setSelectedCustomerIdFilter(st.customerId);
      if (st.vendorId) setSelectedVendorIdFilter(st.vendorId);
      if (st.searchCustomer) setSearchQuery(st.searchCustomer);
    }
  }, [location.state]);

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const branchToUse = activeBranchId || targetBranchId;
    if (!branchToUse) {
      alert("Please select a branch first");
      return;
    }

    if (!description || !amount) return;

    try {
      let category = 'Other';
      if (type === 'IN') {
        if (accountType === 'customer') category = 'Customer Payment';
        else if (accountType === 'owner') category = 'Owner Capital';
        else category = 'Receipt';
      } else {
        if (accountType === 'vendor') category = 'Vendor Payment';
        else if (accountType === 'customer') category = 'Customer Refund'; // usually they won't, but just in case
        else if (accountType === 'owner') category = 'Owner Withdrawal';
        else category = 'Expense';
      }
      
      let custId = accountType === 'customer' ? selectedCustomerId : null;
      let vendId = accountType === 'vendor' ? selectedVendorId : null;
      let referenceName = accountType === 'owner' ? ownerName : referenceInput;

      const data = {
        branchId: branchToUse,
        customerId: custId || null,
        vendorId: vendId || null,
        date: (() => { const [py, pm, pd] = transactionDate.split('-'); return new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime(); })(),
        description: description,
        category,
        type,
        amount: Number(amount),
        reference: referenceName,
        tenantId: user?.tenantId || user?.uid
      };

      if (editEntryId) {
        await updateDoc(doc(db, 'ledger', editEntryId), data);
      } else {
        await addDoc(collection(db, 'ledger'), {
          ...data,
          createdAt: Timestamp.now(),
        });
        
        if (paidByVendorId) {
          const vendorName = vendors.find(v => v.id === paidByVendorId)?.name;
          
          if (type === 'OUT') {
            await addDoc(collection(db, 'ledger'), {
              branchId: branchToUse,
              vendorId: paidByVendorId,
              date: (() => { const [py, pm, pd] = transactionDate.split('-'); return new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime(); })(),
              description: `Direct Payment via ${vendorName}: ${description}`,
              category: 'Vendor Receipt', 
              type: 'IN',
              amount: Number(amount),
              reference: `Direct Payment by ${vendorName}`,
              createdAt: Timestamp.now(),
              tenantId: user?.tenantId || user?.uid
            });
          } else if (type === 'IN') {
            await addDoc(collection(db, 'ledger'), {
              branchId: branchToUse,
              vendorId: paidByVendorId,
              date: (() => { const [py, pm, pd] = transactionDate.split('-'); return new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime(); })(),
              description: `Direct Receipt via ${vendorName}: ${description}`,
              category: 'Vendor Payment', 
              type: 'OUT',
              amount: Number(amount),
              reference: `Directly Received by ${vendorName}`,
              createdAt: Timestamp.now(),
              tenantId: user?.tenantId || user?.uid
            });
          }
        }
      }

      setShowAdd(false);
      setEditEntryId(null);
      setDescription('');
      setReferenceInput('');
      setAmount('');
      setTransactionDate(new Date().toISOString().slice(0, 10));
      setSelectedCustomerId('');
      setSelectedVendorId('');
      setOwnerName('');
      setPaidByVendorId('');
      setType('IN');
      setAccountType('customer');
    } catch (error) {
      console.error(error);
      alert("Failed to add transaction");
    }
  };

  const handleDeleteEntry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!enableDeletion) return;
    if (confirm("Are you sure you want to delete this ledger entry?")) {
      try {
        await deleteDoc(doc(db, 'ledger', id));
      } catch (err: any) {
        alert("Failed to delete entry: " + err.message);
      }
    }
  };

  const handleEditClick = (e: LedgerEntry, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setEditEntryId(e.id);
    setDescription(e.description);
    setAmount(e.amount);
    setType(e.type);
    setTransactionDate(new Date(e.date).toISOString().split('T')[0]);
    if (e.customerId) {
        setAccountType('customer');
        setSelectedCustomerId(e.customerId);
        setReferenceInput(e.reference || '');
    } else if (e.vendorId) {
        setAccountType('vendor');
        setSelectedVendorId(e.vendorId);
        setReferenceInput(e.reference || '');
    } else if (e.category?.includes('Owner')) {
        setAccountType('owner');
        setOwnerName(e.reference || '');
        setReferenceInput('');
    } else {
        setAccountType('general');
        setReferenceInput(e.reference || '');
    }
    setTargetBranchId(e.branchId);
    setPaidByVendorId('');
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const [syncing, setSyncing] = useState(false);

  const handleSyncSalesToLedger = async () => {
    if (!activeBranchId) return;
    setSyncing(true);
    try {
      let salesQ = query(collection(db, 'sales'), where('branchId', '==', activeBranchId));
      const salesSnap = await safeGetDocs(salesQ);
      
      let ledgerQ = query(collection(db, 'ledger'), where('branchId', '==', activeBranchId));
      const ledgerSnap = await safeGetDocs(ledgerQ);
      
      const existingLedgerDocs = ledgerSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      let syncedCount = 0;

      for (const sDoc of salesSnap.docs) {
        const sale = { id: sDoc.id, ...sDoc.data() as any };
        const shortId = String(sale.invoiceNo || sale.id.substring(0,6)).toUpperCase();
        const invoiceNoRef = shortId;
        const advanceAmt = Number(sale.advanceAmount !== undefined && sale.advanceAmount !== null ? sale.advanceAmount : (sale.saleType === 'Online' ? sale.received : 0)) || 0;
        const finalReceived = sale.saleType === 'Online' 
          ? advanceAmt 
          : (sale.paymentMethod === 'Split' ? (Number(sale.splitCashAmount) || 0) + (Number(sale.splitOnlineAmount) || 0) : (sale.received !== undefined ? Number(sale.received) : Number(sale.total || 0)));

        const saleTimestamp = sale.date || (sale.createdAt?.toMillis ? sale.createdAt.toMillis() : Date.now());

        if (sale.saleType === 'Online' && advanceAmt > 0) {
          const hasAdvanceEntry = existingLedgerDocs.some(l => 
            (l.saleId && l.saleId === sale.id && (l.category === 'Advance Payment' || l.category === 'Sale Payment')) ||
            (l.reference && l.reference.includes(shortId) && (l.category === 'Advance Payment' || l.category === 'Sale Payment'))
          );

          if (!hasAdvanceEntry) {
            const vendorId = sale.advanceDirectVendorPaymentId || sale.directVendorPaymentId || null;
            const vendorObj = vendorId ? vendors.find(v => v.id === vendorId) : null;
            const partyRef = vendorObj ? vendorObj.name : (sale.advancePaymentAccount || sale.paymentAccount || sale.advancePaymentMethod || 'Online Advance');

            await addDoc(collection(db, 'ledger'), {
              branchId: sale.branchId || activeBranchId,
              customerId: sale.customerId || null,
              vendorId: vendorId || null,
              date: saleTimestamp,
              description: `Advance Payment: ${sale.customerName || 'Walk-in'}${sale.advanceDescription ? ` (${sale.advanceDescription})` : ''}`,
              category: 'Advance Payment',
              saleType: 'Online',
              type: 'IN',
              amount: advanceAmt,
              reference: `Inv #${invoiceNoRef} - Advance: ${partyRef}`,
              createdAt: Timestamp.now(),
              tenantId: user?.tenantId || user?.uid,
              saleId: sale.id
            });
            syncedCount++;
          }
        } else if (sale.saleType !== 'Online' && finalReceived > 0) {
          const hasPaymentEntry = existingLedgerDocs.some(l => 
            (l.saleId && l.saleId === sale.id && (l.category === 'Sale Payment' || l.category === 'Sale Return')) ||
            (l.reference && l.reference.includes(shortId) && (l.category === 'Sale Payment' || l.category === 'Sale Return'))
          );

          if (!hasPaymentEntry) {
            if (sale.paymentMethod === 'Split') {
              const cashAmt = Number(sale.splitCashAmount) || 0;
              const onlineAmt = Number(sale.splitOnlineAmount) || 0;
              if (cashAmt > 0) {
                await addDoc(collection(db, 'ledger'), {
                  branchId: sale.branchId || activeBranchId,
                  customerId: sale.customerId || null,
                  date: saleTimestamp,
                  description: `Sale Payment (Cash): ${sale.customerName || 'Walk-in'}`,
                  category: 'Sale Payment',
                  saleType: 'In-Store',
                  type: 'IN',
                  amount: cashAmt,
                  reference: `Inv #${invoiceNoRef} - Cash`,
                  createdAt: Timestamp.now(),
                  tenantId: user?.tenantId || user?.uid,
                  saleId: sale.id
                });
                syncedCount++;
              }
              if (onlineAmt > 0) {
                await addDoc(collection(db, 'ledger'), {
                  branchId: sale.branchId || activeBranchId,
                  customerId: sale.customerId || null,
                  date: saleTimestamp,
                  description: `Sale Payment (Online): ${sale.customerName || 'Walk-in'}`,
                  category: 'Sale Payment',
                  saleType: 'In-Store',
                  type: 'IN',
                  amount: onlineAmt,
                  reference: `Inv #${invoiceNoRef} - Online (${sale.paymentAccount || 'Bank'})`,
                  createdAt: Timestamp.now(),
                  tenantId: user?.tenantId || user?.uid,
                  saleId: sale.id
                });
                if (sale.directVendorPaymentId) {
                  await addDoc(collection(db, 'ledger'), {
                    branchId: sale.branchId || activeBranchId,
                    vendorId: sale.directVendorPaymentId,
                    date: saleTimestamp,
                    description: `Sale Payment (Online): ${sale.customerName || 'Walk-in'}`,
                    category: 'Sale Payment',
                    saleType: 'In-Store',
                    type: 'OUT',
                    amount: onlineAmt,
                    reference: `Inv #${invoiceNoRef} - Online (${sale.paymentAccount || 'Bank'})`,
                    createdAt: Timestamp.now(),
                    tenantId: user?.tenantId || user?.uid,
                    saleId: sale.id
                  });
                }
                syncedCount++;
              }
            } else {
              const vendorId = sale.directVendorPaymentId || null;
              const vendorObj = vendorId ? vendors.find(v => v.id === vendorId) : null;
              const partyRef = vendorObj ? vendorObj.name : (sale.paymentAccount || sale.paymentMethod || 'Cash');

              await addDoc(collection(db, 'ledger'), {
                branchId: sale.branchId || activeBranchId,
                customerId: sale.customerId || null,
                date: saleTimestamp,
                description: `Sale Payment: ${sale.customerName || 'Walk-in'}`,
                category: 'Sale Payment',
                saleType: sale.saleType || 'In-Store',
                type: 'IN',
                amount: finalReceived,
                reference: `Inv #${invoiceNoRef} - ${partyRef}`,
                createdAt: Timestamp.now(),
                tenantId: user?.tenantId || user?.uid,
                saleId: sale.id
              });
              if (vendorId) {
                await addDoc(collection(db, 'ledger'), {
                  branchId: sale.branchId || activeBranchId,
                  vendorId: vendorId,
                  date: saleTimestamp,
                  description: `Sale Payment: ${sale.customerName || 'Walk-in'}`,
                  category: 'Sale Payment',
                  saleType: sale.saleType || 'In-Store',
                  type: 'OUT',
                  amount: finalReceived,
                  reference: `Inv #${invoiceNoRef} - ${partyRef}`,
                  createdAt: Timestamp.now(),
                  tenantId: user?.tenantId || user?.uid,
                  saleId: sale.id
                });
              }
              syncedCount++;
            }
          }
        }

        // Check customer invoice
        if (sale.customerId) {
          const hasInvoiceEntry = existingLedgerDocs.some(l => 
            (l.saleId && l.saleId === sale.id && (l.category === 'Sale Invoice' || l.category === 'Sale Return Invoice')) ||
            (l.reference && l.reference.includes(shortId) && (l.category === 'Sale Invoice' || l.category === 'Sale Return Invoice'))
          );
          if (!hasInvoiceEntry && sale.total) {
            await addDoc(collection(db, 'ledger'), {
              branchId: sale.branchId || activeBranchId,
              customerId: sale.customerId,
              date: saleTimestamp,
              description: `Sale Invoice: ${sale.customerName || ''}`,
              category: 'Sale Invoice',
              saleType: sale.saleType || 'In-Store',
              type: 'OUT',
              amount: Math.abs(Number(sale.total)),
              reference: `Inv #${invoiceNoRef}`,
              createdAt: Timestamp.now(),
              tenantId: user?.tenantId || user?.uid,
              saleId: sale.id
            });
            syncedCount++;
          }
        }
      }

      if (syncedCount > 0) {
        alert(`Successfully synced ${syncedCount} missing invoice payment(s) to Ledger.`);
      } else {
        alert("All invoice payments are already present in the Ledger!");
      }
    } catch (e: any) {
      console.error(e);
      alert("Sync error: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const setDateShortcut = (preset: 'today' | 'yesterday' | 'week' | 'month' | 'all') => {
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = format(y, 'yyyy-MM-dd');
      setStartDate(yStr);
      setEndDate(yStr);
    } else if (preset === 'week') {
      const w = new Date();
      w.setDate(w.getDate() - 7);
      setStartDate(format(w, 'yyyy-MM-dd'));
      setEndDate(todayStr);
    } else if (preset === 'month') {
      const m = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(format(m, 'yyyy-MM-dd'));
      setEndDate(todayStr);
    } else if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    }
  };

  const filteredEntries = entries.filter(e => {
    // Date filter
    const d = new Date(e.date || (e.createdAt?.toMillis ? e.createdAt.toMillis() : (e.createdAt?.seconds ? e.createdAt.seconds * 1000 : 0)));
    if (startDate) {
      const [sy, sm, sd] = startDate.split('-');
      const start = new Date(Number(sy), Number(sm) - 1, Number(sd), 0, 0, 0, 0);
      if (d < start) return false;
    }
    if (endDate) {
      const [ey, em, ed] = endDate.split('-');
      const end = new Date(Number(ey), Number(em) - 1, Number(ed), 23, 59, 59, 999);
      if (d > end) return false;
    }

    if (saleTypeFilter !== 'ALL') {
      if (e.category === 'Sale Payment' || e.category === 'Advance Payment' || e.category === 'Sale Return') { const sType = e.saleType || 'In-Store'; if (sType !== saleTypeFilter) return false; }
    }

    // Strict category filtering for General Ledger view
    if (viewMode === 'general') {
      const cat = e.category || '';
      if (cat === 'Sale Invoice' || cat === 'Sale Return Invoice' || cat === 'Purchase Invoice' || cat === 'Purchase Return Invoice' || cat === 'Stock Transfer' || cat === 'Online Bank Transfer') {
        return false;
      }
    }
    if (viewMode === 'stock_transfer') {
      if (e.category !== 'Stock Transfer') {
        return false;
      }
    }

    // Mode filters
    if (viewMode === 'customer') {
      if (selectedCustomerIdFilter) {
        if (e.customerId !== selectedCustomerIdFilter) return false;
      } else {
        if (!e.customerId && !e.category?.includes('Customer')) return false;
      }
    }
    if (viewMode === 'vendor') {
      if (selectedVendorIdFilter) {
        if (e.vendorId !== selectedVendorIdFilter) return false;
      } else {
        if (!e.vendorId && !e.category?.includes('Vendor') && e.category !== 'Courier COD') return false;
      }
    }

    // Type filters
    const typeMatch = filterType === 'ALL' || e.type === filterType;
    
    // Search filter
    const searchMatch = (() => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase().trim();
      const inDesc = e.description.toLowerCase().includes(q);
      const inRef = e.reference?.toLowerCase().includes(q);
      const inAmount = String(e.amount || '').includes(q) || String(Math.round(e.amount || 0)).includes(q) || (!isNaN(Number(q)) && Math.abs(e.amount - Number(q)) < 0.01);
      
      let inCustomer = false;
      if (e.customerId) {
        const c = customers.find(c => c.id === e.customerId);
        if (c && c.name.toLowerCase().includes(q)) inCustomer = true;
      }
      
      let inVendor = false;
      if (e.vendorId) {
        const v = vendors.find(v => v.id === e.vendorId);
        if (v && v.name.toLowerCase().includes(q)) inVendor = true;
      }

      return inDesc || (!!e.reference && inRef) || inCustomer || inVendor || inAmount;
    })();
    
    return typeMatch && searchMatch;
  }).sort((a, b) => {
    const getVal = (v: any) => {
      if (v?.date && typeof v.date === 'number') return v.date;
      if (v?.date && typeof v.date === 'string') return new Date(v.date).getTime();
      if (v?.createdAt?.seconds) return v.createdAt.seconds * 1000;
      if (v?.createdAt && typeof v.createdAt === 'string') return new Date(v.createdAt).getTime();
      if (v?.createdAt && typeof v.createdAt === 'number') return v.createdAt;
      return 0;
    };
    const diff = getVal(a) - getVal(b);
    if (diff !== 0) return diff;
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
    return aTime - bTime;
  });
  const totalIn = filteredEntries.filter(e => e.type === 'IN').reduce((acc, curr) => acc + curr.amount, 0);
  const totalOut = filteredEntries.filter(e => e.type === 'OUT').reduce((acc, curr) => acc + curr.amount, 0);
  const balance = totalIn - totalOut;
  const netTotal = balance;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center card p-4 print:hidden">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
          Ledger
        </h2>
        
        <div className="flex items-center space-x-3">
          <button 
            disabled={syncing}
            onClick={handleSyncSalesToLedger} 
            title="Sync any missing Online Advance or Invoice payments into Ledger"
            className="flex items-center px-3 py-2 bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 rounded-md hover:bg-sky-100 dark:hover:bg-sky-900/50 transition shadow-sm text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Invoices'}
          </button>
          <button onClick={() => printInvoice('ledger-print-content', 'Ledger Report', 'a4')} className="flex items-center px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 transition shadow-sm">
            <Printer className="w-5 h-5 mr-2" /> Print
          </button>
          <button onClick={() => { setShowAdd(!showAdd); setEditEntryId(null); }} className="flex items-center px-4 py-2 bg-[#1e293b] text-sky-400 rounded-md hover:bg-slate-800 transition shadow-sm">
            <Plus className="w-5 h-5 mr-2" /> New Transaction
          </button>
        </div>
      </div>

      <div id="ledger-print-content" className="space-y-6 print:space-y-0 print:bg-white print:w-full print:block print:m-0 print:p-0">
        {/* Print Header inside content */}
        <div className="hidden print:flex flex-col mb-4">
          <div className="flex justify-between items-start border-b-[3px] border-black pb-2 mb-4">
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-wider text-black font-sans">
                {activeBranchId === 'main' ? 'MAIN BRANCH' : (branches.find(b => b.id === activeBranchId)?.name?.toUpperCase() || 'BRANCH')}
              </h1>
              {(branches.find(b => b.id === activeBranchId)?.phone || branches.find(b => b.id === activeBranchId)?.phone2) && (
                <p className="text-sm font-semibold text-black mb-0.5">
                  {branches.find(b => b.id === activeBranchId)?.phone && <span>Phone 1: {branches.find(b => b.id === activeBranchId)?.phone}</span>}
                  {branches.find(b => b.id === activeBranchId)?.phone && branches.find(b => b.id === activeBranchId)?.phone2 && <span> | </span>}
                  {branches.find(b => b.id === activeBranchId)?.phone2 && <span>Phone 2: {branches.find(b => b.id === activeBranchId)?.phone2}</span>}
                </p>
              )}
              {branches.find(b => b.id === activeBranchId)?.address && (
                <p className="text-sm font-semibold text-black mb-1">
                  {branches.find(b => b.id === activeBranchId)?.address}
                </p>
              )}
              {branches.find(b => b.id === activeBranchId)?.onlinePhone && (
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Online Support: {branches.find(b => b.id === activeBranchId)?.onlinePhone}
                </p>
              )}
              <p className="text-sm font-semibold text-black uppercase">
                Ledger Account Statement
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-black">Printed On: {new Date().toLocaleDateString()}</p>
              <p className="text-sm text-black">{new Date().toLocaleTimeString()}</p>
            </div>
          </div>

          <div className="text-center mb-4">
            <h2 className="text-xl font-bold text-black uppercase tracking-widest border border-black border-2 px-6 py-1.5 inline-block print:bg-transparent">
              {viewMode === 'general' ? 'GENERAL LEDGER' : viewMode === 'customer' ? 'CUSTOMER LEDGER' : viewMode === 'vendor' ? 'VENDOR LEDGER' : 'STOCK TRANSFER LEDGER'}
            </h2>
          </div>

          <div className="flex justify-between items-end border-b-2 border-black p-3 mb-4">
            <div>
              <span className="text-sm font-bold text-black uppercase print:text-black">Account Title:</span>
              <span className="ml-3 text-lg font-bold text-black uppercase">
                {viewMode === 'customer' 
                  ? (customers.find(c => c.id === selectedCustomerIdFilter)?.name || 'ALL CUSTOMERS LEDGER') 
                  : viewMode === 'vendor' 
                    ? (vendors.find(v => v.id === selectedVendorIdFilter)?.name || 'ALL VENDORS LEDGER')
                    : viewMode === 'stock_transfer'
                      ? 'STOCK TRANSFER LEDGER'
                      : 'GENERAL LEDGER'}
              </span>
            </div>
            <div>
              <span className="text-sm font-bold text-black uppercase print:text-black">Period:</span>
              <span className="ml-2 text-sm text-black font-medium">{safeFormat(startDate, 'dd MMM yyyy')} to {safeFormat(endDate, 'dd MMM yyyy')}</span>
            </div>
          </div>
        </div>

      {showAdd && (
        <div className="card p-6 bg-slate-50 dark:bg-slate-800/50 print:hidden">
          <h3 className="font-semibold mb-4 text-slate-800 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">{editEntryId ? 'Edit Transaction' : 'Record Transaction'}</h3>
          <form onSubmit={handleAddEntry} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {false && (
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Branch</label>
                <select 
                  required
                  value={targetBranchId} 
                  onChange={(e) => setTargetBranchId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
                >
                  <option value="" disabled>Select Branch</option>
                  <option value="main">Main Branch</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Date</label>
              <input
                type="date"
                required
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Account Type</label>
              <select 
                value={accountType} 
                onChange={(e: any) => { setAccountType(e.target.value); setSelectedCustomerId(''); setSelectedVendorId(''); setOwnerName(''); }}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
              >
                <option value="customer">Customer</option>
                <option value="vendor">Vendor</option>
                <option value="owner">Owner / Partner (Capital/Drawings)</option>
                <option value="general">Other / General</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Transaction Nature</label>
              <select 
                value={type} 
                onChange={(e: any) => setType(e.target.value)}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
              >
                <option value="IN">Cash IN (Money Received)</option>
                <option value="OUT">Cash OUT (Payment / Expense)</option>
              </select>
            </div>
            {accountType === 'customer' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Account Title (Customer)</label>
                <select
                  required
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
                >
                  <option value="" disabled>Select Customer...</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            {accountType === 'vendor' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Account Title (Vendor)</label>
                <select
                  required
                  value={selectedVendorId}
                  onChange={(e) => setSelectedVendorId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
                >
                  <option value="" disabled>Select Vendor...</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
            )}
            {accountType === 'owner' && (
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Owner Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Manzoor Collection"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
                />
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Description</label>
              <input 
                type="text" 
                required 
                value={description} 
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
                placeholder="Enter description details..."
              />
            </div>
            {accountType !== 'owner' && (
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Reference / Invoice No (Optional)</label>
                <input 
                  type="text" 
                  value={referenceInput} 
                  onChange={(e) => setReferenceInput(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
                  placeholder="e.g. Inv #1234, Check #987"
                />
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Amount (PKR)</label>
              <input 
                type="number" 
                required 
                min="0"
                value={amount} 
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full md:w-1/2 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
                placeholder="Enter amount"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                {type === 'IN' ? 'Received Into / Sent To Account (Optional)' : 'Paid By Account (Optional)'}
              </label>
              <select 
                value={paidByVendorId} 
                onChange={(e) => setPaidByVendorId(e.target.value)}
                className="w-full md:w-1/2 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900"
              >
                <option value="">-- Cash In Hand (Shop) --</option>
                <optgroup label="Owner / Vendor Accounts">
                  {vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </optgroup>
              </select>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                {type === 'IN' 
                  ? "If money was directly sent to an owner/vendor instead of shop cash, select them here." 
                  : "If an owner/vendor paid this directly from their pocket, select them so Shop Cash isn't deducted."}
              </p>
            </div>
            <div className="md:col-span-2 flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => { setShowAdd(false); setEditEntryId(null); }} className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">Cancel</button>
              <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded font-medium hover:bg-emerald-700 transition">{editEntryId ? 'Update Transaction' : 'Save Transaction'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden print:shadow-none print:border-none print:overflow-visible print:bg-transparent print:m-0 print:p-0 print:w-full">
        <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 overflow-x-auto print:hidden">
          <button onClick={() => setViewMode('general')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${viewMode === 'general' ? 'border-sky-600 text-sky-700 bg-white dark:bg-slate-900' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            General Ledger
          </button>
          <button onClick={() => setViewMode('customer')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${viewMode === 'customer' ? 'border-sky-600 text-sky-700 bg-white dark:bg-slate-900' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            Customer Ledger
          </button>
          <button onClick={() => setViewMode('vendor')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${viewMode === 'vendor' ? 'border-sky-600 text-sky-700 bg-white dark:bg-slate-900' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            Vendor Ledger
          </button>
          <button onClick={() => setViewMode('stock_transfer')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${viewMode === 'stock_transfer' ? 'border-sky-600 text-sky-700 bg-white dark:bg-slate-900' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            Stock Transfer Ledger
          </button>
        </div>

        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col md:flex-row justify-between items-center gap-4 print:hidden">
          <div className="flex flex-wrap gap-4 items-center w-full md:w-auto">
            {viewMode === 'customer' && (
              <select 
                value={selectedCustomerIdFilter} 
                onChange={(e) => setSelectedCustomerIdFilter(e.target.value)}
                className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm bg-white dark:bg-slate-900 print:hidden focus:outline-none focus:ring-1 focus:ring-slate-300"
              >
                <option value="">All Customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {viewMode === 'vendor' && (
              <select 
                value={selectedVendorIdFilter} 
                onChange={(e) => setSelectedVendorIdFilter(e.target.value)}
                className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm bg-white dark:bg-slate-900 print:hidden focus:outline-none focus:ring-1 focus:ring-slate-300"
              >
                <option value="">All Vendors</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
            
            <div className="flex rounded-md border border-slate-200 dark:border-slate-700 text-xs overflow-hidden print:hidden">
              <button onClick={() => setFilterType('ALL')} className={`px-3 py-1.5 ${filterType === 'ALL' ? 'bg-slate-800 dark:bg-slate-100 text-white' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>All</button>
              <button onClick={() => setFilterType('IN')} className={`px-3 py-1.5 border-l border-slate-200 dark:border-slate-700 ${filterType === 'IN' ? 'bg-emerald-600 text-white' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Cash In</button>
              <button onClick={() => setFilterType('OUT')} className={`px-3 py-1.5 border-l border-slate-200 dark:border-slate-700 ${filterType === 'OUT' ? 'bg-rose-600 text-white' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Cash Out</button>
            </div>
            <div className="flex rounded-md border border-slate-200 dark:border-slate-700 text-xs overflow-hidden print:hidden">
              <button onClick={() => setSaleTypeFilter('ALL')} className={`px-3 py-1.5 ${saleTypeFilter === 'ALL' ? 'bg-sky-600 text-white' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>All Transactions</button>
              <button onClick={() => setSaleTypeFilter('In-Store')} className={`px-3 py-1.5 border-l border-slate-200 dark:border-slate-700 ${saleTypeFilter === 'In-Store' ? 'bg-sky-600 text-white' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>In-Store</button>
              <button onClick={() => setSaleTypeFilter('Online')} className={`px-3 py-1.5 border-l border-slate-200 dark:border-slate-700 ${saleTypeFilter === 'Online' ? 'bg-sky-600 text-white' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>Online</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center space-x-1">
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={e => setStartDate(e.target.value)} 
                  className="w-32 rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs bg-white dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400" 
                />
                <span className="text-slate-400 text-xs text-nowrap">to</span>
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={e => setEndDate(e.target.value)} 
                  className="w-32 rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs bg-white dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400" 
                />
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                <button type="button" onClick={() => setDateShortcut('today')} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium">Today</button>
                <button type="button" onClick={() => setDateShortcut('yesterday')} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium">Yesterday</button>
                <button type="button" onClick={() => setDateShortcut('week')} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium">7 Days</button>
                <button type="button" onClick={() => setDateShortcut('month')} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium">Month</button>
                <button type="button" onClick={() => setDateShortcut('all')} className="px-2 py-1 rounded bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900 text-sky-700 dark:text-sky-300 font-semibold border border-sky-200 dark:border-sky-800">All Dates</button>
              </div>
            </div>
          </div>
          <div className="relative w-full md:w-96 print:hidden">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-slate-400 sm:text-sm">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
            </div>
            <input 
              type="text" 
              placeholder="Search amount (e.g. 21730), invoice, desc, party..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md leading-5 bg-white dark:bg-slate-900 placeholder-slate-500 focus:outline-none focus:placeholder-slate-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm transition duration-150 ease-in-out shadow-sm"
            />
          </div>
        </div>

        {/* On-Screen Account Title Header Card */}
        <div className="p-4 bg-slate-900 text-white dark:bg-slate-950 border border-slate-800 rounded-xl mb-4 shadow-sm print:hidden">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-sky-400">
                Account Title / Ledger Name
              </div>
              <div className="text-xl sm:text-2xl font-bold text-white mt-0.5">
                {viewMode === 'customer' 
                  ? (customers.find(c => c.id === selectedCustomerIdFilter)?.name || (selectedCustomerIdFilter ? 'Customer Account' : 'All Customers Ledger')) 
                  : viewMode === 'vendor' 
                    ? (vendors.find(v => v.id === selectedVendorIdFilter)?.name || (selectedVendorIdFilter ? 'Vendor Account' : 'All Vendors Ledger'))
                    : viewMode === 'stock_transfer'
                      ? 'Stock Transfer Ledger'
                      : 'General Ledger'}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/50">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Period</span>
                <span className="font-semibold text-slate-200">{safeFormat(startDate, 'dd MMM yyyy')} — {safeFormat(endDate, 'dd MMM yyyy')}</span>
              </div>
              <div className="bg-sky-950/80 px-3 py-1.5 rounded-lg border border-sky-800/50">
                <span className="text-sky-300 block text-[10px] uppercase tracking-wider">Closing Balance</span>
                <span className="font-bold text-sky-200 text-sm">
                  PKR {netTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-left border-collapse print:border-none">
            <thead className="print:border-b-[3px] print:border-black">
              <tr className="bg-slate-100 dark:bg-slate-950 print:bg-transparent border-b border-slate-200 dark:border-slate-700 print:border-black text-xs print:text-sm uppercase tracking-wider text-slate-500 dark:text-slate-400 print:text-black print:font-extrabold print:border-b-[3px]">
                <th className="p-3 print:px-1 print:py-3 font-medium print:font-bold print:text-base">Date</th>
                <th className="p-3 print:px-1 print:py-3 font-medium print:font-bold print:text-base">Particulars</th>
                <th className="p-3 print:px-1 print:py-3 font-medium print:font-bold print:text-base">Ref</th>
                <th className="p-3 print:px-1 print:py-3 font-medium text-right print:font-bold print:text-base">Cash In (Dr)</th>
                <th className="p-3 print:px-1 print:py-3 font-medium text-right print:font-bold print:text-base">Cash Out (Cr)</th>
                <th className="p-3 print:px-1 print:py-3 font-medium text-right print:font-bold text-nowrap print:text-base">Balance</th>
                <th className="p-3 font-medium text-right print:hidden">Branch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-none bg-white dark:bg-slate-900">
              {(() => {
                let rollingBalance = 0;
                let sumIn = 0;
                let sumOut = 0;
                const entriesWithBalance = filteredEntries.map(entry => {
                  if (entry.type === 'IN') {
                    rollingBalance += entry.amount;
                    sumIn += entry.amount;
                  } else {
                    rollingBalance -= entry.amount;
                    sumOut += entry.amount;
                  }
                  return { ...entry, runningBalance: rollingBalance };
                });
                
                const sortedEntriesForDisplay = [...entriesWithBalance];
                
                return sortedEntriesForDisplay.length > 0 ? (
                  <>
                  {sortedEntriesForDisplay.map((entry) => {
                  const bName = entry.branchId === 'main' ? 'Main Branch' : branches.find(b => b.id === entry.branchId)?.name || 'Unknown';
                  
                  const rowBalance = entry.runningBalance;

                  return (
                    <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group print:border-b print:border-black print:border-b-[1px] print:text-black">
                      <td className="p-3 print:px-1 print:py-3 text-base font-bold text-slate-800 dark:text-slate-100 print:text-black whitespace-nowrap">
                        {new Date(entry.date).toLocaleDateString()}
                      </td>
                      <td className="p-3 print:px-1 print:py-3 text-base font-bold text-slate-900 dark:text-slate-50 print:text-black">
                        <div className="flex flex-col">
                          <span>{entry.description}</span>
                          <span className="text-xs print:text-sm text-slate-500 dark:text-slate-400 print:text-slate-600 font-bold uppercase tracking-wider mt-0.5">{entry.category}</span>
                        </div>
                      </td>
                      <td className="p-3 print:px-1 print:py-3 text-sm font-bold text-slate-700 dark:text-slate-200 print:text-black font-mono">
                        {(() => {
                          const partyName = entry.vendorId 
                            ? vendors.find(v => v.id === entry.vendorId)?.name 
                            : entry.customerId 
                              ? customers.find(c => c.id === entry.customerId)?.name 
                              : null;
                          if (partyName && entry.reference) {
                            return `${partyName} (${entry.reference})`;
                          }
                          return partyName || entry.reference || '-';
                        })()}
                      </td>
                      <td className="p-3 print:px-1 print:py-3 text-lg text-right font-mono font-bold text-emerald-600 print:text-black">
                        {entry.type === 'IN' ? entry.amount.toLocaleString() : '-'}
                      </td>
                      <td className="p-3 print:px-1 print:py-3 text-lg text-right font-mono font-bold text-rose-600 print:text-black">
                        {entry.type === 'OUT' ? entry.amount.toLocaleString() : '-'}
                      </td>
                      <td className="p-3 print:px-1 print:py-3 text-lg text-right font-mono font-bold text-slate-800 dark:text-slate-100 relative pr-12 print:text-black print:pr-1">
                        <span className={`px-2 py-1 rounded text-base print:bg-transparent print:text-black print:px-0 print:py-0 ${rowBalance < 0 ? 'bg-rose-100 text-rose-700' : rowBalance > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-200'}`}>
                        {rowBalance < 0 ? `-${Math.abs(rowBalance).toLocaleString()}` : rowBalance > 0 ? `+${rowBalance.toLocaleString()}` : '0'}
                        </span>
                        
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition flex items-center pr-2 print:hidden bg-white/80">
                          {user?.role === 'super_admin' && (
                            <button 
                              onClick={(e) => handleEditClick(entry, e)} 
                              className="text-sky-500 hover:text-sky-700 mr-2 p-1 bg-white dark:bg-slate-900 rounded-full shadow-sm"
                              title="Edit Entry"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}
                          {user?.role === 'super_admin' && enableDeletion && (
                            <button 
                              onClick={(e) => handleDeleteEntry(entry.id, e)} 
                              className="text-rose-500 hover:text-rose-700 p-1 bg-white dark:bg-slate-900 rounded-full shadow-sm"
                              title="Delete Entry"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-slate-500 dark:text-slate-400 text-right opacity-70 print:hidden">
                        {bName}
                      </td>
                    </tr>
                  );
                })}
                  <tr className="bg-slate-50 dark:bg-slate-800/50 print:bg-transparent border-t-[3px] border-slate-300 dark:border-slate-600 print:border-black font-bold text-sm print:text-lg print:text-black">
                    <td colSpan={3} className="p-4 print:px-1 print:py-4 text-right uppercase tracking-wider text-slate-700 dark:text-slate-200 print:text-black print:font-extrabold">Closing Balances:</td>
                    <td className="p-4 print:px-1 print:py-4 text-right font-mono text-emerald-600 print:text-black print:font-extrabold">{sumIn.toLocaleString()}</td>
                    <td className="p-4 print:px-1 print:py-4 text-right font-mono text-rose-600 print:text-black print:font-extrabold">{sumOut.toLocaleString()}</td>
                    <td className="p-4 print:px-1 print:py-4 text-right font-mono text-slate-800 dark:text-slate-100 print:text-black pr-12 print:pr-1 print:font-extrabold">
                      {rollingBalance < 0 ? `-${Math.abs(rollingBalance).toLocaleString()}` : `+${rollingBalance.toLocaleString()}`}
                    </td>
                    <td className="p-4 print:hidden"></td>
                  </tr>
                  </>
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-sm text-slate-500 dark:text-slate-400 print:text-black print:font-bold">
                      No transactions found.
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      <div className="mt-8 text-center text-xs font-bold text-black uppercase print:block hidden"></div>
    </div>
  );
}
