import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { collection, query, where, onSnapshot, addDoc, Timestamp, doc, updateDoc, deleteDoc, getDoc, runTransaction, writeBatch, orderBy } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { Plus, Printer, Trash2, Search, User, Package, Receipt, ArrowLeft, RefreshCcw, Pencil, AlertCircle } from 'lucide-react';
import { printInvoice } from '../lib/print';
import toast from 'react-hot-toast';
import { Employee, InventoryItem, EmployeePurchase, EmployeeReturn, SaleItem } from '../types';
import { format } from 'date-fns';

export function EmployeePurchases() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  
  const [activeTab, setActiveTab] = useState<'purchase' | 'return'>('purchase');
  const [purchases, setPurchases] = useState<EmployeePurchase[]>([]);
  const [returns, setReturns] = useState<EmployeeReturn[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  
  const [showAdd, setShowAdd] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [printPurchase, setPrintPurchase] = useState<EmployeePurchase | null>(null);
  const [printReturn, setPrintReturn] = useState<EmployeeReturn | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<EmployeePurchase | null>(null);
  const [editingReturn, setEditingReturn] = useState<EmployeeReturn | null>(null);
  const [historySearch, setHistorySearch] = useState('');

  // Form State
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [empSearchQuery, setEmpSearchQuery] = useState('');

  useEffect(() => {
    if (!activeBranchId) return;

    // Fetch Employees
    const empQ = query(collection(db, 'employees'), where('branchId', '==', activeBranchId), where('status', '==', 'active'));
    const unsubEmp = safeCollectionSnapshot(empQ, (snap) => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });

    // Fetch Inventory
    const invQ = query(collection(db, 'inventory'), where('branchId', '==', activeBranchId));
    const unsubInv = safeCollectionSnapshot(invQ, (snap) => {
      setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });

    // Fetch Employee Purchases
    const purchaseQ = query(
      collection(db, 'employeePurchases'), 
      where('branchId', '==', activeBranchId),
      orderBy('date', 'desc')
    );
    const unsubPurchase = safeCollectionSnapshot(purchaseQ, (snap) => {
      setPurchases(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });

    // Fetch Employee Returns
    const returnQ = query(
      collection(db, 'employeeReturns'), 
      where('branchId', '==', activeBranchId),
      orderBy('date', 'desc')
    );
    const unsubReturn = safeCollectionSnapshot(returnQ, (snap) => {
      setReturns(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });

    return () => {
      unsubEmp();
      unsubInv();
      unsubPurchase();
      unsubReturn();
    };
  }, [activeBranchId]);

  const addToCart = (item: InventoryItem) => {
    const existing = cart.find(c => c.id === item.id);
    if (existing) {
      setCart(cart.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c));
    } else {
      setCart([...cart, {
        id: item.id,
        name: item.name,
        qty: 1,
        price: item.price,
        cost: item.cost,
        sku: item.sku
      }]);
    }
    toast.success(`Added ${item.name}`);
  };

  const removeFromCart = (id: string) => {
    setCart(cart.filter(c => c.id !== id));
  };

  const updateQty = (id: string, qty: number) => {
    if (qty <= 0) return removeFromCart(id);
    setCart(cart.map(c => c.id === id ? { ...c, qty } : c));
  };

  const updatePrice = (id: string, price: number) => {
    setCart(cart.map(c => c.id === id ? { ...c, price } : c));
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  const handleEditPurchase = (purchase: EmployeePurchase) => {
    setActiveTab('purchase');
    setEditingPurchase(purchase);
    setEditingReturn(null);
    setSelectedEmpId(purchase.employeeId);
    setCart(purchase.items.map(item => ({ ...item })));
    setShowAdd(true);
    setPrintPurchase(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditReturn = (ret: EmployeeReturn) => {
    setActiveTab('return');
    setEditingReturn(ret);
    setEditingPurchase(null);
    setSelectedEmpId(ret.employeeId);
    setCart(ret.items.map(item => ({ ...item })));
    setShowAdd(true);
    setPrintReturn(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingPurchase(null);
    setEditingReturn(null);
    setShowAdd(false);
    setCart([]);
    setSelectedEmpId('');
    setSearchQuery('');
    setEmpSearchQuery('');
  };

  const handleDeletePurchase = async (purchase: EmployeePurchase) => {
    if (!window.confirm(`Are you sure you want to delete purchase bill ${purchase.invoiceNo}? This will restore inventory stock and deduct PKR ${purchase.total.toLocaleString()} from employee advance balance.`)) {
      return;
    }
    try {
      const batch = writeBatch(db);
      for (const item of purchase.items) {
        const invItem = inventory.find(i => i.id === item.id);
        if (invItem) {
          batch.update(doc(db, 'inventory', item.id), {
            stock: (invItem.stock || 0) + item.qty,
            updatedAt: Timestamp.now()
          });
        }
      }
      const emp = employees.find(e => e.id === purchase.employeeId);
      if (emp) {
        batch.update(doc(db, 'employees', emp.id), {
          advanceBalance: (Number(emp.advanceBalance) || 0) - purchase.total,
          updatedAt: Timestamp.now()
        });
      }
      try {
        const ledgerQ = query(collection(db, 'ledger'), where('branchId', '==', activeBranchId));
        const ledgerDocs = await safeGetDocs(ledgerQ);
        ledgerDocs.docs.forEach(d => {
          const desc = d.data().description || '';
          if (desc.includes(purchase.invoiceNo)) {
            batch.delete(doc(db, 'ledger', d.id));
          }
        });
      } catch (lErr) {
        console.warn("Could not delete ledger entry", lErr);
      }
      batch.delete(doc(db, 'employeePurchases', purchase.id));
      await batch.commit();
      toast.success(`Purchase bill ${purchase.invoiceNo} deleted successfully`);
    } catch (err: any) {
      toast.error("Failed to delete purchase: " + err.message);
    }
  };

  const handleDeleteReturn = async (ret: EmployeeReturn) => {
    if (!window.confirm(`Are you sure you want to delete return bill ${ret.returnNo}? This will reduce inventory stock and add PKR ${ret.total.toLocaleString()} back to employee advance balance.`)) {
      return;
    }
    try {
      const batch = writeBatch(db);
      for (const item of ret.items) {
        const invItem = inventory.find(i => i.id === item.id);
        if (invItem) {
          batch.update(doc(db, 'inventory', item.id), {
            stock: (invItem.stock || 0) - item.qty,
            updatedAt: Timestamp.now()
          });
        }
      }
      const emp = employees.find(e => e.id === ret.employeeId);
      if (emp) {
        batch.update(doc(db, 'employees', emp.id), {
          advanceBalance: (Number(emp.advanceBalance) || 0) + ret.total,
          updatedAt: Timestamp.now()
        });
      }
      try {
        const ledgerQ = query(collection(db, 'ledger'), where('branchId', '==', activeBranchId));
        const ledgerDocs = await safeGetDocs(ledgerQ);
        ledgerDocs.docs.forEach(d => {
          const desc = d.data().description || '';
          if (desc.includes(ret.returnNo)) {
            batch.delete(doc(db, 'ledger', d.id));
          }
        });
      } catch (lErr) {
        console.warn("Could not delete ledger entry", lErr);
      }
      batch.delete(doc(db, 'employeeReturns', ret.id));
      await batch.commit();
      toast.success(`Return bill ${ret.returnNo} deleted successfully`);
    } catch (err: any) {
      toast.error("Failed to delete return: " + err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmpId) return toast.error("Please select an employee");
    if (cart.length === 0) return toast.error("Cart is empty");

    setIsSubmitting(true);
    try {
      const employee = employees.find(e => e.id === selectedEmpId);
      if (!employee) throw new Error("Employee not found");

      const batch = writeBatch(db);

      if (activeTab === 'purchase') {
        if (editingPurchase) {
          // EDIT PURCHASE LOGIC
          const invoiceNo = editingPurchase.invoiceNo;
          const purchaseRef = doc(db, 'employeePurchases', editingPurchase.id);

          batch.update(purchaseRef, {
            employeeId: employee.id,
            employeeName: employee.name,
            items: cart,
            total,
            updatedAt: Timestamp.now()
          });

          // Stock adjustments: add back old qty, deduct new qty
          const stockDeltas: { [id: string]: number } = {};
          for (const item of editingPurchase.items) {
            stockDeltas[item.id] = (stockDeltas[item.id] || 0) + item.qty;
          }
          for (const item of cart) {
            stockDeltas[item.id] = (stockDeltas[item.id] || 0) - item.qty;
          }

          for (const [itemId, delta] of Object.entries(stockDeltas)) {
            if (delta !== 0) {
              const invItem = inventory.find(i => i.id === itemId);
              if (invItem) {
                batch.update(doc(db, 'inventory', itemId), {
                  stock: (invItem.stock || 0) + delta,
                  updatedAt: Timestamp.now()
                });
              }
            }
          }

          // Advance balance adjustments
          if (editingPurchase.employeeId === selectedEmpId) {
            const diff = total - editingPurchase.total;
            batch.update(doc(db, 'employees', employee.id), {
              advanceBalance: (employee.advanceBalance || 0) + diff,
              updatedAt: Timestamp.now()
            });
          } else {
            const oldEmp = employees.find(e => e.id === editingPurchase.employeeId);
            if (oldEmp) {
              batch.update(doc(db, 'employees', oldEmp.id), {
                advanceBalance: (Number(oldEmp.advanceBalance) || 0) - editingPurchase.total,
                updatedAt: Timestamp.now()
              });
            }
            batch.update(doc(db, 'employees', employee.id), {
              advanceBalance: (employee.advanceBalance || 0) + total,
              updatedAt: Timestamp.now()
            });
          }

          // Update ledger
          try {
            const ledgerQ = query(collection(db, 'ledger'), where('branchId', '==', activeBranchId));
            const ledgerDocs = await safeGetDocs(ledgerQ);
            const matchedDoc = ledgerDocs.docs.find(d => {
              const desc = d.data().description || '';
              return desc.includes(invoiceNo);
            });
            if (matchedDoc) {
              batch.update(doc(db, 'ledger', matchedDoc.id), {
                amount: total,
                employeeId: employee.id,
                description: `Employee Purchase: ${employee.name} (Inv: ${invoiceNo})`,
                updatedAt: Timestamp.now()
              });
            }
          } catch (lErr) {
            console.warn("Could not sync ledger", lErr);
          }

          await batch.commit();
          toast.success(`Purchase Bill ${invoiceNo} Updated Successfully!`);
          setPrintPurchase({
            ...editingPurchase,
            employeeId: employee.id,
            employeeName: employee.name,
            items: cart,
            total
          });
        } else {
          // NEW PURCHASE LOGIC
          const invoiceNo = `EP-${Date.now().toString().slice(-6)}`;
          const purchaseData = {
            invoiceNo,
            employeeId: employee.id,
            employeeName: employee.name,
            branchId: activeBranchId,
            items: cart,
            total,
            date: new Date().getTime(),
            createdAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid
          };

          const purchaseRef = doc(collection(db, 'employeePurchases'));
          batch.set(purchaseRef, purchaseData);

          // Update Employee Advance Balance (+)
          const empRef = doc(db, 'employees', employee.id);
          batch.update(empRef, {
            advanceBalance: (employee.advanceBalance || 0) + total,
            updatedAt: Timestamp.now()
          });

          // Update Inventory Stock (-)
          for (const item of cart) {
            const invRef = doc(db, 'inventory', item.id);
            const invItem = inventory.find(i => i.id === item.id);
            if (invItem) {
              batch.update(invRef, {
                stock: (invItem.stock || 0) - item.qty,
                updatedAt: Timestamp.now()
              });
            }
          }

          // Add Ledger Entry (OUT)
          const ledgerRef = doc(collection(db, 'ledger'));
          batch.set(ledgerRef, {
            branchId: activeBranchId,
            date: new Date().getTime(),
            description: `Employee Purchase: ${employee.name} (Inv: ${invoiceNo})`,
            category: 'Advance',
            type: 'OUT',
            amount: total,
            reference: 'Advance',
            employeeId: employee.id,
            createdAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid
          });

          await batch.commit();
          toast.success("Employee Purchase Recorded Successfully");
          setPrintPurchase({ id: purchaseRef.id, ...purchaseData } as EmployeePurchase);
        }
      } else {
        if (editingReturn) {
          // EDIT RETURN LOGIC
          const returnNo = editingReturn.returnNo;
          const returnRef = doc(db, 'employeeReturns', editingReturn.id);

          batch.update(returnRef, {
            employeeId: employee.id,
            employeeName: employee.name,
            items: cart,
            total,
            updatedAt: Timestamp.now()
          });

          // Stock adjustments: return adds to stock, so old return added stock, we deduct old qty and add new qty
          const stockDeltas: { [id: string]: number } = {};
          for (const item of editingReturn.items) {
            stockDeltas[item.id] = (stockDeltas[item.id] || 0) - item.qty;
          }
          for (const item of cart) {
            stockDeltas[item.id] = (stockDeltas[item.id] || 0) + item.qty;
          }

          for (const [itemId, delta] of Object.entries(stockDeltas)) {
            if (delta !== 0) {
              const invItem = inventory.find(i => i.id === itemId);
              if (invItem) {
                batch.update(doc(db, 'inventory', itemId), {
                  stock: (invItem.stock || 0) + delta,
                  updatedAt: Timestamp.now()
                });
              }
            }
          }

          // Advance balance adjustments: return reduces advance, so diff is inverted
          if (editingReturn.employeeId === selectedEmpId) {
            const diff = total - editingReturn.total;
            batch.update(doc(db, 'employees', employee.id), {
              advanceBalance: (Number(employee.advanceBalance) || 0) - diff,
              updatedAt: Timestamp.now()
            });
          } else {
            const oldEmp = employees.find(e => e.id === editingReturn.employeeId);
            if (oldEmp) {
              batch.update(doc(db, 'employees', oldEmp.id), {
                advanceBalance: (Number(oldEmp.advanceBalance) || 0) + editingReturn.total,
                updatedAt: Timestamp.now()
              });
            }
            batch.update(doc(db, 'employees', employee.id), {
              advanceBalance: (Number(employee.advanceBalance) || 0) - total,
              updatedAt: Timestamp.now()
            });
          }

          // Update ledger
          try {
            const ledgerQ = query(collection(db, 'ledger'), where('branchId', '==', activeBranchId));
            const ledgerDocs = await safeGetDocs(ledgerQ);
            const matchedDoc = ledgerDocs.docs.find(d => {
              const desc = d.data().description || '';
              return desc.includes(returnNo);
            });
            if (matchedDoc) {
              batch.update(doc(db, 'ledger', matchedDoc.id), {
                amount: total,
                employeeId: employee.id,
                description: `Employee Return: ${employee.name} (Ret: ${returnNo})`,
                updatedAt: Timestamp.now()
              });
            }
          } catch (lErr) {
            console.warn("Could not sync ledger", lErr);
          }

          await batch.commit();
          toast.success(`Return Bill ${returnNo} Updated Successfully!`);
          setPrintReturn({
            ...editingReturn,
            employeeId: employee.id,
            employeeName: employee.name,
            items: cart,
            total
          });
        } else {
          // NEW RETURN LOGIC
          const returnNo = `ER-${Date.now().toString().slice(-6)}`;
          const returnData = {
            returnNo,
            employeeId: employee.id,
            employeeName: employee.name,
            branchId: activeBranchId,
            items: cart,
            total,
            date: new Date().getTime(),
            createdAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid
          };

          const returnRef = doc(collection(db, 'employeeReturns'));
          batch.set(returnRef, returnData);

          // Update Employee Advance Balance (-)
          const empRef = doc(db, 'employees', employee.id);
          batch.update(empRef, {
            advanceBalance: (employee.advanceBalance || 0) - total,
            updatedAt: Timestamp.now()
          });

          // Update Inventory Stock (+)
          for (const item of cart) {
            const invRef = doc(db, 'inventory', item.id);
            const invItem = inventory.find(i => i.id === item.id);
            if (invItem) {
              batch.update(invRef, {
                stock: (invItem.stock || 0) + item.qty,
                updatedAt: Timestamp.now()
              });
            }
          }

          // Add Ledger Entry (IN)
          const ledgerRef = doc(collection(db, 'ledger'));
          batch.set(ledgerRef, {
            branchId: activeBranchId,
            date: new Date().getTime(),
            description: `Employee Return: ${employee.name} (Ret: ${returnNo})`,
            category: 'Advance',
            type: 'IN',
            amount: total,
            reference: 'Advance',
            employeeId: employee.id,
            createdAt: Timestamp.now(),
            tenantId: user?.tenantId || user?.uid
          });

          await batch.commit();
          toast.success("Employee Return Recorded Successfully");
          setPrintReturn({ id: returnRef.id, ...returnData } as EmployeeReturn);
        }
      }

      setEditingPurchase(null);
      setEditingReturn(null);
      setShowAdd(false);
      setCart([]);
      setSelectedEmpId('');
      setSearchQuery('');
    } catch (error: any) {
      console.error(error);
      toast.error("Failed to record transaction: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredInventory = inventory.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.sku?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredEmployees = employees.filter(emp => 
    emp.name.toLowerCase().includes(empSearchQuery.toLowerCase())
  );

  if (printPurchase || printReturn) {
    const data = printPurchase || (printReturn as any);
    const isReturn = !!printReturn;
    const invoiceNo = isReturn ? (data as EmployeeReturn).returnNo : (data as EmployeePurchase).invoiceNo;

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center print:hidden">
          <button onClick={() => { setPrintPurchase(null); setPrintReturn(null); }} className="flex items-center text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-5 h-5 mr-2" /> Back
          </button>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                if (printPurchase) handleEditPurchase(printPurchase);
                else if (printReturn) handleEditReturn(printReturn);
              }}
              className="btn btn-secondary flex items-center gap-1.5 text-amber-600 hover:text-amber-700"
            >
              <Pencil className="w-4 h-4" /> Edit Bill
            </button>
            <button onClick={() => printInvoice('emp-transaction-print', `Transaction-${invoiceNo}`, 'thermal')} className="btn btn-primary flex items-center">
              <Printer className="w-5 h-5 mr-2" /> Print Thermal Bill
            </button>
          </div>
        </div>

        <div id="emp-transaction-print" className="bg-white p-4 max-w-[300px] mx-auto text-black font-sans text-[14px] leading-tight font-black">
          <div className="text-center border-b-[2px] border-black border-solid pb-3 mb-3">
             <h1 className="text-[18px] font-black uppercase tracking-tight">MANZOOR COLLECTION</h1>
             <p className="text-[12px] font-bold mt-1">Employee {isReturn ? 'Return' : 'Purchase'}</p>
             <p className="mt-1 font-bold">{isReturn ? 'Return' : 'Invoice'}: {invoiceNo}</p>
             <p className="font-bold">Date: {format(data.date, 'dd/MM/yyyy HH:mm')}</p>
          </div>

          <div className="mb-4 space-y-1">
            <div className="flex justify-between">
              <span className="font-black">Employee:</span>
              <span className="text-right font-black">{data.employeeName}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-black">Branch:</span>
              <span className="text-right font-black">{branches.find(b => b.id === data.branchId)?.name}</span>
            </div>
            <div className={`flex justify-between ${isReturn ? 'text-black' : 'text-black'} font-black mt-2 pt-1 border-t-2 border-black border-dashed`}>
              <span>{isReturn ? 'Credit to:' : 'Payment:'}</span>
              <span className="text-right uppercase">Advance</span>
            </div>
          </div>

          <div className="border-b-[2px] border-black border-solid mb-2"></div>
          
          <div className="space-y-3 mb-4">
            {data.items.map((item: any, idx: number) => (
              <div key={idx} className="flex flex-col border-b border-slate-200 pb-1">
                <div className="flex justify-between font-black text-[15px]">
                  <span>{item.name}</span>
                  <span>PKR {(item.price * item.qty).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-[12px] font-bold">
                  <span>{item.qty} x PKR {item.price.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t-[3px] border-black border-double pt-3">
            <div className="flex justify-between items-center text-[20px] font-black">
              <span>TOTAL</span>
              <span>PKR {data.total.toLocaleString()}</span>
            </div>
          </div>

          <div className="mt-6 text-center text-[11px] font-black leading-tight space-y-1">
            <p>{isReturn ? 'Advance balance decreased.' : 'Deducted from employee advance.'}</p>
            <p className="mt-2 text-[14px]">Thank you!</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center">
            <User className="w-6 h-6 mr-3 text-sky-500" />
            Employee Purchases & Returns
          </h2>
          <div className="flex items-center gap-4 mt-2">
            <button 
              onClick={() => setActiveTab('purchase')}
              className={`text-sm font-bold pb-1 border-b-2 transition-all ${activeTab === 'purchase' ? 'text-sky-600 border-sky-600' : 'text-slate-400 border-transparent'}`}
            >
              Purchases
            </button>
            <button 
              onClick={() => setActiveTab('return')}
              className={`text-sm font-bold pb-1 border-b-2 transition-all ${activeTab === 'return' ? 'text-rose-600 border-rose-600' : 'text-slate-400 border-transparent'}`}
            >
              Returns
            </button>
          </div>
        </div>
        <button 
          onClick={() => setShowAdd(true)} 
          className={`btn flex items-center ${activeTab === 'purchase' ? 'btn-primary' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}
        >
          <Plus className="w-5 h-5 mr-2" /> New {activeTab === 'purchase' ? 'Purchase' : 'Return'}
        </button>
      </div>

      {showAdd ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Editing Notice Banner */}
          {(editingPurchase || editingReturn) && (
            <div className="lg:col-span-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <h4 className="font-bold text-amber-900 dark:text-amber-200 text-sm">
                    {editingPurchase ? `Editing Employee Purchase Bill: ${editingPurchase.invoiceNo}` : `Editing Employee Return Bill: ${editingReturn?.returnNo}`}
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Modifying items, quantities, or rate will automatically balance the employee advance account and adjust inventory stock.
                  </p>
                </div>
              </div>
              <button 
                onClick={handleCancelEdit} 
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 bg-white dark:bg-slate-800 hover:bg-amber-100 transition-colors shadow-sm"
              >
                Cancel Edit
              </button>
            </div>
          )}

          {/* Left Column: Selection */}
          <div className="lg:col-span-2 space-y-6">
            {/* Employee Selection */}
            <div className="card p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center">
                <User className="w-5 h-5 mr-2 text-sky-500" />
                1. Select Employee
              </h3>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                  type="text" 
                  placeholder="Search Employee..." 
                  className="input-field pl-10"
                  value={empSearchQuery}
                  onChange={e => setEmpSearchQuery(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-48 overflow-y-auto pr-2">
                {filteredEmployees.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => setSelectedEmpId(emp.id)}
                    className={`p-3 rounded-lg border text-sm text-left transition-all ${
                      selectedEmpId === emp.id 
                        ? 'border-sky-500 bg-sky-50 text-sky-700 font-bold' 
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    {emp.name}
                    <span className="block text-[10px] font-normal text-slate-500 uppercase">{emp.role}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Item Selection */}
            <div className="card p-6">
              <h3 className="text-lg font-bold mb-4 flex items-center">
                <Package className="w-5 h-5 mr-2 text-sky-500" />
                2. Add {activeTab === 'purchase' ? 'Items' : 'Returned Items'}
              </h3>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                  type="text" 
                  placeholder="Search Inventory (Name or SKU)..." 
                  className="input-field pl-10"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2">
                {filteredInventory.map(item => (
                  <div key={item.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div>
                      <p className="font-bold text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.sku || 'No SKU'} • Stock: {item.stock}</p>
                      <p className="text-sm font-bold text-sky-600 mt-1">PKR {item.price.toLocaleString()}</p>
                    </div>
                    <button 
                      onClick={() => addToCart(item)}
                      disabled={activeTab === 'purchase' && item.stock <= 0}
                      className={`p-2 rounded-full shadow-sm border border-slate-200 transition-colors bg-white ${activeTab === 'purchase' ? 'text-sky-500 hover:bg-sky-50' : 'text-rose-500 hover:bg-rose-50'}`}
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Cart & Summary */}
          <div className="space-y-6">
            <div className="card p-6 sticky top-6">
              <h3 className="text-lg font-bold mb-6 flex items-center justify-between">
                <span className="flex items-center">
                  <Receipt className="w-5 h-5 mr-2 text-sky-500" />
                  {activeTab === 'purchase' ? 'Purchase' : 'Return'} Summary
                </span>
                <span className={`${activeTab === 'purchase' ? 'bg-sky-100 text-sky-600' : 'bg-rose-100 text-rose-600'} text-xs px-2 py-1 rounded-full`}>{cart.length} Items</span>
              </h3>

              <div className="space-y-4 mb-8 max-h-96 overflow-y-auto pr-2">
                {cart.map(item => (
                  <div key={item.id} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex justify-between items-start">
                      <p className="text-sm font-bold text-slate-800 leading-tight">{item.name}</p>
                      <button onClick={() => removeFromCart(item.id)} className="text-rose-500 hover:text-rose-700">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex justify-between items-center mt-1 gap-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQty(item.id, item.qty - 1)} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded-md shadow-sm text-xs font-bold">-</button>
                        <span className="text-sm font-bold w-6 text-center">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, item.qty + 1)} className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded-md shadow-sm text-xs font-bold">+</button>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 font-bold">RATE:</span>
                          <input 
                            type="number" 
                            value={item.price} 
                            onChange={(e) => updatePrice(item.id, Number(e.target.value))}
                            className="w-20 text-right text-xs font-bold bg-white border border-slate-200 rounded px-1 py-0.5 outline-none focus:border-sky-500"
                          />
                        </div>
                        <p className="text-sm font-black text-slate-900">PKR {(item.price * item.qty).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
                {cart.length === 0 && (
                  <div className="text-center py-12 text-slate-400">
                    <Package className="w-12 h-12 mx-auto mb-2 opacity-20" />
                    Your cart is empty
                  </div>
                )}
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex justify-between items-center text-slate-500">
                  <span>Subtotal</span>
                  <span>PKR {total.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xl font-black text-slate-900 pt-2">
                  <span>Grand Total</span>
                  <span>PKR {total.toLocaleString()}</span>
                </div>
                
                {selectedEmpId && (
                  <div className={`${activeTab === 'purchase' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'} border p-3 rounded-lg text-xs mt-4`}>
                    Selected: <span className="font-bold">{employees.find(e => e.id === selectedEmpId)?.name}</span>
                    <br />
                    The total amount will be <span className="font-bold">{activeTab === 'purchase' ? 'added to' : 'deducted from'}</span> their Advance Balance.
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button onClick={handleCancelEdit} className="flex-1 btn btn-secondary">
                    {editingPurchase || editingReturn ? 'Cancel Edit' : 'Cancel'}
                  </button>
                  <button 
                    onClick={handleSubmit} 
                    disabled={isSubmitting || cart.length === 0 || !selectedEmpId} 
                    className={`flex-[2] btn flex items-center justify-center text-white ${activeTab === 'purchase' ? 'bg-sky-600 hover:bg-sky-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                  >
                    {isSubmitting 
                      ? 'Processing...' 
                      : (editingPurchase 
                          ? 'Update Purchase Bill' 
                          : editingReturn 
                            ? 'Update Return Bill' 
                            : `Confirm ${activeTab === 'purchase' ? 'Purchase' : 'Return'}`)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {activeTab === 'purchase' ? (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
                <span className="font-bold text-slate-800 dark:text-slate-100">Purchase History</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4">Invoice #</th>
                      <th className="px-6 py-4">Employee</th>
                      <th className="px-6 py-4">Items</th>
                      <th className="px-6 py-4 text-right">Total Amount</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {purchases.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-6 py-4 text-sm text-slate-500">{format(p.date, 'dd/MM/yyyy')}</td>
                        <td className="px-6 py-4 text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{p.invoiceNo}</td>
                        <td className="px-6 py-4 text-sm font-bold text-slate-900 dark:text-slate-100">{p.employeeName}</td>
                        <td className="px-6 py-4 text-sm text-slate-500">{p.items.length} items</td>
                        <td className="px-6 py-4 text-sm font-bold text-emerald-600 text-right">PKR {p.total.toLocaleString()}</td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => setPrintPurchase(p)} title="Print Thermal Bill" className="p-2 text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                              <Printer className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleEditPurchase(p)} title="Edit Purchase Bill" className="p-2 text-amber-600 hover:bg-amber-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeletePurchase(p)} title="Delete Purchase Bill" className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {purchases.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400">No purchase records found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-rose-50/50 dark:bg-rose-900/10 flex justify-between items-center">
                <span className="font-bold text-rose-800 dark:text-rose-100">Return History</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4">Return #</th>
                      <th className="px-6 py-4">Employee</th>
                      <th className="px-6 py-4">Items</th>
                      <th className="px-6 py-4 text-right">Total Value</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {returns.map(r => (
                      <tr key={r.id} className="hover:bg-rose-50/30 dark:hover:bg-rose-900/5 transition-colors">
                        <td className="px-6 py-4 text-sm text-slate-500">{format(r.date, 'dd/MM/yyyy')}</td>
                        <td className="px-6 py-4 text-sm font-mono font-bold text-rose-700 dark:text-rose-300">{r.returnNo}</td>
                        <td className="px-6 py-4 text-sm font-bold text-slate-900 dark:text-slate-100">{r.employeeName}</td>
                        <td className="px-6 py-4 text-sm text-slate-500">{r.items.length} items</td>
                        <td className="px-6 py-4 text-sm font-bold text-rose-600 text-right">PKR {r.total.toLocaleString()}</td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => setPrintReturn(r)} title="Print Thermal Bill" className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                              <Printer className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleEditReturn(r)} title="Edit Return Bill" className="p-2 text-amber-600 hover:bg-amber-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDeleteReturn(r)} title="Delete Return Bill" className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {returns.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400">No return records found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
