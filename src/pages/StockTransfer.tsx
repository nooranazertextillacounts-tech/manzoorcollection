import { useState, useEffect, Fragment } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { collection, query, where, getDocs, doc, Timestamp, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, getDoc, writeBatch, runTransaction } from '../lib/customFirestore';
import { ArrowRightLeft, PackagePlus, Search, AlertCircle, CheckCircle2, Building, Package, Plus, Minus, X, Inbox, History, Check, Printer, FileSpreadsheet, ChevronDown, ChevronUp, Layers, Filter, BarChart3, Clock, Ban, CheckCircle, User } from 'lucide-react';
import { printInvoice } from '../lib/print';
import { recordActivityLog } from '../lib/activityLogger';

export function StockTransfer() {
  const { user } = useAuth();
  const { branches, activeBranchId } = useBranch();
  
  // Exclude 'main' from literal branches if we only want actual db branches
  const actualBranches = branches.filter(b => b.id !== 'main');

  const [activeTab, setActiveTab] = useState<'send' | 'incoming' | 'history' | 'article_report'>('send');
  const [historyTab, setHistoryTab] = useState<'sent' | 'received'>('sent');
  const [printTransfer, setPrintTransfer] = useState<any | null>(null);
  const [printLedger, setPrintLedger] = useState(false);
  const [lastCompletedTransfer, setLastCompletedTransfer] = useState<any | null>(null);

  const [sourceBranchId, setSourceBranchId] = useState<string>(activeBranchId || '');
  useEffect(() => {
    if (activeBranchId) {
      setSourceBranchId(activeBranchId);
      setArticleFilterFromBranch(activeBranchId);
    }
  }, [activeBranchId]);

  const [destBranchId, setDestBranchId] = useState<string>('');
  const [carrierName, setCarrierName] = useState<string>('');
  const [transferDate, setTransferDate] = useState<string>(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [transferAccount, setTransferAccount] = useState<string>('Stock Transfer');
  const [vendors, setVendors] = useState<any[]>([]);
  
  const [sourceInventory, setSourceInventory] = useState<any[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState<string>('');
  const [historyBranchFilter, setHistoryBranchFilter] = useState<string>('');
  const [historyDateTo, setHistoryDateTo] = useState<string>('');

  // Article-Wise Report States
  const [articleSearchQuery, setArticleSearchQuery] = useState('');
  const [articleFilterFromBranch, setArticleFilterFromBranch] = useState<string>(activeBranchId || '');
  const [articleFilterToBranch, setArticleFilterToBranch] = useState<string>('');
  const [articleDateFrom, setArticleDateFrom] = useState<string>('');
  const [articleDateTo, setArticleDateTo] = useState<string>('');
  const [expandedArticleKey, setExpandedArticleKey] = useState<string | null>(null);
  const [printArticleReport, setPrintArticleReport] = useState(false);
  
  // Selected items to transfer: { [itemId]: quantity }
  const [transferList, setTransferList] = useState<{ [itemId: string]: number }>({});
  
  const [isTransferring, setIsTransferring] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Fetch vendors
  useEffect(() => {
    let q: any = collection(db, 'vendors');
    if (sourceBranchId) {
      q = query(q, where('branchId', '==', sourceBranchId));
    } else if (user?.role !== 'super_admin') {
      q = query(q, where('tenantId', '==', user?.tenantId || user?.uid));
    }
    const unsub = safeCollectionSnapshot(q, (snap) => {
      setVendors(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [sourceBranchId, user]);
  
  const fetchTransfers = async () => {
    setLoadingTransfers(true);
    try {
      const q = user?.role === 'super_admin' 
        ? collection(db, 'stock_transfers')
        : query(collection(db, 'stock_transfers'), where('tenantId', '==', user?.tenantId || user?.uid));
      const snap = await safeGetDocs(q);
      let items = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      items.sort((a: any, b: any) => {
        const bTime = b.date || b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || b.createdAt || 0;
        const aTime = a.date || a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || a.createdAt || 0;
        return bTime - aTime;
      });
      setTransfers(items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTransfers(false);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, [activeTab, user, activeBranchId]);

  // Fetch inventory when source branch changes
  const fetchSourceInventory = async () => {
    if (!sourceBranchId) {
      setSourceInventory([]);
      return;
    }
    setLoadingInventory(true);
    try {
      const q = query(collection(db, 'inventory'), where('branchId', '==', sourceBranchId));
      const snap = await safeGetDocs(q);
      const items = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      // Filter out items with 0 stock
      setSourceInventory(items.filter((item: any) => item.stock > 0));
      setTransferList({});
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingInventory(false);
    }
  };

  useEffect(() => {
    fetchSourceInventory();
  }, [sourceBranchId, user]);

  const myIncomingTransfers = transfers.filter((t: any) => {
    const isTargetBranch = (!activeBranchId && user?.role === 'super_admin') || t.toBranchId === activeBranchId || t.destBranchId === activeBranchId;
    const isPending = t.status === 'Pending' || t.status === 'PENDING' || t.status === 'In-Transit' || t.status === 'Sent' || !t.status;
    return isTargetBranch && isPending;
  });

  // Handle Receiving Stock in Destination Branch
  const handleReceiveStock = async (transfer: any) => {
    if (!transfer || !transfer.id) return;
    if (!window.confirm(`Are you sure you want to receive and enter these items into ${transfer.toBranchName || 'your branch'} inventory?`)) {
      return;
    }

    setIsTransferring(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const totalTransferAmount = transfer.items?.reduce((sum: number, i: any) => sum + ((i.cost !== undefined ? i.cost : (i.price || 0)) * (i.qty || 0)), 0) || transfer.amount || 0;
      const transferredItemNames = (transfer.items || []).map((i: any) => `${i.qty}x ${i.name}`);
      const targetBranchId = transfer.toBranchId || transfer.destBranchId;

      await runTransaction(db, async (transaction) => {
        // 1. Verify Transfer Record
        const transferRef = doc(db, 'stock_transfers', transfer.id);
        const transferDoc = await transaction.get(transferRef);
        if (!transferDoc.exists()) {
          throw new Error("Transfer record not found in database.");
        }
        const transferData = transferDoc.data();
        if (transferData.status === 'COMPLETED') {
          throw new Error("This stock transfer has already been received!");
        }
        if (transferData.status === 'CANCELLED') {
          throw new Error("This stock transfer was cancelled by the sender.");
        }

        // 2. Fetch destination branch inventory
        const destInvQ = query(collection(db, 'inventory'), where('branchId', '==', targetBranchId));
        const destInvSnap = await getDocs(destInvQ);
        const destInvItems = destInvSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

        // 3. Enter stock into destination inventory
        for (const item of (transfer.items || [])) {
          const existingDestItem = destInvItems.find(di => 
            (di.sku && item.sku && di.sku === item.sku) || (di.name && di.name.toLowerCase() === item.name.toLowerCase())
          );

          if (existingDestItem) {
            const destRef = doc(db, 'inventory', existingDestItem.id);
            transaction.update(destRef, {
              stock: (Number(existingDestItem.stock) || 0) + Number(item.qty),
              updatedAt: Timestamp.now()
            });
          } else {
            const newDestRef = doc(collection(db, 'inventory'));
            transaction.set(newDestRef, {
              name: item.name,
              sku: item.sku || '',
              category: item.category || 'General',
              cost: Number(item.cost) || 0,
              price: Number(item.price) || Number(item.cost) || 0,
              stock: Number(item.qty),
              minStockLevel: item.minStockLevel || 5,
              branchId: targetBranchId,
              tenantId: user?.tenantId || user?.uid,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now()
            });
          }
        }

        // 4. Record Destination Branch Ledger Entry (IN)
        const newLedgerDocRefDest = doc(collection(db, 'ledger'));
        transaction.set(newLedgerDocRefDest, {
          branchId: targetBranchId,
          date: Date.now(),
          description: `Received stock from ${transfer.fromBranchName}${transfer.carrierName ? ` via ${transfer.carrierName}` : ''}: ${transferredItemNames.join(', ')}`,
          category: 'Stock Transfer',
          type: 'IN',
          amount: totalTransferAmount,
          reference: transferAccount || `str_${transfer.id}`,
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });

        // 5. Update transfer record status to COMPLETED
        transaction.update(transferRef, {
          status: 'COMPLETED',
          receivedBy: user?.name || user?.email || 'Destination Staff',
          acceptedAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
      });

      setSuccessMsg(`Stock from ${transfer.fromBranchName} received and successfully added to ${transfer.toBranchName} inventory!`);
      
      // Update local state
      setTransfers(prev => prev.map(t => t.id === transfer.id ? { 
        ...t, 
        status: 'COMPLETED', 
        receivedBy: user?.name || user?.email || 'Destination Staff', 
        acceptedAt: Date.now() 
      } : t));

      recordActivityLog({
        action: 'Receive Stock Transfer',
        category: 'Stock Transfer',
        details: `Received ${transfer.items?.length || 0} items from ${transfer.fromBranchName} into ${transfer.toBranchName} (Total: PKR ${totalTransferAmount.toLocaleString()})`,
        metadata: {
          transferId: transfer.id,
          fromBranchId: transfer.fromBranchId,
          toBranchId: targetBranchId,
          totalAmount: totalTransferAmount
        },
        branchId: targetBranchId,
        user
      }).catch(() => {});

      // Refresh inventory if current active branch is destination
      if (activeBranchId === targetBranchId) {
        fetchSourceInventory();
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to receive stock transfer.");
    } finally {
      setIsTransferring(false);
    }
  };

  // Handle Cancelling a Pending Transfer (Restores stock to Source Branch)
  const handleCancelTransfer = async (transfer: any) => {
    if (!transfer || !transfer.id) return;
    if (!window.confirm(`Are you sure you want to CANCEL this transfer? The items will be returned back to ${transfer.fromBranchName} inventory.`)) {
      return;
    }

    setIsTransferring(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await runTransaction(db, async (transaction) => {
        const transferRef = doc(db, 'stock_transfers', transfer.id);
        const transferDoc = await transaction.get(transferRef);
        if (!transferDoc.exists()) {
          throw new Error("Transfer record not found.");
        }
        const transferData = transferDoc.data();
        if (transferData.status === 'COMPLETED') {
          throw new Error("Cannot cancel a transfer that has already been received.");
        }
        if (transferData.status === 'CANCELLED') {
          throw new Error("This transfer is already cancelled.");
        }

        // Fetch source inventory to restore stock
        const srcInvQ = query(collection(db, 'inventory'), where('branchId', '==', transfer.fromBranchId));
        const srcInvSnap = await getDocs(srcInvQ);
        const srcInvItems = srcInvSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

        for (const item of (transfer.items || [])) {
          const existingSrcItem = srcInvItems.find(si => 
            (si.sku && item.sku && si.sku === item.sku) || (si.name && si.name.toLowerCase() === item.name.toLowerCase())
          );

          if (existingSrcItem) {
            const srcRef = doc(db, 'inventory', existingSrcItem.id);
            transaction.update(srcRef, {
              stock: (Number(existingSrcItem.stock) || 0) + Number(item.qty),
              updatedAt: Timestamp.now()
            });
          } else {
            const newSrcRef = doc(collection(db, 'inventory'));
            transaction.set(newSrcRef, {
              name: item.name,
              sku: item.sku || '',
              category: item.category || 'General',
              cost: Number(item.cost) || 0,
              price: Number(item.price) || Number(item.cost) || 0,
              stock: Number(item.qty),
              minStockLevel: item.minStockLevel || 5,
              branchId: transfer.fromBranchId,
              tenantId: user?.tenantId || user?.uid,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now()
            });
          }
        }

        // Update transfer status to CANCELLED
        transaction.update(transferRef, {
          status: 'CANCELLED',
          cancelledBy: user?.name || user?.email || 'User',
          cancelledAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
      });

      setSuccessMsg("Transfer cancelled and items restored back to source branch inventory.");
      fetchTransfers();
      fetchSourceInventory();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to cancel transfer.");
    } finally {
      setIsTransferring(false);
    }
  };

  const handleQtyChange = (itemId: string, qty: string, maxStock: number) => {
    const val = parseInt(qty || '0', 10);
    if (isNaN(val)) return;
    
    setTransferList(prev => {
      const next = { ...prev };
      if (val === 0) {
        delete next[itemId];
      } else {
        next[itemId] = Math.min(val, maxStock);
      }
      return next;
    });
  };

  const clearForm = () => {
    setTransferList({});
    setSearchTerm('');
    setDestBranchId('');
    setCarrierName('');
  };

  // Perform Stock Transfer (OUT from source branch ONLY)
  const handleTransfer = async () => {
    if (!sourceBranchId || !destBranchId) {
      setErrorMsg("Please select both source and destination branches.");
      return;
    }
    if (sourceBranchId === destBranchId) {
      setErrorMsg("Source and destination branches cannot be the same.");
      return;
    }
    
    const itemsToTransferIds = Object.keys(transferList);
    if (itemsToTransferIds.length === 0) {
      setErrorMsg("Please select at least one item to transfer.");
      return;
    }

    setIsTransferring(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const srcBranchName = actualBranches.find(b => b.id === sourceBranchId)?.name || 'Source Branch';
      const destBranchName = actualBranches.find(b => b.id === destBranchId)?.name || 'Destination Branch';
      const selectedDate = new Date(transferDate).getTime();

      let itemsToProcessOut: any[] = [];
      let finalNewTransferId = '';
      let recordedTransferAmount = 0;

      await runTransaction(db, async (transaction) => {
        // Read all source docs
        const sourceDocRefs = itemsToTransferIds.map(id => doc(db, 'inventory', id));
        const sourceDocs = await Promise.all(sourceDocRefs.map(ref => transaction.get(ref)));

        const itemsToProcess = [];

        // Validate source documents
        for (let i = 0; i < sourceDocs.length; i++) {
          const docSnap = sourceDocs[i];
          if (!docSnap.exists()) {
            throw new Error(`Item not found in source branch.`);
          }
          const data = docSnap.data();
          const transferQty = transferList[docSnap.id];
          
          if (data.stock < transferQty) {
            throw new Error(`Not enough stock for ${data.name}. Available: ${data.stock}, Requested: ${transferQty}`);
          }
          
          itemsToProcess.push({
            id: docSnap.id,
            ref: docSnap.ref,
            data: data,
            qty: transferQty
          });
        }

        itemsToProcessOut = itemsToProcess;
        
        const newLedgerDocRefSrc = doc(collection(db, 'ledger'));
        const newTransferRef = doc(collection(db, 'stock_transfers'));
        finalNewTransferId = newTransferRef.id;

        // Process each item
        const transferredItemNames = [];
        let totalTransferAmount = 0;
        for (const item of itemsToProcess) {
          transferredItemNames.push(`${item.qty}x ${item.data.name}`);
          const itemCost = item.data.cost || 0;
          totalTransferAmount += itemCost * item.qty;
        }
        recordedTransferAmount = totalTransferAmount;

        // 1. DEDUCT stock from SOURCE branch inventory
        for (const item of itemsToProcess) {
          const newSourceStock = item.data.stock - item.qty;
          transaction.update(item.ref, { 
            stock: newSourceStock,
            updatedAt: Timestamp.now() 
          });
        }

        // NOTE: Stock is NOT automatically added to destination branch.
        // Destination branch staff will enter/receive stock via "Incoming Stock" tab.
        
        // 2. Record Source branch Ledger entry (OUT)
        transaction.set(newLedgerDocRefSrc, {
          branchId: sourceBranchId,
          date: selectedDate,
          description: `Dispatched stock to ${destBranchName}${carrierName ? ` via ${carrierName}` : ''}: ${transferredItemNames.join(', ')}`,
          category: 'Stock Transfer',
          type: 'OUT',
          amount: totalTransferAmount,
          reference: transferAccount || `str_${newTransferRef.id}`,
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });

        // 3. Create stock transfer record with status 'Pending'
        transaction.set(newTransferRef, {
          fromBranchId: sourceBranchId,
          toBranchId: destBranchId,
          destBranchId: destBranchId,
          fromBranchName: srcBranchName,
          toBranchName: destBranchName,
          carrierName: carrierName.trim() || null,
          amount: totalTransferAmount,
          items: itemsToProcess.map(i => ({
            id: i.id,
            name: i.data.name,
            sku: i.data.sku || '',
            category: i.data.category || 'General',
            qty: i.qty,
            cost: i.data.cost || 0,
            price: i.data.price || 0,
            minStockLevel: i.data.minStockLevel || 5
          })),
          status: 'Pending',
          date: selectedDate,
          createdAt: Timestamp.now(),
          createdBy: user?.name || user?.email || 'Unknown',
          receivedBy: null,
          acceptedAt: null,
          tenantId: user?.tenantId || user?.uid
        });
      });

      // Construct transfer object for print preview
      const transferSlipObj = {
        id: finalNewTransferId,
        fromBranchId: sourceBranchId,
        toBranchId: destBranchId,
        fromBranchName: srcBranchName,
        toBranchName: destBranchName,
        items: itemsToProcessOut.map(i => ({
          id: i.id,
          name: i.data.name,
          sku: i.data.sku || '',
          category: i.data.category || 'General',
          qty: i.qty,
          cost: i.data.cost || 0,
          price: i.data.price || 0,
          minStockLevel: i.data.minStockLevel || 5
        })),
        status: 'Pending',
        date: selectedDate,
        createdAt: new Date().getTime(),
        createdBy: user?.name || user?.email || 'Unknown',
        receivedBy: null,
        acceptedAt: null,
        carrierName: carrierName.trim() || null
      };

      setLastCompletedTransfer(transferSlipObj);
      setPrintTransfer(transferSlipObj);

      recordActivityLog({
        action: 'Stock Transfer Sent',
        category: 'Stock Transfer',
        details: `Dispatched ${itemsToProcessOut.length} items from ${srcBranchName} to ${destBranchName} (Total: PKR ${recordedTransferAmount.toLocaleString()})`,
        metadata: {
          transferId: finalNewTransferId,
          fromBranchId: sourceBranchId,
          toBranchId: destBranchId,
          totalAmount: recordedTransferAmount,
          itemsCount: itemsToProcessOut.length
        },
        branchId: sourceBranchId,
        user
      }).catch(() => {});

      setSuccessMsg(`Stock transferred successfully! Stock is OUT from ${srcBranchName}. ${destBranchName} can now receive and enter it into their inventory.`);
      setTransferList({});
      
      // Re-fetch source inventory & transfers
      fetchSourceInventory();
      fetchTransfers();

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Transfer failed. Please check stock and try again.");
    } finally {
      setIsTransferring(false);
    }
  };

  const filteredItems = sourceInventory.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.category && item.category.toLowerCase().includes(searchTerm.toLowerCase()))
  );
  
  // Related history depends on activeBranchId
  let myHistoryTransfers = !activeBranchId
    ? transfers 
    : transfers.filter(t => t.toBranchId === activeBranchId || t.destBranchId === activeBranchId || t.fromBranchId === activeBranchId);

  if (historyDateFrom) {
    const [fy, fm, fd] = historyDateFrom.split('-');
    const fDateObj = new Date(Number(fy), Number(fm) - 1, Number(fd));
    fDateObj.setHours(0, 0, 0, 0);
    const filterTimeFrom = fDateObj.getTime();
    myHistoryTransfers = myHistoryTransfers.filter(t => {
      const tTime = t.date || t.createdAt?.toMillis?.() || t.createdAt?.seconds * 1000 || t.createdAt || 0;
      return tTime >= filterTimeFrom;
    });
  }
  if (historyDateTo) {
    const [ty2, tm2, td2] = historyDateTo.split('-');
    const tDateObj2 = new Date(Number(ty2), Number(tm2) - 1, Number(td2));
    tDateObj2.setHours(23, 59, 59, 999);
    const filterTimeTo = tDateObj2.getTime();
    myHistoryTransfers = myHistoryTransfers.filter(t => {
      const tTime = t.date || t.createdAt?.toMillis?.() || t.createdAt?.seconds * 1000 || t.createdAt || 0;
      return tTime < filterTimeTo;
    });
  }
  if (historySearchTerm.trim()) {
    const term = historySearchTerm.trim().toLowerCase();
    myHistoryTransfers = myHistoryTransfers.filter(t => {
      const matchBranch = (t.fromBranchName && t.fromBranchName.toLowerCase().includes(term)) ||
                          (t.toBranchName && t.toBranchName.toLowerCase().includes(term));
      const matchCreator = t.createdBy && t.createdBy.toLowerCase().includes(term);
      const matchId = t.id && t.id.toLowerCase().includes(term);
      const matchItems = t.items && t.items.some((i: any) => 
        (i.name && i.name.toLowerCase().includes(term)) ||
        (i.sku && i.sku.toLowerCase().includes(term)) ||
        (i.category && i.category.toLowerCase().includes(term))
      );
      return matchBranch || matchCreator || matchId || matchItems;
    });
  }

  // Article-Wise Transfer Report Aggregation
  const articleWiseReport = (() => {
    let filtered = transfers.filter(t => {
      if (articleFilterFromBranch && t.fromBranchId !== articleFilterFromBranch) return false;
      if (articleFilterToBranch && (t.toBranchId !== articleFilterToBranch && t.destBranchId !== articleFilterToBranch)) return false;

      const tTime = t.date || t.createdAt?.toMillis?.() || t.createdAt?.seconds * 1000 || t.createdAt || 0;
      if (articleDateFrom) {
        const [fy, fm, fd] = articleDateFrom.split('-');
        const fDateObj = new Date(Number(fy), Number(fm) - 1, Number(fd));
        fDateObj.setHours(0, 0, 0, 0);
        if (tTime < fDateObj.getTime()) return false;
      }
      if (articleDateTo) {
        const [ty, tm, td] = articleDateTo.split('-');
        const tDateObj = new Date(Number(ty), Number(tm) - 1, Number(td));
        tDateObj.setHours(23, 59, 59, 999);
        if (tTime > tDateObj.getTime()) return false;
      }
      return true;
    });

    const groups: { [key: string]: {
      key: string;
      articleName: string;
      sku: string;
      category: string;
      totalQty: number;
      totalCost: number;
      totalPrice: number;
      branchBreakdown: { [branchName: string]: { qty: number; cost: number; price: number } };
      transfers: Array<{
        id: string;
        date: number;
        fromBranchName: string;
        toBranchName: string;
        qty: number;
        cost: number;
        price: number;
        createdBy: string;
        status: string;
      }>;
    }} = {};

    const searchLower = articleSearchQuery.trim().toLowerCase();

    for (const t of filtered) {
      if (!t.items || !Array.isArray(t.items)) continue;
      const tTime = t.date || t.createdAt?.toMillis?.() || t.createdAt?.seconds * 1000 || t.createdAt || 0;

      for (const item of t.items) {
        const name = item.name || 'Unnamed Article';
        const sku = item.sku || '';
        const category = item.category || '';

        if (searchLower) {
          const matchName = name.toLowerCase().includes(searchLower);
          const matchSku = sku.toLowerCase().includes(searchLower);
          const matchCat = category.toLowerCase().includes(searchLower);
          if (!matchName && !matchSku && !matchCat) continue;
        }

        const key = `${name.toLowerCase()}___${sku.toLowerCase()}`;
        if (!groups[key]) {
          groups[key] = {
            key,
            articleName: name,
            sku,
            category,
            totalQty: 0,
            totalCost: 0,
            totalPrice: 0,
            branchBreakdown: {},
            transfers: []
          };
        }

        const qty = Number(item.qty) || 0;
        const unitCost = item.cost !== undefined ? Number(item.cost) : (Number(item.price) || 0);
        const unitPrice = item.price !== undefined ? Number(item.price) : unitCost;
        const totalCost = unitCost * qty;
        const totalPrice = unitPrice * qty;

        groups[key].totalQty += qty;
        groups[key].totalCost += totalCost;
        groups[key].totalPrice += totalPrice;

        const destName = t.toBranchName || 'Destination';
        if (!groups[key].branchBreakdown[destName]) {
          groups[key].branchBreakdown[destName] = { qty: 0, cost: 0, price: 0 };
        }
        groups[key].branchBreakdown[destName].qty += qty;
        groups[key].branchBreakdown[destName].cost += totalCost;
        groups[key].branchBreakdown[destName].price += totalPrice;

        groups[key].transfers.push({
          id: t.id,
          date: tTime,
          fromBranchName: t.fromBranchName || 'Source',
          toBranchName: destName,
          qty,
          cost: unitCost,
          price: unitPrice,
          createdBy: t.createdBy || '',
          status: t.status || 'Pending'
        });
      }
    }

    return Object.values(groups).sort((a, b) => b.totalQty - a.totalQty);
  })();

  const reportTotalUnits = articleWiseReport.reduce((sum, a) => sum + a.totalQty, 0);
  const reportTotalCost = articleWiseReport.reduce((sum, a) => sum + a.totalCost, 0);
  const reportTotalPrice = articleWiseReport.reduce((sum, a) => sum + a.totalPrice, 0);
  
  return (
    <>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6 print:hidden">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center">
            <ArrowRightLeft className="w-6 h-6 mr-2 text-sky-600" />
            Stock Transfer (اسٹاک ٹرانسفر)
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Move inventory between branches. Stock is deducted from source branch and received by destination branch.
          </p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 gap-4 sm:gap-6 overflow-x-auto">
        <button
          onClick={() => setActiveTab('send')}
          className={`pb-3 font-bold text-sm border-b-2 transition-colors flex items-center whitespace-nowrap ${activeTab === 'send' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          <ArrowRightLeft className="w-4 h-4 mr-2" />
          Transfer Stock (اسٹاک بھیجیں)
        </button>

        <button
          onClick={() => setActiveTab('incoming')}
          className={`pb-3 font-bold text-sm border-b-2 transition-colors flex items-center relative whitespace-nowrap ${activeTab === 'incoming' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          <Inbox className="w-4 h-4 mr-2" />
          Incoming Stock (وصولی اسٹاک)
          {myIncomingTransfers.length > 0 && (
            <span className="ml-2 bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full font-black animate-pulse shadow-sm">
              {myIncomingTransfers.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`pb-3 font-bold text-sm border-b-2 transition-colors flex items-center whitespace-nowrap ${activeTab === 'history' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          <History className="w-4 h-4 mr-2" />
          Transfer History (ٹرانسفر ریکارڈ)
        </button>

        <button
          onClick={() => setActiveTab('article_report')}
          className={`pb-3 font-bold text-sm border-b-2 transition-colors flex items-center whitespace-nowrap ${activeTab === 'article_report' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          <BarChart3 className="w-4 h-4 mr-2" />
          Article-Wise Report
        </button>
      </div>

      {errorMsg && (
        <div className="bg-rose-50 text-rose-700 p-4 rounded-lg flex items-start border border-rose-200 shadow-sm">
          <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{errorMsg}</p>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 text-emerald-700 p-4 rounded-lg flex items-start justify-between border border-emerald-200 shadow-sm">
          <div className="flex items-start">
            <CheckCircle2 className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold">{successMsg}</p>
              <p className="text-xs mt-1">Records and ledgers have been updated securely.</p>
            </div>
          </div>
          {lastCompletedTransfer && (
            <button
              onClick={() => setPrintTransfer(lastCompletedTransfer)}
              className="ml-4 text-xs flex items-center px-3 py-1.5 bg-emerald-600 text-white font-semibold rounded hover:bg-emerald-700 transition shrink-0 shadow-sm"
            >
              <Printer className="w-3.5 h-3.5 mr-1.5" /> Print Transfer Slip
            </button>
          )}
        </div>
      )}

      {/* TAB 1: SEND TRANSFER */}
      {activeTab === 'send' && (
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col md:flex-row gap-6">
          
          {/* Source Branch */}
          <div className="flex-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Source Branch (مال کہاں سے نکالنا ہے)
            </label>
            <div className="relative">
              <Building className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={sourceBranchId}
                onChange={(e) => setSourceBranchId(e.target.value)}
                disabled={!!activeBranchId}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm font-medium disabled:bg-slate-100 dark:disabled:bg-slate-800"
              >
                <option value="">Select Source Branch</option>
                {actualBranches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              * منتخب کردہ برانچ کی انوینٹری سے فوری اسٹاک کٹ جائے گا (Stock OUT)
            </p>
          </div>

          <div className="hidden md:flex items-center justify-center pt-6">
            <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center">
              <ArrowRightLeft className="w-4 h-4" />
            </div>
          </div>

          {/* Destination Branch */}
          <div className="flex-1">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Destination Branch (مال کس برانچ کو بھیجنا ہے)
            </label>
            <div className="relative">
              <Building className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={destBranchId}
                onChange={(e) => setDestBranchId(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm font-medium"
              >
                <option value="">Select Destination Branch</option>
                {actualBranches.filter(b => b.id !== sourceBranchId).map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold mt-1">
              * اگلی برانچ اپنے 'Incoming Stock' میں وصول کر کے انوینٹری میں خود شامل کرے گی
            </p>
          </div>

          {/* Date */}
          <div className="w-full md:w-48">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Transfer Date
            </label>
            <input
              type="datetime-local"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm"
            />
          </div>

          {/* Carrier Name */}
          <div className="w-full md:w-56">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Carrier Name (لڑکے کا نام)
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Enter name (Optional)"
                value={carrierName}
                onChange={(e) => setCarrierName(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm"
              />
            </div>
          </div>
        </div>


        {/* Product Selection */}
        {!sourceBranchId ? (
          <div className="p-12 text-center text-slate-500 dark:text-slate-400">
            <Building className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-semibold text-base">Please select a Source Branch first</p>
            <p className="text-xs text-slate-400 mt-1">Inventory items from the selected source branch will be shown here.</p>
          </div>
        ) : (
          <div className="p-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <div className="relative flex-1 w-full sm:w-auto">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search articles by name, SKU, or category in source branch..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm"
                />
              </div>
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {filteredItems.length} article(s) in source stock
              </div>
            </div>

            {loadingInventory ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading source inventory...</div>
            ) : filteredItems.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400 border border-dashed rounded-lg">
                No stock available to transfer in this branch.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[420px] border border-slate-200 dark:border-slate-700 rounded-lg">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                    <tr>
                      <th className="p-3">Article / Product</th>
                      <th className="p-3">SKU / Code</th>
                      <th className="p-3 text-right">Cost Price (CP)</th>
                      <th className="p-3 text-center">Available Stock</th>
                      <th className="p-3 text-center w-48">Transfer Qty (بھیجیں)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {filteredItems.map(item => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="p-3 font-semibold text-slate-800 dark:text-slate-100">
                          {item.name}
                          {item.category && <span className="block text-[11px] text-slate-400 font-normal">{item.category}</span>}
                        </td>
                        <td className="p-3 text-slate-500 dark:text-slate-400 font-mono text-xs">{item.sku || '-'}</td>
                        <td className="p-3 text-right font-mono font-semibold text-slate-700 dark:text-slate-200">
                          PKR {(item.cost || item.price || 0).toLocaleString()}
                        </td>
                        <td className="p-3 text-center">
                          <span className="bg-sky-50 text-sky-700 font-bold px-2 py-0.5 rounded text-xs">
                            {item.stock} in stock
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const curr = transferList[item.id] || 0;
                                if (curr > 0) handleQtyChange(item.id, (curr - 1).toString(), item.stock);
                              }}
                              className="p-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 disabled:opacity-30"
                              disabled={!transferList[item.id]}
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              min="0"
                              max={item.stock}
                              value={transferList[item.id] !== undefined ? transferList[item.id] : ''}
                              placeholder="0"
                              onChange={(e) => handleQtyChange(item.id, e.target.value, item.stock)}
                              className="w-16 text-center border border-slate-300 dark:border-slate-600 rounded p-1 text-sm font-bold bg-white dark:bg-slate-900"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const curr = transferList[item.id] || 0;
                                if (curr < item.stock) handleQtyChange(item.id, (curr + 1).toString(), item.stock);
                              }}
                              className="p-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 disabled:opacity-30"
                              disabled={(transferList[item.id] || 0) >= item.stock}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Transfer Button Summary Bar */}
        {Object.keys(transferList).length > 0 && (
          <div className="p-5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
              <span className="font-bold text-sky-600">{Object.keys(transferList).length}</span> item(s) selected for transfer.
              <span className="block text-xs text-slate-400 mt-0.5">
                Total Qty: {Object.values(transferList).reduce((a: number, b: number) => a + (Number(b) || 0), 0)} units
              </span>
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
              <button 
                onClick={clearForm}
                className="flex-1 sm:flex-initial px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                Cancel
              </button>
              <button
                onClick={handleTransfer}
                disabled={isTransferring || !destBranchId}
                className="flex-1 sm:flex-initial flex items-center justify-center px-6 py-2 bg-sky-600 text-white text-sm font-bold rounded-lg hover:bg-sky-700 transition disabled:opacity-50 shadow-sm"
              >
                {isTransferring ? 'Dispatching Stock...' : 'Dispatch / Send Stock'}
                {!isTransferring && <ArrowRightLeft className="w-4 h-4 ml-2" />}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* TAB 2: INCOMING TRANSFERS (RECEIVE STOCK) */}
      {activeTab === 'incoming' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Inbox className="w-5 h-5 text-sky-600" />
                Incoming Stock Transfers (وصولی اسٹاک)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Review and accept stock sent from other branches to enter it into your branch inventory.
              </p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>{myIncomingTransfers.length} Pending Incoming Shipment(s)</span>
            </div>
          </div>

          {loadingTransfers ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">Loading incoming transfers...</div>
          ) : myIncomingTransfers.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800/50 rounded-full flex items-center justify-center mb-4">
                <Inbox className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">No Pending Incoming Transfers</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm max-w-md">
                There are currently no pending stock transfers waiting to be received in this branch.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {myIncomingTransfers.map(transfer => {
                const totalUnits = transfer.items?.reduce((sum: number, i: any) => sum + (Number(i.qty) || 0), 0) || 0;
                const totalCost = transfer.items?.reduce((sum: number, i: any) => sum + ((i.cost !== undefined ? i.cost : (i.price || 0)) * (i.qty || 0)), 0) || transfer.amount || 0;

                return (
                  <div key={transfer.id} className="p-5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-black bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                            <Clock className="w-3 h-3" /> In-Transit / Pending
                          </span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            {new Date(transfer.date || transfer.createdAt?.toMillis?.() || transfer.createdAt || 0).toLocaleString()}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            Ref: #{transfer.id.substring(0, 8).toUpperCase()}
                          </span>
                        </div>
                        <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                          <span>From: <strong className="text-sky-600">{transfer.fromBranchName}</strong></span>
                          <ArrowRightLeft className="w-4 h-4 text-slate-400" />
                          <span>To: <strong className="text-emerald-600">{transfer.toBranchName}</strong></span>
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Dispatched by: <span className="font-semibold text-slate-700 dark:text-slate-200">{transfer.createdBy}</span>
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 font-bold px-2.5 py-1 rounded border border-sky-200 dark:border-sky-800">
                            Total Units: {totalUnits} pcs
                          </span>
                          <span className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold px-2.5 py-1 rounded border border-emerald-200 dark:border-emerald-800">
                            Total Value: PKR {totalCost.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPrintTransfer(transfer)}
                          className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-lg transition flex items-center border border-slate-200 dark:border-slate-700"
                        >
                          <Printer className="w-3.5 h-3.5 mr-1" /> Slip
                        </button>
                        <button
                          onClick={() => handleReceiveStock(transfer)}
                          disabled={isTransferring}
                          className="flex items-center px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition shadow-sm disabled:opacity-50"
                        >
                          <Check className="w-4 h-4 mr-1.5" />
                          {isTransferring ? 'Adding to Inventory...' : 'Accept & Add to Inventory (وصول کریں)'}
                        </button>
                      </div>
                    </div>

                    {/* Items List in this incoming transfer */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                      <h5 className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        Items in Shipment ({transfer.items?.length || 0} items)
                      </h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {transfer.items?.map((item: any, idx: number) => (
                          <div key={idx} className="bg-white dark:bg-slate-900 p-2.5 border border-slate-200 dark:border-slate-700 rounded text-xs flex justify-between items-center shadow-2xs">
                            <div className="truncate pr-2">
                              <span className="font-bold text-slate-800 dark:text-slate-100 block truncate">{item.name}</span>
                              {item.sku && <span className="font-mono text-[10px] text-slate-400">SKU: {item.sku}</span>}
                            </div>
                            <span className="font-black text-sky-600 bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800 px-2 py-0.5 rounded shrink-0">
                              x{item.qty} pcs
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TRANSFER HISTORY */}
      {activeTab === 'history' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Transfer History Log</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">View sent and received stock transfers between branches.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-60 min-w-[180px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search article, SKU, slip..."
                  value={historySearchTerm}
                  onChange={(e) => setHistorySearchTerm(e.target.value)}
                  className="w-full pl-9 pr-7 py-1.5 border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 text-sm"
                />
                {historySearchTerm && (
                  <button
                    onClick={() => setHistorySearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">From:</label>
                <input
                  type="date"
                  value={historyDateFrom}
                  onChange={(e) => setHistoryDateFrom(e.target.value)}
                  className="border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 p-1.5 border text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">To:</label>
                <input
                  type="date"
                  value={historyDateTo}
                  onChange={(e) => setHistoryDateTo(e.target.value)}
                  className="border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 p-1.5 border text-xs"
                />
              </div>
              {(historyDateFrom || historyDateTo) && (
                <button onClick={() => { setHistoryDateFrom(''); setHistoryDateTo(''); }} className="text-slate-400 hover:text-slate-600" title="Clear Dates">
                  <X className="w-4 h-4" />
                </button>
              )}
              <select
                value={historyBranchFilter}
                onChange={(e) => setHistoryBranchFilter(e.target.value)}
                className="border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:border-sky-500 dark:focus:border-sky-400 focus:ring-sky-500 dark:focus:ring-sky-400 bg-white dark:bg-slate-900 p-1.5 border text-xs max-w-[140px]"
              >
                <option value="">{activeBranchId ? "All Branches" : "Select Branch"}</option>
                {actualBranches.filter(b => b.id !== activeBranchId).map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <button onClick={() => { setPrintLedger(true); setTimeout(() => window.print(), 100); }} className="bg-sky-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center hover:bg-sky-700 transition shadow-sm">
                <Printer className="w-3.5 h-3.5 mr-1" /> Print Ledger
              </button>
            </div>
          </div>

          {loadingTransfers ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading history...</div>
          ) : (
            <div className="p-4 md:p-6 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex gap-2 mb-6 border-b border-slate-200 dark:border-slate-700 pb-4">
                <button
                  onClick={() => setHistoryTab('sent')}
                  className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${historyTab === 'sent' ? 'bg-sky-100 text-sky-700 border border-sky-200' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                >
                  <ArrowRightLeft className="w-4 h-4 inline-block mr-2" />
                  Sent Transfers (بھیجے گئے)
                </button>
                <button
                  onClick={() => setHistoryTab('received')}
                  className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors ${historyTab === 'received' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                >
                  <Inbox className="w-4 h-4 inline-block mr-2" />
                  Received Transfers (وصول شدہ)
                </button>
              </div>

              {historyTab === 'sent' && (
              <div>
                {myHistoryTransfers.filter(t => {
                  const contextBranchId = activeBranchId;
                  const filterBranchId = historyBranchFilter;
                  if (contextBranchId && t.fromBranchId !== contextBranchId) return false;
                  if (filterBranchId) {
                    if (contextBranchId && t.toBranchId !== filterBranchId && t.destBranchId !== filterBranchId) return false;
                    if (!contextBranchId && t.fromBranchId !== filterBranchId) return false;
                  }
                  return true;
                }).length === 0 ? (
                  <div className="text-center p-8 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No sent transfers found.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {myHistoryTransfers.filter(t => {
                      const contextBranchId = activeBranchId;
                      const filterBranchId = historyBranchFilter;
                      if (contextBranchId && t.fromBranchId !== contextBranchId) return false;
                      if (filterBranchId) {
                        if (contextBranchId && t.toBranchId !== filterBranchId && t.destBranchId !== filterBranchId) return false;
                        if (!contextBranchId && t.fromBranchId !== filterBranchId) return false;
                      }
                      return true;
                    }).map(transfer => {
                        const totalAmount = transfer.items?.reduce((sum: number, i: any) => sum + ((i.cost !== undefined ? i.cost : (i.price || 0)) * (i.qty || 0)), 0) || transfer.amount || 0;
                        const isPending = transfer.status === 'Pending' || transfer.status === 'PENDING' || transfer.status === 'In-Transit';
                        const isCancelled = transfer.status === 'CANCELLED';

                        return (
                          <div key={transfer.id} className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4 hover:shadow-md transition">
                            <div className="flex flex-col md:flex-row justify-between mb-3 gap-2">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  {transfer.status === 'COMPLETED' ? (
                                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                                      <CheckCircle className="w-3 h-3" /> Completed
                                    </span>
                                  ) : isCancelled ? (
                                    <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                                      <Ban className="w-3 h-3" /> Cancelled
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> In-Transit / Pending
                                    </span>
                                  )}
                                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{new Date(transfer.date || transfer.createdAt?.toMillis?.() || transfer.createdAt?.seconds * 1000 || transfer.createdAt || 0).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 text-sm">
                                   <Building className="w-3.5 h-3.5 text-slate-400" />
                                   <span className="font-bold">{transfer.fromBranchName}</span>
                                   <ArrowRightLeft className="w-3.5 h-3.5 text-slate-300 mx-1" />
                                   <Building className="w-3.5 h-3.5 text-slate-400" />
                                   <span className="font-bold">{transfer.toBranchName}</span>
                                </div>
                              </div>
                              <div className="text-right text-xs text-slate-500 dark:text-slate-400 flex flex-col items-end">
                                <div className="font-bold text-slate-800 dark:text-slate-100 mb-1 text-sm border bg-sky-50 dark:bg-sky-950 border-sky-100 dark:border-sky-800 px-2 py-1 rounded">
                                  Cost Amount: <span className="text-sky-600">PKR {totalAmount.toLocaleString()}</span>
                                </div>
                                <div>Sent by: <span className="font-medium text-slate-700 dark:text-slate-200">{transfer.createdBy}</span></div>
                                {transfer.receivedBy && <div>Received by: <span className="font-medium text-slate-700 dark:text-slate-200">{transfer.receivedBy}</span></div>}
                                {transfer.carrierName && <div>Carrier: <span className="font-medium text-slate-700 dark:text-slate-200">{transfer.carrierName}</span></div>}
                                <div className="mt-2 flex items-center gap-1.5">
                                  {isPending && (
                                    <button
                                      onClick={() => handleCancelTransfer(transfer)}
                                      disabled={isTransferring}
                                      className="text-xs flex items-center px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold border border-rose-200 rounded transition shrink-0"
                                      title="Cancel and return stock to source branch"
                                    >
                                      <Ban className="w-3 h-3 mr-1" /> Cancel Transfer
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setPrintTransfer(transfer)}
                                    className="text-xs flex items-center px-2 py-1 bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700 rounded transition shrink-0"
                                  >
                                    <Printer className="w-3.5 h-3.5 mr-1" /> Print Slip
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800/50 rounded p-2">
                              <div className="flex flex-wrap gap-1.5 text-[11px]">
                                {transfer.items?.map((item: any, idx: number) => (
                                  <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 flex items-center shadow-xs">
                                    <span className="font-bold text-sky-600 bg-sky-50 dark:bg-sky-950 px-1 py-0.5 rounded mr-1">{item.qty}x</span> 
                                    {item.name}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                     })}
                  </div>
                )}
              </div>
              )}

              {historyTab === 'received' && (
              <div>
                {myHistoryTransfers.filter(t => {
                  const contextBranchId = activeBranchId;
                  const filterBranchId = historyBranchFilter;
                  if (contextBranchId && t.toBranchId !== contextBranchId && t.destBranchId !== contextBranchId) return false;
                  if (filterBranchId) {
                    if (contextBranchId && t.fromBranchId !== filterBranchId) return false;
                    if (!contextBranchId && t.toBranchId !== filterBranchId && t.destBranchId !== filterBranchId) return false;
                  }
                  return true;
                }).length === 0 ? (
                  <div className="text-center p-8 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No received transfers found.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {myHistoryTransfers.filter(t => {
                      const contextBranchId = activeBranchId;
                      const filterBranchId = historyBranchFilter;
                      if (contextBranchId && t.toBranchId !== contextBranchId && t.destBranchId !== contextBranchId) return false;
                      if (filterBranchId) {
                        if (contextBranchId && t.fromBranchId !== filterBranchId) return false;
                        if (!contextBranchId && t.toBranchId !== filterBranchId && t.destBranchId !== filterBranchId) return false;
                      }
                      return true;
                    }).map(transfer => {
                        const totalAmount = transfer.items?.reduce((sum: number, i: any) => sum + ((i.cost !== undefined ? i.cost : (i.price || 0)) * (i.qty || 0)), 0) || transfer.amount || 0;
                        const isPending = transfer.status === 'Pending' || transfer.status === 'PENDING' || transfer.status === 'In-Transit';

                        return (
                          <div key={transfer.id} className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-4 hover:shadow-md transition">
                            <div className="flex flex-col md:flex-row justify-between mb-3 gap-2">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  {transfer.status === 'COMPLETED' ? (
                                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                                      <CheckCircle className="w-3 h-3" /> Completed
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> In-Transit / Pending
                                    </span>
                                  )}
                                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{new Date(transfer.date || transfer.createdAt?.toMillis?.() || transfer.createdAt?.seconds * 1000 || transfer.createdAt || 0).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 text-sm">
                                   <Building className="w-3.5 h-3.5 text-slate-400" />
                                   <span className="font-bold">{transfer.fromBranchName}</span>
                                   <ArrowRightLeft className="w-3.5 h-3.5 text-slate-300 mx-1" />
                                   <Building className="w-3.5 h-3.5 text-slate-400" />
                                   <span className="font-bold">{transfer.toBranchName}</span>
                                </div>
                              </div>
                              <div className="text-right text-xs text-slate-500 dark:text-slate-400 flex flex-col items-end">
                                <div className="font-bold text-slate-800 dark:text-slate-100 mb-1 text-sm border bg-emerald-50 dark:bg-emerald-950 border-emerald-100 dark:border-emerald-800 px-2 py-1 rounded">
                                  Cost Amount: <span className="text-emerald-600">PKR {totalAmount.toLocaleString()}</span>
                                </div>
                                <div>Sent by: <span className="font-medium text-slate-700 dark:text-slate-200">{transfer.createdBy}</span></div>
                                {transfer.receivedBy && <div>Received by: <span className="font-medium text-slate-700 dark:text-slate-200">{transfer.receivedBy}</span></div>}
                                {transfer.carrierName && <div>Carrier: <span className="font-medium text-slate-700 dark:text-slate-200">{transfer.carrierName}</span></div>}
                                <div className="mt-2 flex items-center gap-1.5">
                                  {isPending && (
                                    <button
                                      onClick={() => handleReceiveStock(transfer)}
                                      disabled={isTransferring}
                                      className="text-xs flex items-center px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded transition shrink-0 shadow-xs"
                                    >
                                      <Check className="w-3 h-3 mr-1" /> Accept Stock
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setPrintTransfer(transfer)}
                                    className="text-xs flex items-center px-2 py-1 bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700 rounded transition shrink-0"
                                  >
                                    <Printer className="w-3.5 h-3.5 mr-1" /> Print Slip
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800/50 rounded p-2">
                              <div className="flex flex-wrap gap-1.5 text-[11px]">
                                {transfer.items?.map((item: any, idx: number) => (
                                  <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 flex items-center shadow-xs">
                                    <span className="font-bold text-sky-600 bg-sky-50 dark:bg-sky-950 px-1 py-0.5 rounded mr-1">{item.qty}x</span> 
                                    {item.name}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                     })}
                  </div>
                )}
              </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: ARTICLE WISE REPORT */}
      {activeTab === 'article_report' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden space-y-6 p-5">
          {/* Header & Filter Controls */}
          <div className="flex flex-col gap-4 border-b border-slate-200 dark:border-slate-700 pb-5">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-sky-600" />
                  Article-Wise Stock Transfer Report
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Track which products were transferred to other branches, total quantities, and branch-wise breakdown.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPrintArticleReport(true)}
                  className="px-3.5 py-2 bg-sky-600 text-white rounded-lg text-xs font-bold flex items-center hover:bg-sky-700 transition shadow-sm"
                >
                  <Printer className="w-3.5 h-3.5 mr-1.5" /> Print Article Report
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2">
              {/* Article Search Bar */}
              <div className="relative lg:col-span-2">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Search Article / Item</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by article name, SKU, category..."
                    value={articleSearchQuery}
                    onChange={(e) => setArticleSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 text-xs border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 bg-white dark:bg-slate-900"
                  />
                  {articleSearchQuery && (
                    <button
                      onClick={() => setArticleSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* From Branch Filter */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">From Branch</label>
                <select
                  value={articleFilterFromBranch}
                  onChange={(e) => setArticleFilterFromBranch(e.target.value)}
                  disabled={!!activeBranchId}
                  className="w-full py-2 px-2.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 bg-white dark:bg-slate-900 disabled:opacity-60 disabled:bg-slate-100 dark:disabled:bg-slate-800"
                >
                  <option value="">All Source Branches</option>
                  {actualBranches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              {/* To Branch Filter */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">To Branch (Destination)</label>
                <select
                  value={articleFilterToBranch}
                  onChange={(e) => setArticleFilterToBranch(e.target.value)}
                  className="w-full py-2 px-2.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg shadow-sm focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 bg-white dark:bg-slate-900"
                >
                  <option value="">All Destination Branches</option>
                  {actualBranches.filter(b => b.id !== articleFilterFromBranch).map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              {/* Date Filters */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Date Range</label>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={articleDateFrom}
                    onChange={(e) => setArticleDateFrom(e.target.value)}
                    className="w-1/2 p-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                    title="From Date"
                  />
                  <span className="text-slate-400 text-xs">-</span>
                  <input
                    type="date"
                    value={articleDateTo}
                    onChange={(e) => setArticleDateTo(e.target.value)}
                    className="w-1/2 p-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                    title="To Date"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-sky-50/50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/50 rounded-xl p-3.5">
              <span className="text-[11px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider block mb-1">Total Units Sent</span>
              <span className="text-xl font-black text-sky-700 dark:text-sky-300">{reportTotalUnits} <span className="text-xs font-medium text-sky-600">pcs</span></span>
            </div>
            <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-3.5">
              <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block mb-1">Total Cost Value (CP)</span>
              <span className="text-lg font-black text-emerald-700 dark:text-emerald-300 font-mono">PKR {reportTotalCost.toLocaleString()}</span>
            </div>
            <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/50 rounded-xl p-3.5">
              <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider block mb-1">Total Retail Value (SP)</span>
              <span className="text-lg font-black text-indigo-700 dark:text-indigo-300 font-mono">PKR {reportTotalPrice.toLocaleString()}</span>
            </div>
          </div>

          {/* Article-Wise Data Table */}
          {loadingTransfers ? (
            <div className="py-12 text-center text-slate-400 font-medium">Loading transfer records...</div>
          ) : articleWiseReport.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-700">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="font-bold text-slate-700 dark:text-slate-200">No transferred articles found</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Try searching another article name or adjusting the branch and date filters.
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-xs uppercase tracking-wider">Article / Product</th>
                      <th className="px-4 py-3 text-center text-xs uppercase tracking-wider">Total Qty Sent</th>
                      <th className="px-4 py-3 text-xs uppercase tracking-wider">Branches Sent To (Breakdown)</th>
                      <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Total Cost (CP)</th>
                      <th className="px-4 py-3 text-right text-xs uppercase tracking-wider">Total Retail (SP)</th>
                      <th className="px-4 py-3 text-center text-xs uppercase tracking-wider w-24">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {articleWiseReport.map((article) => {
                      const isExpanded = expandedArticleKey === article.key;
                      return (
                        <Fragment key={article.key}>
                          <tr
                            className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${isExpanded ? 'bg-sky-50/30 dark:bg-sky-950/20' : ''}`}
                          >
                            <td className="px-4 py-3.5">
                              <div className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Package className="w-4 h-4 text-sky-600 shrink-0" />
                                <span>{article.articleName}</span>
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5 ml-6">
                                {article.sku && <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">SKU: {article.sku}</span>}
                                {article.category && <span>Category: {article.category}</span>}
                              </div>
                            </td>

                            <td className="px-4 py-3.5 text-center font-black text-sky-700 dark:text-sky-300">
                              <span className="bg-sky-100 dark:bg-sky-900/50 border border-sky-200 dark:border-sky-800 px-2.5 py-1 rounded-full text-xs font-bold font-mono inline-block">
                                {article.totalQty} pcs
                              </span>
                            </td>

                            <td className="px-4 py-3.5">
                              <div className="flex flex-wrap gap-1.5 max-w-md">
                                {Object.entries(article.branchBreakdown).map(([branchName, info], bIdx) => (
                                  <span
                                    key={bIdx}
                                    className="inline-flex items-center text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700"
                                  >
                                    <Building className="w-3 h-3 mr-1 text-slate-400" />
                                    <span className="font-medium mr-1">{branchName}:</span>
                                    <strong className="text-sky-600 font-mono">{info.qty} pcs</strong>
                                  </span>
                                ))}
                              </div>
                            </td>

                            <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-700 dark:text-slate-200">
                              PKR {article.totalCost.toLocaleString()}
                            </td>

                            <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-600 dark:text-slate-300">
                              PKR {article.totalPrice.toLocaleString()}
                            </td>

                            <td className="px-4 py-3.5 text-center">
                              <button
                                onClick={() => setExpandedArticleKey(isExpanded ? null : article.key)}
                                className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 hover:text-sky-700 dark:hover:text-sky-400 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 px-2 py-1 rounded border border-sky-200 dark:border-sky-800 transition"
                              >
                                {isExpanded ? (
                                  <>
                                    <span>Hide</span>
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  </>
                                ) : (
                                  <>
                                    <span>Details</span>
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Transfer History for this specific article */}
                          {isExpanded && (
                            <tr className="bg-slate-50/50 dark:bg-slate-800/40">
                              <td colSpan={6} className="px-6 py-4 border-y border-sky-100 dark:border-slate-800">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                      <History className="w-3.5 h-3.5 text-sky-600" />
                                      Transfer History Log for "{article.articleName}"
                                    </h4>
                                    <span className="text-[11px] text-slate-500">{article.transfers.length} transfer record(s)</span>
                                  </div>

                                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
                                    <table className="w-full text-xs text-left">
                                      <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                                        <tr>
                                          <th className="px-3 py-2">Transfer Date & Time</th>
                                          <th className="px-3 py-2">From Branch</th>
                                          <th className="px-3 py-2">To Branch</th>
                                          <th className="px-3 py-2 text-center">Quantity</th>
                                          <th className="px-3 py-2 text-right">Unit Cost</th>
                                          <th className="px-3 py-2 text-right">Total Cost</th>
                                          <th className="px-3 py-2">Transferred By</th>
                                          <th className="px-3 py-2">Carrier (لڑکا)</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {article.transfers.map((tx, txIdx) => (
                                          <tr key={txIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                            <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">
                                              {new Date(tx.date).toLocaleString()}
                                            </td>
                                            <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                                              {tx.fromBranchName}
                                            </td>
                                            <td className="px-3 py-2 font-bold text-sky-700 dark:text-sky-300">
                                              {tx.toBranchName}
                                            </td>
                                            <td className="px-3 py-2 text-center font-bold font-mono text-slate-800 dark:text-slate-100">
                                              <span className="bg-sky-50 dark:bg-sky-950 text-sky-600 px-1.5 py-0.5 rounded">
                                                {tx.qty} pcs
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400">
                                              PKR {tx.cost.toLocaleString()}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                                              PKR {(tx.cost * tx.qty).toLocaleString()}
                                            </td>
                                            <td className="px-3 py-2 text-slate-500">
                                              {tx.createdBy}
                                            </td>
                                            <td className="px-3 py-2 text-slate-500">
                                              {(tx as any).carrierName || '-'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      </div>
      
      {/* Printable Article-Wise Transfer Report Modal */}
      {printArticleReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 print:bg-white print:static print:inset-auto print:block print:z-auto backdrop-blur-sm print:backdrop-blur-none print:h-auto overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-[210mm] max-w-[95vw] max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none print:w-full h-auto p-8 overflow-y-auto print:overflow-visible relative">
            <div className="flex justify-between items-center pb-4 mb-6 border-b-2 border-slate-200 dark:border-slate-700 print:hidden shrink-0">
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-sky-600" />
                Print Article-Wise Stock Transfer Report
              </h2>
              <div className="flex space-x-2">
                <button onClick={() => window.print()} className="px-4 py-2 bg-sky-600 text-white rounded-lg font-bold hover:bg-sky-700 transition flex items-center text-sm shadow-sm">
                  <Printer className="w-4 h-4 mr-2" /> Print Report
                </button>
                <button onClick={() => setPrintArticleReport(false)} className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition text-sm">
                  Close
                </button>
              </div>
            </div>

            <div className="print-content text-black">
              <div className="text-center mb-6 border-b-2 border-black pb-4">
                <h1 className="text-2xl font-black uppercase tracking-wider text-black">ARTICLE-WISE STOCK TRANSFER REPORT</h1>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-1">
                  {articleFilterFromBranch ? `From: ${actualBranches.find(b => b.id === articleFilterFromBranch)?.name || 'Source Branch'}` : 'All Source Branches'}
                  {articleFilterToBranch ? `  ➔  To: ${actualBranches.find(b => b.id === articleFilterToBranch)?.name || 'Destination Branch'}` : ''}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  {(articleDateFrom || articleDateTo) ? `Date Range: ${articleDateFrom || 'Start'} to ${articleDateTo || 'End'}` : 'All Dates'}
                </p>
              </div>

              <table className="w-full text-xs text-left border-collapse border border-black mb-6">
                <thead>
                  <tr className="bg-slate-100 print:bg-transparent font-black border-b-2 border-black">
                    <th className="p-2 border border-black text-center w-8">#</th>
                    <th className="p-2 border border-black">Article Name</th>
                    <th className="p-2 border border-black">SKU</th>
                    <th className="p-2 border border-black text-center">Total Qty Sent</th>
                    <th className="p-2 border border-black">Destination Breakdown</th>
                    <th className="p-2 border border-black text-right">Cost Total (CP)</th>
                    <th className="p-2 border border-black text-right">Retail Total (SP)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black">
                  {articleWiseReport.map((item, idx) => (
                    <tr key={idx} className="border-b border-black">
                      <td className="p-2 border border-black text-center font-bold">{idx + 1}</td>
                      <td className="p-2 border border-black font-bold">{item.articleName}</td>
                      <td className="p-2 border border-black font-mono">{item.sku || '-'}</td>
                      <td className="p-2 border border-black text-center font-bold font-mono">{item.totalQty} pcs</td>
                      <td className="p-2 border border-black">
                        {Object.entries(item.branchBreakdown).map(([bName, bData], bI) => (
                          <span key={bI} className="inline-block mr-2 font-mono text-[10px]">
                            <strong>{bName}:</strong> {bData.qty} pcs
                          </span>
                        ))}
                      </td>
                      <td className="p-2 border border-black text-right font-mono font-bold">PKR {item.totalCost.toLocaleString()}</td>
                      <td className="p-2 border border-black text-right font-mono font-bold">PKR {item.totalPrice.toLocaleString()}</td>
                    </tr>
                  ))}
                  {articleWiseReport.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-4 text-center border border-black">No transferred articles found.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t-2 border-black font-black bg-slate-100 print:bg-transparent text-black">
                  <tr>
                    <td colSpan={3} className="p-2 text-right border border-black font-bold">TOTALS:</td>
                    <td className="p-2 text-center border border-black font-mono font-black">{reportTotalUnits}</td>
                    <td className="p-2 border border-black font-normal">{articleWiseReport.length} distinct article(s)</td>
                    <td className="p-2 text-right border border-black font-mono font-black">PKR {reportTotalCost.toLocaleString()}</td>
                    <td className="p-2 text-right border border-black font-mono font-black">PKR {reportTotalPrice.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>

              <div className="mt-8 text-center text-xs font-bold text-black uppercase print:block hidden">
                *** End of Article-Wise Stock Transfer Report ***
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock Transfer Ledger Modal */}
      {printLedger && (() => {
        const ledgerTransfers = myHistoryTransfers.filter((t: any) => {
          const contextBranchId = activeBranchId;
          const filterBranchId = historyBranchFilter;
          
          if (historyTab === 'sent') {
            if (contextBranchId && t.fromBranchId !== contextBranchId) return false;
            if (filterBranchId) {
              if (contextBranchId && t.toBranchId !== filterBranchId && t.destBranchId !== filterBranchId) return false;
              if (!contextBranchId && t.fromBranchId !== filterBranchId) return false;
            }
          } else if (historyTab === 'received') {
            if (contextBranchId && t.toBranchId !== contextBranchId && t.destBranchId !== contextBranchId) return false;
            if (filterBranchId) {
              if (contextBranchId && t.fromBranchId !== filterBranchId) return false;
              if (!contextBranchId && t.toBranchId !== filterBranchId && t.destBranchId !== filterBranchId) return false;
            }
          }
          return true;
        });
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 print:bg-white print:static print:inset-auto print:block print:z-auto backdrop-blur-sm print:backdrop-blur-none print:h-auto overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-[210mm] max-w-[95vw] max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none print:w-full h-auto p-8 overflow-y-auto print:overflow-visible relative">
            <div className="flex justify-between items-center pb-4 mb-6 border-b-2 border-slate-200 dark:border-slate-700 print:hidden shrink-0">
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Stock Transfer Ledger</h2>
              <div className="flex space-x-2">
                <button onClick={() => window.print()} className="px-4 py-2 bg-sky-600 text-white rounded-lg font-medium hover:bg-sky-700 transition flex items-center">
                  <Printer className="w-4 h-4 mr-2" /> Print
                </button>
                <button onClick={() => setPrintLedger(false)} className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">
                  Close
                </button>
              </div>
            </div>

            <div className="print-content hidden print:block mb-8 text-center border-b-2 border-black pb-4">
              <h1 className="text-3xl font-black text-black">STOCK TRANSFER LEDGER</h1>
              <p className="text-lg font-bold mt-1 text-slate-800 dark:text-slate-100">
                {(activeBranchId || historyBranchFilter) && actualBranches.find((b: any) => b.id === (activeBranchId || historyBranchFilter))?.name 
                  ? "Branch: " + actualBranches.find((b: any) => b.id === (activeBranchId || historyBranchFilter))?.name 
                  : "All Branches"}
              </p>
              <p className="text-md font-medium text-slate-600 dark:text-slate-300">
                {(historyDateFrom || historyDateTo) ? (
                  `Date: ${historyDateFrom ? new Date(historyDateFrom).toLocaleDateString() : 'Start'} - ${historyDateTo ? new Date(historyDateTo).toLocaleDateString() : 'End'}`
                ) : "All Dates"}
              </p>
            </div>

            <div className="w-full">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-black print:border-black text-black uppercase text-xs font-bold bg-slate-100 dark:bg-slate-950 print:bg-transparent">
                    <th className="p-3 print:p-2 border border-slate-300 dark:border-slate-600 print:border-black">Date</th>
                    <th className="p-3 print:p-2 border border-slate-300 dark:border-slate-600 print:border-black">From / To Branch</th>
                    <th className="p-3 print:p-2 border border-slate-300 dark:border-slate-600 print:border-black text-center">Suites (Qty)</th>
                    <th className="p-3 print:p-2 border border-slate-300 dark:border-slate-600 print:border-black text-right">Cost Amount (CP)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 print:divide-black">
                  {ledgerTransfers.map((t: any) => {
                    const totalQty = t.items?.reduce((sum: number, i: any) => sum + (i.qty || 0), 0) || 0;
                    const totalAmount = t.items?.reduce((sum: number, i: any) => sum + ((i.cost !== undefined ? i.cost : (i.price || 0)) * (i.qty || 0)), 0) || t.amount || 0;
                    const tDate = t.createdAt?.toMillis?.() || t.createdAt?.seconds * 1000 || t.createdAt || t.date || 0;
                    return (
                      <tr key={t.id} className="print:border-b print:border-black text-black font-medium">
                        <td className="p-3 print:p-2 border border-slate-300 dark:border-slate-600 print:border-black">{new Date(tDate).toLocaleString()}</td>
                        <td className="p-3 print:p-2 border border-slate-300 dark:border-slate-600 print:border-black">{t.fromBranchName} → {t.toBranchName}</td>
                        <td className="p-3 print:p-2 border border-slate-300 dark:border-slate-600 print:border-black text-center font-bold">{totalQty}</td>
                        <td className="p-3 print:p-2 border border-slate-300 dark:border-slate-600 print:border-black text-right font-bold font-mono">{(totalAmount || 0).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  {ledgerTransfers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-4 text-center border border-slate-300 dark:border-slate-600 print:border-black">No transfers found</td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t-4 border-black font-bold bg-slate-100 dark:bg-slate-950 print:bg-transparent text-black">
                  <tr>
                    <td colSpan={2} className="p-3 print:p-2 text-right border border-slate-300 dark:border-slate-600 print:border-black">TOTALS:</td>
                    <td className="p-3 print:p-2 text-center border border-slate-300 dark:border-slate-600 print:border-black">
                      {ledgerTransfers.reduce((sum: number, t: any) => sum + (t.items?.reduce((s: number, i: any) => s + (i.qty || 0), 0) || 0), 0)}
                    </td>
                    <td className="p-3 print:p-2 text-right border border-slate-300 dark:border-slate-600 print:border-black font-mono">
                      {ledgerTransfers.reduce((sum: number, t: any) => sum + (t.items?.reduce((s: number, i: any) => s + ((i.cost !== undefined ? i.cost : (i.price || 0)) * (i.qty || 0)), 0) || t.amount || 0), 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Stock Transfer Slip Print Modal */}
      {printTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 print:bg-transparent print:static print:inset-auto print:block print:z-auto backdrop-blur-sm print:backdrop-blur-none print:h-auto print:min-h-0">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-[80mm] max-w-[95vw] max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none h-full md:h-auto print:block print:h-auto print:min-h-0 print:w-[80mm] print:m-0">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800/50 print:hidden shrink-0">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Print Stock Transfer</h3>
              <button onClick={() => setPrintTransfer(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 bg-slate-100 dark:bg-slate-950 p-1.5 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div id="print-transfer-content" className="p-6 print:p-0 print:m-0 print:w-full print:max-w-full text-black bg-white dark:bg-slate-900 overflow-y-auto print:overflow-visible flex-1 content-start font-sans">
              <div className="text-center mb-4 print:mb-3">
                <h1 className="text-xl print:text-lg font-black uppercase tracking-widest leading-tight text-black">
                  Stock Transfer Slip
                </h1>
                {(branches.find(b => b.id === printTransfer.fromBranchId)?.phone || branches.find(b => b.id === printTransfer.fromBranchId)?.phone2) && (
                   <div className="mt-1 text-sm print:text-[10px] font-black text-black">
                     {branches.find(b => b.id === printTransfer.fromBranchId)?.phone && <span>Phone 1: {branches.find(b => b.id === printTransfer.fromBranchId)?.phone}</span>}
                     {branches.find(b => b.id === printTransfer.fromBranchId)?.phone && branches.find(b => b.id === printTransfer.fromBranchId)?.phone2 && <span> | </span>}
                     {branches.find(b => b.id === printTransfer.fromBranchId)?.phone2 && <span>Phone 2: {branches.find(b => b.id === printTransfer.fromBranchId)?.phone2}</span>}
                   </div>
                 )}
                 {branches.find(b => b.id === printTransfer.fromBranchId)?.address && (
                   <div className="mt-0.5 text-sm print:text-[10px] font-black text-black">
                     {branches.find(b => b.id === printTransfer.fromBranchId)?.address}
                   </div>
                 )}
                 {branches.find(b => b.id === printTransfer.fromBranchId)?.onlinePhone && (
                   <div className="mt-0.5 text-sm print:text-[10px] font-black text-black">
                     Online Support: {branches.find(b => b.id === printTransfer.fromBranchId)?.onlinePhone}
                   </div>
                 )}
                <div className="mt-1 text-[11px] print:text-[11px] font-black tracking-widest uppercase text-black border-y-2 border-black py-1">
                  Thermal Receipt
                </div>
              </div>

              <div className="text-[12px] print:text-[11px] font-mono text-black font-bold mb-3 space-y-1 border-b-2 border-dashed border-black pb-2">
                <div><span className="font-black">Transfer Ref:</span> #{printTransfer.id.substring(0, 10).toUpperCase()}</div>
                <div><span className="font-black">Status:</span> {printTransfer.status === 'COMPLETED' ? 'RECEIVED / COMPLETED' : printTransfer.status === 'CANCELLED' ? 'CANCELLED' : 'DISPATCHED (IN-TRANSIT)'}</div>
                <div><span className="font-black">Date:</span> {new Date(printTransfer.date || printTransfer.createdAt || 0).toLocaleString()}</div>
                <div><span className="font-black text-black">From Branch:</span> {printTransfer.fromBranchName}</div>
                <div><span className="font-black text-black">To Branch:</span> {printTransfer.toBranchName}</div>
                <div><span className="font-black text-black">Transferred By:</span> {printTransfer.createdBy}</div>
                {printTransfer.receivedBy && <div><span className="font-black text-black">Received By:</span> {printTransfer.receivedBy}</div>}
                {printTransfer.carrierName && <div><span className="font-black text-black">Name (نام):</span> {printTransfer.carrierName}</div>}
              </div>

              <div className="border-b-2 border-black pb-2 mb-2">
                <div className="flex justify-between text-[11px] font-black text-black uppercase tracking-wider mb-1 border-b-2 border-dashed border-black pb-1">
                  <span className="w-3/4 text-left">Item</span>
                  <span className="w-1/4 text-right">Qty</span>
                </div>
                <div className="space-y-2">
                  {printTransfer.items?.map((item: any, idx: number) => {
                    return (
                      <div key={idx} className="text-[12px] print:text-[11px] text-black font-mono font-bold leading-tight border-b border-dashed border-black pb-1.5 last:border-0 last:pb-0">
                        <div className="flex justify-between items-start">
                          <div className="w-3/4">
                            <div className="font-black text-black">{item.name}</div>
                            {item.sku && <div className="text-[10px] text-black font-bold font-sans">SKU: {item.sku}</div>}
                          </div>
                          <div className="w-1/4 text-right font-black">x{item.qty}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="text-[12px] print:text-[11px] text-black font-mono font-bold space-y-1.5 border-t-2 border-black pt-2">
                <div className="flex justify-between">
                  <span className="font-black">Total Items:</span>
                  <span className="font-black">{printTransfer.items?.reduce((sum: number, i: any) => sum + (i.qty || 0), 0) || 0} units</span>
                </div>
              </div>

              <div className="text-center mt-6 pt-3 border-t-2 border-dashed border-black text-[11px] text-black font-black font-mono">
                *** Stock Transfer Slip ***
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-800/50 flex justify-end shrink-0 print:hidden rounded-b-lg gap-2">
              <button
                onClick={() => setPrintTransfer(null)}
                className="px-4 py-2 bg-slate-200 text-slate-700 dark:text-slate-200 text-sm font-medium rounded hover:bg-slate-300 transition-colors"
              >
                Close
              </button>
              <button 
                onClick={() => printInvoice('print-transfer-content', 'Stock Transfer Slip')}
                className="flex items-center justify-center px-6 py-2 bg-slate-900 text-white text-sm font-bold rounded hover:bg-slate-800 transition-colors shadow-sm"
              >
                <Printer className="w-4 h-4 mr-2" /> Print Slip
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
