import React, { useState } from 'react';
import { useBranch, Branch } from '../context/BranchContext';
import { collection, doc, Timestamp, updateDoc, onSnapshot, query, getDocs, getDoc, runTransaction, writeBatch, addDoc, setDoc, deleteDoc } from '../lib/customFirestore';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db, safeGetDocs, secondaryAuth } from '../lib/firebase';
import { Plus, Building, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

export function Branches() {
  const { branches, loading } = useBranch();
  const { user } = useAuth();
  const { enableDeletion } = useSettings();
  const [showForm, setShowForm] = useState(false);
  
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [phone2, setPhone2] = useState('');
  const [address, setAddress] = useState('');
  const [onlinePhone, setOnlinePhone] = useState('');
  
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchColor, setNewBranchColor] = useState('#3b82f6');
  const [newBranchPhone, setNewBranchPhone] = useState('');
  const [newBranchPhone2, setNewBranchPhone2] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');
  const [newBranchOnlinePhone, setNewBranchOnlinePhone] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      // 1. Create User in Auth using secondary app to avoid logging out super admin
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, adminEmail, password);
      const newUid = userCredential.user.uid;
      
      // We sign out the secondary auth right away to keep it clean
      await signOut(secondaryAuth);

      // 2. Create the branch document
      const branchRef = await addDoc(collection(db, 'branches'), {
        name,
        color,
        adminEmail,
        phone,
        phone2,
        address,
        onlinePhone,
        createdAt: Timestamp.now(),
        tenantId: user?.tenantId || user?.uid
      });

      // 3. Create the user profile in Firestore
      await setDoc(doc(db, 'users', newUid), {
        email: adminEmail,
        name: adminName,
        role: 'branch_admin',
        branchId: branchRef.id,
        tenantId: user?.tenantId || user?.uid,
        createdAt: Timestamp.now()
      });

      // Reset form
      setShowForm(false);
      setName('');
      setAdminEmail('');
      setAdminName('');
      setPassword('');
      setColor('#3b82f6');

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateBranchLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranch) return;
    setIsSubmitting(true);
    setError('');

    let bAuth = secondaryAuth;
    try {
      if (newAdminPassword) {
        // Create new user in Auth using secondary app
        const branchConfig = (editingBranch as any)?.firebaseConfig;
        if (branchConfig) {
          const { getSecondaryAuthForBranch } = await import('../lib/firebase');
          bAuth = getSecondaryAuthForBranch(branchConfig);
        }

        const userCredential = await createUserWithEmailAndPassword(bAuth, newAdminEmail, newAdminPassword);
        const newUid = userCredential.user.uid;
        
        await signOut(bAuth);

        // Create new profile in Firestore
        await setDoc(doc(db, 'users', newUid), {
          email: newAdminEmail,
          name: newAdminName,
          role: 'branch_admin',
          branchId: editingBranch.id,
          tenantId: user?.tenantId || user?.uid,
          createdAt: Timestamp.now()
        });

        // Update the branch document with the new admin email, name and color
        await setDoc(doc(db, 'branches', editingBranch.id), {
          name: newBranchName,
          color: newBranchColor,
          adminEmail: newAdminEmail,
          phone: newBranchPhone,
          phone2: newBranchPhone2,
          address: newBranchAddress,
          onlinePhone: newBranchOnlinePhone
        }, { merge: true });

        alert(`Branch details and Login updated! New admin can log in with ${newAdminEmail}`);
      } else {
        // Just update branch details
        await setDoc(doc(db, 'branches', editingBranch.id), {
          name: newBranchName,
          color: newBranchColor,
          phone: newBranchPhone,
          phone2: newBranchPhone2,
          address: newBranchAddress,
          onlinePhone: newBranchOnlinePhone
        }, { merge: true });
        
        alert(`Branch details updated successfully!`);
      }

      setEditingBranch(null);
      setNewAdminEmail('');
      setNewAdminName('');
      setNewAdminPassword('');
      setNewBranchName('');
      setNewBranchColor('#3b82f6');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!enableDeletion) return;
    if (confirm("Are you sure you want to delete this branch? Note: Admin user needs to be manually deleted from Users & Logins.")) {
      try {
        await deleteDoc(doc(db, 'branches', id));
      } catch (err: any) {
        alert("Failed to delete branch: " + err.message);
      }
    }
  };

  if (loading) return <div>Loading branches...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Manage Branches</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Branch
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100 mb-4">Create New Branch & Admin</h3>
          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          <form onSubmit={handleCreateBranch} className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Branch Name</label>
                <input required type="text" value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" placeholder="e.g. Branch 2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Phone 1 (For Print Slip)</label>
                <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" placeholder="e.g. 03001234567" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Phone 2 (For Print Slip)</label>
                <input type="text" value={phone2} onChange={e => setPhone2(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" placeholder="e.g. 03123456789" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Address (For Print Slip)</label>
                <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" placeholder="e.g. 123 Main St, City" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Online Order Phone (For Print Slip)</label>
                <input type="text" value={onlinePhone} onChange={e => setOnlinePhone(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" placeholder="e.g. 03456789123" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Branch Color (Hex)</label>
                <div className="mt-1 flex items-center space-x-2">
                  <input required type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-9 rounded-md border border-slate-300 dark:border-slate-600 p-0 shadow-sm" />
                  <input required type="text" value={color} onChange={e => setColor(e.target.value)} className="block w-full text-slate-500 dark:text-slate-400 rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" />
                </div>
              </div>
            </div>
            
            <h4 className="text-md font-medium text-slate-700 dark:text-slate-200 pt-4 border-t border-slate-100 dark:border-slate-800/50">Branch Admin Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Admin Full Name</label>
                <input required type="text" value={adminName} onChange={e => setAdminName(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Admin Email</label>
                <input required type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Admin Password</label>
                <input required type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} className="mt-1 block w-full rounded-md border-slate-300 dark:border-slate-600 shadow-sm border py-2 px-3 focus:border-blue-500 focus:ring-blue-500 sm:text-sm" />
              </div>
            </div>

            <div className="pt-4 flex justify-end space-x-3">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50">Cancel</button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                {isSubmitting ? 'Creating...' : 'Create Branch'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {branches.map(branch => (
          <div key={branch.id} className="card p-6 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: branch.color }}></div>
            <div className="flex items-center justify-between mb-4 pl-2">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center">
                <Building className="w-5 h-5 mr-3 text-slate-400" />
                {branch.name}
              </h3>
              <div className="flex items-center space-x-3">
                <span className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: branch.color }}></span>
                {user?.role === 'super_admin' && enableDeletion && (
                  <button onClick={() => handleDelete(branch.id)} className="text-slate-300 hover:text-red-500 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="pl-[28px] space-y-1">
              <div className="text-[10px] text-slate-400 uppercase tracking-widest flex items-center justify-between">
                <span>Admin Details</span>
                {user?.role === 'super_admin' && (
                  <button 
                    onClick={() => {
                      setEditingBranch(branch);
                      setNewBranchName(branch.name);
                      setNewBranchColor(branch.color);
                      setNewAdminEmail(branch.adminEmail || '');
                      setNewAdminName('New Admin');
                      setNewAdminPassword('');
                      setError('');
                    }} 
                    className="text-blue-500 hover:text-blue-700 text-xs normal-case"
                  >
                    Edit / Set Login
                  </button>
                )}
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200"> 
                {branch.adminEmail}
              </p>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/50">System ID</div>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{branch.id}</p>
            </div>
          </div>
        ))}
        {branches.length === 0 && !showForm && (
          <div className="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 rounded-lg border border-dashed border-slate-300 dark:border-slate-600">
            No branches found. Create one to get started.
          </div>
        )}
      </div>

      {editingBranch && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/50 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Edit {editingBranch.name}</h3>
              <button onClick={() => setEditingBranch(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                ×
              </button>
            </div>
            <form onSubmit={handleUpdateBranchLogin} className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded text-sm border-l-4 border-red-500">
                  {error}
                </div>
              )}
              
              <div className="pb-4 border-b border-slate-100 dark:border-slate-800/50 space-y-4">
                <h4 className="text-sm font-medium text-slate-800 dark:text-slate-100">Branch Details</h4>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Branch Name</label>
                  <input required type="text" value={newBranchName} onChange={e => setNewBranchName(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Phone 1</label>
                  <input type="text" value={newBranchPhone} onChange={e => setNewBranchPhone(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" placeholder="e.g. 03001234567" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Phone 2</label>
                  <input type="text" value={newBranchPhone2} onChange={e => setNewBranchPhone2(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" placeholder="e.g. 03123456789" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Address</label>
                  <input type="text" value={newBranchAddress} onChange={e => setNewBranchAddress(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" placeholder="e.g. 123 Main St, City" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Online Order Phone</label>
                  <input type="text" value={newBranchOnlinePhone} onChange={e => setNewBranchOnlinePhone(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" placeholder="e.g. 03456789123" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Branch Color (Hex)</label>
                  <div className="mt-1 flex items-center space-x-2">
                    <input required type="color" value={newBranchColor} onChange={e => setNewBranchColor(e.target.value)} className="h-9 w-9 rounded border border-slate-300 dark:border-slate-600 p-0 shadow-sm" />
                    <input required type="text" value={newBranchColor} onChange={e => setNewBranchColor(e.target.value)} className="block w-full text-slate-500 dark:text-slate-400 rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none sm:text-sm" />
                  </div>
                </div>
              </div>

              <div className="pt-2 space-y-4">
                <h4 className="text-sm font-medium text-slate-800 dark:text-slate-100">Update Admin Login (Optional)</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Leave password empty if you only want to update branch details.</p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Admin Full Name</label>
                  <input type="text" value={newAdminName} onChange={e => setNewAdminName(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Admin Email</label>
                  <input type="email" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">New Password</label>
                  <input type="password" minLength={6} value={newAdminPassword} onChange={e => setNewAdminPassword(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" placeholder="Minimum 6 characters" />
                </div>
              </div>
              
              <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-800/50">
                <button type="button" onClick={() => setEditingBranch(null)} className="px-4 py-2 bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-200 font-medium rounded-lg hover:bg-slate-200 transition">
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-sky-600 text-white font-medium rounded-lg hover:bg-sky-700 transition disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
