import React, { useState, useEffect, Fragment } from 'react';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, query, where, onSnapshot, getDocsFromCache, addDoc, Timestamp, doc, deleteDoc, getDocs, setDoc, updateDoc, getDoc, runTransaction, writeBatch, orderBy, limit } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { Plus, BarChart3, Receipt, Printer, X, Trash2, Search, User, Package, ChevronDown, Edit, RotateCcw, Lock, Check } from 'lucide-react';
import { printInvoice } from '../lib/print';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, startOfWeek, parseISO, isWithinInterval, startOfDay, endOfDay, subDays, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { recordActivityLog } from '../lib/activityLogger';
import { apiFetch } from '../lib/apiUrl';
import Barcode from 'react-barcode';

import { Sale, InventoryItem } from '../types';

export const isOwnerLinkedAccount = (accountNameOrMethod: string | null | undefined, vendorId?: string | null): boolean => {
  if (vendorId) return false;
  if (!accountNameOrMethod) return false;
  const s = accountNameOrMethod.toLowerCase();
  return (
    s.includes('owner') ||
    s.includes('meezan') ||
    s.includes('jazzcash') ||
    s.includes('easypaisa') ||
    s.includes('ubl')
  );
};

export const getNormalizedAccountHead = (accountName: string | null | undefined, paymentMethod?: string | null): string => {
  const s = (accountName || paymentMethod || '').toLowerCase();
  if (s.includes('meezan')) return 'Meezan Bank';
  if (s.includes('jazzcash')) return 'JazzCash';
  if (s.includes('easypaisa')) return 'EasyPaisa';
  if (s.includes('ubl')) return 'UBL Bank';
  if (s.includes('cash by hand')) return 'Cash by Hand';
  if (s.includes('owner') || paymentMethod === 'Owner Account') return 'Owner Account';
  return accountName || 'Owner Account';
};

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

export function Sales() {

  useBarcodeScanner({
    onScan: (barcode) => {
      // 1. Check if it's an invoice
      const code = barcode.trim().toUpperCase();
      const saleMatch = sales.find(s => 
        s.invoiceNo?.toUpperCase() === code || 
        s.id.toUpperCase() === code || 
        s.id.substring(0, 6).toUpperCase() === code
      );

      if (saleMatch) {
        setPrintSale(saleMatch);
        toast.success(`Bill Found: ${saleMatch.invoiceNo || saleMatch.id.substring(0, 6)}`);
        return;
      }

      // 2. Check if it's an item
      const item = inventory.find(i => i.sku === barcode || i.id === barcode);
      if (item) {
        if (!showAdd) {
           setShowAdd(true);
        }
        if (transactionType === 'Return' && hasReturn) {
          handleAddReturnItem(item, 1);
          toast.success(`Returned: ${item.name}`);
        } else {
          handleAddSpecificItem(item, 1);
          toast.success(`Added: ${item.name}`);
        }
      } else {
        toast.error(`Barcode Not Found: ${barcode}`);
      }
    }
  });
  const { user } = useAuth();
  const isOnlineOnlyUser = user?.role === 'online_sale_login' || user?.role === 'online_team';
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion, enableBillEdit } = useSettings();
  const [sales, setSales] = useState<Sale[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  
  const [tab, setTab] = useState<'invoices' | 'reports'>('invoices');
  const [printSale, setPrintSale] = useState<Sale | null>(null);
  const [autoPrintOnSave, setAutoPrintOnSave] = useState<boolean>(() => {
    return localStorage.getItem('mc_auto_print_sale') !== 'false';
  });

  const [customers, setCustomers] = useState<{id: string, name: string, phone?: string, city?: string}[]>([]);

  // Invoices logic
  const [filterType, setFilterType] = useState<'All' | 'In-Store' | 'Online'>(isOnlineOnlyUser ? 'Online' : 'All');
  const [invoiceStartDate, setInvoiceStartDate] = useState(format(startOfDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)), 'yyyy-MM-dd'));
  const [invoiceEndDate, setInvoiceEndDate] = useState(format(endOfDay(new Date()), 'yyyy-MM-dd'));
  const [editSaleId, setEditSaleId] = useState<string | null>(null);
  const [manualInvoiceNo, setManualInvoiceNo] = useState('');
  const [predictedInvoiceNo, setPredictedInvoiceNo] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [targetBranchId, setTargetBranchId] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [saleDescription, setSaleDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Online' | 'Owner Account' | 'Split'>('Cash');
  const [paymentAccount, setPaymentAccount] = useState('Meezan Bank');
  const [directVendorPaymentId, setDirectVendorPaymentId] = useState('');
  const [onlineSalesEmployees, setOnlineSalesEmployees] = useState<any[]>([]);
  const [salesmen, setSalesmen] = useState<any[]>([]);
  const [salesmanId, setSalesmanId] = useState('');
  const [onlineEmployeeId, setOnlineEmployeeId] = useState('');
  const [saleType, setSaleType] = useState<'In-Store' | 'Online'>(isOnlineOnlyUser ? 'Online' : 'In-Store');
  const [advanceAmount, setAdvanceAmount] = useState<number | ''>('');

  useEffect(() => {
    if (isOnlineOnlyUser) {
      setSaleType('Online');
      setFilterType('Online');
    }
  }, [isOnlineOnlyUser]);
  const [advancePaymentMethod, setAdvancePaymentMethod] = useState<'Cash' | 'Online' | 'Owner Account' | 'Split'>('Cash');
  const [advancePaymentAccount, setAdvancePaymentAccount] = useState('Meezan Bank');
  const [advanceDescription, setAdvanceDescription] = useState('');
  const [advanceDirectVendorPaymentId, setAdvanceDirectVendorPaymentId] = useState('');
  const [shippingCost, setShippingCost] = useState<number | ''>(0);
  const [discountAmount, setDiscountAmount] = useState<number | ''>(0);
  const [lumpSumReturnAmount, setLumpSumReturnAmount] = useState<number | ''>('');
  const [receivedAmount, setReceivedAmount] = useState<number | ''>('');
  const [splitCashAmount, setSplitCashAmount] = useState<number | ''>('');
  const [splitOnlineAmount, setSplitOnlineAmount] = useState<number | ''>('');
  const [courier, setCourier] = useState('');
  const [courierVendorId, setCourierVendorId] = useState('');
  const [codCashReceived, setCodCashReceived] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCity, setCustomerCity] = useState('');
  const [selectedItems, setSelectedItems] = useState<Array<{ id: string, name: string, qty: number, price: number, cost?: number, sku?: string }>>([]);
  
  // Mixed Sale Return in Same Bill
  const [hasReturn, setHasReturn] = useState(false);
  const [returnItems, setReturnItems] = useState<Array<{ id: string, name: string, qty: number, price: number, cost?: number, sku?: string }>>([]);
  const [returnItemSearchQuery, setReturnItemSearchQuery] = useState('');
  const [showReturnItemDropdown, setShowReturnItemDropdown] = useState(false);
  const [selectedReturnItemIdForAdd, setSelectedReturnItemIdForAdd] = useState<string>('');
  const [returnItemQtyForAdd, setReturnItemQtyForAdd] = useState<number | ''>(1);
  const [returnItemPriceForAdd, setReturnItemPriceForAdd] = useState<number | ''>('');

  const [transactionType, setTransactionType] = useState<'Sale' | 'Return'>('Sale');
  const [transactionDate, setTransactionDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerIndex, setSelectedCustomerIndex] = useState(0);
  const [selectedSearchItemIndex, setSelectedSearchItemIndex] = useState(0);
  const [selectedReturnSearchIndex, setSelectedReturnSearchIndex] = useState(0);
  const [billSearchQuery, setBillSearchQuery] = useState('');

  const [selectedItemIdForAdd, setSelectedItemIdForAdd] = useState<string>('');
  const [itemQtyForAdd, setItemQtyForAdd] = useState<number | ''>(1);

  // Quick Customer Add / Edit State
  const [showQuickAddCustomerModal, setShowQuickAddCustomerModal] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState('');
  const [quickCustomerPhone, setQuickCustomerPhone] = useState('');
  const [quickCustomerCity, setQuickCustomerCity] = useState('');
  const [quickCustomerAddress, setQuickCustomerAddress] = useState('');
  const [isQuickCustomerSaving, setIsQuickCustomerSaving] = useState(false);

  // Quick Customer Edit State
  const [quickEditCustomerModal, setQuickEditCustomerModal] = useState<{ id: string; name: string; phone: string; city: string } | null>(null);
  const [isQuickCustomerEditing, setIsQuickCustomerEditing] = useState(false);

  // Bill Customer Edit / Reassign State (For existing bills)
  const [billCustomerEditModal, setBillCustomerEditModal] = useState<{
    sale: Sale;
    customerName: string;
    customerId: string;
    customerPhone: string;
    customerCity: string;
    saveToDirectory: boolean;
  } | null>(null);
  const [isSavingBillCustomer, setIsSavingBillCustomer] = useState(false);
  const [billCustomerSearchQuery, setBillCustomerSearchQuery] = useState('');
  const [showBillCustomerDropdown, setShowBillCustomerDropdown] = useState(false);

  const handleOpenBillCustomerEdit = (sale: Sale) => {
    setBillCustomerEditModal({
      sale,
      customerName: sale.customerName || '',
      customerId: sale.customerId || '',
      customerPhone: sale.customerPhone || '',
      customerCity: sale.customerCity || '',
      saveToDirectory: false
    });
    setBillCustomerSearchQuery('');
    setShowBillCustomerDropdown(false);
  };

  const handleSaveBillCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!billCustomerEditModal || isSavingBillCustomer) return;
    const targetSale = billCustomerEditModal.sale;
    const newName = billCustomerEditModal.customerName.trim();
    if (!newName) {
      toast.error("Customer name cannot be empty");
      return;
    }
    setIsSavingBillCustomer(true);
    try {
      let finalCustId = billCustomerEditModal.customerId || null;
      const finalPhone = billCustomerEditModal.customerPhone?.trim() || '';
      const finalCity = billCustomerEditModal.customerCity?.trim() || '';

      // If user wants to save this customer to Directory and not yet linked to an existing customer id
      if (billCustomerEditModal.saveToDirectory && !finalCustId) {
        const existing = customers.find(c => c.name.toLowerCase() === newName.toLowerCase());
        if (existing) {
          finalCustId = existing.id;
        } else {
          const branchToUse = targetSale.branchId || activeBranchId || (branches.length > 0 ? branches[0].id : '');
          const newDocRef = await addDoc(collection(db, 'customers'), {
            branchId: branchToUse,
            name: newName,
            phone: finalPhone,
            city: finalCity,
            address: '',
            createdAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid
          });
          finalCustId = newDocRef.id;
          setCustomers(prev => [...prev, { id: newDocRef.id, name: newName, phone: finalPhone, city: finalCity }]);
        }
      }

      // 1. Update the sales document in Firestore
      await updateDoc(doc(db, 'sales', targetSale.id), {
        customerName: newName,
        customerId: finalCustId,
        customerPhone: finalPhone || null,
        customerCity: finalCity || null
      });

      // 2. Update related ledger records for this sale
      try {
        const ledgerQ = query(collection(db, 'ledger'), where('saleId', '==', targetSale.id));
        const ledgerSnap = await safeGetDocs(ledgerQ);
        for (const lDoc of ledgerSnap.docs) {
          const lData = lDoc.data();
          const oldDesc = lData.description || '';
          let newDesc = oldDesc;
          if (targetSale.customerName && oldDesc.includes(targetSale.customerName)) {
            newDesc = oldDesc.replace(targetSale.customerName, newName);
          } else if (oldDesc.includes('Walk-in')) {
            newDesc = oldDesc.replace('Walk-in', newName);
          } else if (!oldDesc.includes(newName)) {
            newDesc = `${oldDesc} (${newName})`;
          }
          await updateDoc(doc(db, 'ledger', lDoc.id), {
            customerId: finalCustId,
            description: newDesc
          });
        }
      } catch (ledgerErr) {
        console.warn("Could not update related ledger records:", ledgerErr);
      }

      // 3. Update local sales state
      setSales(prev => prev.map(s => s.id === targetSale.id ? {
        ...s,
        customerName: newName,
        customerId: finalCustId || undefined,
        customerPhone: finalPhone || undefined,
        customerCity: finalCity || undefined
      } : s));

      // 4. Log activity
      recordActivityLog({
        action: 'Update Sale Customer',
        category: 'Sales',
        details: `Updated Customer on Invoice #${targetSale.invoiceNo || targetSale.id.substring(0, 6)} from "${targetSale.customerName || 'Walk-in'}" to "${newName}"`,
        metadata: {
          saleId: targetSale.id,
          invoiceNo: targetSale.invoiceNo,
          oldCustomer: targetSale.customerName,
          newCustomer: newName,
          customerId: finalCustId
        },
        branchId: targetSale.branchId,
        user
      }).catch(() => {});

      toast.success(`Customer on Invoice #${targetSale.invoiceNo || 'INV'} updated to "${newName}"!`);
      setBillCustomerEditModal(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to update customer name");
    } finally {
      setIsSavingBillCustomer(false);
    }
  };

  const handleQuickAddCustomer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!quickCustomerName.trim() || isQuickCustomerSaving) return;
    const branchToUse = activeBranchId || targetBranchId || (branches.length > 0 ? branches[0].id : '');
    
    setIsQuickCustomerSaving(true);
    try {
      const docRef = await addDoc(collection(db, 'customers'), {
        branchId: branchToUse,
        name: quickCustomerName.trim(),
        phone: quickCustomerPhone.trim(),
        city: quickCustomerCity.trim(),
        address: quickCustomerAddress.trim(),
        createdAt: Timestamp.now(),
        tenantId: user?.tenantId || user?.uid
      });
      setSelectedCustomerId(docRef.id);
      setCustomerName(quickCustomerName.trim());
      setCustomerPhone(quickCustomerPhone.trim());
      setCustomerCity(quickCustomerCity.trim());
      setCustomers(prev => [...prev, {
        id: docRef.id,
        name: quickCustomerName.trim(),
        phone: quickCustomerPhone.trim(),
        city: quickCustomerCity.trim()
      }]);
      setCustomerSearchQuery('');
      setShowQuickAddCustomerModal(false);
      setQuickCustomerName('');
      setQuickCustomerPhone('');
      setQuickCustomerCity('');
      setQuickCustomerAddress('');
      toast.success("New customer added and selected!");
    } catch (err: any) {
      toast.error(err.message || "Failed to add customer");
    } finally {
      setIsQuickCustomerSaving(false);
    }
  };

  const handleQuickEditCustomer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!quickEditCustomerModal || !quickEditCustomerModal.name.trim() || isQuickCustomerEditing) return;

    setIsQuickCustomerEditing(true);
    try {
      await updateDoc(doc(db, 'customers', quickEditCustomerModal.id), {
        name: quickEditCustomerModal.name.trim(),
        phone: quickEditCustomerModal.phone.trim(),
        city: quickEditCustomerModal.city.trim()
      });
      if (selectedCustomerId === quickEditCustomerModal.id) {
        setCustomerName(quickEditCustomerModal.name.trim());
        setCustomerPhone(quickEditCustomerModal.phone.trim());
        setCustomerCity(quickEditCustomerModal.city.trim());
      }
      setCustomers(prev => prev.map(c => c.id === quickEditCustomerModal.id ? {
        ...c,
        name: quickEditCustomerModal.name.trim(),
        phone: quickEditCustomerModal.phone.trim(),
        city: quickEditCustomerModal.city.trim()
      } : c));
      toast.success("Customer name updated successfully!");
      setQuickEditCustomerModal(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to update customer");
    } finally {
      setIsQuickCustomerEditing(false);
    }
  };

  const handleSaveWalkInAsCustomer = async () => {
    if (!customerName.trim() || isQuickCustomerSaving) return;
    const branchToUse = activeBranchId || targetBranchId || (branches.length > 0 ? branches[0].id : '');
    setIsQuickCustomerSaving(true);
    try {
      const docRef = await addDoc(collection(db, 'customers'), {
        branchId: branchToUse,
        name: customerName.trim(),
        phone: customerPhone ? String(customerPhone).trim() : '',
        city: customerCity ? String(customerCity).trim() : '',
        address: '',
        createdAt: Timestamp.now(),
        tenantId: user?.tenantId || user?.uid
      });
      setSelectedCustomerId(docRef.id);
      setCustomers(prev => [...prev, {
        id: docRef.id,
        name: customerName.trim(),
        phone: customerPhone ? String(customerPhone).trim() : '',
        city: customerCity ? String(customerCity).trim() : ''
      }]);
      toast.success(`"${customerName.trim()}" saved to customers directory!`);
    } catch (err: any) {
      toast.error(err.message || "Failed to save customer");
    } finally {
      setIsQuickCustomerSaving(false);
    }
  };

  useEffect(() => {
    if (showAdd && !editSaleId && branches.length > 0) {
      const branchToUse = activeBranchId || targetBranchId || branches[0].id;
      const branch = branches.find(b => b.id === branchToUse);
      const branchCode = (branch?.name?.substring(0, 2) || 'MA').toUpperCase();
      const d = new Date(transactionDate);
      const year = d.getFullYear().toString().substring(2);
      const monthsLetters = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
      const monthLetter = monthsLetters[d.getMonth()];
      const prefix = `${branchCode}-${monthLetter}${year}-`;

      let isMounted = true;
      const fetchNextInvoice = async () => {
        try {
          const res = await apiFetch(`/api/db/next-invoice?branchId=${encodeURIComponent(branchToUse)}&prefix=${encodeURIComponent(prefix)}`);
          if (isMounted && res && res.data && res.data.invoiceNo) {
            setPredictedInvoiceNo(res.data.invoiceNo);
            setManualInvoiceNo(res.data.invoiceNo);
          }
        } catch (err) {
          console.warn("Failed to fetch authoritative next invoice preview:", err);
        }
      };

      fetchNextInvoice();

      const counterRef = doc(db, 'counters', `invoice_${branchToUse}`);
      const unsubscribe = onSnapshot(counterRef, () => {
        if (isMounted) {
          fetchNextInvoice();
        }
      });

      return () => {
        isMounted = false;
        unsubscribe();
      };
    }
  }, [showAdd, editSaleId, activeBranchId, targetBranchId, branches, transactionDate]);

  // Reports logic
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [aggregation, setAggregation] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');

  useEffect(() => {
    if (!activeBranchId) return;
    setSales([]);

    let q: any = collection(db, 'sales');
    let invQ: any = collection(db, 'inventory');
    let custQ: any = collection(db, 'customers');
    let vendorQ: any = collection(db, 'vendors');
    
    // Apply date filter at the database level to prevent crashing on large datasets
    const [sy, sm, sd] = invoiceStartDate.split('-');
    const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
    start.setHours(0, 0, 0, 0);
    const [ey, em, ed] = invoiceEndDate.split('-');
    const end = new Date(Number(ey), Number(em) - 1, Number(ed));
    end.setHours(23, 59, 59, 999);
    q = query(q, where('date', '>=', start.getTime()), where('date', '<=', end.getTime()));
    
    if (activeBranchId) {
      q = query(q, where('branchId', '==', activeBranchId));
      invQ = query(invQ, where('branchId', '==', activeBranchId));
    }

    const tenantId = user?.tenantId || user?.uid;

    const unsubVendors = safeCollectionSnapshot(vendorQ, snap => {
       let vList = snap.docs.map(d => ({id: d.id, ...(d.data() as any)}));
       if (tenantId) {
         vList = vList.filter(v => !v.tenantId || v.tenantId === tenantId);
       }
       if (activeBranchId) {
         vList = vList.filter(v => !v.branchId || v.branchId === activeBranchId || (activeBranchId === 'main' && !v.branchId) || v.isCourier || v.isGlobal);
       }
       setVendors(vList);
    });

    const unsubSales = safeCollectionSnapshot(q, (snap) => setSales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Sale))));
    const unsubInv = safeCollectionSnapshot(invQ, (snap) => setInventory(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as InventoryItem))));
    let onlineEmpsQ: any = collection(db, 'onlineSalesEmployees');
    if (tenantId) {
      onlineEmpsQ = query(onlineEmpsQ, where('tenantId', '==', tenantId));
    }
    const unsubOnlineEmps = safeCollectionSnapshot(onlineEmpsQ, snap => {
      let emps = snap.docs.map(d => ({id: d.id, ...d.data() as any}));
      if (activeBranchId) {
        emps = emps.filter(e => e.branchId === activeBranchId || (!e.branchId && activeBranchId === 'main'));
      }
      setOnlineSalesEmployees(emps);
    });

    const salesmenQ = query(collection(db, 'salesmen'), where('status', '==', 'Active'));
    const unsubSalesmen = safeCollectionSnapshot(salesmenQ, snap => {
      let emps = snap.docs.map(d => ({id: d.id, ...d.data() as any}));
      if (activeBranchId) {
        emps = emps.filter(e => e.branchId === activeBranchId || (!e.branchId && activeBranchId === 'main'));
      }
      setSalesmen(emps);
    });
    const unsubCust = safeCollectionSnapshot(custQ, (snap) => {
      let cList = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      if (tenantId) {
        cList = cList.filter(c => !c.tenantId || c.tenantId === tenantId);
      }
      if (activeBranchId) {
        cList = cList.filter(c => !c.branchId || c.branchId === activeBranchId || (activeBranchId === 'main' && !c.branchId));
      }
      setCustomers(cList.map(d => ({ id: d.id, name: d.name, phone: d.phone, city: d.city })));
    });
    
    
    
    return () => {
      unsubSalesmen(); unsubSales(); unsubInv(); unsubCust(); unsubVendors(); if(typeof unsubOnlineEmps === 'function') unsubOnlineEmps(); };
  }, [activeBranchId, user, invoiceStartDate, invoiceEndDate]);

  // F1 Shortcut to open New Invoice
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        if (!showAdd) {
          setShowAdd(true);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [showAdd]);

  useEffect(() => {
    if (showAdd && transactionType !== 'Return') {
      setTimeout(() => {
        const input = document.getElementById('item-search-input');
        if (input) {
          input.focus();
        }
      }, 100);
    }
  }, [showAdd, transactionType]);

  useEffect(() => {
    if (printSale) {
      const timer = setTimeout(() => {
        printInvoice('print-invoice-content', `Sale-Receipt-${printSale.invoiceNo || printSale.id}`, 'thermal');
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [printSale]);

  useEffect(() => {
    if (!printSale) return;
    const handlePrintKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        printInvoice('print-invoice-content', `Sale-Receipt-${printSale.invoiceNo || printSale.id}`, 'thermal');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPrintSale(null);
      }
    };
    window.addEventListener('keydown', handlePrintKeyDown);
    return () => window.removeEventListener('keydown', handlePrintKeyDown);
  }, [printSale]);

  const handleAddSpecificItem = (item: InventoryItem, qty: number = 1) => {
    if (isNaN(qty) || qty <= 0) {
      toast.error("Invalid quantity.");
      return;
    }
    
    // For Sale (deducting stock), check if qty exceeds stock. Ignore for returns.
    if (transactionType === 'Sale' && qty > item.stock) {
        toast.error(`Only ${item.stock} left in stock.`);
        return;
    }
    
    const existingIndex = selectedItems.findIndex(i => i.id === item.id);
    if (existingIndex >= 0) {
      const updated = [...selectedItems];
      if (transactionType === 'Sale' && updated[existingIndex].qty + qty > item.stock) {
          toast.error(`Cannot add more. Only ${item.stock} left in stock.`);
          return;
      }
      updated[existingIndex].qty += qty;
      setSelectedItems(updated);
      setItemSearchQuery('');
      setShowItemDropdown(false);
      return;
    }

    setSelectedItems([...selectedItems, { id: item.id, name: item.name, sku: item.sku, qty, price: item.price, cost: item.cost || 0 }]);
    setItemSearchQuery('');
    setShowItemDropdown(false);
  };

  const handleAddReturnItem = (item: InventoryItem, qty: number = 1, priceOverride?: number) => {
    if (isNaN(qty) || qty <= 0) {
      toast.error("Invalid return quantity.");
      return;
    }
    const rate = (priceOverride !== undefined && priceOverride !== null && priceOverride >= 0) ? priceOverride : item.price;
    const existingIndex = returnItems.findIndex(i => i.id === item.id);
    if (existingIndex >= 0) {
      const updated = [...returnItems];
      updated[existingIndex].qty += qty;
      if (priceOverride !== undefined && priceOverride !== null && priceOverride >= 0) {
        updated[existingIndex].price = rate;
      }
      setReturnItems(updated);
    } else {
      setReturnItems([...returnItems, {
        id: item.id,
        name: item.name,
        sku: item.sku,
        qty,
        price: rate,
        cost: item.cost || 0
      }]);
    }
    setReturnItemSearchQuery('');
    setSelectedReturnItemIdForAdd('');
    setReturnItemQtyForAdd(1);
    setReturnItemPriceForAdd('');
    setShowReturnItemDropdown(false);
  };

  const handleCheckout = async () => {
    if (isSubmitting) return;
    const branchToUse = activeBranchId || targetBranchId;
    if (!branchToUse) {
      toast.error("Select a branch first to record a transaction."); return;
    }
    
    if (selectedItems.length === 0 && (!hasReturn || returnItems.length === 0)) {
      toast.error("Please add at least one sale or return item."); return;
    }
    
    const effectiveItems = selectedItems;
      
    if (saleType !== 'Online' && transactionType !== 'Return') {
      if (paymentMethod === 'Split') {
        if (splitCashAmount === '' || splitOnlineAmount === '') {
          toast.error("Please enter both Cash and Online split amounts."); return;
        }
      } else {
        if (receivedAmount === '') {
          toast.error("Please enter the Amount Received."); return;
        }
      }
    }

    if (saleType === 'Online') {
      if (!onlineEmployeeId) {
        toast.error("Please select an Online Sales Employee."); return;
      }
      if (Number(advanceAmount) > 0 && advancePaymentMethod === 'Online' && !advancePaymentAccount.trim() && !advanceDirectVendorPaymentId) {
        toast.error("Please specify the online advance payment account details."); return;
      }
      if (Number(shippingCost) < 0) {
        toast.error("Please specify a valid shipping cost."); return;
      }
    } else {
      if ((paymentMethod === 'Online' || paymentMethod === 'Split') && !paymentAccount.trim() && !directVendorPaymentId) {
        setPaymentAccount('Meezan Bank');
      }
    }
    setIsSubmitting(true);
    const subtotal = effectiveItems.reduce((acc, curr) => acc + (curr.qty * curr.price), 0);
    const returnItemsTotal = (hasReturn || transactionType === 'Return') ? returnItems.reduce((acc, curr) => acc + ((curr.qty || 0) * (curr.price || 0)), 0) : 0;
    const returnedVal = returnItemsTotal + (Number(lumpSumReturnAmount) || 0);
    const discount = Number(discountAmount) || 0;
    const shipping = saleType === 'Online' ? (Number(shippingCost) || 0) : 0;
    const total = subtotal + shipping - discount - returnedVal;
    const onlineAdvanceAmt = Number(advanceAmount) || 0;
    const finalReceived = saleType === 'Online' 
      ? (codCashReceived ? total : onlineAdvanceAmt)
      : (paymentMethod === 'Split' ? (Number(splitCashAmount) || 0) + (Number(splitOnlineAmount) || 0) : (receivedAmount === '' ? 0 : Number(receivedAmount)));

    const actualCustomerName = selectedCustomerId ? customers.find(c => c.id === selectedCustomerId)?.name || customerName : customerName;
    const totalValue = transactionType === 'Return' ? -total : total;

    // Auto-resolve Courier and COD Ledger Vendor
    let resolvedCourier = saleType === 'Online' ? (courier ? courier.trim() : '') : '';
    let resolvedCourierVendorId = saleType === 'Online' ? courierVendorId : '';

    if (saleType === 'Online' && transactionType === 'Sale') {
      if (resolvedCourier && !resolvedCourierVendorId) {
        const fuzzyName = resolvedCourier.replace(/\\s+/g, '').toLowerCase();
        let matched = vendors.find(v => v.name.replace(/\\s+/g, '').toLowerCase() === fuzzyName);
        
        if (!matched) {
            // Also try includes
            matched = vendors.find(v => v.name.toLowerCase().includes(resolvedCourier.toLowerCase()) || resolvedCourier.toLowerCase().includes(v.name.toLowerCase()));
        }

        if (matched) {
          resolvedCourierVendorId = matched.id;
        } else {
          try {
            const vSnap = await getDocs(query(collection(db, 'vendors'), where('name', '==', resolvedCourier)));
            if (!vSnap.empty) {
              resolvedCourierVendorId = vSnap.docs[0].id;
            } else {
              const newVRef = await addDoc(collection(db, 'vendors'), {
                name: resolvedCourier,
                branchId: branchToUse,
                tenantId: user?.tenantId || user?.uid,
                createdAt: Timestamp.now(),
                isCourier: true,
                phone: '',
                email: '',
                address: ''
              });
              resolvedCourierVendorId = newVRef.id;
            }
          } catch(e) {
            console.error("Auto-creating courier vendor error:", e);
          }
        }
      } else if (resolvedCourierVendorId && !resolvedCourier) {
        const v = vendors.find(x => x.id === resolvedCourierVendorId);
        if (v) resolvedCourier = v.name;
      }
    }

    const saleData: any = {
      branchId: branchToUse,
      customerId: selectedCustomerId || null,
      customerName: actualCustomerName || 'Walk-in Customer',
      paymentMethod: saleType === 'Online' ? advancePaymentMethod : paymentMethod,
      paymentAccount: saleType === 'Online' 
        ? (advancePaymentAccount || (advanceDirectVendorPaymentId ? vendors.find(v => v.id === advanceDirectVendorPaymentId)?.name : null)) 
        : ((paymentMethod === 'Online' || paymentMethod === 'Split' || paymentMethod === 'Owner Account') ? (paymentAccount || 'Meezan Bank') : null),
      directVendorPaymentId: saleType === 'Online'
        ? (advanceDirectVendorPaymentId || directVendorPaymentId || null)
        : ((paymentMethod === 'Online' || paymentMethod === 'Split') ? directVendorPaymentId : null),
      saleType,
      transactionType,
      shippingCost: saleType === 'Online' ? Number(shippingCost) || 0 : 0,
      discount,
      lumpSumReturnAmount: Number(lumpSumReturnAmount) || 0,
      returnedValue: returnedVal,
      returnItems: hasReturn ? returnItems : [],
      subtotal,
      courier: saleType === 'Online' ? (resolvedCourier || null) : null,
      courierVendorId: saleType === 'Online' ? (resolvedCourierVendorId || null) : null,
      codCashReceived: saleType === 'Online' ? !!codCashReceived : false,
      trackingNumber: saleType === 'Online' ? trackingNumber : null,
      shippingAddress: saleType === 'Online' ? shippingAddress : null,
      customerPhone: customerPhone || null,
      customerCity: customerCity || null,
      description: saleDescription.trim() || null,
      advanceAmount: saleType === 'Online' ? (Number(advanceAmount) || 0) : 0,
      advancePaymentMethod: saleType === 'Online' ? advancePaymentMethod : null,
      advancePaymentAccount: saleType === 'Online' ? (advancePaymentAccount || (advanceDirectVendorPaymentId ? vendors.find(v => v.id === advanceDirectVendorPaymentId)?.name : null)) : null,
      advanceDescription: saleType === 'Online' ? advanceDescription : null,
      advanceDirectVendorPaymentId: saleType === 'Online' ? (advanceDirectVendorPaymentId || directVendorPaymentId || null) : null,
      splitCashAmount: paymentMethod === 'Split' ? (Number(splitCashAmount) || 0) : undefined,
      splitOnlineAmount: paymentMethod === 'Split' ? (Number(splitOnlineAmount) || 0) : undefined,
      total: totalValue,
      received: transactionType === 'Return' ? totalValue : finalReceived,
      items: effectiveItems,
      date: new Date(transactionDate).getTime(),
      onlineEmployeeId: saleType === 'Online' ? onlineEmployeeId : null,
      onlineEmployeeName: saleType === 'Online' && onlineEmployeeId ? onlineSalesEmployees.find(e => e.id === onlineEmployeeId)?.name : null,
      onlineEmployeeCode: saleType === 'Online' && onlineEmployeeId ? onlineSalesEmployees.find(e => e.id === onlineEmployeeId)?.onlineCode : null,

      salesmanId: salesmanId || null,
      salesmanName: salesmanId ? salesmen.find(s => s.id === salesmanId)?.name : null,
    };

    const descSuffix = saleDescription.trim() ? ` - ${saleDescription.trim()}` : '';
    let recordedInvoiceNo = String(manualInvoiceNo).trim().toUpperCase();
    let savedSaleId = editSaleId || '';
    const branchToUseForInvoice = activeBranchId || targetBranchId || branches[0].id;
    const branchForInvoice = branches.find(b => b.id === branchToUseForInvoice);
    const branchCode = (branchForInvoice?.name?.substring(0, 2) || 'MA').toUpperCase();
    const d = new Date(transactionDate);
    const year = d.getFullYear().toString().substring(2);
    const monthsLetters = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    const monthLetter = monthsLetters[d.getMonth()];
    const currentPrefix = `${branchCode}-${monthLetter}${year}-`;

    // Strict consecutive auto-invoice for any new sale; preserved for edit
    const isAutoInvoice = !editSaleId;

    let relatedLedgerDocs: { id: string }[] = [];
    if (editSaleId) {
      try {
        const existingSale = sales.find(s => s.id === editSaleId);
        const shortId = String(existingSale?.invoiceNo || editSaleId.substring(0,6)).toUpperCase();
        
        const docsToDelete = new Map<string, string>();
        const exactMatchRegex = new RegExp(`Inv #${shortId}\\b`); 

        const qId = query(collection(db, 'ledger'), where('saleId', '==', editSaleId));
        const snapId = await safeGetDocs(qId);
        snapId.docs.forEach(d => docsToDelete.set(d.id, d.id));

        const qRef = query(collection(db, 'ledger'), 
            where('reference', '>=', `Inv #${shortId}`), 
            where('reference', '<=', `Inv #${shortId}\uf8ff`));
        const snapRef = await safeGetDocs(qRef);
        snapRef.docs.forEach(d => {
            const data = d.data();
            if (exactMatchRegex.test(data.reference || '') || exactMatchRegex.test(data.description || '')) {
                docsToDelete.set(d.id, d.id);
            }
        });

        const qOwner = query(collection(db, 'ledger'), where('category', '==', 'Owner Transfer'), where('branchId', '==', existingSale?.branchId || branchToUse));
        const snapOwner = await safeGetDocs(qOwner);
        snapOwner.docs.forEach(d => {
            if (exactMatchRegex.test(d.data().description || '')) docsToDelete.set(d.id, d.id);
        });

        const qAdvance = query(collection(db, 'ledger'), where('category', '==', 'Advance Payment'), where('branchId', '==', existingSale?.branchId || branchToUse));
        const snapAdvance = await safeGetDocs(qAdvance);
        snapAdvance.docs.forEach(d => {
            if (exactMatchRegex.test(d.data().reference || '') || exactMatchRegex.test(d.data().description || '')) docsToDelete.set(d.id, d.id);
        });

        const qVendor = query(collection(db, 'ledger'), where('category', '==', 'Vendor Payment'), where('branchId', '==', existingSale?.branchId || branchToUse));
        const snapVendor = await safeGetDocs(qVendor);
        snapVendor.docs.forEach(d => {
            if (exactMatchRegex.test(d.data().description || '')) docsToDelete.set(d.id, d.id);
        });

        // Also clean up any linked owner transactions for this invoice
        const qOwnerTx = query(collection(db, 'ownerTransactions'), where('saleInvoiceId', '==', editSaleId));
        const snapOwnerTx = await safeGetDocs(qOwnerTx);
        snapOwnerTx.docs.forEach(d => {
          deleteDoc(doc(db, 'ownerTransactions', d.id)).catch(() => {});
        });

        relatedLedgerDocs = Array.from(docsToDelete.values()).map(id => ({ id }));
      } catch (err) {
        console.error("Failed to fetch related ledger docs for update", err);
      }
    }

    let allocatedNextSeq: number | null = null;
    let allocatedInvoiceNo: string | null = null;

    if (isAutoInvoice) {
       try {
         const res = await apiFetch('/api/db/allocate-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ branchId: branchToUseForInvoice, prefix: currentPrefix })
         });
         if (res && res.data && res.data.nextSeq) {
            allocatedNextSeq = res.data.nextSeq;
            allocatedInvoiceNo = res.data.invoiceNo || `${currentPrefix}${allocatedNextSeq}`;
         }
       } catch (err) {
         console.warn("Failed to atomically allocate invoice, falling back to local sequence", err);
       }
    }

    try {
      await runTransaction(db, async (transaction) => {
        let oldSale: Sale | null = null;
        if (editSaleId) {
          const oldSaleSnap = await transaction.get(doc(db, 'sales', editSaleId));
          if (oldSaleSnap.exists()) {
             oldSale = oldSaleSnap.data() as Sale;
          }
        }
        
        const allItemIds = new Set<string>();
        effectiveItems.forEach(i => {
           if (i.id !== 'lumpsum_sale') {
             allItemIds.add(i.id);
           }
        });
        if (hasReturn && returnItems.length > 0) {
           returnItems.forEach(i => {
             if (i.id !== 'lumpsum_sale') {
               allItemIds.add(i.id);
             }
           });
        }
        if (oldSale && oldSale.items) {
           oldSale.items.forEach((i: any) => {
             if (i.id !== 'lumpsum_sale') {
               allItemIds.add(i.id);
             }
           });
        }
        if (oldSale && oldSale.returnItems) {
           oldSale.returnItems.forEach((i: any) => {
             if (i.id !== 'lumpsum_sale') {
               allItemIds.add(i.id);
             }
           });
        }
        
        const invRefs = Array.from(allItemIds);
        const invSnaps: Record<string, any> = {};
        for (const id of invRefs) {
           const snap = await transaction.get(doc(db, 'inventory', id));
           if (snap.exists()) {
              invSnaps[id] = snap.data();
           }
        }
        
        const newStockMap: Record<string, number> = {};

        for (const id of invRefs) {
           let currentStock = invSnaps[id] ? invSnaps[id].stock : 0;
           
           // Revert old sale items
           if (oldSale && oldSale.items) {
              const oldItem = oldSale.items.find((i: any) => i.id === id);
              if (oldItem) {
                 currentStock = oldSale.transactionType === 'Return' ? currentStock - oldItem.qty : currentStock + oldItem.qty;
              }
           }
           // Revert old return items (subtract back the returned stock that was added)
           if (oldSale && oldSale.returnItems) {
              const oldReturnItem = oldSale.returnItems.find((i: any) => i.id === id);
              if (oldReturnItem) {
                 currentStock = currentStock - oldReturnItem.qty;
              }
           }
           
           // Apply new sale items
           const newItem = effectiveItems.find(i => i.id === id);
           if (newItem) {
              currentStock = transactionType === 'Return' ? currentStock + newItem.qty : currentStock - newItem.qty;
              if (transactionType === 'Sale' && currentStock < 0) {
                 throw new Error(`Insufficient stock for ${newItem.name}`);
              }
           }

           // Apply new return items (restore returned stock to inventory)
           if (hasReturn && returnItems.length > 0) {
              const newReturnItem = returnItems.find(i => i.id === id);
              if (newReturnItem) {
                 currentStock = currentStock + newReturnItem.qty;
              }
           }

           newStockMap[id] = currentStock;
        }

        for (const id of invRefs) {
           if (invSnaps[id] !== undefined) {
              transaction.update(doc(db, 'inventory', id), { stock: newStockMap[id] });
           }
        }



        let finalSaleRef;
        let invoiceNoRef = '';
        
        if (editSaleId) {
          finalSaleRef = doc(db, 'sales', editSaleId);
          invoiceNoRef = String(manualInvoiceNo || oldSale?.invoiceNo || editSaleId.substring(0, 6)).toUpperCase();
          
          transaction.update(finalSaleRef, {
            ...saleData,
            invoiceNo: invoiceNoRef
          });
          if (relatedLedgerDocs.length > 0) {
            for (const lDoc of relatedLedgerDocs) {
              transaction.delete(doc(db, 'ledger', lDoc.id));
            }
          }
        } else {
          finalSaleRef = doc(collection(db, 'sales'));
          const finalSaleId = finalSaleRef.id;
          
          if (isAutoInvoice) {
            if (allocatedNextSeq !== null && allocatedInvoiceNo) {
              invoiceNoRef = allocatedInvoiceNo;
              // counter was already updated securely via backend allocation endpoint
            } else {
              const counterRef = doc(db, 'counters', `invoice_${branchToUseForInvoice}`);
              const counterSnap = await transaction.get(counterRef);
              const currentCounterSeq = counterSnap.exists() ? (counterSnap.data().lastSeq || 0) : 0;
              const nextSeq = currentCounterSeq + 1;
              invoiceNoRef = `${currentPrefix}${nextSeq}`;
              transaction.set(counterRef, { prefix: currentPrefix, lastSeq: nextSeq }, { merge: true });
            }
          } else {
            invoiceNoRef = String(manualInvoiceNo || finalSaleId.substring(0, 6)).toUpperCase();
          }
          
          transaction.set(finalSaleRef, {
            ...saleData,
            invoiceNo: invoiceNoRef,
            createdAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid
          });
        }
        
        const finalSaleId = finalSaleRef.id;
        savedSaleId = finalSaleRef.id;
        recordedInvoiceNo = invoiceNoRef;

        if (selectedCustomerId) {
          const invoiceLedgerRef = doc(collection(db, 'ledger'));
          transaction.set(invoiceLedgerRef, {
            branchId: branchToUse,
            customerId: selectedCustomerId,
            date: new Date(transactionDate).getTime(),
            description: transactionType === 'Return' ? `Sale Return Invoice: ${actualCustomerName || ''}${descSuffix}` : `Sale Invoice: ${actualCustomerName || ''}${descSuffix}`,
            category: transactionType === 'Return' ? 'Sale Return Invoice' : 'Sale Invoice',
            saleType: saleType || 'In-Store',
            type: transactionType === 'Return' ? 'IN' : 'OUT',
            amount: Math.abs(totalValue),
            reference: `Inv #${invoiceNoRef}`,
            createdAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid, 
            saleId: finalSaleId
          });
        }

        const initialPaymentAmount = saleType === 'Online' ? onlineAdvanceAmt : finalReceived;
        if (initialPaymentAmount > 0) {
          const actualPaymentMethod = saleType === 'Online' ? advancePaymentMethod : paymentMethod;
          const actualVendorId = saleType === 'Online' 
            ? (advanceDirectVendorPaymentId || directVendorPaymentId || null) 
            : ((paymentMethod === 'Online' || paymentMethod === 'Split') ? directVendorPaymentId : null);
          const vendorObj = actualVendorId ? vendors.find(v => v.id === actualVendorId) : null;
          const actualAccountName = saleType === 'Online' ? (advancePaymentAccount || vendorObj?.name || '') : paymentAccount;

          if (actualPaymentMethod === 'Split') {
            const cashReceived = Number(splitCashAmount) || 0;
            const onlineReceived = Number(splitOnlineAmount) || 0;
            
            if (cashReceived > 0) {
              const cashLedgerRef = doc(collection(db, 'ledger'));
              transaction.set(cashLedgerRef, {
                branchId: branchToUse,
                customerId: selectedCustomerId || null,
                date: new Date(transactionDate).getTime(),
                description: transactionType === 'Return' ? `Sale Refund (Cash): ${actualCustomerName || ''}${descSuffix}` : `Sale Payment (Cash): ${actualCustomerName || ''}${descSuffix}`,
                category: transactionType === 'Return' ? 'Sale Return' : 'Sale Payment',
                saleType: saleType || 'In-Store',
                type: transactionType === 'Return' ? 'OUT' : 'IN',
                amount: transactionType === 'Return' ? Math.abs(totalValue) * (cashReceived/initialPaymentAmount) : cashReceived,
                reference: `Inv #${invoiceNoRef} - Cash`,
                createdAt: Timestamp.now(),
                tenantId: user?.tenantId || user?.uid, 
                saleId: finalSaleId
              });
            }
            
            if (onlineReceived > 0) {
              const onlineLedgerRef = doc(collection(db, 'ledger'));
              transaction.set(onlineLedgerRef, {
                branchId: branchToUse,
                customerId: selectedCustomerId || null,
                vendorId: actualVendorId || null,
                date: new Date(transactionDate).getTime(),
                description:  transactionType === 'Return' ? `Sale Refund (Online): ${actualCustomerName || ''}${descSuffix}` : `Sale Payment (Online): ${actualCustomerName || ''}${descSuffix}`,
                category:  transactionType === 'Return' ? 'Sale Return' : 'Sale Payment',
                saleType: saleType || 'In-Store',
                type: transactionType === 'Return' ? 'OUT' : 'IN',
                amount:  transactionType === 'Return' ? Math.abs(totalValue) * (onlineReceived/initialPaymentAmount) : onlineReceived,
                reference:  `Inv #${invoiceNoRef} - Online${vendorObj ? ` (${vendorObj.name})` : (actualAccountName ? ` (${actualAccountName})` : '')}`,
                createdAt: Timestamp.now(),
                tenantId: user?.tenantId || user?.uid, 
                saleId: finalSaleId
              });

              // Check if online portion of Split payment was deposited into Owner Account / Meezan / JazzCash / EasyPaisa / UBL
              const isOwnerSplit = (isOwnerLinkedAccount(actualAccountName || paymentAccount, actualVendorId) || actualPaymentMethod === 'Owner Account') && !actualVendorId;
              if (isOwnerSplit && transactionType === 'Sale') {
                const normHead = getNormalizedAccountHead(actualAccountName || paymentAccount, actualPaymentMethod);
                const ownerLedgerRef = doc(collection(db, 'ledger'));
                transaction.set(ownerLedgerRef, {
                  branchId: branchToUse,
                  date: new Date(transactionDate).getTime(),
                  description: `Inv #${invoiceNoRef} - Split (${normHead}) to Owner Account - Customer: ${actualCustomerName || 'Walk-in'}${descSuffix}`,
                  category: 'Owner Transfer',
                  type: 'OUT',
                  amount: onlineReceived,
                  reference: `Inv #${invoiceNoRef} - ${normHead}`,
                  createdAt: Timestamp.now(),
                  tenantId: user?.tenantId || user?.uid, 
                  saleId: finalSaleId
                });

                const ownerTxRef = doc(collection(db, 'ownerTransactions'));
                transaction.set(ownerTxRef, {
                  branchId: branchToUse,
                  date: new Date(transactionDate).getTime(),
                  type: 'OUT',
                  amount: onlineReceived,
                  ownerName: 'Manzoor Ahmed (Owner)',
                  handledBy: salesmanId ? salesmen.find(s => s.id === salesmanId)?.name || 'Cashier' : 'Cashier',
                  category: 'Online Received',
                  accountHead: normHead,
                  paymentMode: normHead,
                  description: `Split Sale #${invoiceNoRef} (${normHead} into Owner Account) - Customer: ${actualCustomerName || 'Walk-in'}${descSuffix}`,
                  voucherNo: invoiceNoRef,
                  saleInvoiceId: finalSaleId,
                  saleInvoiceNo: invoiceNoRef,
                  tenantId: user?.tenantId || user?.uid,
                  createdAt: Timestamp.now()
                });
              }
            }
          } else {
             const paymentLedgerRef = doc(collection(db, 'ledger'));
             const partyRef = vendorObj ? vendorObj.name : (saleType === 'Online' ? (actualAccountName || advancePaymentMethod) : (actualAccountName || paymentMethod));
             transaction.set(paymentLedgerRef, {
               branchId: branchToUse,
               customerId: selectedCustomerId || null,
               vendorId: actualVendorId || null,
               date: new Date(transactionDate).getTime(),
               description:  transactionType === 'Return' 
                  ? `Sale Refund: ${actualCustomerName || ''}${descSuffix}` 
                  : saleType === 'Online' 
                    ? `Advance Payment: ${actualCustomerName || 'Walk-in'}${advanceDescription ? ` (${advanceDescription})` : ''}${descSuffix}` 
                    : `Sale Payment: ${actualCustomerName || 'Walk-in'}${descSuffix}`,
               category:  transactionType === 'Return' ? 'Sale Return' : (saleType === 'Online' && Number(advanceAmount) > 0 ? 'Advance Payment' : 'Sale Payment'),
               saleType: saleType || 'In-Store',
               type: transactionType === 'Return' ? 'OUT' : 'IN',
               amount:  transactionType === 'Return' ? Math.abs(totalValue) : initialPaymentAmount,
               reference:  (saleType === 'Online' && Number(advanceAmount) > 0) 
                 ? `Inv #${invoiceNoRef} - Advance: ${partyRef}` 
                 : `Inv #${invoiceNoRef} - ${partyRef}`,
               createdAt: Timestamp.now(),
               tenantId: user?.tenantId || user?.uid, 
               saleId: finalSaleId
             });

             const isOwnerPayment = (actualPaymentMethod === 'Owner Account' || isOwnerLinkedAccount(actualAccountName || paymentAccount, actualVendorId)) && !actualVendorId;

             if (isOwnerPayment && transactionType === 'Sale') {
               const normHead = getNormalizedAccountHead(actualAccountName || paymentAccount, actualPaymentMethod);
               const isCashPayment = actualPaymentMethod === 'Cash' || normHead === 'Cash by Hand';
               const ownerLedgerRef = doc(collection(db, 'ledger'));
               transaction.set(ownerLedgerRef, {
                 branchId: branchToUse,
                 date: new Date(transactionDate).getTime(),
                 description: `Inv #${invoiceNoRef} - ${normHead} to Owner Account - Customer: ${actualCustomerName || 'Walk-in'}${descSuffix}`,
                 category: 'Owner Transfer',
                 type: 'OUT',
                 amount: initialPaymentAmount,
                 reference: `Inv #${invoiceNoRef} - ${normHead}`,
                 createdAt: Timestamp.now(),
                 tenantId: user?.tenantId || user?.uid, 
                 saleId: finalSaleId
               });

               const ownerTxRef = doc(collection(db, 'ownerTransactions'));
               transaction.set(ownerTxRef, {
                 branchId: branchToUse,
                 date: new Date(transactionDate).getTime(),
                 type: 'OUT',
                 amount: initialPaymentAmount,
                 ownerName: 'Manzoor Ahmed (Owner)',
                 handledBy: salesmanId ? salesmen.find(s => s.id === salesmanId)?.name || 'Cashier' : 'Cashier',
                 category: isCashPayment ? 'Sale Payment' : 'Online Received',
                 accountHead: normHead,
                 paymentMode: normHead,
                 description: `Sale #${invoiceNoRef} (${normHead} directly into Owner Account) - Customer: ${actualCustomerName || 'Walk-in'}${descSuffix}`,
                 voucherNo: invoiceNoRef,
                 saleInvoiceId: finalSaleId,
                 saleInvoiceNo: invoiceNoRef,
                 tenantId: user?.tenantId || user?.uid,
                 createdAt: Timestamp.now()
               });
             }
          }
        }

        if (saleType === 'Online' && transactionType === 'Sale' && (resolvedCourierVendorId || codCashReceived)) {
          const remainingCOD = Math.max(0, totalValue - onlineAdvanceAmt);
          if (remainingCOD > 0) {
            const codLedgerRef = doc(collection(db, 'ledger'));
            transaction.set(codLedgerRef, {
              branchId: branchToUse,
              vendorId: resolvedCourierVendorId || null,
              customerId: selectedCustomerId || null,
              date: new Date(transactionDate).getTime(),
              description: codCashReceived
                ? `COD Cash Received from Courier (${resolvedCourier || 'PostEx'}) for Inv #${invoiceNoRef}${descSuffix}`
                : `COD Pending from Courier (${resolvedCourier || 'PostEx'}) for Inv #${invoiceNoRef}${descSuffix}`,
              category: 'Courier COD',
              type: 'IN',
              amount: remainingCOD,
              reference: `Inv #${invoiceNoRef} - Customer: ${actualCustomerName || 'Walk-in'}${codCashReceived ? ' (Cash Received)' : ''}`,
              createdAt: Timestamp.now(),
              tenantId: user?.tenantId || user?.uid,
              saleId: finalSaleId,
              saleType: 'Online',
              cashReceived: !!codCashReceived
            });
          }
        }
      });

      // Record in 24h Activity Logs
      recordActivityLog({
        action: editSaleId ? 'Update Sale Invoice' : (transactionType === 'Return' ? 'Sale Return' : (saleType === 'Online' ? 'Online Sale Created' : 'Sale Invoice Created')),
        category: 'Sales',
        details: `${transactionType === 'Return' ? 'Processed Return' : (editSaleId ? 'Updated' : 'Created')} Invoice #${recordedInvoiceNo || 'INV'} for customer "${actualCustomerName || 'Walk-in'}" (Total: PKR ${totalValue.toLocaleString()})`,
        metadata: {
          invoiceNo: recordedInvoiceNo,
          total: totalValue,
          saleType: saleType || 'In-Store',
          customerName: actualCustomerName || 'Walk-in',
          itemsCount: selectedItems.length,
          branchId: branchToUse
        },
        branchId: branchToUse,
        user
      }).catch(() => {});

      toast.success(editSaleId ? "Invoice updated successfully!" : "Invoice created successfully!");
      setShowAdd(false);

      if (autoPrintOnSave) {
        const newlySavedSale: Sale = {
          ...saleData,
          id: savedSaleId || editSaleId || 'INV',
          invoiceNo: recordedInvoiceNo,
          createdAt: Timestamp.now() as any,
          customerName: actualCustomerName || 'Walk-in',
          customerPhone: customerPhone || undefined,
          customerCity: customerCity || undefined,
          salesmanName: salesmanId ? salesmen.find(s => s.id === salesmanId)?.name : null,
          branchId: branchToUse,
          items: effectiveItems,
          returnItems: hasReturn ? returnItems : [],
          date: new Date(transactionDate).getTime(),
        } as Sale;
        setPrintSale(newlySavedSale);
      }

      setEditSaleId(null);
      setSelectedCustomerId('');
      setCustomerName('');
      setSaleDescription('');
      setManualInvoiceNo('');
      setPaymentMethod('Cash');
      setPaymentAccount('Meezan Bank');
      setDirectVendorPaymentId('');
      setSaleType(isOnlineOnlyUser ? 'Online' : 'In-Store');
      setAdvanceAmount('');
      setAdvancePaymentMethod('Cash');
      setAdvancePaymentAccount('Meezan Bank');
      setAdvanceDescription('');
      setAdvanceDirectVendorPaymentId('');
      setTransactionType('Sale');
      setTransactionDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
      setShippingCost(0);
      setDiscountAmount(0);
      setLumpSumReturnAmount('');
      setReceivedAmount('');
      setCourier('');
      setCourierVendorId('');
      setCodCashReceived(false);
      setTrackingNumber('');
      setShippingAddress('');
      setCustomerPhone('');
      setCustomerCity('');
      setSelectedItems([]);
      setHasReturn(false);
      setReturnItems([]);
      setReturnItemSearchQuery('');
      setSelectedReturnItemIdForAdd('');
      setReturnItemQtyForAdd(1);
      setReturnItemPriceForAdd('');
    } catch (e: any) {
      toast.error(e.message || 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (sale: Sale, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditSaleId(sale.id);
    const d = sale.date ? new Date(sale.date) : (sale.createdAt?.seconds ? new Date(sale.createdAt.seconds * 1000) : new Date());
    setTransactionDate(format(d, "yyyy-MM-dd'T'HH:mm"));
    setTargetBranchId(sale.branchId);
    setSelectedCustomerId(sale.customerId || '');
    setCustomerName(sale.customerName || '');
    setSaleDescription(sale.description || sale.notes || '');
    setManualInvoiceNo(sale.invoiceNo || '');
    setPaymentMethod(sale.paymentMethod || 'Cash');
    setSplitCashAmount(sale.splitCashAmount || '');
    setSplitOnlineAmount(sale.splitOnlineAmount || '');
    setPaymentAccount(sale.paymentAccount || '');
    setDirectVendorPaymentId(sale.directVendorPaymentId || '');
    setSaleType(isOnlineOnlyUser ? 'Online' : (sale.saleType || 'In-Store'));
    setAdvanceAmount(sale.advanceAmount !== undefined && sale.advanceAmount !== null ? sale.advanceAmount : (sale.saleType === 'Online' && sale.received !== undefined ? sale.received : ''));
    setAdvancePaymentMethod(sale.advancePaymentMethod || (sale.paymentMethod as any) || 'Cash');
    setAdvancePaymentAccount(sale.advancePaymentAccount || sale.paymentAccount || '');
    setAdvanceDescription(sale.advanceDescription || '');
    setAdvanceDirectVendorPaymentId(sale.advanceDirectVendorPaymentId || sale.directVendorPaymentId || '');
    setOnlineEmployeeId(sale.onlineEmployeeId || '');
    setTransactionType(sale.transactionType || 'Sale');
    setShippingCost(sale.shippingCost !== undefined && sale.shippingCost !== null ? sale.shippingCost : 0);
    setDiscountAmount(sale.discount !== undefined && sale.discount !== null ? sale.discount : 0);
    setLumpSumReturnAmount(sale.lumpSumReturnAmount !== undefined && sale.lumpSumReturnAmount !== null ? (sale.lumpSumReturnAmount === 0 ? '' : sale.lumpSumReturnAmount) : '');
    setReceivedAmount(sale.received !== undefined ? sale.received : sale.total);
    setCourier(sale.courier || '');
    setCourierVendorId(sale.courierVendorId || '');
    setCodCashReceived(!!sale.codCashReceived || (sale.saleType === 'Online' && Number(sale.total || 0) > 0 && Number(sale.received || 0) >= Number(sale.total || 0)));
    setTrackingNumber(sale.trackingNumber || '');
    setShippingAddress(sale.shippingAddress || '');
    setCustomerPhone(sale.customerPhone || '');
    setCustomerCity(sale.customerCity || '');
    
    if (sale.returnItems && sale.returnItems.length > 0) {
      setHasReturn(true);
      setReturnItems([...sale.returnItems]);
    } else {
      setHasReturn(false);
      setReturnItems([]);
    }
    
    setSelectedItems([...(sale.items || [])]);
    
    setShowAdd(true);
    setTab('invoices');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteSale = async (sale: Sale, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!enableDeletion) return;
    if (confirm("Are you sure you want to delete this invoice? This will NOT revert stock automatically.")) {
      try {
        const shortId = String(sale.invoiceNo || sale.id.substring(0,6)).toUpperCase();
        
        const docsToDelete = new Map<string, any>();
        const exactMatchRegex = new RegExp(`Inv #${shortId}\\b`); 

        const qId = query(collection(db, 'ledger'), where('saleId', '==', sale.id));
        const snapId = await safeGetDocs(qId);
        snapId.docs.forEach(d => docsToDelete.set(d.id, d));

        const qRef = query(collection(db, 'ledger'), 
            where('reference', '>=', `Inv #${shortId}`), 
            where('reference', '<=', `Inv #${shortId}\uf8ff`));
        const snapRef = await safeGetDocs(qRef);
        snapRef.docs.forEach(d => {
            const data = d.data();
            if (exactMatchRegex.test(data.reference || '') || exactMatchRegex.test(data.description || '')) {
                docsToDelete.set(d.id, d);
            }
        });

        const qOwner = query(collection(db, 'ledger'), where('category', '==', 'Owner Transfer'), where('branchId', '==', sale.branchId));
        const snapOwner = await safeGetDocs(qOwner);
        snapOwner.docs.forEach(d => {
            if (exactMatchRegex.test(d.data().description || '')) docsToDelete.set(d.id, d);
        });

        const qAdvance = query(collection(db, 'ledger'), where('category', '==', 'Advance Payment'), where('branchId', '==', sale.branchId));
        const snapAdvance = await safeGetDocs(qAdvance);
        snapAdvance.docs.forEach(d => {
            if (exactMatchRegex.test(d.data().reference || '') || exactMatchRegex.test(d.data().description || '')) docsToDelete.set(d.id, d);
        });

        const qVendor = query(collection(db, 'ledger'), where('category', '==', 'Vendor Payment'), where('branchId', '==', sale.branchId));
        const snapVendor = await safeGetDocs(qVendor);
        snapVendor.docs.forEach(d => {
            if (exactMatchRegex.test(d.data().description || '')) docsToDelete.set(d.id, d);
        });

        // Also clean up any owner transaction entry for this sale
        const qOwnerTx = query(collection(db, 'ownerTransactions'), where('saleInvoiceId', '==', sale.id));
        const snapOwnerTx = await safeGetDocs(qOwnerTx);
        
        const batch = writeBatch(db);
        batch.delete(doc(db, 'sales', sale.id));
        docsToDelete.forEach((_, id) => batch.delete(doc(db, 'ledger', id)));
        snapOwnerTx.docs.forEach(d => batch.delete(doc(db, 'ownerTransactions', d.id)));
        await batch.commit();

        recordActivityLog({
          action: 'Delete Sale Invoice',
          category: 'Sales',
          details: `Deleted Invoice #${sale.invoiceNo || sale.id.substring(0, 6)} for "${sale.customerName || 'Walk-in'}" (PKR ${sale.total?.toLocaleString()})`,
          metadata: {
            saleId: sale.id,
            invoiceNo: sale.invoiceNo,
            total: sale.total,
            customerName: sale.customerName,
            branchId: sale.branchId
          },
          branchId: sale.branchId,
          user
        }).catch(() => {});

        toast.success("Invoice deleted successfully!");
      } catch (err: any) {
        toast.error("Failed to delete invoice: " + err.message);
      }
    }
  };

  // --- COMPUTE REPORTS ---
  const reportData = () => {
    const startStr = safeFormat(startDate || new Date(), 'yyyy-MM-dd');
    const endStr = safeFormat(endDate || new Date(), 'yyyy-MM-dd');
    const [sy, sm, sd] = startStr.split('-');
    const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
    start.setHours(0, 0, 0, 0);
    const [ey, em, ed] = endStr.split('-');
    const end = new Date(Number(ey), Number(em) - 1, Number(ed));
    end.setHours(23, 59, 59, 999);

    const filtered = sales.filter(s => {
      if (isOnlineOnlyUser && s.saleType !== 'Online') return false;
      return new Date(s.date || 0).getTime() >= start.getTime() && new Date(s.date || 0).getTime() <= end.getTime();
    });

    const totalRevenue = filtered.reduce((acc, s) => acc + (s.transactionType === 'Return' ? -Math.abs(s.total) : s.total), 0);

    const trendMap = new Map<string, { display: string, total: number }>();
    const itemsMap = new Map<string, number>();
    const branchMap = new Map<string, number>();

    filtered.forEach(sale => {
      const d = safeFormat(new Date(sale.date || 0), 'yyyy-MM-dd');
      if (!d) return;
      let sortKey = '', display = '';
      if (aggregation === 'daily') {
        sortKey = safeFormat(d, 'yyyy-MM-dd'); display = safeFormat(d, 'MMM dd');
      } else if (aggregation === 'weekly') {
        const sw = startOfWeek(new Date(d));
        sortKey = safeFormat(sw, 'yyyy-MM-dd'); display = `Wk ${safeFormat(sw, 'MMM dd')}`;
      } else if (aggregation === 'monthly') {
        sortKey = safeFormat(d, 'yyyy-MM'); display = safeFormat(d, 'MMM yyyy');
      } else {
        sortKey = safeFormat(d, 'yyyy'); display = safeFormat(d, 'yyyy');
      }

      const rev = sale.transactionType === 'Return' ? -Math.abs(sale.total || 0) : sale.total || 0;
      const existing = trendMap.get(sortKey) || { display, total: 0 };
      trendMap.set(sortKey, { display, total: existing.total + rev });

      (sale.items || []).forEach(item => {
        itemsMap.set(item.name, (itemsMap.get(item.name) || 0) + (item.qty * item.price * (sale.transactionType === 'Return' ? -1 : 1)));
      });

      if (!activeBranchId) {
        const bName = branches.find(b => b.id === sale.branchId)?.name || 'Unknown';
        branchMap.set(bName, (branchMap.get(bName) || 0) + rev);
      }
    });

    const trendChart = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([_, val]) => ({ period: val.display, sales: val.total }));

    const topItems = Array.from(itemsMap.entries())
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a,b) => b.revenue - a.revenue).slice(0, 5);

    const branchChart = activeBranchId ? [] : Array.from(branchMap.entries())
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a,b) => b.revenue - a.revenue);

    return { filteredCount: filtered.length, totalRevenue, trendChart, topItems, branchChart };
  };

  const reports = reportData();

  const todayStart = startOfDay(new Date());
  const visibleSales = isOnlineOnlyUser ? sales.filter(s => s.saleType === 'Online') : sales;
  const dailySales = visibleSales.filter(s => {
    return new Date(s.date || 0) >= todayStart;
  });
  const todaySaleCount = dailySales.length;
  const todaySaleAmount = dailySales.reduce((acc, s) => acc + (s.transactionType === 'Return' ? -Math.abs(s.total) : s.total), 0);
  const totalReturnCount = visibleSales.filter(s => s.transactionType === 'Return' || (s.returnedValue && s.returnedValue > 0) || (s.returnItems && s.returnItems.length > 0)).length;

  return (
    <>
      <div className="space-y-6 print:hidden">
        <div className="flex justify-between items-center flex-wrap gap-4 card p-4">
          <div className="flex items-center space-x-6">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
               Sales 
               <span className="ml-2 text-sm font-normal text-slate-400 bg-slate-100 dark:bg-slate-950 px-2 py-0.5 rounded-full mt-0.5">
                 {tab === 'invoices' ? 'Ledger' : 'Analytics'}
               </span>
            </h2>
            
            {tab === 'invoices' && (
              <div className="flex space-x-6 border-l border-slate-200 dark:border-slate-700 pl-6 border-dashed hidden md:flex">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-0.5">Today's Sales Count</div>
                  <div className="text-xl font-mono text-slate-800 dark:text-slate-100 leading-none">{todaySaleCount}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-0.5">Today's Revenue</div>
                  <div className="text-xl font-mono text-slate-800 dark:text-slate-100 leading-none"><span className="text-sm font-sans text-slate-400 mr-1">PKR</span>{todaySaleAmount.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-rose-500 font-bold mb-0.5">Total Return Count</div>
                  <div className="text-xl font-mono text-rose-600 dark:text-rose-400 leading-none font-bold">{totalReturnCount}</div>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-md border border-slate-200 dark:border-slate-700">
              <button 
                onClick={() => setTab('invoices')}
                className={`px-3 py-1 flex items-center text-sm font-medium rounded ${tab === 'invoices' ? 'bg-white dark:bg-slate-900 shadow-sm text-sky-700' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <Receipt className="w-4 h-4 mr-2" /> Invoices
              </button>
              <button 
                onClick={() => setTab('reports')}
                className={`px-3 py-1 flex items-center text-sm font-medium rounded ${tab === 'reports' ? 'bg-white dark:bg-slate-900 shadow-sm text-sky-700' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                <BarChart3 className="w-4 h-4 mr-2" /> Reports
              </button>
            </div>

            {tab === 'invoices' && (
              <button 
                onClick={() => { 
                  setEditSaleId(null); 
                  setSelectedCustomerId('');
                  setCustomerName('');
                  setManualInvoiceNo('');
                  setPaymentMethod('Cash');
                  setPaymentAccount('');
                  setSaleType(isOnlineOnlyUser ? 'Online' : 'In-Store');
                  setTransactionType('Sale');
                  setTransactionDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                  setShippingCost(0);
                  setDiscountAmount(0);
                  setLumpSumReturnAmount('');
                  setReceivedAmount('');
                  setCourier('');
                  setCourierVendorId('');
                  setCodCashReceived(false);
                  setTrackingNumber('');
                  setShippingAddress('');
                  setCustomerPhone('');
      setCustomerCity('');
                  setSelectedItems([]);
                  setHasReturn(false);
                  setReturnItems([]);
                  setReturnItemSearchQuery('');
                  setSelectedReturnItemIdForAdd('');
                  setReturnItemQtyForAdd(1);
                  setReturnItemPriceForAdd('');
                  setShowAdd(!showAdd); 
                }} 
                className="flex items-center px-4 py-2 bg-[#1e293b] text-sky-400 rounded-md hover:bg-slate-800 transition shadow-sm"
              >
                <Plus className="w-5 h-5 mr-2" /> New Sale
              </button>
            )}
          </div>
        </div>

        {tab === 'invoices' && showAdd && (
          <div 
            id="sale-bill-form"
            className="card p-6 border-2 border-slate-200 dark:border-slate-700 shadow-md"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleCheckout();
                return;
              }
              if (e.key === 'Tab') {
                const activeEl = document.activeElement as HTMLElement | null;
                // Allow dedicated onKeyDown handlers to handle Tab navigation smoothly
                if (
                  activeEl?.id === 'item-search-input' ||
                  activeEl?.id === 'return-item-search-input' ||
                  activeEl?.id === 'customer-search-input' ||
                  activeEl?.getAttribute('data-item-field') === 'qty' ||
                  activeEl?.getAttribute('data-item-field') === 'price' ||
                  activeEl?.getAttribute('data-return-item-field') === 'qty' ||
                  activeEl?.getAttribute('data-return-item-field') === 'price'
                ) {
                  return;
                }

                // Close any open dropdowns so Tab moves cleanly to the next input box
                if (showCustomerDropdown) setShowCustomerDropdown(false);
                if (showItemDropdown) setShowItemDropdown(false);
                if (showReturnItemDropdown) setShowReturnItemDropdown(false);

                const formEl = e.currentTarget as HTMLElement;
                const focusableBoxes = (
                  Array.from(
                    formEl.querySelectorAll(
                      'input:not([type="hidden"]):not([type="checkbox"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]), button[data-bill-submit="true"]'
                    )
                  ) as HTMLElement[]
                ).filter((el: HTMLElement) => el.offsetParent !== null && el.tabIndex !== -1);

                if (focusableBoxes.length > 0 && activeEl) {
                  const currentIndex = focusableBoxes.indexOf(activeEl);
                  if (currentIndex !== -1) {
                    e.preventDefault();
                    const nextIndex = e.shiftKey
                      ? (currentIndex - 1 + focusableBoxes.length) % focusableBoxes.length
                      : (currentIndex + 1) % focusableBoxes.length;
                    const nextEl = focusableBoxes[nextIndex];
                    if (nextEl) {
                      nextEl.focus();
                      if (nextEl instanceof HTMLInputElement && (nextEl.type === 'text' || nextEl.type === 'number')) {
                        try {
                          nextEl.select();
                        } catch {}
                      }
                    }
                  }
                }
              }
            }}
          >
            <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-slate-800/50 pb-2">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">{editSaleId ? 'Edit Transaction' : 'Record Transaction'}</h3>
              <button onClick={() => { setShowAdd(false); setEditSaleId(null); }} className="p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 rounded">
                 <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-slate-100 dark:border-slate-800/50 pb-4 mb-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Transaction Type</label>
                  <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded border border-slate-200 dark:border-slate-700">
                    <button 
                      type="button"
                      onClick={() => setTransactionType('Sale')}
                      className={`flex-1 text-xs py-1.5 rounded transition ${transactionType === 'Sale' ? 'bg-sky-500 shadow text-white font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                      Sale (Payment In)
                    </button>
                    <button 
                      type="button"
                      onClick={() => setTransactionType('Return')}
                      className={`flex-1 text-xs py-1.5 rounded transition ${transactionType === 'Return' ? 'bg-rose-500 shadow text-white font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                      Return / Refund (Pay Cash)
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Date & Time</label>
                  <input
                    type="datetime-local"
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-200">
                      <Lock className="w-3.5 h-3.5 text-amber-500 inline" />
                      Invoice # (Fixed Series)
                    </span>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                      {editSaleId ? 'Existing' : 'Auto Sequence'}
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      disabled
                      placeholder="Auto Series"
                      value={editSaleId ? manualInvoiceNo : (predictedInvoiceNo || 'Loading sequence...')}
                      className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-mono font-bold text-sm tracking-wider cursor-not-allowed select-none shadow-inner"
                    />
                    <div className="absolute right-3 top-2.5 text-xs text-slate-400 flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[10px] uppercase font-bold text-slate-400">Locked</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    {editSaleId ? 'Original bill number locked.' : 'Bill numbers strictly follow consecutive series without skipping.'}
                  </p>
                </div>
              </div>

              {!activeBranchId && !editSaleId && (
                <div className="md:col-span-2">
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Branch</label>
                  <select required value={targetBranchId} onChange={e => setTargetBranchId(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm font-medium">
                    <option value="" disabled>Select Branch</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              
              <div className="md:col-span-2 grid grid-cols-2 gap-4 border-b border-slate-100 dark:border-slate-800/50 pb-4 mb-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Sale Type</label>
                  <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded border border-slate-200 dark:border-slate-700">
                    {!isOnlineOnlyUser && (
                      <button 
                        type="button"
                        onClick={() => setSaleType('In-Store')}
                        className={`flex-1 text-xs py-1.5 rounded transition ${saleType === 'In-Store' ? 'bg-white dark:bg-slate-800 shadow text-slate-800 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                      >
                        In-Store
                      </button>
                    )}
                    <button 
                      type="button"
                      onClick={() => setSaleType('Online')}
                      className={`flex-1 text-xs py-1.5 rounded transition ${saleType === 'Online' ? 'bg-sky-50 dark:bg-sky-900/50 shadow text-sky-700 dark:text-sky-300 font-medium border border-sky-100 dark:border-sky-800' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                      Online Delivery
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Phone Number</label>
                  <input 
                    type="text" 
                    placeholder="Customer Phone" 
                    value={customerPhone} 
                    onChange={e => setCustomerPhone(e.target.value)} 
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" 
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">City</label>
                  <input 
                    type="text" 
                    placeholder="Customer City" 
                    value={customerCity} 
                    onChange={e => setCustomerCity(e.target.value)} 
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" 
                  />
                </div>
              </div>

              {saleType === 'Online' && (
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-4 gap-4 border-b border-slate-100 dark:border-slate-800/50 pb-4 mb-2">
                  <div className="md:col-span-4">
                    <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Shipping Address</label>
                    <input 
                      type="text" 
                      placeholder="Full Delivery Address" 
                      value={shippingAddress} 
                      onChange={e => setShippingAddress(e.target.value)} 
                      className="w-full rounded-md border border-sky-200 dark:border-sky-800 px-3 py-2 bg-sky-50/30 dark:bg-slate-800/80 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 text-sm" 
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Shipping Cost (PKR)</label>
                    <input 
                      type="number" 
                      value={shippingCost} 
                      onChange={e => setShippingCost(e.target.value === '' ? '' : Number(e.target.value))} 
                      className="w-full rounded-md border border-sky-200 dark:border-sky-800 px-3 py-2 bg-sky-50/30 dark:bg-slate-800/80 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 text-sm" 
                    />
                  </div>
                                    <div>
                    <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Online Sales Employee *</label>
                    <select 
                      value={onlineEmployeeId} 
                      onChange={e => setOnlineEmployeeId(e.target.value)} 
                      className="w-full rounded-md border border-sky-300 dark:border-sky-700 px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 font-medium"
                      required={saleType === 'Online'}
                    >
                      <option value="">-- Select Employee --</option>
                      {onlineSalesEmployees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.onlineCode} - {emp.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                      <label className="block text-[10px] uppercase tracking-widest text-indigo-500 dark:text-indigo-400 font-bold">Courier / COD Ledger Account *</label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-400 dark:border-emerald-700 px-2.5 py-0.5 rounded-full text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition shadow-2xs">
                        <input
                          type="checkbox"
                          checked={codCashReceived}
                          onChange={e => setCodCashReceived(e.target.checked)}
                          className="w-4 h-4 rounded text-emerald-600 border-emerald-400 focus:ring-emerald-500 cursor-pointer"
                        />
                        <span>Cash Received (کیش وصول - ادھار نہ دکھائیں)</span>
                      </label>
                    </div>
                    <select 
                      value={courierVendorId} 
                      onChange={e => {
                        const selectedId = e.target.value;
                        setCourierVendorId(selectedId);
                        if (selectedId) {
                          const v = vendors.find(x => x.id === selectedId);
                          if (v) setCourier(v.name);
                        } else {
                          setCourier('');
                        }
                      }} 
                      required={saleType === 'Online'}
                      className="w-full rounded-md border border-indigo-300 dark:border-indigo-700 px-3 py-2 bg-indigo-50 dark:bg-slate-800 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 text-sm shadow-sm font-medium focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">-- Select Courier from Ledger --</option>
                      {vendors.map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Tracking Number</label>
                    <input 
                      type="text" 
                      placeholder="Tracking ID" 
                      value={trackingNumber} 
                      onChange={e => setTrackingNumber(e.target.value)} 
                      className="w-full rounded-md border border-sky-200 dark:border-sky-800 px-3 py-2 bg-sky-50/30 dark:bg-slate-800/80 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 text-sm" 
                    />
                  </div>
                </div>
              )}

              {saleType === 'Online' && (
                <div className="md:col-span-2 border border-sky-300 bg-sky-50/40 dark:bg-sky-950/20 rounded-md p-4 mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400 mb-3 flex items-center justify-between">
                    <span className="flex items-center">
                      <span className="w-2 h-2 rounded-full bg-sky-500 mr-2 animate-pulse"></span>
                      Advance Payment & Ledger Details (پیشگی ادائیگی اور کھاتہ)
                    </span>
                    <span className="text-[10px] text-sky-600 font-normal">Recorded in selected Ledger Account</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-1 font-bold">Advance Amount (PKR)</label>
                      <input 
                        type="number" 
                        placeholder="0"
                        value={advanceAmount} 
                        onChange={e => setAdvanceAmount(e.target.value === '' ? '' : Number(e.target.value))} 
                        className="w-full rounded-md border border-sky-300 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-bold text-sky-700 dark:text-sky-300 focus:border-sky-500 focus:ring-1 focus:ring-sky-500" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-1 font-bold">Deposit Into Ledger / Bank Account (کھاتہ / لیجر)</label>
                      <select 
                        value={advanceDirectVendorPaymentId} 
                        onChange={e => {
                          const val = e.target.value;
                          setAdvanceDirectVendorPaymentId(val);
                          if (val) {
                            setAdvancePaymentMethod('Online');
                            const vName = vendors.find(v => v.id === val)?.name;
                            if (vName) {
                              setAdvancePaymentAccount(vName);
                            }
                          }
                        }} 
                        className="w-full rounded-md border border-sky-300 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-medium focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      >
                        <option value="">-- Shop Cash In-Hand (دکان کیش) --</option>
                        <option value="owner">👑 Owner Account (مالک کا اکاؤنٹ)</option>
                        {vendors.map(v => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">Advance Payment Method</label>
                      <select 
                        value={advancePaymentMethod} 
                        onChange={e => {
                          const val = e.target.value as 'Cash' | 'Online' | 'Owner Account';
                          setAdvancePaymentMethod(val);
                          if (val === 'Owner Account') {
                            setAdvancePaymentAccount('Owner Account');
                          } else if (val === 'Online' && (!advancePaymentAccount || advancePaymentAccount === 'Cash')) {
                            setAdvancePaymentAccount('Meezan Bank');
                          }
                        }} 
                        className="w-full rounded-md border border-sky-300 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-semibold focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      >
                        <option value="Cash">Cash / In-Hand (نقد کیش)</option>
                        <option value="Online">Online / Bank Transfer (آن لائن)</option>
                        <option value="Owner Account">👑 Owner Account (مالک کا اکاؤنٹ)</option>
                      </select>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[10px] uppercase tracking-widest text-sky-800 dark:text-sky-300 font-bold">
                          Advance Account Head (وصولی کھاتہ ہیڈ) *
                        </label>
                        {isOwnerLinkedAccount(advancePaymentAccount, advanceDirectVendorPaymentId) && (
                          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-700">
                            👑 Owner Linked
                          </span>
                        )}
                      </div>
                      <select 
                        value={
                          advanceDirectVendorPaymentId 
                            ? `vendor:${advanceDirectVendorPaymentId}` 
                            : ((advancePaymentAccount || '').toLowerCase().includes('meezan')
                                ? 'Meezan Bank'
                                : ((advancePaymentAccount || '').toLowerCase().includes('jazzcash')
                                    ? 'JazzCash'
                                    : ((advancePaymentAccount || '').toLowerCase().includes('easypaisa')
                                        ? 'EasyPaisa'
                                        : ((advancePaymentAccount || '').toLowerCase().includes('ubl')
                                            ? 'UBL Bank'
                                            : ((advancePaymentAccount || '').toLowerCase().includes('owner') || advancePaymentMethod === 'Owner Account'
                                                ? 'Owner Account'
                                                : (advancePaymentAccount ? 'custom' : 'Meezan Bank'))))))
                        } 
                        onChange={e => {
                          const val = e.target.value;
                          if (val === 'custom') {
                            setAdvancePaymentAccount('');
                            setAdvanceDirectVendorPaymentId('');
                          } else if (val.startsWith('vendor:')) {
                            const vId = val.replace('vendor:', '');
                            setAdvanceDirectVendorPaymentId(vId);
                            const vName = vendors.find(v => v.id === vId)?.name;
                            if (vName) setAdvancePaymentAccount(`Vendor: ${vName}`);
                          } else {
                            setAdvancePaymentAccount(val);
                            setAdvanceDirectVendorPaymentId('');
                          }
                        }} 
                        className="w-full rounded-md border border-sky-300 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-bold text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      >
                        <optgroup label="👑 Owner Attached Accounts (براہ راست مالک کے اکاؤنٹ میں)">
                          <option value="Meezan Bank">🏦 Meezan Bank (Shop Main Account / میزان بینک)</option>
                          <option value="JazzCash">📱 JazzCash (جاز کیش)</option>
                          <option value="EasyPaisa">📱 EasyPaisa (ایزی پیسہ)</option>
                          <option value="UBL Bank">🏛️ UBL Bank (یو بی ایل بینک)</option>
                          <option value="Owner Account">👑 Owner Account (مالک کا اکاؤنٹ)</option>
                        </optgroup>
                        {vendors.length > 0 && (
                          <optgroup label="Directly to Vendor (وینڈر کھاتہ)">
                            {vendors.map(v => (
                              <option key={v.id} value={`vendor:${v.id}`}>🏢 {v.name}</option>
                            ))}
                          </optgroup>
                        )}
                        <option value="custom">✏️ Other / Custom Account...</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Advance Description / Remarks</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Advance deposit received for order confirmation" 
                        value={advanceDescription} 
                        onChange={e => setAdvanceDescription(e.target.value)} 
                        className="w-full rounded-md border border-sky-300 px-3 py-2 bg-white dark:bg-slate-900 text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500" 
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="relative">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Customer / Assign To (کسٹمر)
                  </label>
                  <div className="flex items-center gap-1.5">
                    {selectedCustomerId ? (
                      <button
                        type="button"
                        onClick={() => {
                          const cust = customers.find(c => c.id === selectedCustomerId);
                          if (cust) {
                            setQuickEditCustomerModal({
                              id: cust.id,
                              name: cust.name,
                              phone: cust.phone || (customerPhone ? String(customerPhone) : ''),
                              city: cust.city || (customerCity ? String(customerCity) : '')
                            });
                          }
                        }}
                        className="text-[11px] font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 flex items-center gap-1 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800 transition cursor-pointer"
                        title="Edit Customer Name"
                      >
                        <Edit className="w-3 h-3" /> Edit Name (نام تبدیل کریں)
                      </button>
                    ) : (
                      customerName.trim() && (
                        <button
                          type="button"
                          onClick={handleSaveWalkInAsCustomer}
                          disabled={isQuickCustomerSaving}
                          className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 transition cursor-pointer"
                          title="Save this customer name into directory"
                        >
                          <Plus className="w-3 h-3" /> Save Customer (محفوظ کریں)
                        </button>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setQuickCustomerName(customerSearchQuery || customerName || '');
                        setShowQuickAddCustomerModal(true);
                      }}
                      className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 transition cursor-pointer"
                      title="Add New Customer to Directory"
                    >
                      <Plus className="w-3 h-3" /> + Add Customer (نیا کسٹمر)
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <div 
                      className={`w-full rounded-md border px-3 py-2 flex items-center cursor-pointer transition ${
                        selectedCustomerId 
                          ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30' 
                          : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 focus-within:bg-white'
                      }`}
                      onClick={() => setShowCustomerDropdown(true)}
                    >
                      <User className={`w-4 h-4 mr-2 ${selectedCustomerId ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <input 
                        type="text" 
                        id="customer-search-input"
                        placeholder={selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name || 'Selected Customer') : 'Search customer by name...'} 
                        value={customerSearchQuery}
                        onChange={e => {
                          setCustomerSearchQuery(e.target.value);
                          setShowCustomerDropdown(true);
                          setSelectedCustomerIndex(0);
                          if (selectedCustomerId) { 
                            setSelectedCustomerId(''); 
                            setCustomerName(e.target.value);
                          }
                        }}
                        onKeyDown={e => {
                          const matched = customers.filter(c => 
                            c.name.toLowerCase().includes(customerSearchQuery.toLowerCase()) || 
                            (c.phone || '').includes(customerSearchQuery) ||
                            (c.city || '').toLowerCase().includes(customerSearchQuery.toLowerCase())
                          );

                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setShowCustomerDropdown(true);
                            setSelectedCustomerIndex(prev => Math.min(prev + 1, Math.max(0, matched.length - 1)));
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setSelectedCustomerIndex(prev => Math.max(prev - 1, 0));
                            return;
                          }

                          if ((e.key === 'Enter' || e.key === 'Tab') && customerSearchQuery.trim()) {
                            if (matched.length > 0) {
                              e.preventDefault();
                              const cust = matched[selectedCustomerIndex] || matched[0];
                              setSelectedCustomerId(cust.id);
                              setCustomerName(cust.name);
                              setCustomerPhone(cust.phone || '');
                              setCustomerCity(cust.city || '');
                              setCustomerSearchQuery('');
                              setShowCustomerDropdown(false);
                              // Seamlessly jump to item search input
                              setTimeout(() => {
                                const itemInput = document.getElementById('item-search-input');
                                if (itemInput) {
                                  itemInput.focus();
                                  try { (itemInput as HTMLInputElement).select(); } catch {}
                                }
                              }, 50);
                              return;
                            }
                          }

                          if (e.key === 'Tab') {
                            setShowCustomerDropdown(false);
                          }
                        }}
                        className="bg-transparent border-none p-0 focus:ring-0 text-sm w-full outline-none"
                      />
                      {selectedCustomerId && (
                        <div className="flex items-center gap-1 ml-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const cust = customers.find(c => c.id === selectedCustomerId);
                              if (cust) {
                                setQuickEditCustomerModal({
                                  id: cust.id,
                                  name: cust.name,
                                  phone: cust.phone || (customerPhone ? String(customerPhone) : ''),
                                  city: cust.city || (customerCity ? String(customerCity) : '')
                                });
                              }
                            }}
                            className="text-sky-600 hover:text-sky-800 p-0.5 rounded hover:bg-sky-100"
                            title="Edit this customer name"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            type="button" 
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setSelectedCustomerId(''); 
                              setCustomerPhone(''); 
                              setCustomerCity(''); 
                              setCustomerSearchQuery(''); 
                              setCustomerName('');
                            }} 
                            className="text-slate-400 hover:text-rose-600 p-0.5"
                            title="Clear Selection"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                      <ChevronDown className="w-4 h-4 text-slate-400 ml-1 shrink-0" />
                    </div>

                    {showCustomerDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowCustomerDropdown(false)}></div>
                        <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-xl max-h-56 overflow-y-auto">
                          <div className="p-1 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between">
                            <button 
                              type="button" 
                              onClick={() => { 
                                setSelectedCustomerId(''); 
                                setCustomerSearchQuery(''); 
                                setShowCustomerDropdown(false); 
                              }} 
                              className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 font-semibold p-1.5"
                            >
                              + Walk-in (Unregistered)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setQuickCustomerName(customerSearchQuery || '');
                                setShowCustomerDropdown(false);
                                setShowQuickAddCustomerModal(true);
                              }}
                              className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 p-1.5 flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" /> + New Customer
                            </button>
                          </div>
                          {customerSearchQuery && !customers.some(c => c.name.toLowerCase() === customerSearchQuery.toLowerCase()) && (
                            <button
                              type="button"
                              onClick={() => {
                                setQuickCustomerName(customerSearchQuery);
                                setShowCustomerDropdown(false);
                                setShowQuickAddCustomerModal(true);
                              }}
                              className="w-full text-left px-4 py-2 text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 font-bold border-b border-emerald-100 dark:border-emerald-800/60 flex items-center justify-between cursor-pointer"
                            >
                              <span>+ Add &quot;{customerSearchQuery}&quot; as Customer</span>
                              <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded">Quick Add</span>
                            </button>
                          )}
                          {customers.filter(c => c.name.toLowerCase().includes(customerSearchQuery.toLowerCase()) || (c.phone || '').includes(customerSearchQuery)).map((c, idx) => (
                            <div
                              key={c.id}
                              className={`w-full flex items-center justify-between px-3 py-2 text-sm border-b border-slate-50 dark:border-slate-800/30 group transition ${
                                idx === selectedCustomerIndex
                                  ? 'bg-sky-50 dark:bg-sky-950/60 font-semibold text-sky-800 dark:text-sky-200'
                                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedCustomerId(c.id);
                                  setCustomerName(c.name);
                                  setCustomerPhone(c.phone || '');
                                  setCustomerCity(c.city || '');
                                  setCustomerSearchQuery('');
                                  setShowCustomerDropdown(false);
                                  setTimeout(() => {
                                    const itemInput = document.getElementById('item-search-input');
                                    if (itemInput) {
                                      itemInput.focus();
                                      try { (itemInput as HTMLInputElement).select(); } catch {}
                                    }
                                  }, 50);
                                }}
                                className="flex-1 text-left cursor-pointer flex items-center gap-1.5"
                              >
                                {idx === selectedCustomerIndex && <span className="text-sky-500 text-xs">▶</span>}
                                <span className="font-semibold text-slate-800 dark:text-slate-100">{c.name}</span>
                                {c.phone && <span className="ml-2 text-xs font-mono text-slate-400">{c.phone}</span>}
                                {c.city && <span className="ml-1 text-xs text-slate-400">({c.city})</span>}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setQuickEditCustomerModal({
                                    id: c.id,
                                    name: c.name,
                                    phone: c.phone || '',
                                    city: c.city || ''
                                  });
                                  setShowCustomerDropdown(false);
                                }}
                                className="text-slate-400 hover:text-sky-600 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
                                title="Edit this customer name"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          {customers.filter(c => c.name.toLowerCase().includes(customerSearchQuery.toLowerCase())).length === 0 && (
                            <div className="p-3 text-xs text-slate-400 text-center">
                              No customer found. Click &quot;+ New Customer&quot; to add.
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {!selectedCustomerId ? (
                    <div className="relative flex-1 flex gap-1">
                      <input 
                        type="text" 
                        placeholder="Walk-in Customer Name" 
                        value={customerName} 
                        onChange={e => setCustomerName(e.target.value)} 
                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" 
                      />
                      {customerName.trim() && (
                        <button
                          type="button"
                          onClick={handleSaveWalkInAsCustomer}
                          disabled={isQuickCustomerSaving}
                          className="px-2 py-1 bg-emerald-600 text-white rounded text-[11px] font-bold hover:bg-emerald-700 shrink-0 flex items-center gap-1 transition cursor-pointer"
                          title="Save this name as registered customer"
                        >
                          <Plus className="w-3 h-3" /> Save
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-between px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs">
                      <div>
                        <span className="font-bold text-emerald-800 dark:text-emerald-300">
                          {customers.find(c => c.id === selectedCustomerId)?.name || customerName}
                        </span>
                        {customerPhone && <span className="ml-2 font-mono text-emerald-700 dark:text-emerald-400">{customerPhone}</span>}
                        {customerCity && <span className="ml-1 text-slate-500">({customerCity})</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const cust = customers.find(c => c.id === selectedCustomerId);
                          if (cust) {
                            setQuickEditCustomerModal({
                              id: cust.id,
                              name: cust.name,
                              phone: cust.phone || (customerPhone ? String(customerPhone) : ''),
                              city: cust.city || (customerCity ? String(customerCity) : '')
                            });
                          }
                        }}
                        className="text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 font-bold cursor-pointer"
                      >
                        <Edit className="w-3 h-3" /> Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Salesman (Optional)</label>
                <select 
                  value={salesmanId} 
                  onChange={e => setSalesmanId(e.target.value)} 
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm"
                >
                  <option value="">-- Select Salesman --</option>
                  {salesmen.map(s => (
                    <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
                  ))}
                </select>
              </div>

              {saleType !== 'Online' ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 font-bold">
                        Payment Method (ادائیگی کا طریقہ)
                      </label>
                      <select 
                        value={paymentMethod} 
                        onChange={(e: any) => {
                          const val = e.target.value;
                          setPaymentMethod(val);
                          if (val === 'Owner Account') {
                            setPaymentAccount('Owner Account');
                            setDirectVendorPaymentId('');
                          }
                        }} 
                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm font-bold"
                      >
                        <option value="Cash">💵 Cash / In-Hand (دکان نقد کیش)</option>
                        <option value="Online">💳 Online / Bank Transfer (آن لائن)</option>
                        <option value="Owner Account">👑 Owner Account (مالک کا اکاؤنٹ - نقد/آن لائن)</option>
                        <option value="Split">⚖️ Split (Cash + Online / Owner Account)</option>
                      </select>
                    </div>

                    {(paymentMethod === 'Online' || paymentMethod === 'Split' || paymentMethod === 'Owner Account') && (
                      <div className="col-span-1 md:col-span-2 bg-sky-50/70 dark:bg-sky-950/30 p-2.5 rounded-lg border border-sky-200 dark:border-sky-800 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[10px] uppercase tracking-widest text-sky-800 dark:text-sky-300 font-bold">
                                Account Head (وصولی کھاتہ ہیڈ) *
                              </label>
                              {isOwnerLinkedAccount(paymentAccount, directVendorPaymentId) && (
                                <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                                  👑 Attached to Owner
                                </span>
                              )}
                            </div>
                            <select 
                              value={
                                directVendorPaymentId 
                                  ? `vendor:${directVendorPaymentId}` 
                                  : ((paymentAccount || '').toLowerCase().includes('meezan')
                                      ? 'Meezan Bank'
                                      : ((paymentAccount || '').toLowerCase().includes('jazzcash')
                                          ? 'JazzCash'
                                          : ((paymentAccount || '').toLowerCase().includes('easypaisa')
                                              ? 'EasyPaisa'
                                              : ((paymentAccount || '').toLowerCase().includes('ubl')
                                                  ? 'UBL Bank'
                                                  : ((paymentAccount || '').toLowerCase().includes('owner') || paymentMethod === 'Owner Account'
                                                      ? 'Owner Account'
                                                      : (paymentAccount ? 'custom' : 'Meezan Bank'))))))
                              } 
                              onChange={e => {
                                const val = e.target.value;
                                if (val === 'custom') {
                                  setPaymentAccount('');
                                  setDirectVendorPaymentId('');
                                } else if (val.startsWith('vendor:')) {
                                  const vId = val.replace('vendor:', '');
                                  setDirectVendorPaymentId(vId);
                                  const vName = vendors.find(v => v.id === vId)?.name;
                                  if (vName) setPaymentAccount(`Vendor: ${vName}`);
                                } else {
                                  setPaymentAccount(val);
                                  setDirectVendorPaymentId('');
                                }
                              }} 
                              className="w-full rounded-md border border-sky-300 dark:border-sky-700 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-bold text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                            >
                              <optgroup label="👑 Owner Attached Accounts (براہ راست مالک کے اکاؤنٹ میں جائے گی)">
                                <option value="Meezan Bank">🏦 Meezan Bank (Shop Main Account / میزان بینک)</option>
                                <option value="JazzCash">📱 JazzCash (جاز کیش - آن لائن اکاؤنٹ)</option>
                                <option value="EasyPaisa">📱 EasyPaisa (ایزی پیسہ - آن لائن اکاؤنٹ)</option>
                                <option value="UBL Bank">🏛️ UBL Bank (یو بی ایل بینک)</option>
                                <option value="Owner Account">👑 Owner Account (مالک کا اکاؤنٹ - Manzoor / Owner)</option>
                              </optgroup>
                              {vendors.length > 0 && (
                                <optgroup label="Directly to Vendor (وینڈر کھاتہ)">
                                  {vendors.map(v => (
                                    <option key={v.id} value={`vendor:${v.id}`}>🏢 {v.name}</option>
                                  ))}
                                </optgroup>
                              )}
                              <option value="custom">✏️ Other / Custom Account...</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
                              Account Details / Trx ID (اختیاری تفصیل)
                            </label>
                            <input 
                              type="text" 
                              placeholder="e.g. Trx #12345, Reference note" 
                              value={paymentAccount} 
                              onChange={e => setPaymentAccount(e.target.value)} 
                              className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 text-sm font-medium" 
                            />
                          </div>
                        </div>

                        {paymentMethod === 'Split' && (
                          <div className="text-[11px] text-sky-700 dark:text-sky-300 bg-sky-100/70 dark:bg-sky-900/40 px-3 py-1.5 rounded flex items-center justify-between font-medium">
                            <span>💡 Split Payment: Cash portion goes to Counter; Online portion (PKR {Number(splitOnlineAmount || 0).toLocaleString()}) goes into {isOwnerLinkedAccount(paymentAccount, directVendorPaymentId) ? `👑 Owner Account (${getNormalizedAccountHead(paymentAccount, paymentMethod)})` : (paymentAccount || 'Selected Account')}.</span>
                          </div>
                        )}
                        {paymentMethod !== 'Split' && isOwnerLinkedAccount(paymentAccount, directVendorPaymentId) && (
                          <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-3 py-1.5 rounded flex items-center justify-between font-medium">
                            <span>👑 یہ رقم براہ راست مالک (Owner Account) کے کھاتے میں جمع ہوگی۔ ({getNormalizedAccountHead(paymentAccount, paymentMethod)})</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Discount (PKR)</label>
                      <input 
                        type="number" 
                        min="0" 
                        id="sale-discount-input"
                        placeholder="0.00"
                        value={discountAmount} 
                        onChange={e => setDiscountAmount(e.target.value === '' ? '' : Number(e.target.value))} 
                        onKeyDown={e => {
                          if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                            const recvInput = document.getElementById('received-amount-input') || document.getElementById('split-cash-input');
                            if (recvInput) {
                              e.preventDefault();
                              recvInput.focus();
                              try { (recvInput as HTMLInputElement).select(); } catch {}
                            }
                          }
                        }}
                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" 
                      />
                    </div>


                  </div>
                </>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Discount (PKR)</label>
                    <input 
                      type="number" 
                      min="0" 
                      id="sale-discount-input-online"
                      placeholder="0.00"
                      value={discountAmount} 
                      onChange={e => setDiscountAmount(e.target.value === '' ? '' : Number(e.target.value))} 
                      onKeyDown={e => {
                        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                          const itemInp = document.getElementById('item-search-input');
                          if (itemInp) {
                            e.preventDefault();
                            itemInp.focus();
                            try { (itemInp as HTMLInputElement).select(); } catch {}
                          }
                        }
                      }}
                      className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" 
                    />
                  </div>

                </div>
              )}
            </div>
            
            {/* 1. SALE ITEMS SECTION */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-4 bg-white dark:bg-slate-900/60">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                    <Package className="w-4 h-4 text-emerald-500" />
                    <span>Items to Sell (فروخت شدہ اشیاء)</span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 mb-3">
                    <div className="md:col-span-4 relative">
                      <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Scan / Search Sale Item</label>
                      <div 
                        className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus-within:bg-white focus-within:ring-1 focus-within:ring-emerald-500 flex items-center cursor-pointer"
                        onClick={() => {
                          setShowItemDropdown(true);
                          const inp = document.getElementById('item-search-input');
                          if (inp) inp.focus();
                        }}
                      >
                        <Package className="w-4 h-4 text-slate-400 mr-2 shrink-0" />
                        <input 
                          type="text" 
                          placeholder="Scan barcode or search product..." 
                          id="item-search-input"
                          autoComplete="off"
                          value={itemSearchQuery}
                          onChange={e => {
                            setItemSearchQuery(e.target.value);
                            setShowItemDropdown(true);
                            setSelectedSearchItemIndex(0);
                            if (selectedItemIdForAdd) setSelectedItemIdForAdd('');
                          }}
                          onKeyDown={e => {
                            const branchInv = inventory.filter(i => i.branchId === (activeBranchId || targetBranchId));
                            const filtered = branchInv.filter(i => 
                              i.name.toLowerCase().includes(itemSearchQuery.toLowerCase()) || 
                              (i.sku || '').toLowerCase().includes(itemSearchQuery.toLowerCase()) ||
                              i.id === itemSearchQuery.trim()
                            );

                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setShowItemDropdown(true);
                              setSelectedSearchItemIndex(prev => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
                              return;
                            }
                            if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setSelectedSearchItemIndex(prev => Math.max(prev - 1, 0));
                              return;
                            }

                            if (e.key === 'Enter') {
                              if (itemSearchQuery.trim()) {
                                e.preventDefault();
                                const exactMatch = filtered.find(
                                  i => i.sku?.toLowerCase() === itemSearchQuery.trim().toLowerCase() || 
                                       i.sku === itemSearchQuery.trim() ||
                                       i.id === itemSearchQuery.trim() ||
                                       i.name.toLowerCase() === itemSearchQuery.trim().toLowerCase()
                                );
                                const itemToPick = exactMatch || filtered[selectedSearchItemIndex] || filtered[0];
                                if (itemToPick) {
                                  handleAddSpecificItem(itemToPick, 1);
                                  setItemSearchQuery('');
                                  setShowItemDropdown(false);
                                  setSelectedSearchItemIndex(0);
                                  setTimeout(() => {
                                    const inp = document.getElementById('item-search-input');
                                    if (inp) {
                                      inp.focus();
                                      try { (inp as HTMLInputElement).select(); } catch {}
                                    }
                                  }, 40);
                                }
                                return;
                              } else {
                                if (selectedItems.length > 0) {
                                  e.preventDefault();
                                  const recvInput = document.getElementById('received-amount-input') || document.getElementById('split-cash-input');
                                  if (recvInput) {
                                    recvInput.focus();
                                    try { (recvInput as HTMLInputElement).select(); } catch {}
                                  } else {
                                    handleCheckout();
                                  }
                                  return;
                                }
                              }
                            }

                            if (e.key === 'Tab') {
                              if (itemSearchQuery.trim()) {
                                e.preventDefault();
                                const exactMatch = filtered.find(
                                  i => i.sku?.toLowerCase() === itemSearchQuery.trim().toLowerCase() || 
                                       i.sku === itemSearchQuery.trim() ||
                                       i.id === itemSearchQuery.trim() ||
                                       i.name.toLowerCase() === itemSearchQuery.trim().toLowerCase()
                                );
                                const itemToPick = exactMatch || filtered[selectedSearchItemIndex] || filtered[0];
                                if (itemToPick) {
                                  handleAddSpecificItem(itemToPick, 1);
                                  setItemSearchQuery('');
                                  setShowItemDropdown(false);
                                  setSelectedSearchItemIndex(0);
                                  // Tab moves focus straight to newly added item's QTY box
                                  setTimeout(() => {
                                    const allQtyInputs = document.querySelectorAll('input[data-item-field="qty"]');
                                    if (allQtyInputs.length > 0) {
                                      const targetQty = allQtyInputs[allQtyInputs.length - 1] as HTMLInputElement;
                                      targetQty.focus();
                                      try { targetQty.select(); } catch {}
                                    }
                                  }, 60);
                                }
                                return;
                              } else {
                                if (!e.shiftKey) {
                                  e.preventDefault();
                                  setShowItemDropdown(false);
                                  const discountInput = document.getElementById('sale-discount-input');
                                  const recvInput = document.getElementById('received-amount-input') || document.getElementById('split-cash-input');
                                  const target = discountInput || recvInput;
                                  if (target) {
                                    target.focus();
                                    try { (target as HTMLInputElement).select(); } catch {}
                                  }
                                  return;
                                }
                              }
                            }
                          }}
                          className="bg-transparent border-none p-0 focus:ring-0 text-sm w-full outline-none"
                        />
                        {selectedItemIdForAdd && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedItemIdForAdd(''); setItemSearchQuery(''); }} className="text-slate-400 hover:text-slate-600 ml-1">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                        <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
                      </div>
                      
                      {showItemDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowItemDropdown(false)}></div>
                          <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                            {inventory.filter(i => i.branchId === (activeBranchId || targetBranchId)).filter(i => i.name.toLowerCase().includes(itemSearchQuery.toLowerCase()) || (i.sku || '').toLowerCase().includes(itemSearchQuery.toLowerCase())).length === 0 ? (
                               <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">No items found</div>
                            ) : (
                              inventory.filter(i => i.branchId === (activeBranchId || targetBranchId)).filter(i => i.name.toLowerCase().includes(itemSearchQuery.toLowerCase()) || (i.sku || '').toLowerCase().includes(itemSearchQuery.toLowerCase())).map((i, idx) => (
                                <button
                                  key={i.id}
                                  type="button"
                                  onClick={() => {
                                    handleAddSpecificItem(i, 1);
                                    setItemSearchQuery('');
                                    setShowItemDropdown(false);
                                    setTimeout(() => {
                                      const inp = document.getElementById('item-search-input');
                                      if (inp) {
                                        inp.focus();
                                        try { (inp as HTMLInputElement).select(); } catch {}
                                      }
                                    }, 40);
                                  }}
                                  className={`w-full flex justify-between items-center px-4 py-3 text-sm border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition text-left cursor-pointer ${
                                    idx === selectedSearchItemIndex
                                      ? 'bg-sky-50 dark:bg-sky-950/70 border-l-4 border-l-sky-500 font-semibold text-sky-800 dark:text-sky-200'
                                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                  }`}
                                >
                                  <div className="text-left">
                                    <div className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                      {idx === selectedSearchItemIndex && <span className="text-sky-500 text-xs">▶</span>}
                                      <span>{i.name}</span>
                                    </div>
                                    {i.sku && <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">{i.sku}</div>}
                                  </div>
                                  <div className="text-right">
                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Cost: PKR {(i.cost || 0).toLocaleString()}</div>
                                    <div className="font-bold text-sky-600">Sale: PKR {i.price.toLocaleString()}</div>
                                    <div className={`text-[10px] ${i.stock > 0 ? 'text-emerald-500' : 'text-rose-500'} mt-0.5 font-bold uppercase tracking-wider`}>Stock: {i.stock}</div>
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    

                    
                  </div>
                  {selectedItems.length > 0 && (
                    <div className="mt-3 bg-slate-50 dark:bg-slate-800/40 p-3 border border-slate-200 dark:border-slate-700 rounded-md">
                      <ul className="space-y-2">
                        {selectedItems.map((item, idx) => (
                          <li key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between text-sm font-mono text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200 dark:border-slate-700/60 last:border-0 last:pb-0">
                            <div className="flex-1 pr-4">
                              <div className="font-medium flex items-center gap-2">
                                <input 
                                  type="number" 
                                  min="1" 
                                  id={`item-qty-${idx}`}
                                  data-item-idx={idx}
                                  data-item-field="qty"
                                  value={item.qty} 
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    if (val > 0) {
                                      const updatedItems = [...selectedItems];
                                      updatedItems[idx].qty = val;
                                      setSelectedItems(updatedItems);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Tab' && !e.shiftKey) {
                                      e.preventDefault();
                                      const priceInput = document.getElementById(`item-price-${idx}`);
                                      if (priceInput) {
                                        priceInput.focus();
                                        try { (priceInput as HTMLInputElement).select(); } catch {}
                                      }
                                    } else if (e.key === 'Tab' && e.shiftKey) {
                                      e.preventDefault();
                                      const searchInput = document.getElementById('item-search-input');
                                      if (searchInput) {
                                        searchInput.focus();
                                        try { (searchInput as HTMLInputElement).select(); } catch {}
                                      }
                                    } else if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const searchInput = document.getElementById('item-search-input');
                                      if (searchInput) {
                                        searchInput.focus();
                                        try { (searchInput as HTMLInputElement).select(); } catch {}
                                      }
                                    }
                                  }}
                                  className="w-16 px-1 py-0.5 text-center border border-slate-300 dark:border-slate-600 rounded-md text-sm font-bold bg-white dark:bg-slate-800"
                                />
                                <span>× {item.name}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {item.sku && <span className="text-[10px] text-slate-400">{item.sku}</span>}
                                <span className="text-[10px] text-slate-500 dark:text-slate-400">Cost Rate: PKR {(item.cost || 0).toLocaleString()}</span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2 mt-2 sm:mt-0">
                              <span className="text-slate-400 text-xs">Rate:</span>
                              <input 
                                type="number" 
                                id={`item-price-${idx}`}
                                data-item-idx={idx}
                                data-item-field="price"
                                value={item.price} 
                                onChange={(e) => {
                                  const newPrice = Number(e.target.value);
                                  const updatedItems = [...selectedItems];
                                  updatedItems[idx].price = newPrice;
                                  setSelectedItems(updatedItems);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Tab' && !e.shiftKey) {
                                    e.preventDefault();
                                    // Move directly to NEXT SEARCH ITEM!
                                    const searchInput = document.getElementById('item-search-input');
                                    if (searchInput) {
                                      searchInput.focus();
                                      try { (searchInput as HTMLInputElement).select(); } catch {}
                                    }
                                  } else if (e.key === 'Tab' && e.shiftKey) {
                                    e.preventDefault();
                                    const qtyInput = document.getElementById(`item-qty-${idx}`);
                                    if (qtyInput) {
                                      qtyInput.focus();
                                      try { (qtyInput as HTMLInputElement).select(); } catch {}
                                    }
                                  } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const searchInput = document.getElementById('item-search-input');
                                    if (searchInput) {
                                      searchInput.focus();
                                      try { (searchInput as HTMLInputElement).select(); } catch {}
                                    }
                                  }
                                }}
                                className="w-24 px-2 py-1 text-right border border-slate-300 dark:border-slate-600 rounded-md focus:border-emerald-500 focus:ring-emerald-500 focus:outline-none text-sm font-bold bg-white dark:bg-slate-800"
                              />
                              <span className="w-28 text-right font-bold text-slate-900 dark:text-slate-50 border-l border-slate-200 dark:border-slate-700 pl-2">PKR {((item.qty || 0) * (item.price || 0)).toFixed(2)}</span>
                              <button type="button" onClick={() => setSelectedItems(selectedItems.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 ml-1 font-bold text-lg leading-none shrink-0" title="Remove item">×</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700 pt-2 mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                        <div className="flex items-center gap-2">
                          <span>Sale Items Subtotal:</span>
                          <span className="bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200 text-xs px-2 py-0.5 rounded font-bold">
                            Total: {selectedItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)} Suits (سوٹ)
                          </span>
                        </div>
                        <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">PKR {selectedItems.reduce((sum, item) => sum + (item.qty * item.price), 0).toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. DEDICATED SALE RETURN CHECKBOX */}
                <div 
                  onClick={() => setHasReturn(!hasReturn)}
                  className={`flex items-center justify-between p-3.5 rounded-lg border cursor-pointer transition-all mb-4 ${
                    hasReturn 
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 shadow-sm' 
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      id="hasReturnCheckbox" 
                      checked={hasReturn} 
                      onChange={(e) => setHasReturn(e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-rose-600 rounded border-rose-300 focus:ring-rose-500 cursor-pointer"
                    />
                    <label htmlFor="hasReturnCheckbox" className="text-sm font-bold text-slate-800 dark:text-slate-100 cursor-pointer flex items-center gap-2 select-none">
                      <RotateCcw className={`w-4 h-4 ${hasReturn ? 'text-rose-600' : 'text-slate-400'}`} />
                      <span>Include Sale Return in this Invoice (کسٹمر کی واپسی شامل کریں)</span>
                    </label>
                  </div>
                  {hasReturn && (
                    <span className="text-xs font-semibold text-rose-700 bg-rose-100 dark:bg-rose-900/60 dark:text-rose-200 px-2.5 py-0.5 rounded-full border border-rose-200 dark:border-rose-800">
                      Return Deducted from Bill
                    </span>
                  )}
                </div>

                {/* 3. RETURN ITEMS SECTION (EXPANDED WHEN CHECKED) */}
                {hasReturn && (
                  <div className="border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 rounded-lg p-4 mb-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 mb-3 flex items-center justify-between border-b border-rose-200 dark:border-rose-900/50 pb-2">
                      <div className="flex items-center gap-2">
                        <RotateCcw className="w-4 h-4 text-rose-600" />
                        <span>Customer Return Items (واپسی شدہ مال - اسٹاک میں واپس شامل ہوگا)</span>
                      </div>
                      <span className="text-[11px] text-rose-600 font-normal">
                        Returned items will be added back to inventory stock
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-3 mb-3">
                      <div className="md:col-span-5 relative">
                        <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Scan / Search Return Item</label>
                        <div 
                          className="w-full rounded-md border border-rose-200 dark:border-rose-800 px-3 py-2 bg-white dark:bg-slate-900 focus-within:ring-1 focus-within:ring-rose-500 flex items-center cursor-pointer"
                          onClick={() => setShowReturnItemDropdown(true)}
                        >
                          <Package className="w-4 h-4 text-rose-400 mr-2" />
                          <input 
                            type="text" 
                            placeholder="Scan barcode or search return item..." 
                            value={returnItemSearchQuery}
                            onChange={e => {
                              setReturnItemSearchQuery(e.target.value);
                              setShowReturnItemDropdown(true);
                              setSelectedReturnSearchIndex(0);
                              if (selectedReturnItemIdForAdd) setSelectedReturnItemIdForAdd('');
                            }}
                            onKeyDown={e => {
                              const branchInv = inventory.filter(i => i.branchId === (activeBranchId || targetBranchId));
                              const filtered = branchInv.filter(i => 
                                i.name.toLowerCase().includes(returnItemSearchQuery.toLowerCase()) || 
                                (i.sku || '').toLowerCase().includes(returnItemSearchQuery.toLowerCase()) ||
                                i.id === returnItemSearchQuery.trim()
                              );

                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setShowReturnItemDropdown(true);
                                setSelectedReturnSearchIndex(prev => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
                                return;
                              }
                              if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setSelectedReturnSearchIndex(prev => Math.max(prev - 1, 0));
                                return;
                              }

                              if (e.key === 'Enter') {
                                if (returnItemSearchQuery.trim()) {
                                  e.preventDefault();
                                  const exactMatch = filtered.find(i => i.sku?.toLowerCase() === returnItemSearchQuery.trim().toLowerCase() || i.sku === returnItemSearchQuery.trim() || i.id === returnItemSearchQuery.trim());
                                  const itemToPick = exactMatch || filtered[selectedReturnSearchIndex] || filtered[0];
                                  if (itemToPick) {
                                    handleAddReturnItem(itemToPick, 1, itemToPick.price);
                                    setReturnItemSearchQuery('');
                                    setShowReturnItemDropdown(false);
                                    setSelectedReturnSearchIndex(0);
                                    setTimeout(() => {
                                      const inp = document.getElementById('return-item-search-input');
                                      if (inp) {
                                        inp.focus();
                                        try { (inp as HTMLInputElement).select(); } catch {}
                                      }
                                    }, 40);
                                  }
                                  return;
                                }
                              }

                              if (e.key === 'Tab') {
                                if (returnItemSearchQuery.trim()) {
                                  e.preventDefault();
                                  const exactMatch = filtered.find(i => i.sku?.toLowerCase() === returnItemSearchQuery.trim().toLowerCase() || i.sku === returnItemSearchQuery.trim() || i.id === returnItemSearchQuery.trim());
                                  const itemToPick = exactMatch || filtered[selectedReturnSearchIndex] || filtered[0];
                                  if (itemToPick) {
                                    handleAddReturnItem(itemToPick, 1, itemToPick.price);
                                    setReturnItemSearchQuery('');
                                    setShowReturnItemDropdown(false);
                                    setSelectedReturnSearchIndex(0);
                                    setTimeout(() => {
                                      const allRetQty = document.querySelectorAll('input[data-return-item-field="qty"]');
                                      if (allRetQty.length > 0) {
                                        const target = allRetQty[allRetQty.length - 1] as HTMLInputElement;
                                        target.focus();
                                        try { target.select(); } catch {}
                                      }
                                    }, 60);
                                  }
                                  return;
                                }
                              }
                            }}
                            className="bg-transparent border-none p-0 focus:ring-0 text-sm w-full outline-none"
                          />
                          {selectedReturnItemIdForAdd && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedReturnItemIdForAdd(''); setReturnItemSearchQuery(''); }} className="text-slate-400 hover:text-slate-600 ml-1">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                          <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
                        </div>
                        
                        {showReturnItemDropdown && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowReturnItemDropdown(false)}></div>
                            <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                              {inventory.filter(i => i.branchId === (activeBranchId || targetBranchId)).filter(i => i.name.toLowerCase().includes(returnItemSearchQuery.toLowerCase()) || (i.sku || '').toLowerCase().includes(returnItemSearchQuery.toLowerCase())).length === 0 ? (
                                 <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">No items found</div>
                              ) : (
                                inventory.filter(i => i.branchId === (activeBranchId || targetBranchId)).filter(i => i.name.toLowerCase().includes(returnItemSearchQuery.toLowerCase()) || (i.sku || '').toLowerCase().includes(returnItemSearchQuery.toLowerCase())).map((i, idx) => (
                                  <button
                                    key={i.id}
                                    type="button"
                                    onClick={() => {
                                      handleAddReturnItem(i, 1, i.price);
                                      setReturnItemSearchQuery('');
                                      setShowReturnItemDropdown(false);
                                      setTimeout(() => {
                                        const inp = document.getElementById('return-item-search-input');
                                        if (inp) {
                                          inp.focus();
                                          try { (inp as HTMLInputElement).select(); } catch {}
                                        }
                                      }, 40);
                                    }}
                                    className={`w-full flex justify-between items-center px-4 py-3 text-sm border-b border-slate-100 dark:border-slate-800/50 last:border-0 transition text-left cursor-pointer ${
                                      idx === selectedReturnSearchIndex
                                        ? 'bg-rose-50 dark:bg-rose-950/70 border-l-4 border-l-rose-500 font-semibold text-rose-800 dark:text-rose-200'
                                        : 'hover:bg-rose-50 dark:hover:bg-rose-950/40'
                                    }`}
                                  >
                                    <div className="text-left">
                                      <div className="font-medium text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                        {idx === selectedReturnSearchIndex && <span className="text-rose-500 text-xs">▶</span>}
                                        <span>{i.name}</span>
                                      </div>
                                      {i.sku && <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">{i.sku}</div>}
                                    </div>
                                    <div className="text-right">
                                      <div className="font-bold text-rose-600">Rate: PKR {i.price.toLocaleString()}</div>
                                      <div className="text-[10px] text-slate-400 mt-0.5 font-bold uppercase tracking-wider">Current Stock: {i.stock}</div>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      

                      

                      
                    </div>
                    {returnItems.length > 0 && (
                      <div className="mt-3 bg-white dark:bg-slate-900 p-3 border border-rose-200 dark:border-rose-900/60 rounded-md">
                        <ul className="space-y-2">
                          {returnItems.map((item, idx) => (
                            <li key={`ret-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between text-sm font-mono text-slate-700 dark:text-slate-200 pb-2 border-b border-rose-100 dark:border-rose-950 last:border-0 last:pb-0">
                              <div className="flex-1 pr-4">
                                <div className="flex items-center gap-1.5 font-medium text-rose-700 dark:text-rose-300">
                                  <div className="font-medium flex items-center gap-2">
                                  <span>↩</span>
                                  <input 
                                    type="number" 
                                    min="1" 
                                    id={`return-item-qty-${idx}`}
                                    data-return-item-idx={idx}
                                    data-return-item-field="qty"
                                    value={item.qty} 
                                    onChange={(e) => {
                                      const val = Number(e.target.value);
                                      if (val > 0) {
                                        const updated = [...returnItems];
                                        updated[idx].qty = val;
                                        setReturnItems(updated);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Tab' && !e.shiftKey) {
                                        e.preventDefault();
                                        const p = document.getElementById(`return-item-price-${idx}`);
                                        if (p) {
                                          p.focus();
                                          try { (p as HTMLInputElement).select(); } catch {}
                                        }
                                      } else if (e.key === 'Tab' && e.shiftKey) {
                                        e.preventDefault();
                                        const s = document.getElementById('return-item-search-input');
                                        if (s) {
                                          s.focus();
                                          try { (s as HTMLInputElement).select(); } catch {}
                                        }
                                      } else if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const s = document.getElementById('return-item-search-input');
                                        if (s) {
                                          s.focus();
                                          try { (s as HTMLInputElement).select(); } catch {}
                                        }
                                      }
                                    }}
                                    className="w-16 px-1 py-0.5 text-center border border-rose-300 dark:border-rose-700 rounded-md text-sm text-slate-800 dark:text-slate-100 font-bold bg-white dark:bg-slate-800"
                                  />
                                  <span>× {item.name}</span>
                                </div>
                                  <span className="text-[10px] bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 px-1.5 py-0.2 rounded">WAPASI</span>
                                </div>
                                {item.sku && <span className="text-[10px] text-slate-400 block mt-0.5">{item.sku}</span>}
                              </div>
                              <div className="flex items-center space-x-2 mt-2 sm:mt-0">
                                <span className="text-slate-400 text-xs">Return Rate:</span>
                                <input 
                                  type="number" 
                                  id={`return-item-price-${idx}`}
                                  data-return-item-idx={idx}
                                  data-return-item-field="price"
                                  value={item.price} 
                                  onChange={(e) => {
                                    const newPrice = Number(e.target.value);
                                    const updated = [...returnItems];
                                    updated[idx].price = newPrice;
                                    setReturnItems(updated);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Tab' && !e.shiftKey) {
                                      e.preventDefault();
                                      // Tab from Return Rate returns to return-item-search-input
                                      const s = document.getElementById('return-item-search-input');
                                      if (s) {
                                        s.focus();
                                        try { (s as HTMLInputElement).select(); } catch {}
                                      }
                                    } else if (e.key === 'Tab' && e.shiftKey) {
                                      e.preventDefault();
                                      const q = document.getElementById(`return-item-qty-${idx}`);
                                      if (q) {
                                        q.focus();
                                        try { (q as HTMLInputElement).select(); } catch {}
                                      }
                                    } else if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const s = document.getElementById('return-item-search-input');
                                      if (s) {
                                        s.focus();
                                        try { (s as HTMLInputElement).select(); } catch {}
                                      }
                                    }
                                  }}
                                  className="w-24 px-2 py-1 text-right border border-rose-300 dark:border-rose-700 rounded-md focus:border-rose-500 focus:ring-rose-500 focus:outline-none text-sm text-rose-600 font-bold bg-white dark:bg-slate-800"
                                />
                                <span className="w-28 text-right font-bold text-rose-600 border-l border-rose-200 dark:border-rose-800 pl-2">- PKR {((item.qty || 0) * (item.price || 0)).toFixed(2)}</span>
                                <button type="button" onClick={() => setReturnItems(returnItems.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 ml-1 font-bold text-lg leading-none shrink-0" title="Remove return item">×</button>
                              </div>
                            </li>
                          ))}
                        </ul>
                        <div className="flex justify-between items-center border-t border-rose-200 dark:border-rose-900/60 pt-2 mt-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
                          <span>Total Return Items Deduction:</span>
                          <span className="font-mono text-rose-600 font-bold">- PKR {returnItems.reduce((sum, item) => sum + (item.qty * item.price), 0).toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

            {/* 4. GROSS & NET BILL SUMMARY SECTION */}
            {(selectedItems.length > 0 || (hasReturn && returnItems.length > 0)) && (
              <div className="mb-4 bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 border-b border-slate-200 dark:border-slate-700 pb-1 flex justify-between items-center">
                  <span>Invoice Calculation Summary (بل کا خلاصہ)</span>
                  <span className="text-sky-700 dark:text-sky-300 font-bold font-mono">
                    Total Suits: {selectedItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)}
                  </span>
                </div>
                <div className="flex flex-col text-right space-y-1.5 font-mono text-sm">
                  {/* Total Suit Count Breakdown */}
                  <div className="flex justify-between items-center text-slate-800 dark:text-slate-200 bg-sky-50 dark:bg-sky-950/40 px-2.5 py-1.5 rounded border border-sky-200 dark:border-sky-800/60 mb-1">
                    <span className="text-xs font-sans font-bold flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-sky-600" /> Total Suits / Qty (کل سوٹ):
                    </span>
                    <span className="font-bold text-sky-800 dark:text-sky-200 text-sm">
                      {selectedItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)} Suits / پیس
                    </span>
                  </div>

                  {/* Purchase / Sale Subtotal */}
                  <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
                    <span className="text-xs font-sans">Purchased Items Total (خریدار کا نیا مال):</span>
                    <span className="font-semibold">PKR {selectedItems.reduce((sum, item) => sum + (item.qty * item.price), 0).toFixed(2)}</span>
                  </div>

                  {/* Return Deduction */}
                  {(() => {
                    const returnItemsTotal = (hasReturn || transactionType === 'Return') ? returnItems.reduce((acc, curr) => acc + ((curr.qty || 0) * (curr.price || 0)), 0) : 0;
                    if (returnItemsTotal > 0) {
                      return (
                        <div className="flex justify-between items-center text-rose-600 font-medium">
                          <span className="text-xs font-sans flex items-center gap-1">
                            <RotateCcw className="w-3.5 h-3.5" /> Less: Sale Return (واپسی مال کی کٹوتی):
                          </span>
                          <span className="font-bold">- PKR {returnItemsTotal.toFixed(2)}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Return Amount */}
                  {Number(lumpSumReturnAmount || 0) > 0 && (
                    <div className="flex justify-between items-center text-rose-600 font-medium">
                      <span className="text-xs font-sans flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Less: Return Amt (واپسی):</span>
                      <span className="font-bold">- PKR {Number(lumpSumReturnAmount || 0).toFixed(2)}</span>
                    </div>
                  )}

                  {/* Discount */}
                  {Number(discountAmount || 0) > 0 && (
                    <div className="flex justify-between items-center text-rose-600 font-medium">
                      <span className="text-xs font-sans">Less: Discount (رعایت):</span>
                      <span className="font-bold">- PKR {Number(discountAmount || 0).toFixed(2)}</span>
                    </div>
                  )}

                  {/* Shipping */}
                  {saleType === 'Online' && Number(shippingCost || 0) > 0 && (
                    <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
                      <span className="text-xs font-sans">Add: Shipping Charges (ڈلیوری):</span>
                      <span className="font-semibold">+ PKR {Number(shippingCost || 0).toFixed(2)}</span>
                    </div>
                  )}

                  {/* Gross Net Bill */}
                  {(() => {
                    const saleSubtotal = selectedItems.reduce((sum, item) => sum + (item.qty * item.price), 0);
                    const returnItemsTotal = (hasReturn || transactionType === 'Return') ? returnItems.reduce((acc, curr) => acc + ((curr.qty || 0) * (curr.price || 0)), 0) : 0;
                    const discount = Number(discountAmount) || 0;
                    const lumpSumReturn = Number(lumpSumReturnAmount) || 0;
                    const shipping = saleType === 'Online' ? (Number(shippingCost) || 0) : 0;
                    const grossTotal = saleSubtotal + shipping - discount - returnItemsTotal - lumpSumReturn;
                    
                    const recVal = saleType === 'Online' 
                      ? (codCashReceived ? grossTotal : (Number(advanceAmount) || 0)) 
                      : (paymentMethod === 'Split' ? (Number(splitCashAmount) || 0) + (Number(splitOnlineAmount) || 0) : (receivedAmount === '' ? 0 : Number(receivedAmount)));
                    const balVal = grossTotal - recVal;
                    return (
                      <>
                        {transactionType !== 'Return' && saleType !== 'Online' && (
                          <div className="py-3 border-t border-slate-200 dark:border-slate-700/60 mb-2 mt-2">
                            {paymentMethod !== 'Split' ? (
                              <div>
                                <label className="block text-[11px] uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1 font-bold">Amount Recv (PKR) <span className="text-rose-500">*</span></label>
                                <input 
                                  type="number" 
                                  min="0" 
                                  id="received-amount-input"
                                  placeholder="Enter cash received..."
                                  value={receivedAmount} 
                                  onChange={e => setReceivedAmount(e.target.value === '' ? '' : Number(e.target.value))} 
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleCheckout();
                                    } else if (e.key === 'Tab' && !e.shiftKey) {
                                      e.preventDefault();
                                      const submitBtn = document.querySelector('button[data-bill-submit="true"]') as HTMLElement | null;
                                      if (submitBtn) submitBtn.focus();
                                    }
                                  }}
                                  className="w-full rounded-md border border-emerald-400 px-4 py-3 bg-emerald-50 focus:bg-white text-lg font-black text-slate-900" 
                                />
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[11px] uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1 font-bold">Cash Recv <span className="text-rose-500">*</span></label>
                                  <input 
                                    type="number" 
                                    min="0" 
                                    id="split-cash-input"
                                    placeholder="0"
                                    value={splitCashAmount} 
                                    onChange={e => setSplitCashAmount(e.target.value === '' ? '' : Number(e.target.value))} 
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleCheckout();
                                      } else if (e.key === 'Tab' && !e.shiftKey) {
                                        e.preventDefault();
                                        const onlineInp = document.getElementById('split-online-input');
                                        if (onlineInp) {
                                          onlineInp.focus();
                                          try { (onlineInp as HTMLInputElement).select(); } catch {}
                                        }
                                      }
                                    }}
                                    className="w-full rounded-md border border-emerald-400 px-3 py-3 bg-emerald-50 focus:bg-white text-lg font-black text-slate-900" 
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] uppercase tracking-widest text-sky-600 dark:text-sky-400 mb-1 font-bold">💳 Online Recv <span className="text-rose-500">*</span></label>
                                  <input 
                                    type="number" 
                                    min="0" 
                                    id="split-online-input"
                                    placeholder="0"
                                    value={splitOnlineAmount} 
                                    onChange={e => setSplitOnlineAmount(e.target.value === '' ? '' : Number(e.target.value))} 
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleCheckout();
                                      } else if (e.key === 'Tab' && !e.shiftKey) {
                                        e.preventDefault();
                                        const submitBtn = document.querySelector('button[data-bill-submit="true"]') as HTMLElement | null;
                                        if (submitBtn) submitBtn.focus();
                                      }
                                    }}
                                    className="w-full rounded-md border border-sky-400 px-3 py-3 bg-sky-50 focus:bg-white text-lg font-black text-slate-900" 
                                  />
                                  <span className="text-[10px] text-sky-700 dark:text-sky-300 font-semibold mt-1 block truncate">
                                    To: {isOwnerLinkedAccount(paymentAccount, directVendorPaymentId) ? `👑 Owner Account (${getNormalizedAccountHead(paymentAccount, paymentMethod)})` : (paymentAccount || 'Online / Bank')}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex justify-between items-center font-bold text-base md:text-lg text-slate-900 dark:text-slate-50 pt-2 border-t-2 border-slate-300 dark:border-slate-600">
                          <span className="font-sans text-sm md:text-base uppercase tracking-wider">Final Net Total Bill (کل بل):</span>
                          <span className="font-mono text-emerald-600 dark:text-emerald-400">PKR {(grossTotal || 0).toFixed(2)}</span>
                        </div>

                        {transactionType !== 'Return' && (
                          <div className="pt-2 border-t border-slate-200 dark:border-slate-700/60 space-y-1">
                            <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 font-semibold">
                              <span className="text-xs font-sans">{saleType === 'Online' ? (codCashReceived ? 'Cash Received (PostEx / COD Cleared)' : 'Advance Received') : 'Amount Received'}:</span>
                              <span>PKR {(recVal || 0).toFixed(2)}</span>
                            </div>
                            {balVal > 0 ? (
                              <div className="flex justify-between items-center text-rose-600 font-bold">
                                <span className="text-xs font-sans">{saleType === 'Online' && courierVendorId ? 'COD to Collect from Courier:' : 'Balance (Udhar / بقایا):'}</span>
                                <span>PKR {(balVal || 0).toFixed(2)}</span>
                              </div>
                            ) : balVal < 0 ? (
                              <div className="flex justify-between items-center text-amber-600 font-bold">
                                <span className="text-xs font-sans">Change to Return (بقیہ):</span>
                                <span>PKR {Math.abs(balVal).toFixed(2)}</span>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center text-emerald-600 text-xs font-sans font-bold">
                                <span>Bill Status:</span>
                                <span>Fully Paid (کلیئر)</span>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-3 pt-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={autoPrintOnSave} 
                  onChange={e => {
                    setAutoPrintOnSave(e.target.checked);
                    localStorage.setItem('mc_auto_print_sale', e.target.checked ? 'true' : 'false');
                  }}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                />
                <span className="flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Auto Print on Save (سیو کرتے ہی پرنٹ کھولیں)</span>
                </span>
              </label>
              <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">Press Enter to Print</span>
            </div>

            <button 
              type="button"
              data-bill-submit="true"
              onClick={handleCheckout} 
              disabled={isSubmitting}
              className={`w-full text-white py-3.5 rounded-xl font-bold text-base transition shadow-md disabled:opacity-50 flex items-center justify-center gap-2 ${
                transactionType === 'Return' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              <Printer className="w-5 h-5" />
              {isSubmitting 
                ? 'Processing...' 
                : editSaleId 
                  ? (autoPrintOnSave ? 'Update Invoice & Print (Enter)' : 'Update Invoice & Sync Stock')
                  : (transactionType === 'Return' 
                      ? (autoPrintOnSave ? 'Save Return & Print (Enter)' : 'Reflect Return & Restore Stock') 
                      : (hasReturn && returnItems.length > 0 
                          ? (autoPrintOnSave ? 'Save Sale & Return & Print (Enter)' : 'Save Sale & Return') 
                          : (autoPrintOnSave ? 'Save & Direct Print (Enter) / محفوظ اور پرنٹ کریں' : 'Reflect Sale & Deduct Stock')))}
            </button>
          </div>
        )}

        {tab === 'invoices' && (
          <div className="space-y-6">
            {/* Invoice Search & Filters */}
            <div className="card p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row gap-4 items-center">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search Invoice #, Customer Name, Phone, or Tracking..."
                  value={billSearchQuery}
                  onChange={(e) => setBillSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-sm focus:ring-2 focus:ring-sky-500 outline-none transition-all placeholder:text-slate-400"
                />
                {billSearchQuery && (
                  <button 
                    onClick={() => setBillSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-3 items-center w-full md:w-auto">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] uppercase font-bold text-slate-400 whitespace-nowrap">From:</label>
                  <input 
                    type="date" 
                    value={invoiceStartDate} 
                    onChange={e => setInvoiceStartDate(e.target.value)} 
                    className="text-xs border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 bg-slate-50 dark:bg-slate-800/50" 
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] uppercase font-bold text-slate-400 whitespace-nowrap">To:</label>
                  <input 
                    type="date" 
                    value={invoiceEndDate} 
                    onChange={e => setInvoiceEndDate(e.target.value)} 
                    className="text-xs border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 bg-slate-50 dark:bg-slate-800/50" 
                  />
                </div>
                {!isOnlineOnlyUser ? (
                  <select 
                    value={filterType} 
                    onChange={(e: any) => setFilterType(e.target.value)} 
                    className="text-xs border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 bg-slate-50 dark:bg-slate-800/50"
                  >
                    <option value="All">All Bills</option>
                    <option value="In-Store">In-Store</option>
                    <option value="Online">Online</option>
                  </select>
                ) : (
                  <span className="text-xs font-semibold px-3 py-1.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                    Online Bills Only
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sales.filter(s => {
              if (isOnlineOnlyUser && s.saleType !== 'Online') return false;
              const matchesType = filterType === 'All' || s.saleType === filterType;
              const d = format(new Date(s.date || 0), 'yyyy-MM-dd');
              const startStr = format(invoiceStartDate || new Date(), 'yyyy-MM-dd');
              const endStr = format(invoiceEndDate || new Date(), 'yyyy-MM-dd');
              const [sy, sm, sd] = startStr.split('-');
              const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
              start.setHours(0, 0, 0, 0);
              const [ey, em, ed] = endStr.split('-');
              const end = new Date(Number(ey), Number(em) - 1, Number(ed));
              end.setHours(23, 59, 59, 999);
              
              const searchLower = billSearchQuery.toLowerCase().trim();
              const matchesSearch = !searchLower || 
                (s.invoiceNo || '').toLowerCase().includes(searchLower) ||
                (s.customerName || '').toLowerCase().includes(searchLower) ||
                (s.customerPhone || '').toLowerCase().includes(searchLower) ||
                (s.trackingNumber || '').toLowerCase().includes(searchLower) ||
                s.id.toLowerCase().includes(searchLower);

              return matchesType && matchesSearch && new Date(s.date || 0).getTime() >= start.getTime() && new Date(s.date || 0).getTime() <= end.getTime();
            }).sort((a, b) => {
              const getTime = (v: any) => {
                if (v?.date) {
                  const t = typeof v.date === 'number' ? v.date : new Date(v.date).getTime();
                  if (!isNaN(t) && t > 0) return t;
                }
                if (v?.createdAt?.seconds) return v.createdAt.seconds * 1000;
                if (v?.createdAt) {
                  const t = typeof v.createdAt === 'number' ? v.createdAt : new Date(v.createdAt).getTime();
                  if (!isNaN(t) && t > 0) return t;
                }
                return 0;
              };
              const diff = getTime(b) - getTime(a);
              if (diff !== 0) return diff;
              // Secondary tie-break: invoice sequence number descending
              const getSeq = (inv: string) => {
                if (!inv) return 0;
                const p = String(inv).split('-');
                const s = parseInt(p[p.length - 1], 10);
                return isNaN(s) ? 0 : s;
              };
              return getSeq(b.invoiceNo) - getSeq(a.invoiceNo);
            }).map(sale => {
              const bName = branches.find(b => b.id === sale.branchId)?.name || 'Unknown Branch';
              
              const isReturn = sale.transactionType === 'Return';
              const amount = isReturn ? -Math.abs(sale.total || 0) : Math.abs(sale.total || 0);
              let profit = 0;
              if (!isReturn) {
                const saleSubtotal = (sale.items || []).reduce((acc: number, item: any) => acc + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
                const cost = (sale.items || []).reduce((acc: number, item: any) => acc + ((Number(item.cost) || 0) * (Number(item.qty) || 0)), 0);
                const returnSubtotal = (sale.returnItems || []).reduce((acc: number, item: any) => acc + ((Number(item.price) || 0) * (Number(item.qty) || 0)), 0);
                const returnCost = (sale.returnItems || []).reduce((acc: number, item: any) => acc + ((Number(item.cost) || 0) * (Number(item.qty) || 0)), 0);
                const discount = Number(sale.discount) || 0;
                profit = saleSubtotal - cost - discount - returnSubtotal + returnCost;
              }
              
              return (
                <div key={sale.id} className="card p-5 relative flex flex-col">
                  <div className="flex justify-between items-start mb-1">
                    <div className="text-[10px] text-slate-400 uppercase tracking-widest flex items-center flex-wrap gap-1">
                      Invoice Total
                      {sale.saleType === 'Online' && <span className="px-1.5 py-0.5 rounded-sm bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">Online</span>}
                      {sale.transactionType === 'Return' && <span className="px-1.5 py-0.5 rounded-sm bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">Sale Return</span>}
                      {sale.transactionType !== 'Return' && ((sale.returnItems && sale.returnItems.length > 0) || (sale.returnedValue && sale.returnedValue > 0)) && (
                        <span className="px-1.5 py-0.5 rounded-sm bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-0.5">
                          <RotateCcw className="w-2.5 h-2.5" /> Return Adj
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                       
                       <div className="text-[10px] bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-medium">
                         {bName}
                       </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-end mb-1">
                    <div className={`stat-value ${sale.transactionType === 'Return' ? 'text-rose-600' : 'text-sky-600'}`}>
                      PKR {(sale.total || 0).toFixed(2)}
                    </div>
                    {(user?.role === 'super_admin' || user?.role === 'branch_admin') && sale.transactionType !== 'Return' && profit > 0 && (
                      <div className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100">
                        Profit: PKR {profit.toFixed(2)}
                      </div>
                    )}
                  </div>
                  {sale.transactionType !== 'Return' && sale.received !== undefined && (sale.received < sale.total || (sale.total || 0) < 0) && (
                    <div className="flex space-x-3 mb-1 mt-1 text-xs font-mono bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded border border-slate-100 dark:border-slate-800/50">
                      <div><span className="text-emerald-600 font-semibold uppercase tracking-wider text-[10px]">{(sale.total || 0) < 0 ? 'Refunded:' : 'Recv:'}</span> <span className="font-bold text-emerald-700">{Number(sale.received).toFixed(2)}</span></div>
                      {((sale.total || 0) - (sale.received || 0)) !== 0 && (
                        sale.saleType === 'Online' && sale.courierVendorId ? (
                          <div><span className="text-indigo-500 font-semibold uppercase tracking-wider text-[10px]">COD:</span> <span className="font-bold text-indigo-600">{((sale.total || 0) - (sale.received || 0)).toFixed(2)}</span></div>
                        ) : (
                          <div><span className="text-rose-500 font-semibold uppercase tracking-wider text-[10px]">Udhar:</span> <span className="font-bold text-rose-600">{((sale.total || 0) - (sale.received || 0)).toFixed(2)}</span></div>
                        )
                      )}
                    </div>
                  )}
                  <div className="flex justify-between items-start gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">Customer:</span>
                      <strong className="text-slate-800 dark:text-slate-100">{sale.customerName || 'Walk-in'}</strong>
                      {sale.customerPhone && <span className="text-xs font-mono text-slate-500">({sale.customerPhone})</span>}
                      {sale.customerCity && <span className="text-xs text-slate-400">[{sale.customerCity}]</span>}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenBillCustomerEdit(sale);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800 transition cursor-pointer ml-1"
                        title="Edit Customer Name / Add Customer on this Bill"
                      >
                        <Edit className="w-3 h-3" /> Edit Customer (کسٹمر ایڈ / تبدیل)
                      </button>
                    </div>
                    <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 shrink-0">
                      {sale.items?.reduce((s, i) => s + (Number(i.qty) || 0), 0) || 0} Suits (سوٹ)
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-400 mt-1 uppercase">
                    #{ String(sale.invoiceNo || sale.id.substring(0,6)).toUpperCase() } • { new Date(sale.date || 0).toLocaleString() }
                     <span className="block mt-0.5 text-slate-500 dark:text-slate-400">
                       <span className="font-semibold text-slate-600 dark:text-slate-300">PAYMENT:</span> {sale.paymentMethod === 'Split' ? `Split (Cash: ${sale.splitCashAmount || 0}, Online: ${sale.splitOnlineAmount || 0}${sale.paymentAccount ? ` - ${sale.paymentAccount}` : ''})` : `${sale.paymentMethod}${sale.paymentAccount ? ` (${sale.paymentAccount})` : ''}`}
                       {isOwnerLinkedAccount(sale.paymentAccount, sale.directVendorPaymentId) && (
                         <span className="ml-1.5 inline-block text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-800">
                           👑 Owner Linked
                         </span>
                       )}
                     </span>
                     {sale.saleType === 'Online' && (
                       <div className="mt-1.5 p-1.5 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-100 dark:border-slate-800/50 space-y-0.5">
                         {sale.customerPhone && <div><span className="font-semibold">Phone:</span> {sale.customerPhone}</div>}
                         {sale.courier && <div><span className="font-semibold">Courier:</span> {sale.courier}</div>}
                         {sale.trackingNumber && <div><span className="font-semibold">Tracking:</span> {sale.trackingNumber}</div>}
                       </div>
                     )}
                  </div>
                  <div className="mt-2 pt-3 border-t border-slate-100 dark:border-slate-800/50 space-y-1 flex-1">
                    {sale.items?.slice(0, 3).map((item, i) => (
                      <div key={i} className="text-xs flex justify-between font-mono">
                        <span className="text-slate-600 dark:text-slate-300">{item.qty}x {item.name}</span>
                      </div>
                    ))}
                    {(sale.items?.length || 0) > 3 && <div className="text-xs text-slate-400">+{sale.items.length - 3} more sale items</div>}
                    
                    {sale.returnItems && sale.returnItems.length > 0 && (
                      <div className="mt-1 pt-1 border-t border-dashed border-rose-200 dark:border-rose-900/40">
                        {sale.returnItems.slice(0, 2).map((rItem, ri) => (
                          <div key={`rc-${ri}`} className="text-xs flex justify-between font-mono text-rose-600 dark:text-rose-400">
                            <span>↩ {rItem.qty}x {rItem.name}</span>
                            <span>-{(rItem.qty * rItem.price).toFixed(0)}</span>
                          </div>
                        ))}
                        {sale.returnItems.length > 2 && <div className="text-[10px] text-rose-400">+{sale.returnItems.length - 2} more return items</div>}
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-slate-50 dark:border-slate-800/50 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      {enableBillEdit ? (
                        <button 
                          onClick={(e) => handleEditClick(sale, e)}
                          className="text-xs flex items-center px-2.5 py-1.5 bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-200 rounded transition-colors cursor-pointer"
                          title="Edit Bill"
                        >
                          <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                        </button>
                      ) : null}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenBillCustomerEdit(sale);
                        }}
                        className="text-xs flex items-center px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/50 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/60 border border-sky-200 dark:border-sky-800 rounded transition-colors cursor-pointer"
                        title="Edit Customer Name / Add Customer on this Bill"
                      >
                        <User className="w-3.5 h-3.5 mr-1" /> Edit Customer
                      </button>
                    </div>
                    <button 
                      onClick={() => setPrintSale(sale)}
                      className="text-xs flex items-center px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 mr-1.5" /> Print Bill
                    </button>
                  </div>
                </div>
              );
            })}
            {sales.length === 0 && <div className="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 card border-dashed">No sales records found.</div>}
          </div>
        </div>
      )}

        {tab === 'reports' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="card p-4 flex flex-wrap gap-4 items-end bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">End Date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Group By</label>
                <select value={aggregation} onChange={(e: any) => setAggregation(e.target.value)} className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              <div className="card p-3 md:p-5">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Period Revenue</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-emerald-600">PKR {reports.totalRevenue.toLocaleString()}</div>
              </div>
              <div className="card p-3 md:p-5">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Transactions</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{reports.filteredCount}</div>
              </div>
              <div className="card p-3 md:p-5 col-span-2 lg:col-span-1">
                 <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Avg Transaction</div>
                 <div className="text-base md:text-3xl font-bold tracking-tight text-sky-600">PKR {reports.filteredCount ? Math.round(reports.totalRevenue / reports.filteredCount).toLocaleString() : 0}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              {/* Trend Chart */}
              <div className="card p-5 flex flex-col min-h-[350px]">
                <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Revenue Trend</div>
                <div className="flex-1 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reports.trendChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="period" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                        itemStyle={{ color: '#38bdf8' }}
                      />
                      <Line type="monotone" dataKey="sales" stroke="#0284c7" strokeWidth={3} dot={{ r: 4, fill: '#0ea5e9' }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top Items Bar Chart */}
              <div className="card p-5 flex flex-col min-h-[350px]">
                <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Top Selling Items (Revenue)</div>
                <div className="flex-1 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reports.topItems} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                      <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} width={80} />
                      <Tooltip 
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              {/* Branch Performance (Super Admin only - Global View) */}
              {!activeBranchId && reports.branchChart.length > 0 && (
                <div className="card p-5 flex flex-col min-h-[350px] col-span-1 lg:col-span-2">
                  <div className="font-serif italic text-sm text-slate-600 dark:text-slate-300 mb-6 border-b border-slate-100 dark:border-slate-800/50 pb-2">Branch Performance Snapshot</div>
                  <div className="flex-1 w-full">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={reports.branchChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `PKR ${v/1000}k`} />
                        <Tooltip 
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {printSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 print:bg-transparent print:static print:inset-auto print:block print:z-auto backdrop-blur-sm print:backdrop-blur-none print:h-auto print:min-h-0">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-[80mm] max-w-[95vw] max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none h-full md:h-auto print:block print:h-auto print:min-h-0 print:w-[80mm] print:m-0">
            {/* Modal Header - Hidden in Print */}
            <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800/50 print:hidden shrink-0">
               <h3 className="font-semibold text-slate-800 dark:text-slate-100">Print Preview</h3>
               <button onClick={() => setPrintSale(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 bg-slate-100 dark:bg-slate-950 p-1.5 rounded-full">
                 <X className="w-5 h-5" />
               </button>
            </div>

            {/* The Print Content */}
            <div id="print-invoice-content" className="p-8 print:p-0 print:m-0 print:w-full print:max-w-full text-black bg-white dark:bg-white overflow-y-auto print:overflow-visible flex-1 content-start font-sans">
               <div className="text-center mb-4 print:mb-2">
                 <h1 className="text-2xl print:text-[22px] font-black uppercase tracking-widest leading-tight text-black">
                   {printSale.branchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === printSale.branchId)?.name || '')}
                 </h1>
                 {(branches.find(b => b.id === printSale.branchId)?.phone || branches.find(b => b.id === printSale.branchId)?.phone2) && (
                   <div className="mt-1 text-sm print:text-[11px] font-black text-black">
                     {branches.find(b => b.id === printSale.branchId)?.phone && <span>Phone 1: {branches.find(b => b.id === printSale.branchId)?.phone}</span>}
                     {branches.find(b => b.id === printSale.branchId)?.phone && branches.find(b => b.id === printSale.branchId)?.phone2 && <span> | </span>}
                     {branches.find(b => b.id === printSale.branchId)?.phone2 && <span>Phone 2: {branches.find(b => b.id === printSale.branchId)?.phone2}</span>}
                   </div>
                 )}
                 {branches.find(b => b.id === printSale.branchId)?.address && (
                   <div className="mt-0.5 text-sm print:text-[11px] font-black text-black">
                     {branches.find(b => b.id === printSale.branchId)?.address}
                   </div>
                 )}
                 {branches.find(b => b.id === printSale.branchId)?.onlinePhone && (
                   <div className="mt-0.5 text-sm print:text-[11px] font-black text-black">
                     Online Support: {branches.find(b => b.id === printSale.branchId)?.onlinePhone}
                   </div>
                 )}
                 {printSale.salesmanName && (
                   <div className="mt-1 text-[13px] print:text-[14px] font-black text-black uppercase tracking-widest border border-black inline-block px-2 py-0.5 rounded-sm">
                     Salesman: {printSale.salesmanName}
                   </div>
                 )}
                 {printSale.transactionType === 'Return' ? (
                   <div className="mt-2 text-sm print:text-[16px] font-black text-black uppercase tracking-widest border-y-[2px] border-solid border-black py-1.5 inline-block w-full">
                     Return Receipt
                   </div>
                 ) : (
                   <div className="mt-2 text-sm print:text-[16px] font-black text-white bg-black uppercase tracking-widest py-1.5 inline-block w-full">
                     SALE INVOICE
                   </div>
                 )}
               </div>
               
               <div className="text-sm print:text-[13px] font-medium text-black mb-4 print:mb-2 space-y-0.5">
                 <div>Receipt No: #{String(printSale.invoiceNo || printSale.id.substring(0,6)).toUpperCase()}</div>
                 <div>Date: {new Date(printSale.date || 0).toLocaleString()}</div>
                 <div>Customer: {printSale.customerName || 'Walk-in'}</div>
                 {printSale.customerPhone && <div>Phone: {printSale.customerPhone}</div>}
                 {printSale.customerCity && <div>City: {printSale.customerCity}</div>}
                 {printSale.saleType === 'Online' && printSale.onlineEmployeeCode && <div>Online Empl: {printSale.onlineEmployeeCode} - {printSale.onlineEmployeeName}</div>}
                 {printSale.salesmanName && <div>Salesman: {printSale.salesmanName}</div>}
                 <div>
                   Payment: {printSale.paymentMethod === 'Split' ? `Split (Cash: ${printSale.splitCashAmount || 0}, Online: ${printSale.splitOnlineAmount || 0}${printSale.paymentAccount ? ` - ${printSale.paymentAccount}` : ''})` : `${printSale.paymentMethod}${printSale.paymentAccount ? ` (${printSale.paymentAccount})` : ''}`}
                 </div>
               </div>

               <div className="border-t-[2px] border-b-[2px] border-black py-2 mb-3 print:mb-2">
                 {/* Sold items */}
                 {printSale.items && printSale.items.length > 0 && (
                   <>
                     <div className="flex justify-between text-[13px] font-black uppercase tracking-wider mb-1 border-b-[2px] border-dashed border-black pb-1">
                       <span>{printSale.transactionType === 'Return' ? 'Returned Items' : 'Sold Items'}</span>
                       <span>Amt</span>
                     </div>
                     <div className="space-y-1 mt-1">
                       {printSale.items.map((item, idx) => (
                         <div key={idx} className="flex justify-between text-[13px] font-bold text-black">
                           <div className="flex-1 pr-2">
                             <div className="leading-tight font-black">{item.name}</div>
                             <div className="text-[12px]">{item.qty} x {(item.price || 0).toFixed(0)}</div>
                           </div>
                           <div className="self-end font-black">
                             {((item.qty || 0) * (item.price || 0)).toFixed(0)}
                           </div>
                         </div>
                       ))}
                     </div>
                   </>
                 )}

                 {/* Return items in mixed invoice */}
                 {printSale.returnItems && printSale.returnItems.length > 0 && (
                   <div className="mt-2 pt-2 border-t-[2px] border-dashed border-black">
                     <div className="flex justify-between text-[13px] font-black uppercase tracking-wider mb-1 border-b-[2px] border-dotted border-black pb-0.5">
                       <span>Customer Return Items (واپسی)</span>
                       <span>Deduction</span>
                     </div>
                     <div className="space-y-1 mt-1">
                       {printSale.returnItems.map((rItem, rIdx) => (
                         <div key={`ret-p-${rIdx}`} className="flex justify-between text-[13px] font-bold text-black">
                           <div className="flex-1 pr-2">
                             <div className="leading-tight font-black">↩ {rItem.name}</div>
                             <div className="text-[12px]">{rItem.qty} x {(rItem.price || 0).toFixed(0)} (Return Rate)</div>
                           </div>
                           <div className="self-end font-black">
                             -{((rItem.qty || 0) * (rItem.price || 0)).toFixed(0)}
                           </div>
                         </div>
                       ))}
                     </div>
                   </div>
                 )}

                 {/* Calculation Adjustments */}
                 {(() => {
                   const hasAdjustments = (printSale.saleType === 'Online' && (printSale.shippingCost || 0) > 0) || (printSale.discount || 0) > 0 || (printSale.lumpSumReturnAmount || 0) > 0;

                   if (!hasAdjustments) return null;

                   return (
                     <div className="mt-2 pt-2 border-t-[2px] border-dashed border-black space-y-1">
                       {(printSale.lumpSumReturnAmount || 0) > 0 && (
                         <div className="flex justify-between text-[13px] font-bold text-black">
                           <div className="flex-1 pr-2">
                             <div className="leading-tight font-black">Less: Return Amt (واپسی)</div>
                           </div>
                           <div className="self-end font-black">
                             -{(printSale.lumpSumReturnAmount || 0).toFixed(0)}
                           </div>
                         </div>
                       )}

                       {(printSale.discount || 0) > 0 && (
                         <div className="flex justify-between text-[13px] font-bold text-black">
                           <div className="flex-1 pr-2">
                             <div className="leading-tight font-black">Less: Discount (رعایت)</div>
                           </div>
                           <div className="self-end font-black">
                             -{(printSale.discount || 0).toFixed(0)}
                           </div>
                         </div>
                       )}

                       {printSale.saleType === 'Online' && (printSale.shippingCost || 0) > 0 && (
                         <div className="flex justify-between text-[13px] font-bold text-black">
                           <div className="flex-1 pr-2">
                             <div className="leading-tight font-black">Add: Shipping Charges</div>
                           </div>
                           <div className="self-end font-black">
                             +{(printSale.shippingCost || 0).toFixed(0)}
                           </div>
                         </div>
                       )}
                     </div>
                   );
                 })()}
               </div>

               {/* Total Suits / Quantity Summary */}
               {(() => {
                 const totalSoldSuits = (printSale.items || []).reduce((s: number, i: any) => s + (Number(i.qty) || 0), 0);
                 const totalReturnSuits = (printSale.returnItems || []).reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0);
                 const netSuits = totalSoldSuits - totalReturnSuits;

                 return (
                   <div className="py-1.5 border-b-[2px] border-dotted border-black mb-1 space-y-0.5">
                     <div className="flex justify-between items-center text-black">
                       <span className="text-[14px] font-black uppercase tracking-wider">Total Suits (کل سوٹ):</span>
                       <span className="text-[16px] font-black">{totalSoldSuits} {totalSoldSuits === 1 ? 'Suit' : 'Suits'}</span>
                     </div>
                     {totalReturnSuits > 0 && (
                       <>
                         <div className="flex justify-between items-center text-[12px] font-bold text-black">
                           <span>Returned Suits (واپسی سوٹ):</span>
                           <span>-{totalReturnSuits} Suits</span>
                         </div>
                         <div className="flex justify-between items-center text-[13px] font-black text-black border-t border-dashed border-black pt-0.5 mt-0.5">
                           <span className="uppercase tracking-wider">Net Suits (خالص سوٹ):</span>
                           <span className="text-[14px] font-black">{netSuits} Suits</span>
                         </div>
                       </>
                     )}
                   </div>
                 );
               })()}

               <div className="flex justify-between items-center pt-1 text-black mb-1">
                 <span className="text-[15px] font-black uppercase tracking-wider">{printSale.transactionType === 'Return' ? 'Total Refund PKR' : 'Net Total / کل بل PKR'}</span>
                 <span className="text-[18px] font-black border-b-[2px] border-double border-black">{(printSale.total || 0).toFixed(0)}</span>
               </div>
               
               {printSale.transactionType !== 'Return' && printSale.received !== undefined && (printSale.received !== printSale.total || (printSale.total || 0) < 0) && (
                 <>
                   <div className="flex justify-between items-center pt-1 text-black">
                     <span className="text-[13px] font-black uppercase tracking-wider">
                       {(printSale.total || 0) < 0 ? 'Cash Refunded' : (printSale.saleType === 'Online' ? 'Advance Paid' : 'Received (وصول)')}
                     </span>
                     <span className="text-[15px] font-black">{(printSale.received || 0).toFixed(0)}</span>
                   </div>
                   {((printSale.total || 0) - (printSale.received || 0)) !== 0 && (
                     <div className="flex justify-between items-center pt-1 border-t-[2px] border-dashed border-black mt-1 text-black">
                       <span className="text-[13px] font-black uppercase tracking-wider">
                         {printSale.saleType === 'Online' && printSale.courierVendorId ? 'COD to Collect' : (((printSale.total || 0) - (printSale.received || 0)) < 0 ? 'Change (بقیہ)' : 'Balance (Udhar)')}
                       </span>
                       <span className="text-[15px] font-black">
                         {Math.abs((printSale.total || 0) - (printSale.received || 0)).toFixed(0)}
                       </span>
                     </div>
                   )}
                 </>
               )}

               {printSale.saleType === 'Online' && (
                 <div className="mt-3 pt-2 border-t-[2px] border-black text-[13px] font-bold text-black space-y-0.5">
                   <div className="text-[14px] mb-1 uppercase tracking-widest font-black">Delivery Info</div>
                   {printSale.shippingAddress && <div>Address: {printSale.shippingAddress}</div>}
                   {printSale.customerPhone && <div>Phone: {printSale.customerPhone}</div>}
                   {printSale.courier && <div>Courier: {printSale.courier}</div>}
                   {printSale.trackingNumber && <div>Tracking ID: {printSale.trackingNumber}</div>}
                 </div>
               )}

               <div className="mt-4 print:mt-3 text-center text-[12px] font-black text-black uppercase tracking-widest leading-relaxed">
                 {printSale.transactionType === 'Return' ? (
                   <>
                     <p className="border-t-[2px] border-black pt-2 mb-1">Return Accepted!</p>
                     <p>Amount has been settled.</p>
                   </>
                 ) : (
                   <>
                     <p className="border-t-[2px] border-black pt-2 mb-1">Thank you for shopping!</p>
                     <p>Goods once sold cannot be returned</p>
                     <p>or exchanged after 7 days.</p>
                   </>
                 )}
                 <div className="mt-4 print:mt-4 text-center text-[10px] font-bold text-black uppercase tracking-widest border-t-[2px] border-black pt-2 flex flex-col items-center justify-center">
                    <Barcode 
                      value={String(printSale.invoiceNo || printSale.id.substring(0, 6)).toUpperCase()} 
                      width={1.2}
                      height={40}
                      fontSize={10}
                      margin={0}
                      background="transparent"
                    />
                  </div>
                  <div style={{ display: 'none' }}>
                   
                 </div>
               </div>
            </div>

            {/* Modal Actions - Hidden in Print */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-center shrink-0 gap-3 print:hidden rounded-b-lg">
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 order-2 sm:order-1">
                <kbd className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[11px] font-mono font-bold">Enter</kbd>
                <span>Print</span>
                <span className="mx-1">&bull;</span>
                <kbd className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[11px] font-mono font-bold">Esc</kbd>
                <span>Close</span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto order-1 sm:order-2">
                <button 
                  type="button"
                  onClick={() => setPrintSale(null)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-sm"
                >
                  Close
                </button>
                <button 
                  type="button"
                  autoFocus
                  onClick={() => printInvoice('print-invoice-content', `Sale-Receipt-${printSale.invoiceNo || printSale.id}`, 'thermal')}
                  className="flex-1 sm:flex-none flex items-center justify-center px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium transition-colors shadow-sm text-sm"
                >
                  <Printer className="w-4 h-4 mr-2" /> Print Receipt (Enter)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BILL CUSTOMER EDIT / REASSIGN MODAL */}
      {billCustomerEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <User className="w-4 h-4 text-sky-600" />
                  <span>Edit Customer - #{billCustomerEditModal.sale.invoiceNo || billCustomerEditModal.sale.id.slice(-6).toUpperCase()}</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  بل پر کسٹمر کا نام تبدیل کریں یا نیا کسٹمر ایڈ کریں
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setBillCustomerEditModal(null)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBillCustomer} className="space-y-4">
              {/* Select from existing registered customers */}
              <div className="relative">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span>Pick Registered Customer (کسٹمر لسٹ)</span>
                  {billCustomerEditModal.customerId && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                      Linked
                    </span>
                  )}
                </label>
                <div 
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800 text-sm flex items-center justify-between cursor-pointer"
                  onClick={() => setShowBillCustomerDropdown(!showBillCustomerDropdown)}
                >
                  <span className={billCustomerEditModal.customerId ? "font-semibold text-slate-800 dark:text-slate-100" : "text-slate-500"}>
                    {customers.find(c => c.id === billCustomerEditModal.customerId)?.name || '-- Select Existing Customer (اختیاری) --'}
                  </span>
                  <div className="flex items-center gap-1">
                    {billCustomerEditModal.customerId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBillCustomerEditModal({
                            ...billCustomerEditModal,
                            customerId: ''
                          });
                        }}
                        className="text-slate-400 hover:text-rose-600 p-0.5"
                        title="Unlink"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  </div>
                </div>

                {showBillCustomerDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowBillCustomerDropdown(false)}></div>
                    <div className="absolute z-20 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-xl max-h-48 overflow-y-auto">
                      <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                        <input
                          type="text"
                          placeholder="Search customer by name or phone..."
                          value={billCustomerSearchQuery}
                          onChange={e => setBillCustomerSearchQuery(e.target.value)}
                          className="w-full text-xs px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 outline-none"
                          onClick={e => e.stopPropagation()}
                          autoFocus
                        />
                      </div>
                      {customers.filter(c => c.name.toLowerCase().includes(billCustomerSearchQuery.toLowerCase()) || (c.phone || '').includes(billCustomerSearchQuery)).map(c => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setBillCustomerEditModal({
                              ...billCustomerEditModal,
                              customerId: c.id,
                              customerName: c.name,
                              customerPhone: c.phone || billCustomerEditModal.customerPhone,
                              customerCity: c.city || billCustomerEditModal.customerCity,
                              saveToDirectory: false
                            });
                            setShowBillCustomerDropdown(false);
                            setBillCustomerSearchQuery('');
                          }}
                          className="px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer border-b border-slate-50 dark:border-slate-800 flex justify-between items-center"
                        >
                          <div>
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{c.name}</span>
                            {c.phone && <span className="ml-2 font-mono text-slate-400">{c.phone}</span>}
                            {c.city && <span className="ml-1 text-slate-400">({c.city})</span>}
                          </div>
                          <span className="text-[10px] text-sky-600 font-bold">Select</span>
                        </div>
                      ))}
                      {customers.length === 0 && (
                        <div className="p-3 text-xs text-slate-400 text-center">No registered customers found.</div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Customer Name Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Customer Name * (کسٹمر کا نام)
                </label>
                <input
                  required
                  type="text"
                  value={billCustomerEditModal.customerName}
                  onChange={e => setBillCustomerEditModal({
                    ...billCustomerEditModal,
                    customerName: e.target.value
                  })}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                  placeholder="Enter Customer Name (e.g. Walk-in or Ali Khan)"
                />
              </div>

              {/* Phone & City */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Phone Number (فون نمبر)
                  </label>
                  <input
                    type="text"
                    value={billCustomerEditModal.customerPhone}
                    onChange={e => setBillCustomerEditModal({
                      ...billCustomerEditModal,
                      customerPhone: e.target.value
                    })}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
                    placeholder="0300 1234567"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    City (شہر)
                  </label>
                  <input
                    type="text"
                    value={billCustomerEditModal.customerCity}
                    onChange={e => setBillCustomerEditModal({
                      ...billCustomerEditModal,
                      customerCity: e.target.value
                    })}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
                    placeholder="Karachi, Lahore, etc."
                  />
                </div>
              </div>

              {/* Checkbox to add/save this customer into Customer Directory */}
              {!billCustomerEditModal.customerId && billCustomerEditModal.customerName.trim() && (
                <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800/60">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={billCustomerEditModal.saveToDirectory}
                      onChange={e => setBillCustomerEditModal({
                        ...billCustomerEditModal,
                        saveToDirectory: e.target.checked
                      })}
                      className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Save this customer into Customer Directory
                      </span>
                      <span className="text-emerald-700/80 dark:text-emerald-400 block mt-0.5 text-[11px]">
                        اس کسٹمر کو مستقل کسٹمر لسٹ میں بھی رجسٹر کر لیں تاکہ آئندہ بھی آسانی سے سیل بن سکے
                      </span>
                    </div>
                  </label>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 mt-4">
                <button
                  type="button"
                  onClick={() => setBillCustomerEditModal(null)}
                  disabled={isSavingBillCustomer}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingBillCustomer || !billCustomerEditModal.customerName.trim()}
                  className="px-5 py-2 bg-sky-600 text-white rounded-md text-sm font-semibold hover:bg-sky-700 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {isSavingBillCustomer ? 'Saving...' : 'Update Customer (محفوظ کریں)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK ADD CUSTOMER MODAL */}
      {showQuickAddCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-600" />
                <span>Add New Customer (نیا کسٹمر شامل کریں)</span>
              </h3>
              <button 
                type="button" 
                onClick={() => setShowQuickAddCustomerModal(false)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleQuickAddCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Customer Name * (کسٹمر کا نام)
                </label>
                <input
                  required
                  type="text"
                  autoFocus
                  placeholder="e.g. Muhammad Ali"
                  value={quickCustomerName}
                  onChange={e => setQuickCustomerName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Phone Number (فون نمبر)
                  </label>
                  <input
                    type="text"
                    placeholder="0300 1234567"
                    value={quickCustomerPhone}
                    onChange={e => setQuickCustomerPhone(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    City (شہر)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Karachi"
                    value={quickCustomerCity}
                    onChange={e => setQuickCustomerCity(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Address (پتہ)
                </label>
                <input
                  type="text"
                  placeholder="Street / Area Address"
                  value={quickCustomerAddress}
                  onChange={e => setQuickCustomerAddress(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 mt-4">
                <button
                  type="button"
                  onClick={() => setShowQuickAddCustomerModal(false)}
                  disabled={isQuickCustomerSaving}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isQuickCustomerSaving || !quickCustomerName.trim()}
                  className="px-5 py-2 bg-emerald-600 text-white rounded-md text-sm font-semibold hover:bg-emerald-700 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {isQuickCustomerSaving ? 'Saving...' : 'Add & Select Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK EDIT CUSTOMER MODAL */}
      {quickEditCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Edit className="w-4 h-4 text-sky-600" />
                <span>Edit Customer Name (کسٹمر کا نام تبدیل کریں)</span>
              </h3>
              <button 
                type="button" 
                onClick={() => setQuickEditCustomerModal(null)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleQuickEditCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Customer Name * (کسٹمر کا نام)
                </label>
                <input
                  required
                  type="text"
                  autoFocus
                  value={quickEditCustomerModal.name}
                  onChange={e => setQuickEditCustomerModal({ ...quickEditCustomerModal, name: e.target.value })}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                  placeholder="Enter customer name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Phone (فون نمبر)
                  </label>
                  <input
                    type="text"
                    value={quickEditCustomerModal.phone}
                    onChange={e => setQuickEditCustomerModal({ ...quickEditCustomerModal, phone: e.target.value })}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
                    placeholder="Phone number"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    City (شہر)
                  </label>
                  <input
                    type="text"
                    value={quickEditCustomerModal.city}
                    onChange={e => setQuickEditCustomerModal({ ...quickEditCustomerModal, city: e.target.value })}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
                    placeholder="City"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800 mt-4">
                <button
                  type="button"
                  onClick={() => setQuickEditCustomerModal(null)}
                  disabled={isQuickCustomerEditing}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isQuickCustomerEditing || !quickEditCustomerModal.name.trim()}
                  className="px-5 py-2 bg-sky-600 text-white rounded-md text-sm font-semibold hover:bg-sky-700 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {isQuickCustomerEditing ? 'Updating...' : 'Save & Update Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
