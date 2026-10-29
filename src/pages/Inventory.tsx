import React, { useState, useEffect, useRef } from 'react';
import { useBranch } from '../context/BranchContext';
import { collection, query, where, onSnapshot, Timestamp, doc, setDoc, getDocs, getDoc, runTransaction, writeBatch, addDoc, updateDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { Plus, Trash2, Edit2, AlertTriangle, FileText, Download, Printer, Search, X, Barcode as BarcodeIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { printInvoice } from '../lib/print';
import { recordActivityLog } from '../lib/activityLogger';
import Barcode from 'react-barcode';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

import { InventoryItem } from '../types';

export function Inventory() {

  useBarcodeScanner({
    onScan: (barcode) => {
      if (showAdd) {
        // If we are in the add/edit form, set the SKU field
        setSku(barcode);
      } else if (!showBulkAdd) {
        // If we are in the main list, search for the item
        setSearchTerm(barcode);
      }
    }
  });
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [printMode, setPrintMode] = useState<'with_amount' | 'without_amount' | 'employee'>('with_amount');
  const [barcodeItem, setBarcodeItem] = useState<InventoryItem | null>(null);
  const [barcodePrintQty, setBarcodePrintQty] = useState<number>(1);
  const barcodePrintRef = useRef<HTMLDivElement>(null);

  // Form states
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [category, setCategory] = useState('');
  const [minStockLevel, setMinStockLevel] = useState('10'); // Default to 10
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Bulk form state
  const [bulkNames, setBulkNames] = useState('');
  const [isSubmittingBulk, setIsSubmittingBulk] = useState(false);

  useEffect(() => {
    if ((showAdd || 0) && !selectedBranchId) {
      if (activeBranchId) setSelectedBranchId(activeBranchId);
      else if (branches.length > 0) setSelectedBranchId(branches[0].id);
    }
  }, [showAdd, showBulkAdd, activeBranchId, branches]);

  useEffect(() => {
    if (!activeBranchId) return;
    setItems([]);

    const q = query(collection(db, 'inventory'), where('branchId', '==', activeBranchId));

    const unsub = safeCollectionSnapshot(q, (snap) => {
      setItems(snap.docs.map(doc => ({ ...(doc.data() || {}), id: doc.id } as InventoryItem)));
    });
    return unsub;
  }, [activeBranchId, user]);

  const resetForm = () => {
    setName(''); setSku(''); setPrice(''); setCost(''); setStock(''); setCategory(''); setMinStockLevel('10');
    setEditingId(null);
    setShowAdd(false);
    setShowBulkAdd(false);
    setBulkNames('');
  };

  const handleEditInit = (item: InventoryItem) => {
    setEditingId(item.id);
    setName(item.name);
    setSku(item.sku);
    setCategory(item.category);
    setPrice(item.price.toString());
    setCost(item.cost.toString());
    setStock(item.stock.toString());
    setMinStockLevel((item.minStockLevel || 0).toString());
    setShowAdd(true);
    setShowBulkAdd(false);
  };

  const handleAddOrEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const branchToUse = editingId ? null : (selectedBranchId || 0);
    if (!editingId && !branchToUse) {
      alert("Please select a specific branch to add inventory.");
      return;
    }

    setIsSubmitting(true);
    try {
      const itemData = {
        name,
        sku,
        price: parseFloat(price),
        cost: parseFloat(cost),
        stock: parseInt(stock, 10),
        category,
        minStockLevel: parseInt(minStockLevel, 10) || 10,
        updatedAt: Timestamp.now()
      };

      if (editingId) {
        await updateDoc(doc(db, 'inventory', editingId), itemData);
        recordActivityLog({
          action: 'Update Inventory Item',
          category: 'Inventory',
          details: `Updated item "${name}" (SKU: ${sku}, Stock: ${stock}, Price: PKR ${price})`,
          metadata: { id: editingId, ...itemData },
          branchId: branchToUse || activeBranchId,
          user
        }).catch(() => {});
      } else {
        await addDoc(collection(db, 'inventory'), {
          branchId: branchToUse,
          ...itemData,
          createdAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });
        recordActivityLog({
          action: 'Add Inventory Item',
          category: 'Inventory',
          details: `Added new item "${name}" (SKU: ${sku}, Stock: ${stock}, Price: PKR ${price})`,
          metadata: { ...itemData, branchId: branchToUse },
          branchId: branchToUse,
          user
        }).catch(() => {});
      }

      resetForm();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingBulk) return;

    const branchToUse = selectedBranchId || activeBranchId;
    if (!branchToUse) {
      alert("Please select a specific branch to bulk add inventory.");
      return;
    }

    const lines = bulkNames.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    setIsSubmittingBulk(true);
    try {
      const promises = lines.map(line => {
        const generatedSku = line.substring(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' + Math.floor(Math.random() * 1000);
        return addDoc(collection(db, 'inventory'), {
          branchId: branchToUse,
          name: line,
          sku: generatedSku,
          price: 0,
          cost: 0,
          stock: 0,
          category: 'General',
          minStockLevel: 10,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          tenantId: user?.tenantId || user?.uid
        });
      });
      await Promise.all(promises);
      resetForm();
    } catch (e: any) {
      alert("Error adding bulk items: " + e.message);
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure?")) {
      await deleteDoc(doc(db, 'inventory', id));
    }
  };

  // Determine low stock items to show alert at top
  const lowStockItems = items.filter(item => item.stock <= (item.minStockLevel || 0));

  const filteredItems = items.filter(item => {
    const term = searchTerm.toLowerCase();
    return (
      item.name.toLowerCase().includes(term) ||
      item.sku.toLowerCase().includes(term) ||
      item.category.toLowerCase().includes(term)
    );
  });

  const exportToCSV = () => {
    if (items.length === 0) {
      alert("No inventory data to export.");
      return;
    }

    const headers = ['Name', 'SKU', 'Category', 'Price', 'Cost', 'Stock', 'Min Stock Level'];
    const csvContent = [
      headers.join(','),
      ...items.map(item => [
        `"${item.name.replace(/"/g, '""')}"`,
        `"${item.sku}"`,
        `"${item.category}"`,
        item.price,
        item.cost,
        item.stock,
        item.minStockLevel || 10
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `inventory_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      
      {lowStockItems.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-start shadow-sm print:hidden">
          <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 mr-3 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-rose-800">Critical Stock Alerts ({lowStockItems.length} Items)</h3>
            <p className="text-xs text-rose-600 mt-1">The following items have fallen below their configured minimum stock threshold. Restock recommended.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {lowStockItems.slice(0, 5).map(item => (
                <span key={item.id} className="bg-white dark:bg-slate-900 text-rose-700 text-[10px] font-bold px-2 py-1 rounded border border-rose-200">
                  {item.name} ({item.stock} left)
                </span>
              ))}
              {lowStockItems.length > 5 && <span className="text-rose-600 text-xs font-medium">+{lowStockItems.length - 5} more</span>}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center card text-slate-800 dark:text-slate-100 p-4">
        <h2 className="text-xl font-semibold flex items-center">
          Inventory Items
        </h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => { setPrintMode('with_amount'); setTimeout(() => printInvoice('inventory-print-content', 'Inventory Report', 'a4'), 100); }}
            className="flex items-center px-4 py-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 transition border border-slate-200 dark:border-slate-700 shadow-sm print:hidden"
          >
            <Printer className="w-5 h-5 mr-2" />
            Print w/ Amount
          </button>
          <button
            onClick={() => { setPrintMode('without_amount'); setTimeout(() => printInvoice('inventory-print-content', 'Inventory Report', 'a4'), 100); }}
            className="flex items-center px-4 py-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 transition border border-slate-200 dark:border-slate-700 shadow-sm print:hidden"
          >
            <Printer className="w-5 h-5 mr-2" />
            Print w/o Amount
          </button>
          <button
            onClick={() => { setPrintMode('employee'); setTimeout(() => printInvoice('inventory-print-content', 'Employee Inventory Print', 'a4'), 100); }}
            className="flex items-center px-4 py-2 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 transition border border-slate-200 dark:border-slate-700 shadow-sm print:hidden"
          >
            <Printer className="w-5 h-5 mr-2" />
            Print for Employees
          </button>
          <button
            onClick={exportToCSV}
            className="flex items-center px-4 py-2 bg-emerald-100 text-emerald-700 font-medium rounded-md hover:bg-emerald-200 transition print:hidden"
          >
            <Download className="w-5 h-5 mr-2" />
            Export CSV
          </button>
          <button
            onClick={() => { const target = !showBulkAdd; resetForm(); setShowBulkAdd(target); }}
            className="flex items-center px-4 py-2 bg-slate-200 text-slate-700 dark:text-slate-200 font-medium rounded-md hover:bg-slate-300 transition print:hidden"
          >
            <FileText className="w-5 h-5 mr-2" />
            Bulk Paste Names
          </button>
          <button
            onClick={() => { const target = !showAdd; resetForm(); setShowAdd(target); }}
            className="flex items-center px-4 py-2 bg-[#1e293b] text-sky-400 font-medium rounded-md hover:bg-slate-800 transition shadow-sm print:hidden"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Item
          </button>
        </div>
      </div>

      {barcodeItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex justify-center items-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Print Barcode</h3>
              <button onClick={() => setBarcodeItem(null)} className="text-slate-400 hover:text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700">
                <div ref={barcodePrintRef} className="flex flex-col items-center justify-center space-y-4">
                  {Array.from({ length: barcodePrintQty }).map((_, idx) => (
                    <div key={idx} className="flex flex-col items-center bg-white p-4 rounded-md shadow-sm barcode-item" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                      <p className="text-xs font-bold text-center mb-1 text-black truncate w-full max-w-[200px]">{barcodeItem.name}</p>
                      {barcodeItem.sku ? (
                        <Barcode value={barcodeItem.sku} width={1.5} height={40} fontSize={12} margin={0} />
                      ) : (
                        <div className="py-4 text-rose-500 text-sm font-semibold">SKU required for barcode</div>
                      )}
                      <p className="text-xs font-semibold text-center mt-1 text-black">PKR {barcodeItem.price.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Number of copies</label>
                <input 
                  type="number" 
                  min="1" max="100"
                  value={barcodePrintQty} 
                  onChange={e => setBarcodePrintQty(Number(e.target.value) || 1)} 
                  className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 text-sm bg-slate-50 dark:bg-slate-800/50"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end space-x-3 bg-slate-50 dark:bg-slate-800/20">
              <button 
                onClick={() => setBarcodeItem(null)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                   if (!barcodeItem.sku) return;
                   const printContent = barcodePrintRef.current?.innerHTML;
                   if (printContent) {
                     const printWindow = window.open('', '_blank');
                     if (printWindow) {
                       printWindow.document.write(`
                         <html>
                           <head>
                             <title>Print Barcode</title>
                             <style>
                               body { font-family: monospace; display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; padding: 20px; }
                               .barcode-item { display: flex; flex-direction: column; align-items: center; border: 1px dashed #ccc; padding: 10px; page-break-inside: avoid; break-inside: avoid; }
                               p { margin: 0; padding: 0; }
                               .name { font-weight: bold; font-size: 12px; margin-bottom: 4px; text-align: center; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                               .price { font-weight: bold; font-size: 14px; margin-top: 4px; text-align: center; }
                             </style>
                           </head>
                           <body>
                             ${printContent.replace(/class="[^"]*"/g, (match) => {
                               if(match.includes('barcode-item')) return 'class="barcode-item"';
                               if(match.includes('text-xs font-bold')) return 'class="name"';
                               if(match.includes('text-xs font-semibold')) return 'class="price"';
                               return '';
                             })}
                             <script>
                               window.onload = function() { window.print(); window.close(); }
                             </script>
                           </body>
                         </html>
                       `);
                       printWindow.document.close();
                     }
                   }
                }}
                disabled={!barcodeItem.sku}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50"
              >
                Print Barcode
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkAdd && (
        <form onSubmit={handleBulkAdd} className="card p-6 border-emerald-100 ring-1 ring-emerald-50">
          <h3 className="font-semibold mb-4 text-emerald-800 border-b border-emerald-50 pb-2">Bulk Quick-Add Inventory</h3>
          {user?.role === 'super_admin' && !activeBranchId && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Assign to Branch *</label>
              <select 
                required 
                value={selectedBranchId} 
                onChange={e => setSelectedBranchId(e.target.value)} 
                className="w-full rounded-md border border-emerald-200 px-3 py-2 bg-white dark:bg-slate-900"
              >
                <option value="" disabled>Select a branch</option>
                <option value="main">Main Branch (HQ)</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Paste Item Names (One per line)</label>
            <textarea
              required
              rows={8}
              value={bulkNames}
              onChange={e => setBulkNames(e.target.value)}
              className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-3 px-3 focus:ring-emerald-500 focus:border-emerald-500 text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white"
              placeholder={'Item Name 1\nItem Name 2\nItem Name 3'}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
              Every name pasted onto a new line will be instantly created with <strong>0 stock</strong> and <strong>0 price</strong>. 
              SKUs will be auto-generated. You can update their prices/stock later manually or during Vendor Purchases.
            </p>
          </div>
          <div className="pt-2 flex items-center space-x-3">
            <button type="submit" disabled={isSubmittingBulk} className="px-5 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50">
              {isSubmittingBulk ? 'Saving Items...' : 'Save All Items'}
            </button>
            <button type="button" onClick={resetForm} disabled={isSubmittingBulk} className="px-5 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      {showAdd && (
        <form onSubmit={handleAddOrEdit} className="card p-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div className="col-span-full mb-2">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">{editingId ? 'Edit Item' : 'Add New Item'}</h3>
          </div>
          
          {user?.role === 'super_admin' && !activeBranchId && !editingId && (
            <div className="col-span-full">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Assign to Branch *</label>
              <select 
                required 
                value={selectedBranchId} 
                onChange={e => setSelectedBranchId(e.target.value)} 
                className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white"
              >
                <option value="" disabled>Select a branch</option>
                <option value="main">Main Branch (HQ)</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="md:col-span-1 lg:col-span-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Name</label>
            <input required type="text" value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">SKU</label>
            <input required type="text" value={sku} onChange={e => setSku(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Category</label>
            <input required type="text" value={category} onChange={e => setCategory(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Cost Price</label>
            <input required type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Selling Price</label>
            <input required type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Current Stock</label>
            <input required type="number" value={stock} onChange={e => setStock(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Alert Threshold</label>
            <input required type="number" value={minStockLevel} onChange={e => setMinStockLevel(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:ring-sky-500 dark:focus:ring-sky-400 focus:border-sky-500 dark:focus:border-sky-400 sm:text-sm bg-slate-50 dark:bg-slate-800/50 focus:bg-white" placeholder="10" />
            <p className="text-[10px] text-slate-400 mt-1">Warn if stock drops below this.</p>
          </div>
          
          <div className="col-span-full pt-2 flex items-center h-full space-x-3">
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-sky-400 bg-[#1e293b] hover:bg-slate-800 w-full sm:w-auto disabled:opacity-50">
              {isSubmitting ? 'Saving...' : (editingId ? 'Update Item' : 'Save Item')}
            </button>
            <button type="button" onClick={resetForm} disabled={isSubmitting} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 w-full sm:w-auto disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div id="inventory-print-content" className="print:static print:w-full print:bg-white print:p-0 print:z-auto print:h-auto">
        {/* Print Header */}
        <div className="hidden print:block text-center border-b border-slate-200 dark:border-slate-700 pb-4 mb-4">
          <h1 className="text-2xl font-bold font-serif uppercase tracking-widest text-slate-900 dark:text-slate-50">
             {printMode === 'employee' ? 'INVENTORY ITEMS' : (activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || ''))}
          </h1>
          {printMode !== 'employee' && (branches.find(b => b.id === activeBranchId)?.phone || branches.find(b => b.id === activeBranchId)?.phone2) && (
             <div className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
               {branches.find(b => b.id === activeBranchId)?.phone && <span>Phone 1: {branches.find(b => b.id === activeBranchId)?.phone}</span>}
               {branches.find(b => b.id === activeBranchId)?.phone && branches.find(b => b.id === activeBranchId)?.phone2 && <span> | </span>}
               {branches.find(b => b.id === activeBranchId)?.phone2 && <span>Phone 2: {branches.find(b => b.id === activeBranchId)?.phone2}</span>}
             </div>
           )}
           {printMode !== 'employee' && branches.find(b => b.id === activeBranchId)?.address && (
             <div className="mt-0.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
               {branches.find(b => b.id === activeBranchId)?.address}
             </div>
           )}
                 {printMode !== 'employee' && branches.find(b => b.id === activeBranchId)?.onlinePhone && (
                   <div className="mt-0.5 text-sm print:text-xs font-black text-black">
                     Online Support: {branches.find(b => b.id === activeBranchId)?.onlinePhone}
                   </div>
                 )}
          {printMode !== 'employee' && <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-1 uppercase tracking-widest">Inventory Report</h2>}
          <div className="flex justify-between items-end mt-4">
             <div className="text-left">
               {printMode !== 'employee' && <p className="text-xs text-slate-400">Printed on {new Date().toLocaleString()}</p>}
             </div>
             {printMode === 'with_amount' && <div className="text-right bg-slate-50 dark:bg-slate-800/50 p-3 rounded border border-slate-200 dark:border-slate-700">
               <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Grand Total (Value)</p>
               <p className="text-xl font-bold font-mono text-slate-800 dark:text-slate-100">
                 PKR {filteredItems.reduce((acc, item) => acc + (item.stock * item.cost), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
               </p>
              </div>}
           </div>
        </div>

      <div className="card flex-1 flex flex-col overflow-hidden print:border-none print:shadow-none print:rounded-none">
        <div className="grid-header flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
          <span>Inventory Master Catalog</span>
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search by Name, SKU or Category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:focus:ring-sky-400 focus:bg-white text-slate-800 dark:text-slate-100 placeholder-slate-400 shadow-sm"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto print:overflow-visible">
          <div className={`min-w-[800px] print:w-full print:min-w-0 ${printMode === 'employee' ? 'print:grid print:grid-cols-2 print:gap-x-12 print:gap-y-0' : ''}`}>
            <div className={`grid-row bg-slate-50 dark:bg-slate-800/50 font-bold text-[11px] border-b border-slate-200 dark:border-slate-700 print:bg-white print:border-b-2 print:border-slate-800 ${printMode === 'employee' ? 'print:hidden' : ''}`}>
              <div className="uppercase tracking-tighter w-48 print:flex-1">Item Name</div>
              <div className={`uppercase tracking-tighter w-32 ${printMode === 'employee' ? 'print:hidden' : ''}`}>SKU</div>
              <div className={`uppercase tracking-tighter w-32 ${printMode === 'employee' ? 'print:hidden' : ''}`}>Category</div>
              <div className="uppercase tracking-tighter w-48 print:hidden">Price / Cost</div>
              <div className="uppercase tracking-tighter flex-1 print:hidden">Stock Level</div>
              <div className="uppercase tracking-tighter text-right w-24 print:hidden">Actions</div>
              {/* Print Only Headers */}
              {printMode !== 'employee' && <div className="uppercase tracking-tighter w-24 text-right hidden print:block">Stock</div>}
              {printMode === 'with_amount' && <div className="uppercase tracking-tighter w-32 text-right hidden print:block">Cost Price</div>}
              {printMode === 'employee' && <div className="uppercase tracking-tighter w-32 text-right hidden print:block">Sale Price</div>}
              {printMode === 'with_amount' && <div className="uppercase tracking-tighter w-32 text-right hidden print:block">Total Value</div>}
            </div>
            
            {printMode === 'employee' && (
              <>
                <div className="hidden print:flex justify-between border-b-2 border-black pb-1 mb-1 font-bold text-xs uppercase">
                  <span>Item Name</span>
                  <span>Sale Price</span>
                </div>
                <div className="hidden print:flex justify-between border-b-2 border-black pb-1 mb-1 font-bold text-xs uppercase">
                  <span>Item Name</span>
                  <span>Sale Price</span>
                </div>
              </>
            )}
            {filteredItems.map((item) => {
              const checkLowStock = item.stock <= (item.minStockLevel || 0);
              const totalAmount = item.stock * item.cost;

              return (
                <div key={item.id} className={`grid-row print:border-b ${printMode === 'employee' ? 'print:py-1 print:border-dashed print:border-slate-300' : 'print:border-slate-100'} ${checkLowStock ? 'bg-rose-50/30 print:bg-transparent' : 'print:bg-transparent'}`}>
                  <div className="text-slate-800 dark:text-slate-100 font-medium w-48 print:flex-1 truncate print:whitespace-normal pr-4">{item.name}</div>
                  <div className={`font-mono text-xs w-32 print:text-slate-800 ${printMode === 'employee' ? 'print:hidden' : ''}`}>{item.sku || "-"}</div>
                  <div className={`w-32 ${printMode === 'employee' ? 'print:hidden' : ''}`}>
                    <span className="px-2 inline-flex text-[10px] leading-5 font-semibold rounded-full bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 print:bg-transparent print:border print:border-slate-300 print:text-slate-800">
                      {item.category}
                    </span>
                  </div>
                  <div className="w-48 text-sm print:hidden">
                    <span className="text-slate-900 dark:text-slate-50 font-bold">PKR {(item.price || 0).toFixed(2)}</span>
                    <span className="text-slate-400 ml-2">/ PKR {(item.cost || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex-1 flex items-center print:hidden">
                    <span className={`px-2 py-0.5 rounded font-mono text-xs font-semibold ${checkLowStock ? 'text-rose-700 bg-rose-100 border border-rose-200' : 'text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700'}`}>
                      {item.stock} Units
                    </span>
                    {checkLowStock && <AlertTriangle className="w-4 h-4 text-rose-500 ml-2 print:hidden" title="Low stock alert" />}
                  </div>
                  <div className="text-right w-24 flex justify-end space-x-2 print:hidden">
                    <button onClick={() => { setBarcodeItem(item); setBarcodePrintQty(1); }} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors" title="Print Barcode">
                      <BarcodeIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleEditInit(item)} className="text-slate-500 dark:text-slate-400 hover:text-sky-600 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    {user?.role === 'super_admin' && enableDeletion && (
                      <button onClick={() => handleDelete(item.id)} className="text-slate-500 dark:text-slate-400 hover:text-rose-600 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  
                  {/* Print Only Columns */}
                  {printMode !== 'employee' && <div className="w-24 text-right hidden print:block font-mono text-sm">{item.stock}</div>}
                  {printMode === 'with_amount' && <div className="w-32 text-right hidden print:block font-mono text-sm">{(item.cost || 0).toFixed(2)}</div>}
                  {printMode === 'employee' && <div className="w-32 text-right hidden print:block font-mono text-sm font-bold">{(item.price || 0).toFixed(2)}</div>}
                  {printMode === 'with_amount' && <div className="w-32 text-right hidden print:block font-mono text-sm font-bold">{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                </div>
              );
            })}
            
            {filteredItems.length === 0 && (
              <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
                {searchTerm ? 'No items found matching your search.' : 'No items in inventory.'}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
