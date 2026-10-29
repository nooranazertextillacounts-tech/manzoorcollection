import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, addDoc, updateDoc, deleteDoc, Timestamp, where, getDocs } from '../lib/customFirestore';
import { db, safeCollectionSnapshot } from '../lib/firebase';
import { Plus, Edit2, Trash2, Search, Package, Save, X, Phone, User, Hash } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';


interface OnlineSalesEmployee {
  id: string;
  name: string;
  onlineCode: string;
  mobileNumber: string;
  status: 'Active' | 'Inactive';
  notes: string;
  createdAt: any;
  tenantId?: string;
  branchId?: string;
}

export function OnlineSalesEmployees() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const [employees, setEmployees] = useState<OnlineSalesEmployee[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Form State
  const [editId, setEditId] = useState('');
  const [name, setName] = useState('');
  const [onlineCode, setOnlineCode] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!user?.tenantId) {
      if (user?.uid) {
        // Fallback for user without tenantId but with uid
      } else {
        return;
      }
    }
    
    const tenantId = user.tenantId || user.uid;
    let q: any = collection(db, 'onlineSalesEmployees');
    q = query(q, where('tenantId', '==', tenantId));

    const unsubscribe = safeCollectionSnapshot(q, (snapshot) => {
      let empsData = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as OnlineSalesEmployee[];
      
      if (activeBranchId) {
        empsData = empsData.filter(e => e.branchId === activeBranchId || (!e.branchId && activeBranchId === 'main'));
      }
      
      empsData.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
        return timeB - timeA;
      });
      setEmployees(empsData);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user, activeBranchId]);

  const resetForm = () => {
    setEditId('');
    setName('');
    setOnlineCode('');
    setMobileNumber('');
    setStatus('Active');
    setNotes('');
  };

  const openAddModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (emp: OnlineSalesEmployee) => {
    setEditId(emp.id);
    setName(emp.name);
    setOnlineCode(emp.onlineCode);
    setMobileNumber(emp.mobileNumber || '');
    setStatus(emp.status);
    setNotes(emp.notes || '');
    setIsModalOpen(true);
  };

  const checkCodeExists = async (code: string, excludeId?: string) => {
    const tenantId = user?.tenantId || user?.uid;
    const q = query(
      collection(db, 'onlineSalesEmployees'),
      where('tenantId', '==', tenantId),
      where('onlineCode', '==', code)
    );
    const snap = await getDocs(q);
    if (snap.empty) return false;
    
    // Check if the only matches are the one we are excluding
    const matches = snap.docs.filter(d => d.id !== excludeId);
    return matches.length > 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !onlineCode) {
      toast.error('Name and Online Code are required.');
      return;
    }

    try {
      const codeUpper = onlineCode.toUpperCase().trim();
      
      const exists = await checkCodeExists(codeUpper, editId);
      if (exists) {
        toast.error(`Online Code "${codeUpper}" is already in use.`);
        return;
      }

      const tenantId = user?.tenantId || user?.uid;
      const finalBranchId = activeBranchId || user?.branchId || 'main';
      
      const data: any = {
        name: name.trim(),
        onlineCode: codeUpper,
        mobileNumber: mobileNumber.trim(),
        status,
        notes: notes.trim(),
        tenantId,
        branchId: finalBranchId
      };

      if (editId) {
        await updateDoc(doc(db, 'onlineSalesEmployees', editId), data);
        toast.success('Employee updated successfully');
      } else {
        await addDoc(collection(db, 'onlineSalesEmployees'), {
          ...data,
          createdAt: Timestamp.now()
        });
        toast.success('Employee added successfully');
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err: any) {
      toast.error('Error saving employee: ' + err.message);
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (window.confirm(`Are you sure you want to delete ${code}?`)) {
      try {
        await deleteDoc(doc(db, 'onlineSalesEmployees', id));
        toast.success('Employee deleted successfully');
      } catch (error) {
        toast.error('Error deleting employee');
      }
    }
  };

  const filteredEmployees = employees.filter(emp => 
    emp.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    emp.onlineCode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Online Sales Employees</h1>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Employee
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="relative max-w-md">
            <input
              type="text"
              placeholder="Search by name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 font-semibold">Online Code</th>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Mobile Number</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Notes</th>
                {user?.role === 'super_admin' && <th className="px-4 py-3 font-semibold">Branch</th>}
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-slate-700 dark:text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={user?.role === 'super_admin' ? 7 : 6} className="px-4 py-8 text-center text-slate-500">
                    Loading employees...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={user?.role === 'super_admin' ? 7 : 6} className="px-4 py-8 text-center text-slate-500">
                    No online sales employees found.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors">
                    <td className="px-4 py-3 font-medium text-emerald-600 dark:text-emerald-400">
                      {emp.onlineCode}
                    </td>
                    <td className="px-4 py-3 font-semibold">{emp.name}</td>
                    <td className="px-4 py-3">{emp.mobileNumber || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        emp.status === 'Active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                      )}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 truncate max-w-[200px]">{emp.notes || '-'}</td>
                    {user?.role === 'super_admin' && (
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-xs">
                          {emp.branchId ? (branches.find(b => b.id === emp.branchId)?.name || 'Main Branch') : 'Main Branch'}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEditModal(emp)}
                        className="p-1.5 text-slate-400 hover:text-blue-500 transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(emp.id, emp.onlineCode)}
                        className="p-1.5 text-slate-400 hover:text-red-500 transition-colors ml-2"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
                  {editId ? 'Edit Online Sales Employee' : 'Add Online Sales Employee'}
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Employee Name *
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <User className="h-4 w-4 text-slate-400" />
                      </div>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="pl-9 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                        placeholder="e.g. Ali"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Online Code *
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Hash className="h-4 w-4 text-slate-400" />
                      </div>
                      <input
                        type="text"
                        required
                        value={onlineCode}
                        onChange={(e) => setOnlineCode(e.target.value)}
                        className="pl-9 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 uppercase"
                        placeholder="e.g. COD1"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Mobile Number
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Phone className="h-4 w-4 text-slate-400" />
                      </div>
                      <input
                        type="text"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value)}
                        className="pl-9 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Status
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    placeholder="Optional notes..."
                  />
                </div>

                <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Save Employee
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
