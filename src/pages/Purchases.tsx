import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { collection, query, where, onSnapshot, Timestamp, doc, getDocs, addDoc, setDoc, updateDoc, getDoc, writeBatch, deleteDoc, runTransaction } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { Plus, Printer, X, Receipt, Building2, Trash2, Edit } from 'lucide-react';
import { printInvoice } from '../lib/print';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

import { Purchase, InventoryItem, Vendor } from '../types';

export function Purchases() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion, enableBillEdit } = useSettings();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  
  const [printPurchase, setPrintPurchase] = useState<Purchase | null>(null);
  const [editPurchaseId, setEditPurchaseId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [targetBranchId, setTargetBranchId] = useState('');

  // Bill logic
  const [purchaseDate, setPurchaseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedVendor, setSelectedVendor] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Online' | 'Credit'>('Cash');
  const [paymentAccount, setPaymentAccount] = useState('');
  const [purchaseDescription, setPurchaseDescription] = useState('');
  const [selectedItems, setSelectedItems] = useState<Array<{ id: string, name: string, qty: number, price: number, salePrice: number }>>([]);
  
  const [currentItem, setCurrentItem] = useState('');
  const [currentQty, setCurrentQty] = useState(1);
  const [currentCostPrice, setCurrentCostPrice] = useState(0);
  const [currentSalePrice, setCurrentSalePrice] = useState(0);

  useEffect(() => {
    if (!activeBranchId) return;

    let q: any = collection(db, 'purchases');
    let invQ: any = collection(db, 'inventory');
    let venQ: any = collection(db, 'vendors');

    if (activeBranchId) {
      q = query(q, where('branchId', '==', activeBranchId));
      invQ = query(invQ, where('branchId', '==', activeBranchId));
      venQ = query(venQ, where('branchId', '==', activeBranchId));
    }

    const unsubPurchases = safeCollectionSnapshot(q, (snap) => setPurchases(snap.docs.map(d => ({ ...(d.data() as any), id: d.id } as Purchase))));
    const unsubInv = safeCollectionSnapshot(invQ, (snap) => setInventory(snap.docs.map(d => ({ ...(d.data() as any), id: d.id } as InventoryItem))));
    const unsubVen = safeCollectionSnapshot(venQ, (snap) => setVendors(snap.docs.map(d => ({ ...(d.data() as any), id: d.id } as Vendor))));
    
    return () => { unsubPurchases(); unsubInv(); unsubVen(); };
  }, [activeBranchId, user]);

  useEffect(() => {
    if (printPurchase) {
      setTimeout(() => {
        window.print();
      }, 300);
    }
  }, [printPurchase]);

  const handleItemSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setCurrentItem(val);
    if (!val) {
      setCurrentCostPrice(0);
      setCurrentSalePrice(0);
      return;
    }
    const item = inventory.find(i => String(i.id) === String(val));
    if (item) {
      setCurrentCostPrice(Number(item.cost) || 0);
      setCurrentSalePrice(Number(item.price) || 0);
    }
  };

  const handleAddItem = () => {
    const item = inventory.find(i => String(i.id) === String(currentItem));
    if (!item) return;
    if (isNaN(currentQty) || currentQty <= 0) {
      toast.error("Quantity must be greater than zero.");
      return;
    }
    const costVal = isNaN(currentCostPrice) ? 0 : Number(currentCostPrice);
    const saleVal = isNaN(currentSalePrice) ? 0 : Number(currentSalePrice);
    setSelectedItems([...selectedItems, { id: item.id, name: item.name, qty: Number(currentQty), price: costVal, salePrice: saleVal }]);
    setCurrentItem('');
    setCurrentQty(1);
    setCurrentCostPrice(0);
    setCurrentSalePrice(0);
  };

  const handleCheckout = async () => {
    if (isSubmitting) return;
    const branchToUse = activeBranchId || targetBranchId;
    if (!branchToUse) {
      alert("Select a branch first to record a vendor bill."); return;
    }
    if (selectedItems.length === 0) return;
    if (paymentMethod === 'Online' && !paymentAccount.trim()) {
      alert("Please specify the online payment account details."); return;
    }

    setIsSubmitting(true);
    const total = selectedItems.reduce((acc, curr) => acc + (curr.qty * curr.price), 0);
    const vendorLookup = vendors.find(v => v.id === selectedVendor);
    const vendorName = vendorLookup ? vendorLookup.name : 'Unknown Vendor';

        const billData = {
          branchId: branchToUse,
          vendorId: selectedVendor || null,
          vendorName: vendorName,
          paymentMethod,
          paymentAccount: paymentMethod === 'Online' ? paymentAccount : null,
          description: purchaseDescription.trim() || null,
          total,
          items: selectedItems,
          date: (() => { const [py, pm, pd] = purchaseDate.split('-'); return new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime(); })() };
    try {
      let relatedLedgerDocs: any[] = [];
      if (editPurchaseId) {
        try {
          const shortId = editPurchaseId.substring(0, 6).toUpperCase();
          const lQuery = query(collection(db, 'ledger'), 
              where('reference', '>=', `Bill #${shortId}`), 
              where('reference', '<=', `Bill #${shortId}\uf8ff`));
          const snap = await safeGetDocs(lQuery);
          relatedLedgerDocs = snap.docs.map(d => ({ id: d.id }));
        } catch (err) {
          console.error("Failed to fetch related ledger docs for update", err);
        }
      }

      await runTransaction(db, async (transaction) => {
        let oldPurchase: Purchase | null = null;
        if (editPurchaseId) {
          const oldPurchaseSnap = await transaction.get(doc(db, 'purchases', editPurchaseId));
          if (oldPurchaseSnap.exists()) {
             oldPurchase = oldPurchaseSnap.data() as Purchase;
          }
        }

        const allItemIds = new Set<string>();
        selectedItems.forEach(i => allItemIds.add(i.id));
        if (oldPurchase && oldPurchase.items) {
           oldPurchase.items.forEach((i: any) => allItemIds.add(i.id));
        }

        const invRefs = Array.from(allItemIds);
        const invSnaps: Record<string, any> = {};
        for (const id of invRefs) {
           const snap = await transaction.get(doc(db, 'inventory', id));
           if (snap.exists() && snap.data()) {
              invSnaps[id] = snap.data();
           } else {
              // Fallback to loaded inventory state (by ID or name) so available items never fail
              const selectedItemObj = selectedItems.find(i => String(i.id) === String(id));
              const localInv = inventory.find(i =>
                String(i.id) === String(id) ||
                (selectedItemObj && i.name?.trim().toLowerCase() === selectedItemObj.name?.trim().toLowerCase())
              );
              if (localInv) {
                 invSnaps[id] = localInv;
              }
           }
        }
        
        const newStockMap: Record<string, number> = {};
        const newCostMap: Record<string, number> = {};
        const newPriceMap: Record<string, number> = {};
        const resolvedDocIds: Record<string, string> = {};

        for (const id of invRefs) {
           const snapData = invSnaps[id];
           resolvedDocIds[id] = snapData?.id || id;
           let currentStock = snapData ? Number(snapData.stock || 0) : 0;
           let currentCost = snapData ? Number(snapData.cost || 0) : 0;
           let currentPrice = snapData ? Number(snapData.price || 0) : 0;
           
           if (oldPurchase && oldPurchase.items) {
              const oldItem = oldPurchase.items.find((i: any) => String(i.id) === String(id));
              if (oldItem) {
                 currentStock = currentStock - Number(oldItem.qty || 0); // Reverse the previous stock
              }
           }
           
           const newItem = selectedItems.find(i => String(i.id) === String(id));
           if (newItem) {
              currentStock = currentStock + Number(newItem.qty || 0);
              currentCost = Number(newItem.price || 0); // Cost equals the purchase price
              currentPrice = Number(newItem.salePrice || 0); // Retail price
           }
           
           newStockMap[id] = currentStock;
           if (newItem) {
              newCostMap[id] = currentCost;
              newPriceMap[id] = currentPrice;
           }
        }

        for (const id of invRefs) {
           const targetDocId = resolvedDocIds[id] || id;
           const snapData = invSnaps[id];
           const newItem = selectedItems.find(i => String(i.id) === String(id));
           const updates: any = { stock: newStockMap[id] };
           if (newCostMap[id] !== undefined) updates.cost = newCostMap[id];
           if (newPriceMap[id] !== undefined) updates.price = newPriceMap[id];

           if (snapData !== undefined) {
              transaction.set(doc(db, 'inventory', targetDocId), { ...snapData, ...updates, id: targetDocId }, { merge: true });
           } else if (newItem) {
              transaction.set(doc(db, 'inventory', targetDocId), {
                id: targetDocId,
                branchId: branchToUse,
                name: newItem.name,
                sku: newItem.name.substring(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' + Math.floor(Math.random() * 1000),
                category: 'General',
                minStockLevel: 10,
                ...updates,
                updatedAt: Timestamp.now()
              }, { merge: true });
           }
        }
        


        if (editPurchaseId) {
           transaction.update(doc(db, 'purchases', editPurchaseId), billData);

           if (relatedLedgerDocs.length > 0) {
              for (const lDoc of relatedLedgerDocs) {
                transaction.delete(doc(db, 'ledger', lDoc.id));
              }
           }

           const purDescSuffix = purchaseDescription.trim() ? ` - ${purchaseDescription.trim()}` : '';

           const newLedgerRef = doc(collection(db, 'ledger'));
           transaction.set(newLedgerRef, {
             branchId: branchToUse,
             vendorId: selectedVendor || null,
             date: (() => { const [py, pm, pd] = purchaseDate.split('-'); return new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime(); })(),
             description: paymentMethod === 'Credit' ? `Vendor Bill (Credit): ${vendorName}${purDescSuffix}` : `Vendor Bill: ${vendorName}${purDescSuffix}`,
             category: paymentMethod === 'Credit' ? 'Vendor Bill' : 'Purchase Payment',
             type: paymentMethod === 'Credit' ? 'IN' : 'OUT',
             amount: total,
             reference: `Bill #${editPurchaseId.substring(0,6).toUpperCase()} - ${paymentMethod}${paymentMethod === 'Online' ? ` (${paymentAccount})` : ''}`,
             createdAt: Timestamp.now(),
             tenantId: user?.tenantId || user?.uid
           });
        } else {
           const newPurchaseRef = doc(collection(db, 'purchases'));
           transaction.set(newPurchaseRef, {
             ...billData,
             createdAt: Timestamp.now(),
             tenantId: user?.tenantId || user?.uid
           });
           
           const purDescSuffix = purchaseDescription.trim() ? ` - ${purchaseDescription.trim()}` : '';
           const newLedgerRef = doc(collection(db, 'ledger'));
           transaction.set(newLedgerRef, {
             branchId: branchToUse,
             vendorId: selectedVendor || null,
             date: (() => { const [py, pm, pd] = purchaseDate.split('-'); return new Date(Number(py), Number(pm) - 1, Number(pd), 12, 0, 0).getTime(); })(),
             description: paymentMethod === 'Credit' ? `Vendor Bill (Credit): ${vendorName}${purDescSuffix}` : `Vendor Bill: ${vendorName}${purDescSuffix}`,
             category: paymentMethod === 'Credit' ? 'Vendor Bill' : 'Purchase Payment',
             type: paymentMethod === 'Credit' ? 'IN' : 'OUT',
             amount: total,
             reference: `Bill #${newPurchaseRef.id.substring(0,6).toUpperCase()} - ${paymentMethod}${paymentMethod === 'Online' ? ` (${paymentAccount})` : ''}`,
             createdAt: Timestamp.now(),
             tenantId: user?.tenantId || user?.uid
           });
        }
      });
      setShowAdd(false);
      setEditPurchaseId(null);
      setSelectedVendor('');
      setSelectedItems([]);
      setPaymentMethod('Cash');
      setPaymentAccount('');
      setPurchaseDescription('');
      toast.success(editPurchaseId ? 'Vendor Bill updated successfully!' : 'Vendor Bill saved successfully!');
    } catch (e: any) {
      console.error("Purchase Transaction Failed: ", e);
      toast.error("Failed to save vendor bill: " + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePurchase = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!enableDeletion || 0) return;
    if (confirm("Are you sure you want to delete this bill? This will NOT revert stock automatically.")) {
      try {
        await deleteDoc(doc(db, 'purchases', id));
      } catch (err: any) {
        alert("Failed to delete bill: " + err.message);
      }
    }
  };

  const handleEditPurchase = (purchase: Purchase, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditPurchaseId(purchase.id);
    const d = purchase.date ? new Date(purchase.date) : (purchase.createdAt?.seconds ? new Date(purchase.createdAt.seconds * 1000) : new Date());
    setPurchaseDate(format(d, "yyyy-MM-dd"));
    setTargetBranchId(purchase.branchId);
    setSelectedVendor(purchase.vendorId || 0);
    setPaymentMethod(purchase.paymentMethod || 0);
    setPaymentAccount(purchase.paymentAccount || 0);
    setSelectedItems(purchase.items.map((i: any) => ({...i, salePrice: i.salePrice || 0})));
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <div className="space-y-6 print:hidden">
        <div className="flex justify-between items-center card p-4">
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
             <Building2 className="w-6 h-6 mr-3 text-emerald-600" />
             Vendor Bills & Purchases
          </h2>
          
          <button onClick={() => {
            if (!showAdd || 0) {
                setShowAdd(true);
                setEditPurchaseId(null);
                setSelectedVendor('');
                setSelectedItems([]);
                setPaymentAccount('');
                setPurchaseDate(format(new Date(), 'yyyy-MM-dd'));
            } else {
                setShowAdd(false);
            }
          }} className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition shadow-sm">
            <Plus className="w-5 h-5 mr-2" /> New Vendor Bill
          </button>
        </div>

        {showAdd && (
          <div className="card p-6 border-emerald-100 ring-1 ring-emerald-50 shadow-md">
            <h3 className="font-semibold mb-4 text-emerald-800 border-b border-emerald-50 pb-2 flex items-center">
              <Receipt className="w-4 h-4 mr-2" /> {editPurchaseId ? 'Edit Vendor Bill' : 'Record Incoming Stock (Purchase)'}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {false && (
                <div className="md:col-span-3">
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Branch</label>
                  <select required value={targetBranchId} onChange={e => setTargetBranchId(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm">
                    <option value="" disabled>Select Branch</option>
                    <option value="main">Main Branch</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Purchase Date</label>
                <input required type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Select Vendor</label>
                <select value={selectedVendor} onChange={e => setSelectedVendor(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm">
                  <option value="">-- Choose Vendor --</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Payment Method</label>
                  <select value={paymentMethod} onChange={(e: any) => setPaymentMethod(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm">
                    <option value="Cash">Cash</option>
                    <option value="Online">Online</option>
                    <option value="Credit">Credit (Udhar)</option>
                  </select>
                </div>
                {paymentMethod === 'Online' && (
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Account Info</label>
                    <input type="text" placeholder="e.g. Meezan, Easypaisa" value={paymentAccount} onChange={e => setPaymentAccount(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" />
                  </div>
                )}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">Bill Description / Remarks (Recorded in Ledger)</label>
              <input type="text" placeholder="e.g. Direct online payment details, vendor bill remarks..." value={purchaseDescription} onChange={e => setPurchaseDescription(e.target.value)} className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" />
            </div>
            
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1 mt-4">Add Items to Bill</label>
            <div className="flex flex-col xl:flex-row space-y-2 xl:space-y-0 xl:space-x-2 mb-4">
              <select value={currentItem} onChange={handleItemSelect} className="flex-1 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm">
                <option value="">Select Item to receiving stock...</option>
                {inventory.filter(i => i.branchId === (activeBranchId || targetBranchId)).map(i => <option key={i.id} value={i.id}>{i.name} (Current Stock: {i.stock})</option>)}
              </select>
              <div className="flex space-x-2">
                <input type="number" min="1" placeholder="Qty" value={currentQty} onChange={e => setCurrentQty(parseInt(e.target.value))} className="w-20 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" />
                <div className="relative">
                  <span className="absolute left-2.5 top-2.5 text-slate-400 text-sm">Cost</span>
                  <input type="number" min="0" placeholder="Cost Rate" value={currentCostPrice} onChange={e => setCurrentCostPrice(parseFloat(e.target.value))} className="w-28 rounded-md border border-slate-300 dark:border-slate-600 pl-10 pr-2 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" />
                </div>
                <div className="relative">
                  <span className="absolute left-2.5 top-2.5 text-slate-400 text-sm">Sale</span>
                  <input type="number" min="0" placeholder="Retail Price" value={currentSalePrice} onChange={e => setCurrentSalePrice(parseFloat(e.target.value))} className="w-28 rounded-md border border-slate-300 dark:border-slate-600 pl-10 pr-2 py-2 bg-slate-50 dark:bg-slate-800/50 focus:bg-white text-sm" />
                </div>
                <button type="button" onClick={handleAddItem} className="px-4 bg-emerald-50 text-emerald-700 font-medium border border-emerald-200 rounded hover:bg-emerald-100 transition">Add</button>
              </div>
            </div>

            {selectedItems.length > 0 && (
              <div className="mb-4 bg-emerald-50 p-4 border border-emerald-100 rounded-md">
                <ul className="mb-2 space-y-2">
                  {selectedItems.map((item, idx) => (
                    <li key={idx} className="flex flex-col lg:flex-row lg:items-center justify-between text-sm font-mono text-emerald-900 border-b border-emerald-100/50 pb-3 mt-2 first:mt-0">
                      <span className="mb-2 lg:mb-0">{item.qty} x {item.name}</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] uppercase text-emerald-700">Cost:</span>
                        <input 
                          type="number" 
                          value={item.price || 0} 
                          onChange={(e) => {
                            const newPrice = Number(e.target.value);
                            const updatedItems = [...selectedItems];
                            updatedItems[idx].price = newPrice;
                            setSelectedItems(updatedItems);
                          }}
                          className="w-20 px-2 py-1 text-right border border-emerald-200 rounded focus:border-emerald-500 focus:outline-none bg-white dark:bg-slate-900 text-emerald-900"
                        />
                        <span className="text-[10px] uppercase text-sky-700 md:ml-2">Sale:</span>
                        <input 
                          type="number" 
                          value={item.salePrice || 0} 
                          onChange={(e) => {
                            const newSalePrice = Number(e.target.value);
                            const updatedItems = [...selectedItems];
                            updatedItems[idx].salePrice = newSalePrice;
                            setSelectedItems(updatedItems);
                          }}
                          className="w-20 px-2 py-1 text-right border border-sky-200 rounded focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none bg-white dark:bg-slate-900 text-sky-900"
                        />
                        <span className="font-bold border-l border-emerald-200 pl-3 ml-2 w-28 text-right">PKR {((item.qty || 0) * (item.price || 0)).toFixed(2)}</span>
                        <button type="button" onClick={() => setSelectedItems(selectedItems.filter((_, i) => i !== idx))} className="text-rose-400 hover:text-rose-600 ml-2 font-bold text-lg leading-none shrink-0" title="Remove item">×</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="text-right font-bold text-lg border-t border-emerald-200 pt-2 text-emerald-900 flex justify-between">
                  <span>Grand Total</span>
                  <span>PKR {selectedItems.reduce((sum, item) => sum + (item.qty * item.price), 0).toFixed(2)}</span>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button 
                onClick={() => {
                   setShowAdd(false);
                   setEditPurchaseId(null);
                }}
                disabled={isSubmitting}
                className="w-1/3 bg-slate-200 text-slate-700 dark:text-slate-200 py-2.5 rounded font-medium hover:bg-slate-300 transition shadow-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button 
                onClick={handleCheckout} 
                disabled={isSubmitting}
                className="w-2/3 bg-[#0f172a] text-white py-2.5 rounded font-medium hover:bg-slate-800 transition shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : (editPurchaseId ? 'Update Vendor Bill' : 'Save Vendor Bill & Add Stock')}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...purchases].sort((a, b) => {
            const getVal = (v: any) => {
                 if (v?.createdAt?.seconds) return v.createdAt.seconds * 1000;
                 if (v?.createdAt && typeof v.createdAt === 'string') return new Date(v.createdAt).getTime();
                 if (v?.createdAt && typeof v.createdAt === 'number') return v.createdAt;
                 if (v?.date && typeof v.date === 'string') return new Date(v.date).getTime();
                 if (v?.date && typeof v.date === 'number') return v.date;
                 return 0;
              };
              return getVal(b) - getVal(a);
          }).map(purchase => {
            const bName = branches.find(b => b.id === purchase.branchId)?.name || 'Unknown Branch';
            return (
              <div key={purchase.id} className="card p-5 relative flex flex-col border-emerald-100/50 hover:border-emerald-200">
                <div className="flex justify-between items-start mb-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">Bill Total</div>
                  <div className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-100 font-medium">
                    {bName}
                  </div>
                </div>
                <div className="stat-value text-slate-800 dark:text-slate-100 mb-1">PKR {(purchase.total || 0).toFixed(2)}</div>
                <div className="text-sm font-medium text-emerald-700">Vendor: {purchase.vendorName || '--'}</div>
                <div className="text-xs font-mono text-slate-400 mt-1 uppercase">
                  {new Date(purchase.date || 0).toLocaleString()}
                    <span className="block mt-0.5 text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">PAID VIA:</span> {purchase.paymentMethod || ''}
                    </span>
                </div>
                <div className="mt-2 pt-4 border-t border-slate-100 dark:border-slate-800/50 space-y-1 flex-1">
                  {purchase.items?.slice(0, 3).map((item, i) => (
                    <div key={i} className="text-xs flex justify-between font-mono">
                      <span className="text-slate-500 dark:text-slate-400">+{item.qty} {item.name}</span>
                      <span className="text-slate-400">@ {item.price} {item.salePrice ? `(S: ${item.salePrice})` : ''}</span>
                    </div>
                  ))}
                  {(purchase.items?.length || 0) > 3 && <div className="text-xs text-slate-400">+{purchase.items.length - 3} more</div>}
                </div>
                
                <div className="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center">
                  <div className="flex gap-2">
                    {enableBillEdit && (
                      <button
                        onClick={(e) => handleEditPurchase(purchase, e)}
                        className="text-xs flex items-center px-2.5 py-1.5 bg-sky-50 text-sky-600 hover:bg-sky-100 border border-sky-200 rounded transition-colors"
                      >
                        <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                      </button>
                    )}
                  </div>
                  <button 
                    onClick={() => setPrintPurchase(purchase)}
                    className="text-xs flex items-center px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5 mr-1.5" /> Print Bill
                  </button>
                </div>
              </div>
            );
          })}
          {purchases.length === 0 && <div className="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 card border-dashed">No vendor purchases recorded yet.</div>}
        </div>
      </div>

      {printPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 print:bg-transparent print:static print:inset-auto print:block print:z-auto backdrop-blur-sm print:backdrop-blur-none print:h-auto print:min-h-0">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-[80mm] max-w-[95vw] max-h-[95vh] flex flex-col print:shadow-none print:rounded-none print:max-h-none h-full md:h-auto print:block print:h-auto print:min-h-0 print:w-[80mm] print:m-0">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800/50 print:hidden shrink-0">
               <h3 className="font-semibold text-slate-800 dark:text-slate-100">Print Vendor Invoice</h3>
               <button onClick={() => setPrintPurchase(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 bg-slate-100 dark:bg-slate-950 p-1.5 rounded-full">
                 <X className="w-5 h-5" />
               </button>
            </div>

            <div id="print-invoice-content" className="p-8 print:p-0 print:m-0 print:w-full print:max-w-full text-black bg-white dark:bg-slate-900 overflow-y-auto print:overflow-visible flex-1 content-start font-sans font-bold">
               <div className="text-center mb-4 print:mb-3">
                 <h1 className="text-3xl print:text-4xl font-black uppercase tracking-widest leading-tight text-black">
                   {printPurchase.branchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === printPurchase.branchId)?.name || '')}
                 </h1>
                 {(branches.find(b => b.id === printPurchase.branchId)?.phone || branches.find(b => b.id === printPurchase.branchId)?.phone2) && (
                   <div className="mt-1 text-sm print:text-xs font-black text-black">
                     {branches.find(b => b.id === printPurchase.branchId)?.phone && <span>Phone 1: {branches.find(b => b.id === printPurchase.branchId)?.phone}</span>}
                     {branches.find(b => b.id === printPurchase.branchId)?.phone && branches.find(b => b.id === printPurchase.branchId)?.phone2 && <span> | </span>}
                     {branches.find(b => b.id === printPurchase.branchId)?.phone2 && <span>Phone 2: {branches.find(b => b.id === printPurchase.branchId)?.phone2}</span>}
                   </div>
                 )}
                 {branches.find(b => b.id === printPurchase.branchId)?.address && (
                   <div className="mt-0.5 text-sm print:text-xs font-black text-black">
                     {branches.find(b => b.id === printPurchase.branchId)?.address}
                   </div>
                 )}
                 {branches.find(b => b.id === printPurchase.branchId)?.onlinePhone && (
                   <div className="mt-0.5 text-sm print:text-xs font-black text-black">
                     Online Support: {branches.find(b => b.id === printPurchase.branchId)?.onlinePhone}
                   </div>
                 )}
                 <div className="mt-2 text-sm print:text-[16px] font-black text-white bg-black uppercase tracking-widest py-1.5 inline-block w-full">PURCHASE BILL</div>
               </div>
               
               <div className="text-xs print:text-[11px] font-mono text-slate-700 dark:text-slate-200 mb-4 space-y-1">
                 <div><span className="font-semibold text-slate-700 dark:text-slate-200">Receipt No:</span> #{printPurchase.id.substring(0,8).toUpperCase()}</div>
                 <div><span className="font-semibold text-slate-700 dark:text-slate-200">Date:</span> {new Date(printPurchase.date || 0).toLocaleString()}</div>
                 <div><span className="font-semibold text-slate-700 dark:text-slate-200">Vendor:</span> {printPurchase.vendorName || '--'}</div>
                 <div>
                   <span className="font-semibold text-slate-700 dark:text-slate-200">Settlement:</span> {printPurchase.paymentMethod || ''}
                 </div>
               </div>

               <div className="border-t border-b border-slate-800 py-2 mb-3">
                 <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-1 border-b border-dashed border-slate-300 dark:border-slate-600 pb-1">
                   <span>Item</span>
                   <span>Rate / Amt</span>
                 </div>
                 <div className="space-y-1">
                   {printPurchase.items?.map((item, idx) => (
                     <div key={idx} className="flex justify-between text-[10px] font-mono">
                       <div className="flex-1 pr-2">
                         <div className="font-semibold text-slate-800 dark:text-slate-100 leading-tight">{item.name}</div>
                         <div className="text-slate-500 dark:text-slate-400">{item.qty} units (IN)</div>
                       </div>
                       <div className="text-right">
                         <div className="text-slate-500 dark:text-slate-400">@ {(item.price || 0).toFixed(0)}</div>
                         <div className="text-slate-800 dark:text-slate-100 font-bold">{((item.qty || 0) * (item.price || 0)).toFixed(0)}</div>
                       </div>
                     </div>
                   ))}
                 </div>
               </div>

               <div className="flex justify-between items-center pt-1">
                 <span className="text-xs font-bold uppercase tracking-wider">Total PKR</span>
                 <span className="text-base font-bold font-mono">{(printPurchase.total || 0).toFixed(0)}</span>
               </div>
               <div className="mt-4 print:mt-4 text-center text-[10px] font-bold text-black uppercase tracking-widest border-t-[1px] border-black pt-2">
                 
               </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-800/50 flex justify-end shrink-0 print:hidden rounded-b-lg">
               <button 
                 onClick={() => printInvoice('print-invoice-content', 'Vendor Purchase Bill')}
                 className="flex-1 md:flex-none flex items-center justify-center px-6 py-2.5 bg-slate-900 text-white rounded font-medium hover:bg-slate-800 transition-colors shadow-sm"
               >
                 <Printer className="w-4 h-4 mr-2" /> Print
               </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
