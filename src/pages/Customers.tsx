import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';
import { collection, query, where, onSnapshot, Timestamp, doc, setDoc, updateDoc, getDocs, getDoc, runTransaction, writeBatch, addDoc, deleteDoc } from '../lib/customFirestore';
import { db, safeGetDocs, safeCollectionSnapshot } from '../lib/firebase';
import { Users, Plus, Trash2, Mail, Phone, MapPin, Edit, Search, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';

interface Customer {
  id: string;
  branchId: string;
  name: string;
  phone: string;
  email: string;
  address?: string;
  city?: string;
  createdAt: any;
}

import { useSettings } from '../context/SettingsContext';

export function Customers() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
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

  useEffect(() => {
    if (showAdd && !selectedBranchId) {
      if (activeBranchId) setSelectedBranchId(activeBranchId);
      else if (branches.length > 0) setSelectedBranchId(branches[0].id);
    }
  }, [showAdd, activeBranchId, branches]);

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

  const filteredCustomers = customers.filter(c => {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 card p-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
            <Users className="w-5 h-5 mr-3 text-slate-500 dark:text-slate-400" />
            Customer Directory (کسٹمرز)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Total {customers.length} registered customers across branches
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search customer by name/phone..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 transition shadow-sm text-sm font-semibold shrink-0 cursor-pointer">
            <Plus className="w-4 h-4 mr-1.5" /> Add Customer (کسٹمر بنائیں)
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card p-6 bg-slate-50 dark:bg-slate-800/50 border border-sky-100 dark:border-sky-900/40">
          <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-slate-700 pb-2">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Plus className="w-4 h-4 text-sky-600" /> New Customer Profile (نیا کسٹمر)
            </h3>
            <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600 p-1">
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

      {/* EDIT CUSTOMER MODAL */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 dark:border-slate-700 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-slate-700 pb-3">
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Edit className="w-5 h-5 text-sky-600" /> Edit Customer Profile (کسٹمر کا نام تبدیل کریں)
              </h3>
              <button onClick={() => setEditingCustomer(null)} className="text-slate-400 hover:text-slate-600 p-1">
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
                    value={editCity}
                    onChange={e => setEditCity(e.target.value)}
                    className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
                    placeholder="City"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
                  placeholder="Email"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Address (پتہ)
                </label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={e => setEditAddress(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:ring-1 focus:ring-sky-500 outline-none"
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
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-sky-600 text-white rounded-md text-sm font-semibold hover:bg-sky-700 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {isSubmitting ? 'Updating...' : 'Update Customer (محفوظ کریں)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredCustomers.map(c => {
          const bName = branches.find(b => b.id === c.branchId)?.name || 'Unknown Branch';
          return (
            <div key={c.id} className="card p-5 group flex flex-col hover:border-sky-300 transition-all">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center">
                  <div className="w-10 h-10 rounded-full bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 flex items-center justify-center text-sky-700 dark:text-sky-300 font-bold text-lg mr-3 shadow-xs">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base flex items-center gap-1.5">
                      <span>{c.name}</span>
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
                 <span onClick={() => navigate('/ledger', { state: { viewMode: 'customer', customerId: c.id } })} className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium hover:underline cursor-pointer">
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
  );
}
