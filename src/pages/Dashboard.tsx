import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useSettings } from '../context/SettingsContext';
import { collection, where, orderBy, limit, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc, runTransaction, writeBatch, onSnapshot, query } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { Link, useNavigate } from 'react-router';
import { Settings, Save, X, Calendar, Lock, Eye, EyeOff, Printer, TrendingDown, Receipt, ExternalLink } from 'lucide-react';
import { startOfMonth, endOfMonth, startOfDay, parse, format, isValid } from 'date-fns';

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

const safeParse = (dateStr: string, formatStr: string, baseDate: Date) => {
  if (!dateStr) return baseDate;
  try {
    const d = parse(dateStr, formatStr, baseDate);
    if (!isValid(d)) return baseDate;
    return d;
  } catch (e) {
    return baseDate;
  }
};

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { activeBranchId, setActiveBranchId, branches } = useBranch();
  const currentBranch = branches.find(b => b.id === activeBranchId) || (branches.length > 0 ? branches[0] : null);
  const { enableDashboardEdit, enableBillEdit, dashboardOffsets, updateDashboardOffsets } = useSettings();
  
  const [sales, setSales] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [onlineEmployees, setOnlineEmployees] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  
  const now = new Date();
  const todayDateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const [selectedDailyDateStr, setSelectedDailyDateStr] = useState<string>(todayDateStr);
  const [selectedMonthStr, setSelectedMonthStr] = useState(`${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Don't clear states immediately to avoid flickering "empty" states if data comes back fast
    // Only reset if loading takes too long or when explicitly necessary
    
    let qSales: any = collection(db, 'sales');
    let qInv: any = collection(db, 'inventory');
    let qVendors: any = collection(db, 'vendors');
    let qCustomers: any = collection(db, 'customers');
    let qLedger: any = collection(db, 'ledger');
        
    if (activeBranchId) {
      qSales = query(qSales, where('branchId', '==', activeBranchId));
      qInv = query(qInv, where('branchId', '==', activeBranchId));
      qLedger = query(qLedger, where('branchId', '==', activeBranchId));
    }
    
    const tenantId = user?.tenantId || user?.uid;
    
    let salesLoaded = false;
    let invLoaded = false;
    let vendorsLoaded = false;
    let customersLoaded = false;
    let ledgerLoaded = false;
    let purchasesLoaded = false;

    const checkAllLoaded = () => {
      if (salesLoaded && invLoaded && vendorsLoaded && customersLoaded && ledgerLoaded && purchasesLoaded) {
        setLoading(false);
      }
    };
    
    const unsubSales = safeCollectionSnapshot(qSales, (snap) => {
      setSales(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      salesLoaded = true;
      checkAllLoaded();
    }, (err) => {
      console.error("Dashboard sales snapshot error:", err);
      setError(`Sales database query failed: ${err?.message || err}`);
      setLoading(false);
    });

    const unsubVendors = safeCollectionSnapshot(qVendors, (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      if (tenantId) {
        list = list.filter(v => !v.tenantId || v.tenantId === tenantId);
      }
      if (activeBranchId) {
        list = list.filter(v => !v.branchId || v.branchId === activeBranchId || (activeBranchId === 'main' && !v.branchId) || v.isCourier || v.isGlobal);
      }
      setVendors(list);
      vendorsLoaded = true;
      checkAllLoaded();
    });

    const unsubCustomers = safeCollectionSnapshot(qCustomers, (snap) => {
      let list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      if (tenantId) {
        list = list.filter(c => !c.tenantId || c.tenantId === tenantId);
      }
      if (activeBranchId) {
        // Support customers with matching branch, no branch (global), or main branch fallback
        list = list.filter(c => !c.branchId || c.branchId === activeBranchId || (activeBranchId === 'main' && !c.branchId));
      }
      setCustomers(list);
      customersLoaded = true;
      checkAllLoaded();
    });

    const unsubLedger = safeCollectionSnapshot(qLedger, (snap) => {
      setLedgerEntries(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      ledgerLoaded = true;
      checkAllLoaded();
    });

    let qPurchases: any = collection(db, 'purchases');
    if (tenantId) {
      qPurchases = query(qPurchases, where('tenantId', '==', tenantId));
    }
    if (activeBranchId) {
      qPurchases = query(qPurchases, where('branchId', '==', activeBranchId));
    }

    const unsubPurchases = safeCollectionSnapshot(qPurchases, (snap) => {
      setPurchases(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      purchasesLoaded = true;
      checkAllLoaded();
    });

    let qOnlineEmp: any = collection(db, 'onlineSalesEmployees');
    if (user?.tenantId || user?.uid) {
      qOnlineEmp = query(qOnlineEmp, where('tenantId', '==', user.tenantId || user.uid));
    }
    
    const unsubOnlineEmp = safeCollectionSnapshot(qOnlineEmp, (snap) => {
      let emps = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      if (activeBranchId) {
        emps = emps.filter(e => e.branchId === activeBranchId || (!e.branchId && activeBranchId === 'main'));
      }
      setOnlineEmployees(emps);
    });

    const unsubInv = safeCollectionSnapshot(qInv, (snap) => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      invLoaded = true;
      checkAllLoaded();
    }, (err) => {
      console.error("Dashboard inventory snapshot error:", err);
      setError(`Inventory database query failed: ${err?.message || err}`);
      setLoading(false);
    });
    
    // Set a safety timeout so if database is connecting slowly it doesn't get stuck forever
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 5000);
    
    return () => {
      clearTimeout(safetyTimer);
      unsubSales();
      unsubInv();
      unsubOnlineEmp();
      unsubVendors();
      unsubCustomers();
      unsubLedger();
      unsubPurchases();
    };
  }, [user, activeBranchId]);

  // Calculations
  const getSaleTime = (v: any) => {
    if (!v) return 0;
    if (typeof v.date === 'number' && !isNaN(v.date)) return v.date;
    if (typeof v.date === 'string') {
      const num = Number(v.date);
      if (!isNaN(num) && num > 1000000000) return num;
      const parsed = new Date(v.date).getTime();
      if (!isNaN(parsed)) return parsed;
    }
    if (v.date?.toDate && typeof v.date.toDate === 'function') return v.date.toDate().getTime();
    if (v.date?.toMillis && typeof v.date.toMillis === 'function') return v.date.toMillis();
    if (typeof v.date?.seconds === 'number') return v.date.seconds * 1000;
    
    if (v.createdAt?.toDate && typeof v.createdAt.toDate === 'function') return v.createdAt.toDate().getTime();
    if (v.createdAt?.toMillis && typeof v.createdAt.toMillis === 'function') return v.createdAt.toMillis();
    if (typeof v.createdAt?.seconds === 'number') return v.createdAt.seconds * 1000;
    if (typeof v.createdAt === 'string') {
      const num = Number(v.createdAt);
      if (!isNaN(num) && num > 1000000000) return num;
      const parsed = new Date(v.createdAt).getTime();
      if (!isNaN(parsed)) return parsed;
    }
    if (typeof v.createdAt === 'number' && !isNaN(v.createdAt)) return v.createdAt;
    return 0;
  };

  const isSaleOnDate = (saleDate: number, targetDateStr: string = selectedDailyDateStr) => {
    if (!saleDate) return false;
    const d = new Date(saleDate);
    if (isNaN(d.getTime())) return false;
    const dYear = d.getFullYear();
    const dMonth = (d.getMonth() + 1).toString().padStart(2, '0');
    const dDay = d.getDate().toString().padStart(2, '0');
    return `${dYear}-${dMonth}-${dDay}` === targetDateStr;
  };

  const isSaleInMonth = (saleDate: number, targetMonthStr: string = selectedMonthStr) => {
    if (!saleDate) return false;
    const d = new Date(saleDate);
    if (isNaN(d.getTime())) return false;
    const dYear = d.getFullYear();
    const dMonth = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${dYear}-${dMonth}` === targetMonthStr;
  };

  let dailySales = 0;
  let dailyProfit = 0;
  let dailyOnlineSales = 0;
  let dailyInStoreSales = 0;
  let dailyOnlineProfit = 0;
  let dailyInStoreProfit = 0;
  let dailyBills = 0;
  let dailySuits = 0;
  let lastDailyBillDate = '';
  let lastDailyOnlineDate = '';
  let lastDailyOnlineAmount = 0;
  let lastDailyInStoreDate = '';
  let lastDailyInStoreAmount = 0;

  let monthlySales = 0;
  let monthlyOnlineSales = 0;
  let monthlyInStoreSales = 0;
  let monthlyProfit = 0;
  let monthlyOnlineProfit = 0;
  let monthlyInStoreProfit = 0;
  let monthlyBills = 0;
  let monthlySuits = 0;
  let lastMonthlyBillDate = '';

  let totalSales = 0;
  let totalOnlineSales = 0;
  let totalInStoreSales = 0;
  let totalProfit = 0;
  let totalOnlineProfit = 0;
  let totalInStoreProfit = 0;
  let totalBills = 0;
  let totalSuits = 0;
  let lastTotalBillDate = '';

  const sortedSales = [...sales].sort((a, b) => {
    const da = getSaleTime(a);
    const db = getSaleTime(b);
    if (db !== da) return db - da; // Descending by time
    const getSeq = (inv: string) => {
      if (!inv) return 0;
      const p = String(inv).split('-');
      const s = parseInt(p[p.length - 1], 10);
      return isNaN(s) ? 0 : s;
    };
    return getSeq(b.invoiceNo) - getSeq(a.invoiceNo);
  });

  const formatDate = (ts: number) => {
    if (!ts || isNaN(ts)) return '';
    const d = new Date(ts);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
  };

  const getRealValues = (monthStr: string, dailyDateStr: string = selectedDailyDateStr) => {
    let rD = 0, rDP = 0, rDB = 0;
    let rM = 0, rMP = 0, rMB = 0;
    let rT = 0, rTP = 0, rTB = 0;

    sortedSales.forEach(sale => {
       const saleDate = getSaleTime(sale);
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
       
       rT += amount;
       rTP += profit;
       rTB++;
       
       if (isSaleInMonth(saleDate, monthStr)) {
         rM += amount;
         rMP += profit;
         rMB++;
       }
       
       if (isSaleOnDate(saleDate, dailyDateStr)) {
         rD += amount;
         rDP += profit;
         rDB++;
       }
    });
    
    return { rD, rDP, rDB, rM, rMP, rMB, rT, rTP, rTB };
  };

  if (sortedSales.length > 0) {
    const ts = getSaleTime(sortedSales[0]);
    lastTotalBillDate = formatDate(ts);
    
    // Find last daily bill on selected date
    const dailySale = sortedSales.find(s => {
      const saleDate = getSaleTime(s);
      return isSaleOnDate(saleDate, selectedDailyDateStr);
    });
    if (dailySale) {
      const ts = getSaleTime(dailySale);
      lastDailyBillDate = formatDate(ts);
    } else {
      const targetTs = safeParse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime();
      lastDailyBillDate = formatDate(targetTs);
    }

    const absoluteLastOnlineSale = sortedSales.find(s => s.saleType === 'Online' && s.transactionType !== 'Return');
    if (absoluteLastOnlineSale) {
      lastDailyOnlineDate = formatDate(getSaleTime(absoluteLastOnlineSale));
      lastDailyOnlineAmount = Number(absoluteLastOnlineSale.total) || 0;
    }

    const absoluteLastInStoreSale = sortedSales.find(s => s.saleType !== 'Online' && s.transactionType !== 'Return');
    if (absoluteLastInStoreSale) {
      lastDailyInStoreDate = formatDate(getSaleTime(absoluteLastInStoreSale));
      lastDailyInStoreAmount = Number(absoluteLastInStoreSale.total) || 0;
    }

    // Find last monthly bill within selected month
    const monthlySale = sortedSales.find(s => {
      const saleDate = getSaleTime(s);
      return isSaleInMonth(saleDate, selectedMonthStr);
    });
    if (monthlySale) {
      const ts = getSaleTime(monthlySale);
      lastMonthlyBillDate = formatDate(ts);
    }
  }

  sortedSales.forEach(sale => {
    const saleDate = getSaleTime(sale);
    const isReturn = sale.transactionType === 'Return';
    const amount = isReturn ? -Math.abs(Number(sale.total) || 0) : (Number(sale.total) || 0);
    
    // Suit count
    const suitsInSale = (sale.items || []).reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0);
    const suitsInReturn = (sale.returnItems || []).reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0);
    const netSuits = isReturn ? -Math.abs(suitsInSale || suitsInReturn) : (suitsInSale - suitsInReturn);

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

    totalSales += amount;
    totalSuits += netSuits;
    if (sale.saleType === 'Online') {
      totalOnlineSales += amount;
      totalOnlineProfit += profit;
    } else {
      totalInStoreSales += amount;
      totalInStoreProfit += profit;
    }
    totalProfit += profit;
    totalBills++;

    if (isSaleInMonth(saleDate, selectedMonthStr)) {
      monthlySales += amount;
      monthlySuits += netSuits;
      if (sale.saleType === 'Online') {
        monthlyOnlineSales += amount;
        monthlyOnlineProfit += profit;
      } else {
        monthlyInStoreSales += amount;
        monthlyInStoreProfit += profit;
      }
      monthlyProfit += profit;
      monthlyBills++;
    }
    
    if (isSaleOnDate(saleDate, selectedDailyDateStr)) {
      dailySales += amount;
      dailyProfit += profit;
      dailySuits += netSuits;
      if (sale.saleType === 'Online') { 
        dailyOnlineProfit += profit; 
        dailyOnlineSales += amount; 
      } else { 
        dailyInStoreProfit += profit; 
        dailyInStoreSales += amount; 
      }
      dailyBills++;
    }
  });

  // Only apply offsets if dashboard editing is explicitly enabled by Super Admin
  const activeOffsets = (enableDashboardEdit && activeBranchId) 
    ? (dashboardOffsets?.branches?.[activeBranchId] || {}) 
    : (enableDashboardEdit ? dashboardOffsets : null);

  if (enableDashboardEdit && activeOffsets) {
    if (activeOffsets.dailyOffsetDate === selectedDailyDateStr) {
      dailySales += Number(activeOffsets.dailySales || 0);
      dailyProfit += Number(activeOffsets.dailyProfit || 0);
      if (activeOffsets.dailyBills !== undefined && activeOffsets.dailyBills !== '') dailyBills += Number(activeOffsets.dailyBills);
      if (activeOffsets.lastDailyBillDate) lastDailyBillDate = activeOffsets.lastDailyBillDate;
    }
    
    totalSales += Number(activeOffsets.totalSales || 0);
    totalProfit += Number(activeOffsets.totalProfit || 0);
    
    let mSales = Number(activeOffsets[`monthlySales_${selectedMonthStr}`] || 0);
    let mProfit = Number(activeOffsets[`monthlyProfit_${selectedMonthStr}`] || 0);
    
    monthlySales += mSales;
    monthlyProfit += mProfit;

    let mBills = activeOffsets[`monthlyBills_${selectedMonthStr}`];
    if (mBills !== undefined && mBills !== '') monthlyBills += Number(mBills);

    let mBillDate = activeOffsets[`lastMonthlyBillDate_${selectedMonthStr}`];
    if (mBillDate) lastMonthlyBillDate = mBillDate;

    if (activeOffsets.totalBills !== undefined && activeOffsets.totalBills !== '') totalBills += Number(activeOffsets.totalBills);
    if (activeOffsets.lastTotalBillDate) lastTotalBillDate = activeOffsets.lastTotalBillDate;
  }

  // Prevent profit from displaying as negative
  dailyProfit = Math.max(0, dailyProfit);
  monthlyProfit = Math.max(0, monthlyProfit);
  totalProfit = Math.max(0, totalProfit);

  const formatCurrency = (val: number) => {
    return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  };

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [modalSaleTab, setModalSaleTab] = useState<'all' | 'instore' | 'online'>('all');
  const [isEditingOffsets, setIsEditingOffsets] = useState(false);

  const formatMonthName = (monthStr: string) => {
    if (!monthStr) return '';
    try {
      const d = safeParse(monthStr, 'yyyy-MM', new Date());
      return safeFormat(d, 'MMMM yyyy');
    } catch (e) {
      return monthStr;
    }
  };

  const formatDateTime = (ts: number) => {
    if (!ts) return '-';
    try {
      const d = new Date(ts);
      return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (e) {
      return '-';
    }
  };

  const getSuitsInSale = (sale: any) => {
    const suitsInSale = (sale.items || []).reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0);
    const suitsInReturn = (sale.returnItems || []).reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0);
    const isReturn = sale.transactionType === 'Return';
    return isReturn ? -Math.abs(suitsInSale || suitsInReturn) : (suitsInSale - suitsInReturn);
  };

  const getNetSaleAmount = (sale: any) => {
    const isReturn = sale.transactionType === 'Return';
    return isReturn ? -Math.abs(Number(sale.total) || 0) : (Number(sale.total) || 0);
  };

  const monthlyTransactions = sortedSales.filter(sale => {
    const saleDate = getSaleTime(sale);
    return isSaleInMonth(saleDate, selectedMonthStr);
  });

  const monthlyInStoreTransactions = monthlyTransactions.filter(sale => sale.saleType !== 'Online');
  const monthlyOnlineTransactions = monthlyTransactions.filter(sale => sale.saleType === 'Online');

  const inStoreSuitsCount = monthlyInStoreTransactions.reduce((acc, s) => {
    const suitsInSale = (s.items || []).reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const suitsInReturn = (s.returnItems || []).reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const isReturn = s.transactionType === 'Return';
    return acc + (isReturn ? -Math.abs(suitsInSale || suitsInReturn) : (suitsInSale - suitsInReturn));
  }, 0);

  const onlineSuitsCount = monthlyOnlineTransactions.reduce((acc, s) => {
    const suitsInSale = (s.items || []).reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const suitsInReturn = (s.returnItems || []).reduce((sum: number, it: any) => sum + (Number(it.qty) || 0), 0);
    const isReturn = s.transactionType === 'Return';
    return acc + (isReturn ? -Math.abs(suitsInSale || suitsInReturn) : (suitsInSale - suitsInReturn));
  }, 0);

  const activeBranch = branches.find((b: any) => b.id === activeBranchId) || (branches.length > 0 ? branches[0] : null);
  const branchDisplayName = activeBranch?.name || 'Branch';
  
  // Profit Password Lock State
  const [showProfitPrompt, setShowProfitPrompt] = useState(false);
  const [profitPasswordInput, setProfitPasswordInput] = useState('');
  const [showProfitPassword, setShowProfitPassword] = useState(false);
  const [profitPromptError, setProfitPromptError] = useState('');
  const [pendingBoxId, setPendingBoxId] = useState<string | null>(null);

  const handleUnlockProfitBox = (e: React.FormEvent) => {
    e.preventDefault();
    if (profitPasswordInput === 'superadmin@@') {
      sessionStorage.setItem('profit_loss_unlocked', 'true');
      setShowProfitPrompt(false);
      setProfitPasswordInput('');
      setProfitPromptError('');
      if (pendingBoxId) {
        setModalSaleTab('all');
        setActiveModal(pendingBoxId);
        setPendingBoxId(null);
      }
    } else {
      setProfitPromptError('Incorrect password! Please try again.');
    }
  };

  const handleBoxClick = (boxId: string) => {
    if (enableDashboardEdit) {
      handleEditClick();
    } else {
      if (boxId.includes('profit') && sessionStorage.getItem('profit_loss_unlocked') !== 'true') {
        setPendingBoxId(boxId);
        setProfitPasswordInput('');
        setProfitPromptError('');
        setShowProfitPrompt(true);
        return;
      }
      setModalSaleTab('all');
      setActiveModal(boxId);
    }
  };
  const [offsetsForm, setOffsetsForm] = useState<any>({});
  const [editMonth, setEditMonth] = useState('');

  useEffect(() => {
    if (isEditingOffsets) {
      const activeOffsets = activeBranchId 
        ? (dashboardOffsets?.branches?.[activeBranchId] || {}) 
        : dashboardOffsets;
      
      const reals = getRealValues(editMonth);
      let mSalesOffset = Number(activeOffsets?.[`monthlySales_${editMonth}`] || 0);
      let mProfitOffset = Number(activeOffsets?.[`monthlyProfit_${editMonth}`] || 0);
      let mBillsOffset = Number(activeOffsets?.[`monthlyBills_${editMonth}`] || 0);
      
      if (editMonth === '2026-05') {
         if (activeOffsets?.monthlySales !== undefined && !activeOffsets?.[`monthlySales_${editMonth}`]) mSalesOffset = Number(activeOffsets.monthlySales || 0);
         if (activeOffsets?.monthlyProfit !== undefined && !activeOffsets?.[`monthlyProfit_${editMonth}`]) mProfitOffset = Number(activeOffsets.monthlyProfit || 0);
         if (activeOffsets?.monthlyBills !== undefined && activeOffsets?.[`monthlyBills_${editMonth}`] === undefined) mBillsOffset = Number(activeOffsets.monthlyBills || 0);
      }
      
      setOffsetsForm({
        dailySales: reals.rD + Number(activeOffsets?.dailySales || 0),
        dailyProfit: reals.rDP + Number(activeOffsets?.dailyProfit || 0),
        dailyBills: reals.rDB + Number(activeOffsets?.dailyBills || 0),
        
        [`monthlySales_${editMonth}`]: reals.rM + mSalesOffset,
        [`monthlyProfit_${editMonth}`]: reals.rMP + mProfitOffset,
        [`monthlyBills_${editMonth}`]: reals.rMB + mBillsOffset,
        
        totalSales: reals.rT + Number(activeOffsets?.totalSales || 0),
        totalProfit: reals.rTP + Number(activeOffsets?.totalProfit || 0),
        totalBills: reals.rTB + Number(activeOffsets?.totalBills || 0),
      });
    }
  }, [isEditingOffsets, editMonth, dashboardOffsets, activeBranchId]);

  const handleEditClick = () => {
    setEditMonth(selectedMonthStr);
    setIsEditingOffsets(true);
  };

  const handleSaveOffsets = () => {
    const reals = getRealValues(editMonth);
    const newOffsets = { ...dashboardOffsets };
    const activeOffsets = activeBranchId ? { ...(newOffsets.branches?.[activeBranchId] || {}) } : newOffsets;
    
    if (offsetsForm.dailySales === '' || isNaN(Number(offsetsForm.dailySales))) activeOffsets.dailySales = 0; else activeOffsets.dailySales = Number(offsetsForm.dailySales) - reals.rD;
    if (offsetsForm.dailyProfit === '' || isNaN(Number(offsetsForm.dailyProfit))) activeOffsets.dailyProfit = 0; else activeOffsets.dailyProfit = Number(offsetsForm.dailyProfit) - reals.rDP;
    if (offsetsForm.dailyBills === '' || isNaN(Number(offsetsForm.dailyBills))) activeOffsets.dailyBills = 0; else activeOffsets.dailyBills = Number(offsetsForm.dailyBills) - reals.rDB;
    activeOffsets.dailyOffsetDate = todayDateStr;
    
    if (offsetsForm[`monthlySales_${editMonth}`] === '' || isNaN(Number(offsetsForm[`monthlySales_${editMonth}`]))) activeOffsets[`monthlySales_${editMonth}`] = 0; else activeOffsets[`monthlySales_${editMonth}`] = Number(offsetsForm[`monthlySales_${editMonth}`]) - reals.rM;
    if (offsetsForm[`monthlyProfit_${editMonth}`] === '' || isNaN(Number(offsetsForm[`monthlyProfit_${editMonth}`]))) activeOffsets[`monthlyProfit_${editMonth}`] = 0; else activeOffsets[`monthlyProfit_${editMonth}`] = Number(offsetsForm[`monthlyProfit_${editMonth}`]) - reals.rMP;
    if (offsetsForm[`monthlyBills_${editMonth}`] === '' || isNaN(Number(offsetsForm[`monthlyBills_${editMonth}`]))) activeOffsets[`monthlyBills_${editMonth}`] = 0; else activeOffsets[`monthlyBills_${editMonth}`] = Number(offsetsForm[`monthlyBills_${editMonth}`]) - reals.rMB;
    
    if (offsetsForm.totalSales === '' || isNaN(Number(offsetsForm.totalSales))) activeOffsets.totalSales = 0; else activeOffsets.totalSales = Number(offsetsForm.totalSales) - reals.rT;
    if (offsetsForm.totalProfit === '' || isNaN(Number(offsetsForm.totalProfit))) activeOffsets.totalProfit = 0; else activeOffsets.totalProfit = Number(offsetsForm.totalProfit) - reals.rTP;
    if (offsetsForm.totalBills === '' || isNaN(Number(offsetsForm.totalBills))) activeOffsets.totalBills = 0; else activeOffsets.totalBills = Number(offsetsForm.totalBills) - reals.rTB;
    
    if (activeBranchId) {
      if (!newOffsets.branches) newOffsets.branches = {};
      newOffsets.branches[activeBranchId] = activeOffsets;
    }
    
    updateDashboardOffsets(newOffsets);
    setIsEditingOffsets(false);
  };

  const handleResetToReal = () => {
    const newOffsets = { ...dashboardOffsets };
    if (activeBranchId) {
      if (newOffsets.branches) {
        delete newOffsets.branches[activeBranchId];
      }
    } else {
      updateDashboardOffsets({});
      setIsEditingOffsets(false);
      return;
    }
    updateDashboardOffsets(newOffsets);
    setIsEditingOffsets(false);
  };

  let stockValue = 0;
  const lowStockItems: any[] = [];
  
  inventory.forEach(item => {
    stockValue += (item.stock || 0) * (item.cost || 0);
    if ((item.stock || 0) <= (item.minStockLevel || 0)) {
      lowStockItems.push(item);
    }
  });

  // Optimized Party Balances Calculation
  const { customerBalMap, vendorBalMap } = React.useMemo(() => {
    const cMap: Record<string, number> = {};
    const vMap: Record<string, number> = {};
    
    ledgerEntries.forEach(e => {
      const amount = Number(e.amount) || 0;
      if (e.customerId) {
        if (!cMap[e.customerId]) cMap[e.customerId] = 0;
        cMap[e.customerId] += (e.type === 'IN' ? amount : -amount);
      }
      if (e.vendorId) {
        if (!vMap[e.vendorId]) vMap[e.vendorId] = 0;
        vMap[e.vendorId] += (e.type === 'IN' ? amount : -amount);
      }
    });
    return { customerBalMap: cMap, vendorBalMap: vMap };
  }, [ledgerEntries]);

  const getVendorBalance = (vendorId: string) => {
    return vendorBalMap[vendorId] || 0;
  };

  const vendorBalances = React.useMemo(() => vendors.map(v => ({
    ...v,
    balance: getVendorBalance(v.id)
  })), [vendors, vendorBalMap]);

  const totalVendorPayableOnly = React.useMemo(() => vendorBalances.filter(v => v.balance < 0).reduce((sum, v) => sum + Math.abs(v.balance), 0), [vendorBalances]);
  const totalVendorReceivableOnly = React.useMemo(() => vendorBalances.filter(v => v.balance > 0).reduce((sum, v) => sum + v.balance, 0), [vendorBalances]);
  const totalVendorPayable = React.useMemo(() => vendorBalances.reduce((sum, v) => sum + v.balance, 0), [vendorBalances]);

  const getCustomerBalance = (customerId: string) => {
    return customerBalMap[customerId] || 0;
  };

  const customerBalances = React.useMemo(() => customers.map(c => ({
    ...c,
    balance: getCustomerBalance(c.id)
  })), [customers, customerBalMap]);

  const totalCustomerReceivable = React.useMemo(() => customerBalances.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0), [customerBalances]);
  const totalCustomerPrepaid = React.useMemo(() => customerBalances.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0), [customerBalances]);
  
  // Expenses, Labour & Purchase Calculations
  const expenseEntries = React.useMemo(() => {
    return ledgerEntries.filter(entry => {
      const cat = entry.category || '';
      return cat === 'Expense' || cat === 'General Expense' || (cat.toLowerCase().includes('expense') && entry.type === 'OUT');
    });
  }, [ledgerEntries]);

  const dailyExpenseEntries = React.useMemo(() => {
    return expenseEntries.filter(entry => {
      const entryDate = getSaleTime(entry);
      return isSaleOnDate(entryDate, selectedDailyDateStr);
    });
  }, [expenseEntries, selectedDailyDateStr]);

  const monthlyExpenseEntries = React.useMemo(() => {
    return expenseEntries.filter(entry => {
      const entryDate = getSaleTime(entry);
      return isSaleInMonth(entryDate, selectedMonthStr);
    });
  }, [expenseEntries, selectedMonthStr]);

  const dailyExpenses = React.useMemo(() => {
    return dailyExpenseEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [dailyExpenseEntries]);

  const monthlyExpenses = React.useMemo(() => {
    return monthlyExpenseEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [monthlyExpenseEntries]);

  const totalExpenses = React.useMemo(() => {
    return expenseEntries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [expenseEntries]);

  let totalLabour = 0;
  let monthlyLabour = 0;
  let dailyLabour = 0;

  ledgerEntries.forEach(entry => {
    const entryDate = getSaleTime(entry);
    const amount = Number(entry.amount) || 0;
    
    if (entry.category === 'Salary' || entry.category === 'Advance') {
      totalLabour += amount;
      if (isSaleInMonth(entryDate, selectedMonthStr)) monthlyLabour += amount;
      if (isSaleOnDate(entryDate, selectedDailyDateStr)) dailyLabour += amount;
    }
  });
  
  let totalPurchasesValue = 0;
  let monthlyPurchasesValue = 0;
  let dailyPurchasesValue = 0;
  
  purchases.forEach(p => {
    const pDate = p.date || 0;
    const amount = Number(p.total) || 0;
    totalPurchasesValue += amount;
    if (isSaleInMonth(pDate)) monthlyPurchasesValue += amount;
    if (isSaleOnDate(pDate)) dailyPurchasesValue += amount;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Main on-screen Dashboard UI (hidden in print when monthly sale modal is printing) */}
      <div className={activeModal === 'monthly-sale' ? "space-y-6 print:hidden" : "space-y-6"}>
        {error && (
        <div className="bg-rose-100 text-rose-800 p-4 rounded-xl border border-rose-300 shadow-sm flex flex-col gap-1">
          <p className="font-bold flex items-center gap-2">
            <X className="w-5 h-5 text-rose-600" /> Database Connection Error:
          </p>
          <p className="text-sm font-mono whitespace-pre-wrap">{error}</p>
          {error.includes('session issue') && (
            <div className="mt-1 border-t border-rose-200 pt-2">
               <button 
                onClick={() => window.open(window.location.href, '_blank')}
                className="bg-rose-600 text-white px-3 py-1 rounded text-[10px] font-bold hover:bg-rose-700"
              >
                Open in New Tab to Fix Auth
              </button>
            </div>
          )}
        </div>
      )}

      {loading && !error && (
        <div className="bg-sky-50 text-sky-700 p-4 rounded-xl border border-sky-100 shadow-sm flex items-center gap-3 animate-pulse">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 animate-ping" />
          <span className="text-sm font-medium">Fetching real-time business statistics from Neon Postgres...</span>
        </div>
      )}
      
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Overview Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Real-time business statistics</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Daily Date Selector */}
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/70 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 pl-2 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-sky-500" />
                <span>Date:</span>
              </label>
              <input
                type="date"
                value={selectedDailyDateStr}
                onChange={(e) => setSelectedDailyDateStr(e.target.value)}
                className="rounded-md border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 bg-white dark:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none cursor-pointer"
              />
              {selectedDailyDateStr !== todayDateStr && (
                <button
                  type="button"
                  onClick={() => setSelectedDailyDateStr(todayDateStr)}
                  className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 dark:bg-sky-950 dark:text-sky-300 font-bold px-2 py-1.5 rounded transition-colors"
                  title="Reset to Today"
                >
                  Today
                </button>
              )}
            </div>

            {/* Month Selector */}
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/70 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 pl-2">Month:</label>
              <input
                type="month"
                value={selectedMonthStr}
                onChange={(e) => setSelectedMonthStr(e.target.value)}
                className="rounded-md border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 bg-white dark:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none cursor-pointer"
              />
            </div>

            {/* Default Logged-In Branch Display */}
            {currentBranch && (
              <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/70 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <span className="text-[11px] text-slate-400 font-bold uppercase">Branch:</span>
                <span className="text-sky-600 dark:text-sky-400 font-bold">{currentBranch.name}</span>
              </div>
            )}

            {user?.role === 'super_admin' && enableDashboardEdit && (
              <button
                onClick={handleEditClick}
                className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg text-sm font-medium shadow-sm hover:bg-slate-900 dark:hover:bg-slate-200 transition-colors shrink-0"
              >
                <Settings className="w-4 h-4" />
                Edit
              </button>
            )}
          </div>
        </div>

      {user?.role !== 'limited_access' && user?.role !== 'cashier' && lowStockItems.length > 0 && (
        <div className="bg-rose-50 text-rose-600 rounded-lg p-6 mb-6 border border-rose-100">
          <p className="font-bold mb-3">{lowStockItems.length} items are at or below minimum stock levels:</p>
          <div className="flex flex-wrap gap-2">
            {lowStockItems.slice(0, 10).map(item => (
              <span key={item.id} className="text-xs bg-white dark:bg-slate-900 text-rose-700 px-2.5 py-1 rounded border border-rose-200 font-semibold shadow-sm">
                {item.name} ({item.stock} left)
              </span>
            ))}
            {lowStockItems.length > 10 && (
              <span className="text-xs bg-rose-100 text-rose-800 px-2.5 py-1 rounded border border-rose-200 font-bold shadow-sm">
                +{lowStockItems.length - 10} more items
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
                                        {/* Daily Sale */}
        <div onClick={() => handleBoxClick("daily-sale")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Daily Sale</h3>
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className="text-lg sm:text-3xl font-extrabold text-slate-800 dark:text-slate-100">PKR {formatCurrency(dailySales)}</div>
            <span className="block text-[9px] sm:text-[10px] font-bold text-slate-400 mb-1 mt-1 tracking-wider uppercase">
              {formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())}
              {selectedDailyDateStr === todayDateStr ? ' (TODAY)' : ''}
            </span>
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 dark:text-indigo-300 inline-block px-2 sm:px-2.5 py-0.5 rounded-full w-fit">{dailySuits} Suits ({dailyBills} Bills)</div>
              <div className="text-[10px] sm:text-xs font-medium text-emerald-600 bg-emerald-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">In-Store: PKR {formatCurrency(dailyInStoreSales)}</div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Online: PKR {formatCurrency(dailyOnlineSales)}</div>
            </div>
          </div>
        </div>
        {/* Daily Profit */}
        {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'new_limited_access' && user?.role !== 'cashier' && (
        <div onClick={() => handleBoxClick("daily-profit")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Daily Profit</h3>
            <Lock className="w-3.5 h-3.5 text-amber-500/80" />
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className="text-lg sm:text-3xl font-extrabold text-slate-800 dark:text-slate-100">PKR {formatCurrency(dailyProfit)}</div>
            <span className="block text-[9px] sm:text-[10px] font-bold text-slate-400 mb-1 mt-1 tracking-wider uppercase">
              {formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())}
              {selectedDailyDateStr === todayDateStr ? ' (TODAY)' : ''}
            </span>
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-medium text-emerald-600 bg-emerald-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">In-Store: PKR {formatCurrency(dailyInStoreProfit)}</div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Online: PKR {formatCurrency(dailyOnlineProfit)}</div>
            </div>
          </div>
        </div>
        )}
        {/* Daily Expense */}
        {user?.role !== 'sales_stock_only' && user?.role !== 'limited_access' && (
        <div 
          onClick={() => handleBoxClick("daily-expense")} 
          className="card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-rose-200"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-rose-600 dark:text-rose-400 uppercase flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-rose-500" />
              <span>Daily Expense</span>
            </h3>
            <span className="text-[10px] font-bold text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-800">
              آج کا خرچہ
            </span>
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className={`text-lg sm:text-3xl font-extrabold ${dailyExpenses > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
              PKR {formatCurrency(dailyExpenses)}
            </div>
            <span className="block text-[9px] sm:text-[10px] font-bold text-slate-400 mb-1 mt-1 tracking-wider uppercase">
              {formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())}
              {selectedDailyDateStr === todayDateStr ? ' (TODAY)' : ''}
            </span>
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-bold text-rose-700 bg-rose-50 dark:bg-rose-950/60 dark:text-rose-300 inline-block px-2 sm:px-2.5 py-0.5 rounded-full w-fit">
                {dailyExpenseEntries.length} Items ({dailyExpenses > 0 ? 'Recorded' : 'Zero'})
              </div>
              <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 inline-block px-2 sm:px-2.5 py-0.5 rounded-full w-fit">
                Daily Resets to 0
              </div>
            </div>
          </div>
        </div>
        )}
        {/* Monthly Sale */}
        {user?.role !== 'sales_stock_only' && user?.role !== 'cashier' && user?.role !== 'limited_access' && (
        <div onClick={() => handleBoxClick("monthly-sale")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Monthly Sale</h3>
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className="text-lg sm:text-3xl font-extrabold text-slate-800 dark:text-slate-100">PKR {formatCurrency(monthlySales)}</div>
            {lastMonthlyBillDate && (<span className="block text-[9px] sm:text-[10px] font-bold text-slate-400 mb-1 mt-1 tracking-wider uppercase">{lastMonthlyBillDate}</span>)}
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-bold text-purple-700 bg-purple-50 dark:bg-purple-950/60 dark:text-purple-300 inline-block px-2 sm:px-2.5 py-0.5 rounded-full w-fit">{monthlySuits} Suits ({monthlyBills} Bills)</div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Online: PKR {formatCurrency(monthlyOnlineSales)}</div>
            </div>
          </div>
        </div>
        )}
        {/* Monthly Profit */}
        {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'new_limited_access' && user?.role !== 'cashier' && (
        <div onClick={() => handleBoxClick("monthly-profit")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Monthly Profit</h3>
            <Lock className="w-3.5 h-3.5 text-amber-500/80" />
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className="text-lg sm:text-3xl font-extrabold text-slate-800 dark:text-slate-100">PKR {formatCurrency(monthlyProfit)}</div>
            {lastMonthlyBillDate && (<span className="block text-[9px] sm:text-[10px] font-bold text-slate-400 mb-1 mt-1 tracking-wider uppercase">{lastMonthlyBillDate}</span>)}
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-medium text-emerald-600 bg-emerald-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Sales: PKR {formatCurrency(monthlySales)}</div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Online: PKR {formatCurrency(monthlyOnlineProfit)}</div>
            </div>
          </div>
        </div>
        )}
        {/* Monthly Expense */}
        {user?.role !== 'sales_stock_only' && user?.role !== 'limited_access' && (
        <div 
          onClick={() => handleBoxClick("monthly-expense")} 
          className="card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-rose-200"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-rose-600 dark:text-rose-400 uppercase flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-rose-500" />
              <span>Monthly Expense</span>
            </h3>
            <span className="text-[10px] font-bold text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-800">
              اس ماہ کا خرچہ
            </span>
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className={`text-lg sm:text-3xl font-extrabold ${monthlyExpenses > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
              PKR {formatCurrency(monthlyExpenses)}
            </div>
            <span className="block text-[9px] sm:text-[10px] font-bold text-slate-400 mb-1 mt-1 tracking-wider uppercase">
              {formatMonthName(selectedMonthStr)}
            </span>
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-bold text-rose-700 bg-rose-50 dark:bg-rose-950/60 dark:text-rose-300 inline-block px-2 sm:px-2.5 py-0.5 rounded-full w-fit">
                {monthlyExpenseEntries.length} Items ({formatMonthName(selectedMonthStr)})
              </div>
              <div className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 inline-block px-2 sm:px-2.5 py-0.5 rounded-full w-fit">
                {Array.from(new Set(monthlyExpenseEntries.map(e => e.reference || 'General'))).length} Accounts
              </div>
            </div>
          </div>
        </div>
        )}
        {/* Total Revenue */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div onClick={() => handleBoxClick("total-sale")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Total Revenue</h3>
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className="text-lg sm:text-3xl font-extrabold text-slate-800 dark:text-slate-100">PKR {formatCurrency(totalSales)}</div>
            {lastTotalBillDate && (<span className="block text-[9px] sm:text-[10px] font-bold text-slate-400 mb-1 mt-1 tracking-wider uppercase">{lastTotalBillDate}</span>)}
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 dark:text-indigo-300 inline-block px-2 sm:px-2.5 py-0.5 rounded-full w-fit">{totalSuits} Suits ({totalBills} Bills)</div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Online: PKR {formatCurrency(totalOnlineSales)}</div>
            </div>
          </div>
        </div>
        )}
        {/* Overall Profit */}
        {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'new_limited_access' && user?.role !== 'cashier' && (
        <div onClick={() => handleBoxClick("total-profit")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Overall Profit</h3>
            <Lock className="w-3.5 h-3.5 text-amber-500/80" />
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className="text-lg sm:text-3xl font-extrabold text-slate-800 dark:text-slate-100">PKR {formatCurrency(totalProfit)}</div>
            {lastTotalBillDate && (<span className="block text-[9px] sm:text-[10px] font-bold text-slate-400 mb-1 mt-1 tracking-wider uppercase">{lastTotalBillDate}</span>)}
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-medium text-emerald-600 bg-emerald-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Sales: PKR {formatCurrency(totalSales)}</div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Online: PKR {formatCurrency(totalOnlineProfit)}</div>
            </div>
          </div>
        </div>
        )}

        {/* Stock Value */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div onClick={() => handleBoxClick("stock")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Stock Value</h3>
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className="text-lg sm:text-3xl font-extrabold text-slate-800 dark:text-slate-100">PKR {formatCurrency(stockValue)}</div>
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-medium text-purple-600 bg-purple-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Items: {inventory.length}</div>
              <div className="text-[10px] sm:text-xs font-medium text-rose-600 bg-rose-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Low Stock: {lowStockItems.length}</div>
            </div>
          </div>
        </div>
        )}

        {/* Total Payable */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div onClick={() => handleBoxClick("vendor-payable")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Total Payable</h3>
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className={`text-lg sm:text-3xl font-extrabold ${(totalVendorPayableOnly + totalCustomerPrepaid) > 0 ? 'text-rose-600' : 'text-slate-800 dark:text-slate-100'}`}>
              PKR {formatCurrency(totalVendorPayableOnly + totalCustomerPrepaid)}
            </div>
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-medium text-rose-500 bg-rose-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">
                دینا ہے
              </div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Vendors: {vendorBalances.filter(v => v.balance < 0).length}</div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Customers: {customerBalances.filter(c => c.balance > 0).length}</div>
            </div>
          </div>
        </div>
        )}

        {/* Total Receivable */}
        {((user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && user?.role !== 'cashier') || user?.role === 'new_limited_access') && (
        <div onClick={() => handleBoxClick("vendor-receivable")} className={`card p-4 sm:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800/50 relative overflow-hidden flex flex-col justify-between min-h-[140px] sm:h-[160px] gap-2 sm:gap-0 cursor-pointer hover:shadow-md transition-shadow ring-2 ring-transparent hover:ring-sky-200`}>
          <div>
            <h3 className="text-xs sm:text-sm font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">Total Receivable</h3>
          </div>
          <div className="mt-4 flex flex-col justify-end flex-grow">
            <div className={`text-lg sm:text-3xl font-extrabold ${(totalVendorReceivableOnly + totalCustomerReceivable) > 0 ? 'text-emerald-600' : 'text-slate-800 dark:text-slate-100'}`}>
              PKR {formatCurrency(totalVendorReceivableOnly + totalCustomerReceivable)}
            </div>
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-2">
              <div className="text-[10px] sm:text-xs font-medium text-emerald-600 bg-emerald-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">
                Total Receivable (لینا ہے)
              </div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Vendors: {vendorBalances.filter(v => v.balance > 0).length}</div>
              <div className="text-[10px] sm:text-xs font-medium text-sky-600 bg-sky-50 inline-block px-2 sm:px-3 py-1 rounded-full w-fit">Customers: {customerBalances.filter(c => c.balance < 0).length}</div>
            </div>
          </div>
        </div>
        )}
      </div>
      {user?.role !== 'limited_access' && user?.role !== 'sales_stock_only' && (
      <div className="card mt-8 bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-xl text-slate-700 dark:text-slate-200">
          <h2 className="text-lg font-bold italic tracking-wide uppercase">Real-Time Sales Activity</h2>
          <Link to="/sales" className="px-4 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium">VIEW ALL</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800/50">
                <th className="p-4 text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">TXN ID</th>
                <th className="p-4 text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">CUSTOMER</th>
                <th className="p-4 text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">DATE</th>
                <th className="p-4 text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">AMOUNT</th>
                <th className="p-4 text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {sortedSales.slice(0, 5).map(sale => {
                const saleDate = sale.date || 0;
                return (
                  <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="p-4 text-sm font-medium text-slate-700 dark:text-slate-200">{sale.id.slice(-6).toUpperCase()}</td>
                    <td className="p-4 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || 'Walk-in'}</td>
                    <td className="p-4 text-sm text-slate-500 dark:text-slate-400">{saleDate.toLocaleString()}</td>
                    <td className="p-4 text-sm font-semibold text-slate-700 dark:text-slate-200">PKR {formatCurrency(sale.total || 0)}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        sale.transactionType === 'Return' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {sale.transactionType === 'Return' ? 'RETURNED' : 'COMPLETED'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {sortedSales.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500 dark:text-slate-400">No recent activity</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Edit Offsets Modal */}
      {isEditingOffsets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Edit Dashboard Values</h2>
              <button onClick={() => setIsEditingOffsets(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-sky-50 p-3 rounded border border-sky-100 mb-4">
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  <strong>How it works:</strong> Enter the exact final value you want to see on the dashboard. It will automatically update as you make new sales. To revert a field to its real calculated value, <strong>clear it completely</strong> (leave it empty).
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {enableDashboardEdit && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Daily Sales</label>
                      <input type="number" value={offsetsForm.dailySales ?? ''} onChange={e => setOffsetsForm({...offsetsForm, dailySales: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Daily Profit</label>
                      <input type="number" value={offsetsForm.dailyProfit ?? ''} onChange={e => setOffsetsForm({...offsetsForm, dailyProfit: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Total Revenue</label>
                      <input type="number" value={offsetsForm.totalSales ?? ''} onChange={e => setOffsetsForm({...offsetsForm, totalSales: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Overall Profit</label>
                      <input type="number" value={offsetsForm.totalProfit ?? ''} onChange={e => setOffsetsForm({...offsetsForm, totalProfit: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" />
                    </div>
                  </>
                )}
                
                {enableDashboardEdit && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Daily Bills Count</label>
                      <input type="number" value={offsetsForm.dailyBills ?? ''} onChange={e => setOffsetsForm({...offsetsForm, dailyBills: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" placeholder="Auto" />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Total Bills Count</label>
                      <input type="number" value={offsetsForm.totalBills ?? ''} onChange={e => setOffsetsForm({...offsetsForm, totalBills: e.target.value})} className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" placeholder="Auto" />
                    </div>
                    
                  </>
                )}
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/50">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100">Monthly Offsets</h3>
                  <input 
                    type="month" 
                    value={editMonth} 
                    onChange={(e) => setEditMonth(e.target.value)} 
                    className="text-sm border border-slate-300 dark:border-slate-600 rounded px-2 py-1 outline-none focus:border-sky-500 dark:focus:border-sky-400" 
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {enableDashboardEdit && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Monthly Sales</label>
                        <input 
                          type="number" 
                          value={offsetsForm[`monthlySales_${editMonth}`] ?? (editMonth === '2026-05' ? offsetsForm.monthlySales : '') ?? ''} 
                          onChange={e => setOffsetsForm({
                            ...offsetsForm, 
                            [`monthlySales_${editMonth}`]: e.target.value,
                            ...(editMonth === '2026-05' && { monthlySales: e.target.value })
                          })} 
                          className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Monthly Profit</label>
                        <input 
                          type="number" 
                          value={offsetsForm[`monthlyProfit_${editMonth}`] ?? (editMonth === '2026-05' ? offsetsForm.monthlyProfit : '') ?? ''} 
                          onChange={e => setOffsetsForm({
                            ...offsetsForm, 
                            [`monthlyProfit_${editMonth}`]: e.target.value,
                            ...(editMonth === '2026-05' && { monthlyProfit: e.target.value })
                          })} 
                          className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" 
                        />
                      </div>
                    </>
                  )}
                  {enableDashboardEdit && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-1">Monthly Bills Count</label>
                        <input 
                          type="number" 
                          value={offsetsForm[`monthlyBills_${editMonth}`] ?? (editMonth === '2026-05' ? offsetsForm.monthlyBills : '') ?? ''} 
                          onChange={e => setOffsetsForm({
                            ...offsetsForm, 
                            [`monthlyBills_${editMonth}`]: e.target.value,
                            ...(editMonth === '2026-05' && { monthlyBills: e.target.value })
                          })} 
                          className="w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 outline-none" 
                          placeholder="Auto"
                        />
                      </div>
                      
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800/50 flex justify-between items-center gap-3">
              <button 
                type="button"
                onClick={handleResetToReal} 
                className="px-3 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
                title="تمام آفسیٹس ختم کریں اور حقیقی سیل پر واپس آئیں"
              >
                Reset to 100% Real Values (حقیقی سیل بحال کریں)
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setIsEditingOffsets(false)} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">Cancel</button>
                <button onClick={handleSaveOffsets} className="px-6 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-900 text-white rounded text-sm font-medium transition-colors shadow-md flex items-center">
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

       {activeModal && activeModal !== 'vendor-payable' && activeModal !== 'vendor-receivable' && activeModal !== 'daily-expense' && activeModal !== 'monthly-expense' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800/50">
               <h2 className="font-bold text-lg text-slate-800 dark:text-slate-100">
                 {activeModal === 'monthly-sale' ? `Monthly Sales Details (${formatMonthName(selectedMonthStr)})` :
                  activeModal?.startsWith('daily') ? `Daily Transactions (${formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())})` : 
                  activeModal?.startsWith('monthly') ? 'Monthly Transactions' :
                  activeModal?.startsWith('total') ? 'All Transactions' : 'Stock Value Details'}
               </h2>
               <div className="flex items-center gap-2">
                 <button
                   id="btn-print-modal-header"
                   type="button"
                   onClick={() => window.print()}
                   className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer"
                   title="Print Report"
                 >
                   <Printer className="w-4 h-4" />
                   <span>Print (پرنٹ)</span>
                 </button>
                 <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
                   <X className="w-5 h-5" />
                 </button>
               </div>
            </div>
            <div className="p-4 overflow-y-auto">
               {activeModal === 'monthly-sale' ? (
                 <div className="w-full flex flex-col gap-4">
                   {/* Print Action Box */}
                   <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-sm">
                     <div className="flex items-center gap-3">
                       <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center shrink-0 shadow-sm">
                         <Printer className="w-5 h-5" />
                       </div>
                       <div>
                         <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                           <span>Monthly Sales Print</span>
                           <span className="text-[10px] bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200 px-2 py-0.5 rounded-full font-bold uppercase">
                             {formatMonthName(selectedMonthStr)}
                           </span>
                         </h4>
                         <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                           پرنٹ ویو میں اسٹور سیل اور آن لائن سیل علیحدہ علیحدہ مکمل تفصیل کے ساتھ پرنٹ ہوں گی
                         </p>
                       </div>
                     </div>
                     <button
                       id="btn-print-monthly-box"
                       type="button"
                       onClick={() => window.print()}
                       className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow transition shrink-0 cursor-pointer"
                     >
                       <Printer className="w-4 h-4" />
                       <span>Print Monthly Sale Report (پرنٹ کریں)</span>
                     </button>
                   </div>

                   {/* Summary Stat Cards */}
                   <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                     <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-200 dark:border-slate-700">
                       <span className="text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase block">Total Monthly Sale</span>
                       <span className="text-xl font-black text-slate-800 dark:text-slate-100 block mt-1">PKR {formatCurrency(monthlySales)}</span>
                       <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-1 block">{monthlySuits} Suits ({monthlyBills} Bills)</span>
                     </div>
                     <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl p-3.5 border border-emerald-200 dark:border-emerald-800/50">
                       <span className="text-xs font-bold tracking-wider text-emerald-600 dark:text-emerald-400 uppercase block">In-Store Sales (اسٹور سیل)</span>
                       <span className="text-xl font-black text-emerald-700 dark:text-emerald-300 block mt-1">PKR {formatCurrency(monthlyInStoreSales)}</span>
                       <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 mt-1 block">{inStoreSuitsCount} Suits ({monthlyInStoreTransactions.length} Bills)</span>
                     </div>
                     <div className="bg-sky-50 dark:bg-sky-950/30 rounded-xl p-3.5 border border-sky-200 dark:border-sky-800/50">
                       <span className="text-xs font-bold tracking-wider text-sky-600 dark:text-sky-400 uppercase block">Online Sales (آن لائن سیل)</span>
                       <span className="text-xl font-black text-sky-700 dark:text-sky-300 block mt-1">PKR {formatCurrency(monthlyOnlineSales)}</span>
                       <span className="text-[11px] font-medium text-sky-600 dark:text-sky-400 mt-1 block">{onlineSuitsCount} Suits ({monthlyOnlineTransactions.length} Bills)</span>
                     </div>
                   </div>

                   {/* Tab Switcher */}
                   <div className="flex border-b border-slate-200 dark:border-slate-700 gap-2">
                     <button
                       type="button"
                       onClick={() => setModalSaleTab('all')}
                       className={`pb-2 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                         modalSaleTab === 'all'
                           ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                           : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
                       }`}
                     >
                       All Sales ({monthlyTransactions.length})
                     </button>
                     <button
                       type="button"
                       onClick={() => setModalSaleTab('instore')}
                       className={`pb-2 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                         modalSaleTab === 'instore'
                           ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                           : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
                       }`}
                     >
                       In-Store Sales ({monthlyInStoreTransactions.length})
                     </button>
                     <button
                       type="button"
                       onClick={() => setModalSaleTab('online')}
                       className={`pb-2 px-3 text-xs font-bold transition border-b-2 cursor-pointer ${
                         modalSaleTab === 'online'
                           ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                           : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
                       }`}
                     >
                       Online Sales ({monthlyOnlineTransactions.length})
                     </button>
                   </div>

                   {/* Tables based on selected tab */}
                   {modalSaleTab === 'all' ? (
                     <div className="space-y-6">
                       {/* In-Store Section */}
                       <div className="space-y-2">
                         <div className="flex justify-between items-center bg-emerald-50 dark:bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/40">
                           <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wide">
                             In-Store Sales (اسٹور سیل) &bull; {monthlyInStoreTransactions.length} Bills ({inStoreSuitsCount} Suits)
                           </span>
                           <span className="text-xs font-black text-emerald-800 dark:text-emerald-200">
                             PKR {formatCurrency(monthlyInStoreSales)}
                           </span>
                         </div>
                         <div className="overflow-x-auto">
                           <table className="w-full text-left border-collapse">
                             <thead>
                               <tr className="border-b border-slate-100 dark:border-slate-800/50">
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">TXN ID</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Date</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Customer</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-center">Suits</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Amount</th>
                               </tr>
                             </thead>
                             <tbody>
                               {monthlyInStoreTransactions.map(sale => {
                                 const isReturn = sale.transactionType === 'Return';
                                 const saleDate = getSaleTime(sale);
                                 const suitsCount = getSuitsInSale(sale);
                                 const netAmt = getNetSaleAmount(sale);
                                 return (
                                   <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                     <td className="p-2.5 text-sm text-slate-700 dark:text-slate-200">
                                       <div className="flex items-center gap-1.5 font-mono">
                                         <span className="font-bold text-slate-800 dark:text-slate-100">{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}</span>
                                         {isReturn && (
                                           <span className="px-1.5 py-0.5 rounded-sm bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">Return</span>
                                         )}
                                       </div>
                                     </td>
                                     <td className="p-2.5 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(saleDate)}</td>
                                     <td className="p-2.5 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || 'Walk-in'}</td>
                                     <td className="p-2.5 text-sm text-slate-600 dark:text-slate-300 text-center font-medium">{suitsCount} suits</td>
                                     <td className="p-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency(netAmt)}</td>
                                   </tr>
                                 );
                               })}
                               {monthlyInStoreTransactions.length === 0 && (
                                 <tr>
                                   <td colSpan={5} className="p-4 text-center text-sm text-slate-500 italic">No in-store transactions this month</td>
                                 </tr>
                               )}
                             </tbody>
                           </table>
                         </div>
                       </div>

                       {/* Online Section */}
                       <div className="space-y-2">
                         <div className="flex justify-between items-center bg-sky-50 dark:bg-sky-950/40 p-2.5 rounded-lg border border-sky-200 dark:border-sky-800/40">
                           <span className="text-xs font-bold text-sky-800 dark:text-sky-300 uppercase tracking-wide">
                             Online Sales (آن لائن سیل) &bull; {monthlyOnlineTransactions.length} Bills ({onlineSuitsCount} Suits)
                           </span>
                           <span className="text-xs font-black text-sky-800 dark:text-sky-200">
                             PKR {formatCurrency(monthlyOnlineSales)}
                           </span>
                         </div>
                         <div className="overflow-x-auto">
                           <table className="w-full text-left border-collapse">
                             <thead>
                               <tr className="border-b border-slate-100 dark:border-slate-800/50">
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">TXN ID</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Date</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Customer</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-center">Suits</th>
                                 <th className="p-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Amount</th>
                               </tr>
                             </thead>
                             <tbody>
                               {monthlyOnlineTransactions.map(sale => {
                                 const isReturn = sale.transactionType === 'Return';
                                 const saleDate = getSaleTime(sale);
                                 const suitsCount = getSuitsInSale(sale);
                                 const netAmt = getNetSaleAmount(sale);
                                 return (
                                   <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                     <td className="p-2.5 text-sm text-slate-700 dark:text-slate-200">
                                       <div className="flex items-center gap-1.5 font-mono">
                                         <span className="font-bold text-slate-800 dark:text-slate-100">{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}</span>
                                         {isReturn && (
                                           <span className="px-1.5 py-0.5 rounded-sm bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">Return</span>
                                         )}
                                       </div>
                                     </td>
                                     <td className="p-2.5 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(saleDate)}</td>
                                     <td className="p-2.5 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || 'Online Order'}</td>
                                     <td className="p-2.5 text-sm text-slate-600 dark:text-slate-300 text-center font-medium">{suitsCount} suits</td>
                                     <td className="p-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency(netAmt)}</td>
                                   </tr>
                                 );
                               })}
                               {monthlyOnlineTransactions.length === 0 && (
                                 <tr>
                                   <td colSpan={5} className="p-4 text-center text-sm text-slate-500 italic">No online transactions this month</td>
                                 </tr>
                               )}
                             </tbody>
                           </table>
                         </div>
                       </div>
                     </div>
                   ) : (
                     <div className="overflow-x-auto">
                       <table className="w-full text-left border-collapse">
                         <thead>
                           <tr className="border-b border-slate-100 dark:border-slate-800/50">
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">TXN ID</th>
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Date</th>
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Customer</th>
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-center">Suits</th>
                             <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Amount</th>
                           </tr>
                         </thead>
                         <tbody>
                           {(modalSaleTab === 'instore' ? monthlyInStoreTransactions : monthlyOnlineTransactions).map(sale => {
                             const isReturn = sale.transactionType === 'Return';
                             const saleDate = getSaleTime(sale);
                             const suitsCount = getSuitsInSale(sale);
                             const netAmt = getNetSaleAmount(sale);
                             return (
                               <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                 <td className="p-3 text-sm text-slate-700 dark:text-slate-200">
                                   <div className="flex items-center gap-2 font-mono">
                                     <span className="font-bold text-slate-800 dark:text-slate-100">{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}</span>
                                     {isReturn && (
                                       <span className="px-1.5 py-0.5 rounded-sm bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold">Return</span>
                                     )}
                                   </div>
                                 </td>
                                 <td className="p-3 text-sm text-slate-500 dark:text-slate-400">{formatDateTime(saleDate)}</td>
                                 <td className="p-3 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || (sale.saleType === 'Online' ? 'Online Customer' : 'Walk-in')}</td>
                                 <td className="p-3 text-sm text-slate-600 dark:text-slate-300 text-center font-medium">{suitsCount} suits</td>
                                 <td className="p-3 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency(netAmt)}</td>
                               </tr>
                             );
                           })}
                           {(modalSaleTab === 'instore' ? monthlyInStoreTransactions : monthlyOnlineTransactions).length === 0 && (
                             <tr>
                               <td colSpan={5} className="p-4 text-center text-sm text-slate-500 italic">No transactions found</td>
                             </tr>
                           )}
                         </tbody>
                       </table>
                     </div>
                   )}
                 </div>
               ) : activeModal !== 'stock' ? (
                 <div className="w-full flex flex-col gap-4">
                   {['daily-sale', 'daily-profit', 'monthly-profit', 'total-sale', 'total-profit'].includes(activeModal) && (
                     <div className="flex bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800/50 justify-between items-center shadow-sm">
                       <div className="flex flex-col">
                         <span className="text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase">In-Store {activeModal.includes('profit') ? 'Profit' : 'Sales'}</span>
                         <span className="text-lg font-black text-slate-800 dark:text-slate-100">PKR {formatCurrency(
                           activeModal === 'daily-profit' ? dailyInStoreProfit + (activeOffsets?.dailyOffsetDate === selectedDailyDateStr ? (Number(activeOffsets?.dailyProfit) || 0) : 0) :
                           activeModal === 'daily-sale' ? dailyInStoreSales + (activeOffsets?.dailyOffsetDate === selectedDailyDateStr ? (Number(activeOffsets?.dailySales) || 0) : 0) :
                           activeModal === 'monthly-profit' ? monthlyInStoreProfit :
                           activeModal === 'total-profit' ? totalInStoreProfit :
                           totalInStoreSales
                         )}</span>
                       </div>
                       <div className="h-10 w-px bg-slate-200"></div>
                       <div className="flex flex-col text-right">
                         <span className="text-xs font-bold tracking-wider text-sky-600 uppercase">Online {activeModal.includes('profit') ? 'Profit' : 'Sales'}</span>
                         <span className="text-lg font-black text-sky-700">PKR {formatCurrency(
                           activeModal === 'daily-profit' ? dailyOnlineProfit :
                           activeModal === 'daily-sale' ? dailyOnlineSales :
                           activeModal === 'monthly-profit' ? monthlyOnlineProfit :
                           activeModal === 'total-profit' ? totalOnlineProfit :
                           totalOnlineSales
                         )}</span>
                       </div>
                     </div>
                   )}
                   <div className="overflow-x-auto">
                   <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800/50">
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">TXN ID</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Date</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Customer</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Items</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSales.filter(sale => {
                            const saleDate = getSaleTime(sale);
                            if (activeModal?.startsWith('daily')) return isSaleOnDate(saleDate, selectedDailyDateStr);
                            if (activeModal?.startsWith('monthly')) return isSaleInMonth(saleDate, selectedMonthStr);
                            return true;
                        }).map(sale => (
                            <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="p-3 text-sm text-slate-700 dark:text-slate-200">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-800 dark:text-slate-100">{sale.invoiceNo || sale.id.slice(-6).toUpperCase()}</span>
                                  {sale.saleType === 'Online' && (
                                    <span className="px-1.5 py-0.5 rounded-sm bg-sky-100 text-sky-700 border border-sky-200 text-[10px] font-bold">Online</span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3 text-sm text-slate-500 dark:text-slate-400">{new Date(getSaleTime(sale) || 0).toLocaleString()}</td>
                              <td className="p-3 text-sm text-slate-600 dark:text-slate-300">{sale.customerName || 'Walk-in'}</td>
                              <td className="p-3 text-sm text-slate-600 dark:text-slate-300">{sale.items?.length || 0} items</td>
                              <td className="p-3 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency(sale.total || 0)}</td>
                            </tr>
                        ))}
                      </tbody>
                   </table>
                 </div>
                 </div>
               ) : (
                 <div className="overflow-x-auto">
                   <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800/50">
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Item Name</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">SKU</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Qty</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Cost</th>
                          <th className="p-3 text-xs font-bold text-slate-600 dark:text-slate-300 uppercase text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventory.filter(i => (i.stock || 0) > 0).map(item => (
                            <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="p-3 text-sm text-slate-700 dark:text-slate-200">{item.name}</td>
                              <td className="p-3 text-sm text-slate-500 dark:text-slate-400">{item.sku || '-'}</td>
                              <td className="p-3 text-sm text-slate-600 dark:text-slate-300 text-right">{item.stock || 0}</td>
                              <td className="p-3 text-sm text-slate-600 dark:text-slate-300 text-right">PKR {formatCurrency(item.cost || 0)}</td>
                              <td className="p-3 text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">PKR {formatCurrency((item.stock || 0) * (item.cost || 0))}</td>
                            </tr>
                        ))}
                      </tbody>
                   </table>
                 </div>
               )}
            </div>
          </div>
        </div>
      )}

      {/* EXPENSE DETAILS MODAL */}
      {(activeModal === 'daily-expense' || activeModal === 'monthly-expense') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 rounded-t-2xl">
              <div>
                <h2 className="font-bold text-base sm:text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-rose-600" />
                  <span>
                    {activeModal === 'daily-expense' 
                      ? `Daily Expenses Details (${formatDate(parse(selectedDailyDateStr, 'yyyy-MM-dd', new Date()).getTime())})`
                      : `Monthly Expenses Details (${formatMonthName(selectedMonthStr)})`}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {activeModal === 'daily-expense'
                    ? 'آج کے تمام ریکارڈ شدہ اخراجات کی تفصیل'
                    : `${formatMonthName(selectedMonthStr)} کے تمام اخراجات کی مکمل تفصیل`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/expenses"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 hover:bg-rose-100 border border-rose-200 dark:border-rose-800 rounded-lg text-xs font-bold transition"
                  title="Go to Expenses Management"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Manage Expenses</span>
                </Link>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button 
                  onClick={() => setActiveModal(null)} 
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-400 hover:text-slate-600 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Summary Banner */}
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-rose-50/50 dark:bg-rose-950/20 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-rose-100 dark:border-rose-900/40">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Expenses</span>
                <span className="text-xl sm:text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">
                  PKR {formatCurrency(activeModal === 'daily-expense' ? dailyExpenses : monthlyExpenses)}
                </span>
              </div>
              <div className="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-rose-100 dark:border-rose-900/40">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Entries</span>
                <span className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 font-mono">
                  {activeModal === 'daily-expense' ? dailyExpenseEntries.length : monthlyExpenseEntries.length}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-1 p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-rose-100 dark:border-rose-900/40">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Status</span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 block mt-1">
                  {activeModal === 'daily-expense' && selectedDailyDateStr === todayDateStr
                    ? '✓ Tracking Today (00:00 to 23:59)'
                    : '✓ Real-time Sync'}
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1 p-4">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs uppercase font-bold tracking-wider">
                    <th className="py-2.5 px-3">Date & Time</th>
                    <th className="py-2.5 px-3">Account / Head</th>
                    <th className="py-2.5 px-3">Description / Details</th>
                    <th className="py-2.5 px-3 text-right">Amount (PKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 text-sm">
                  {(activeModal === 'daily-expense' ? dailyExpenseEntries : monthlyExpenseEntries).map((item, idx) => {
                    const itemTime = getSaleTime(item);
                    return (
                      <tr key={item.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formatDateTime(itemTime)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {item.reference || 'General Expense'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 text-xs sm:text-sm">
                          {item.description || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                          PKR {formatCurrency(Number(item.amount) || 0)}
                        </td>
                      </tr>
                    );
                  })}
                  {(activeModal === 'daily-expense' ? dailyExpenseEntries : monthlyExpenseEntries).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-slate-400 text-sm italic">
                        {activeModal === 'daily-expense' 
                          ? 'No expenses recorded for this day yet. (آج کوئی خرچہ ریکارڈ نہیں ہوا - PKR 0)'
                          : 'No expenses recorded for this month.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center rounded-b-2xl">
              <span className="text-xs text-slate-500">
                Daily expense automatically resets to 0 every day at midnight (00:00).
              </span>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vendor Balances Modal */}
      {/* Vendor Balances Modal (Dynamic for Payable/Receivable) */}
      {(activeModal === 'vendor-payable' || activeModal === 'vendor-receivable') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm print:hidden">
          <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full ${activeModal === 'vendor-receivable' ? 'max-w-5xl' : 'max-w-2xl'} overflow-hidden flex flex-col max-h-[90vh]`}>
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  {activeModal === 'vendor-payable' ? 'Total Payables (دینا ہے)' : 'Total Receivables (وصولی)'}
                </h2>
                <p className="text-xs text-slate-500">
                  {activeModal === 'vendor-payable' 
                    ? 'Money you owe to Vendors and Customers' 
                    : 'Money to be received from Vendors and Customers'}
                </p>
              </div>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 transition-colors p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-0 overflow-y-auto flex-1">
              {activeModal === 'vendor-receivable' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-slate-100 dark:divide-slate-800 h-full">
                  {/* Left Column: Customer Receivables */}
                  <div className="flex flex-col h-full">
                    <div className="bg-sky-50/50 dark:bg-sky-950/20 p-3 border-b border-slate-100 dark:border-slate-800 sticky top-0 z-20">
                      <h3 className="text-sm font-bold text-sky-800 dark:text-sky-300 flex justify-between items-center">
                        <span>Customer Receivables (کسٹمر سے لینا ہے)</span>
                        <span className="text-rose-600 bg-rose-50 dark:bg-rose-950 px-2 py-0.5 rounded text-xs">PKR {formatCurrency(totalCustomerReceivable)}</span>
                      </h3>
                    </div>
                    <div className="flex-1">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-[45px] bg-white dark:bg-slate-900 z-10 shadow-sm">
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            <th className="p-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Customer Name</th>
                            <th className="p-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                          {customerBalances
                            .filter(c => c.balance < 0)
                            .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
                            .map(customer => (
                            <tr key={`c-${customer.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                              <td className="p-3">
                                <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{customer.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono uppercase">{customer.id.slice(-6)}</div>
                              </td>
                              <td className="p-3 text-right">
                                <div className="font-mono font-bold text-rose-600 text-sm">
                                  PKR {formatCurrency(Math.abs(customer.balance))}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {customerBalances.filter(c => c.balance < 0).length === 0 && (
                            <tr>
                              <td colSpan={2} className="p-8 text-center text-slate-500 text-sm italic">No customer receivables</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Right Column: Vendor Receivables */}
                  <div className="flex flex-col h-full">
                    <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 border-b border-slate-100 dark:border-slate-800 sticky top-0 z-20">
                      <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300 flex justify-between items-center">
                        <span>Vendor Receivables (وینڈر سے لینا ہے)</span>
                        <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded text-xs">PKR {formatCurrency(totalVendorReceivableOnly)}</span>
                      </h3>
                    </div>
                    <div className="flex-1">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-[45px] bg-white dark:bg-slate-900 z-10 shadow-sm">
                          <tr className="border-b border-slate-100 dark:border-slate-800">
                            <th className="p-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vendor Name</th>
                            <th className="p-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                          {vendorBalances
                            .filter(v => v.balance > 0)
                            .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
                            .map(vendor => (
                            <tr key={`v-${vendor.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                              <td className="p-3">
                                <div className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{vendor.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono uppercase">{vendor.id.slice(-6)}</div>
                              </td>
                              <td className="p-3 text-right">
                                <div className="font-mono font-bold text-emerald-600 text-sm">
                                  PKR {formatCurrency(Math.abs(vendor.balance))}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {vendorBalances.filter(v => v.balance > 0).length === 0 && (
                            <tr>
                              <td colSpan={2} className="p-8 text-center text-slate-500 text-sm italic">No vendor receivables</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900 z-10 shadow-sm">
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <th className="p-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Party Name</th>
                      <th className="p-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Balance</th>
                      <th className="p-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {/* Unified List Section */}
                    {[
                      ...vendorBalances.map(v => ({ ...v, partyType: 'Vendor' })),
                      ...customerBalances.map(c => ({ ...c, partyType: 'Customer' }))
                    ]
                      .filter(party => {
                        if (activeModal === 'vendor-payable') {
                          // Vendor (bal < 0) = Payable, Customer (bal > 0) = Payable (Advance)
                          return party.partyType === 'Vendor' ? party.balance < 0 : party.balance > 0;
                        } else {
                          // Vendor (bal > 0) = Receivable (Advance), Customer (bal < 0) = Receivable (Debt)
                          return party.partyType === 'Vendor' ? party.balance > 0 : party.balance < 0;
                        }
                      })
                      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
                      .map(party => (
                      <tr key={`${party.partyType}-${party.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <td className="p-4">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{party.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono uppercase">{party.partyType} • {party.id.slice(-6)}</div>
                        </td>
                        <td className="p-4 text-right">
                          <div className={`font-mono font-bold ${
                            (party.partyType === 'Vendor' ? party.balance < 0 : party.balance > 0) 
                              ? 'text-rose-600' 
                              : 'text-emerald-600'
                          }`}>
                            PKR {formatCurrency(Math.abs(party.balance))}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight ${
                            (party.partyType === 'Vendor' ? party.balance < 0 : party.balance > 0)
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' 
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}>
                            {party.partyType === 'Vendor' 
                              ? (party.balance < 0 ? 'Payable (دینا ہے)' : 'Receivable (لینا ہے)') 
                              : (party.balance > 0 ? 'Payable (دینا ہے)' : 'Receivable (لینا ہے)')}
                          </span>
                        </td>
                      </tr>
                    ))}

                    {/* Empty State */}
                    {[
                      ...vendorBalances.map(v => ({ ...v, partyType: 'Vendor' })),
                      ...customerBalances.map(c => ({ ...c, partyType: 'Customer' }))
                    ]
                      .filter(party => {
                        if (activeModal === 'vendor-payable') {
                          return party.partyType === 'Vendor' ? party.balance < 0 : party.balance > 0;
                        } else {
                          return party.partyType === 'Vendor' ? party.balance > 0 : party.balance < 0;
                        }
                      }).length === 0 && (
                      <tr>
                        <td colSpan={3} className="p-8 text-center text-slate-500">
                          No outstanding records found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
            
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-between items-center shrink-0">
              <div className="text-xs font-bold text-slate-500 uppercase">
                {activeModal === 'vendor-payable' ? 'Total Payable Sum' : 'Grand Total Receivable'}
              </div>
              <div className={`text-lg font-black font-mono ${activeModal === 'vendor-payable' ? 'text-rose-600' : 'text-emerald-600'}`}>
                PKR {formatCurrency(activeModal === 'vendor-payable' ? (totalVendorPayableOnly + totalCustomerPrepaid) : (totalVendorReceivableOnly + totalCustomerReceivable))}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Profit Password Prompt Modal */}
      {showProfitPrompt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200 print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Profit Details Locked</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Enter password to view profit breakdown</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowProfitPrompt(false);
                  setProfitPasswordInput('');
                  setProfitPromptError('');
                  setPendingBoxId(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {profitPromptError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs rounded-xl border border-red-200 dark:border-red-900/50 font-medium">
                {profitPromptError}
              </div>
            )}

            <form onSubmit={handleUnlockProfitBox} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Enter Password
                </label>
                <div className="relative">
                  <input
                    type={showProfitPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    value={profitPasswordInput}
                    onChange={(e) => {
                      setProfitPasswordInput(e.target.value);
                      setProfitPromptError('');
                    }}
                    placeholder="Enter password..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowProfitPassword(!showProfitPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showProfitPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowProfitPrompt(false);
                    setProfitPasswordInput('');
                    setProfitPromptError('');
                    setPendingBoxId(null);
                  }}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-sm shadow-md transition-all flex items-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DEDICATED MONTHLY SALE PRINT VIEW (Visible only during printing when activeModal === 'monthly-sale') */}
      {activeModal === 'monthly-sale' && (
        <div id="monthly-sales-print-document" className="hidden print:block text-black bg-white p-4 font-sans text-xs">
          {/* Header */}
          <div className="border-b-2 border-black pb-3 mb-4 text-center">
            <h1 className="text-2xl font-black tracking-wide uppercase">MANZOOR COLLECTION</h1>
            <p className="text-sm font-bold text-gray-700">ماہانہ سیل رپورٹ (Monthly Sales Report)</p>
            <div className="flex justify-between items-center mt-2 text-xs text-gray-600 border-t border-gray-200 pt-1">
              <span><strong>Month:</strong> {formatMonthName(selectedMonthStr)}</span>
              <span><strong>Branch:</strong> {branchDisplayName}</span>
              <span><strong>Printed:</strong> {new Date().toLocaleString()}</span>
            </div>
          </div>

          {/* Executive Summary Cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="border border-black p-2 rounded bg-gray-50 text-center">
              <span className="text-[10px] font-bold uppercase text-gray-600 block">Total Monthly Sale</span>
              <span className="text-base font-black block mt-0.5">PKR {formatCurrency(monthlySales)}</span>
              <span className="text-[10px] text-gray-600 block">{monthlySuits} Suits &bull; {monthlyBills} Bills</span>
            </div>
            <div className="border border-black p-2 rounded bg-gray-50 text-center">
              <span className="text-[10px] font-bold uppercase text-gray-600 block">In-Store Sales (اسٹور سیل)</span>
              <span className="text-base font-black block mt-0.5">PKR {formatCurrency(monthlyInStoreSales)}</span>
              <span className="text-[10px] text-gray-600 block">{inStoreSuitsCount} Suits &bull; {monthlyInStoreTransactions.length} Bills</span>
            </div>
            <div className="border border-black p-2 rounded bg-gray-50 text-center">
              <span className="text-[10px] font-bold uppercase text-gray-600 block">Online Sales (آن لائن سیل)</span>
              <span className="text-base font-black block mt-0.5">PKR {formatCurrency(monthlyOnlineSales)}</span>
              <span className="text-[10px] text-gray-600 block">{onlineSuitsCount} Suits &bull; {monthlyOnlineTransactions.length} Bills</span>
            </div>
          </div>

          {/* Section 1: In-Store Sales Table */}
          <div className="mb-6">
            <div className="flex justify-between items-center bg-gray-200 px-3 py-1.5 border border-black border-b-0 font-bold">
              <span className="text-xs uppercase">1. In-Store Sales &mdash; اسٹور سیل کی مکمل تفصیل</span>
              <span className="text-xs">
                Total: PKR {formatCurrency(monthlyInStoreSales)} ({inStoreSuitsCount} Suits / {monthlyInStoreTransactions.length} Bills)
              </span>
            </div>
            <table className="w-full text-left border-collapse border border-black text-[11px]">
              <thead>
                <tr className="bg-gray-100 border-b border-black">
                  <th className="p-1.5 border-r border-black w-8 text-center">#</th>
                  <th className="p-1.5 border-r border-black w-24">Inv #</th>
                  <th className="p-1.5 border-r border-black w-36">Date & Time</th>
                  <th className="p-1.5 border-r border-black">Customer</th>
                  <th className="p-1.5 border-r border-black text-center w-20">Suits</th>
                  <th className="p-1.5 text-right w-28">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {monthlyInStoreTransactions.map((sale, idx) => {
                  const isReturn = sale.transactionType === 'Return';
                  const saleDate = getSaleTime(sale);
                  const suitsCount = getSuitsInSale(sale);
                  const netAmt = getNetSaleAmount(sale);
                  return (
                    <tr key={sale.id} className="border-b border-gray-300">
                      <td className="p-1.5 border-r border-black text-center">{idx + 1}</td>
                      <td className="p-1.5 border-r border-black font-mono font-bold">
                        {sale.invoiceNo || sale.id.slice(-6).toUpperCase()}
                        {isReturn && <span className="ml-1 text-[9px] text-red-600 font-bold">(Return)</span>}
                      </td>
                      <td className="p-1.5 border-r border-black">{formatDateTime(saleDate)}</td>
                      <td className="p-1.5 border-r border-black">{sale.customerName || 'Walk-in'}</td>
                      <td className="p-1.5 border-r border-black text-center">{suitsCount}</td>
                      <td className="p-1.5 text-right font-mono font-bold">{formatCurrency(netAmt)}</td>
                    </tr>
                  );
                })}
                {monthlyInStoreTransactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-center italic text-gray-500">No In-Store Transactions Recorded</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-bold border-t border-black">
                  <td colSpan={4} className="p-1.5 border-r border-black text-right uppercase">In-Store Subtotal (ذیلی میزان):</td>
                  <td className="p-1.5 border-r border-black text-center">{inStoreSuitsCount} Suits</td>
                  <td className="p-1.5 text-right font-mono">PKR {formatCurrency(monthlyInStoreSales)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Section 2: Online Sales Table */}
          <div className="mb-6">
            <div className="flex justify-between items-center bg-gray-200 px-3 py-1.5 border border-black border-b-0 font-bold">
              <span className="text-xs uppercase">2. Online Sales &mdash; آن لائن سیل کی مکمل تفصیل</span>
              <span className="text-xs">
                Total: PKR {formatCurrency(monthlyOnlineSales)} ({onlineSuitsCount} Suits / {monthlyOnlineTransactions.length} Bills)
              </span>
            </div>
            <table className="w-full text-left border-collapse border border-black text-[11px]">
              <thead>
                <tr className="bg-gray-100 border-b border-black">
                  <th className="p-1.5 border-r border-black w-8 text-center">#</th>
                  <th className="p-1.5 border-r border-black w-24">Inv #</th>
                  <th className="p-1.5 border-r border-black w-36">Date & Time</th>
                  <th className="p-1.5 border-r border-black">Customer</th>
                  <th className="p-1.5 border-r border-black text-center w-20">Suits</th>
                  <th className="p-1.5 text-right w-28">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {monthlyOnlineTransactions.map((sale, idx) => {
                  const isReturn = sale.transactionType === 'Return';
                  const saleDate = getSaleTime(sale);
                  const suitsCount = getSuitsInSale(sale);
                  const netAmt = getNetSaleAmount(sale);
                  return (
                    <tr key={sale.id} className="border-b border-gray-300">
                      <td className="p-1.5 border-r border-black text-center">{idx + 1}</td>
                      <td className="p-1.5 border-r border-black font-mono font-bold">
                        {sale.invoiceNo || sale.id.slice(-6).toUpperCase()}
                        {isReturn && <span className="ml-1 text-[9px] text-red-600 font-bold">(Return)</span>}
                      </td>
                      <td className="p-1.5 border-r border-black">{formatDateTime(saleDate)}</td>
                      <td className="p-1.5 border-r border-black">{sale.customerName || 'Online Order'}</td>
                      <td className="p-1.5 border-r border-black text-center">{suitsCount}</td>
                      <td className="p-1.5 text-right font-mono font-bold">{formatCurrency(netAmt)}</td>
                    </tr>
                  );
                })}
                {monthlyOnlineTransactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-center italic text-gray-500">No Online Transactions Recorded</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-bold border-t border-black">
                  <td colSpan={4} className="p-1.5 border-r border-black text-right uppercase">Online Subtotal (ذیلی میزان):</td>
                  <td className="p-1.5 border-r border-black text-center">{onlineSuitsCount} Suits</td>
                  <td className="p-1.5 text-right font-mono">PKR {formatCurrency(monthlyOnlineSales)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Grand Summary Box */}
          <div className="border-2 border-black p-3 rounded mb-8 bg-gray-50">
            <div className="flex justify-between items-center text-sm font-black">
              <span>GRAND TOTAL MONTHLY SALES (کل ماہانہ سیل مع اسٹور و آن لائن):</span>
              <span className="text-base font-mono">PKR {formatCurrency(monthlySales)}</span>
            </div>
            <div className="flex justify-between items-center text-xs text-gray-700 mt-1">
              <span>Total Volume: {monthlySuits} Suits Across {monthlyBills} Invoices</span>
              <span>In-Store: PKR {formatCurrency(monthlyInStoreSales)} | Online: PKR {formatCurrency(monthlyOnlineSales)}</span>
            </div>
          </div>

          {/* Signatures & Footer */}
          <div className="grid grid-cols-3 gap-6 pt-6 border-t border-gray-400 text-center text-xs">
            <div>
              <div className="border-b border-black mb-1 w-32 mx-auto"></div>
              <span>Prepared By</span>
            </div>
            <div>
              <div className="border-b border-black mb-1 w-32 mx-auto"></div>
              <span>Store Manager</span>
            </div>
            <div>
              <div className="border-b border-black mb-1 w-32 mx-auto"></div>
              <span>Authorized Signature</span>
            </div>
          </div>
          <p className="text-[9px] text-gray-500 text-center mt-6">
            Computer generated report &bull; Manzoor Collection POS &bull; {new Date().toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}

