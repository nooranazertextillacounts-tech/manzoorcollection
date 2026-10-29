import React, { useEffect, useState } from 'react';
import { useAuth, UserRole, AppUser } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useSettings } from '../context/SettingsContext';
import { collection, query, where, doc, setDoc, updateDoc, deleteDoc } from '../lib/customFirestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { db, safeCollectionSnapshot, secondaryAuth } from '../lib/firebase';
import { Plus, UserCog, Trash2, KeyRound, Edit, Check, X, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export function Users() {
  const { user } = useAuth();
  const { activeBranchId, branches } = useBranch();
  const { enableDeletion } = useSettings();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  
  // Adding New User State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('sales_stock_only');
  const [branchIdForNewUser, setBranchIdForNewUser] = useState<string>('main');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Editing User State
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('sales_stock_only');
  const [editBranchId, setEditBranchId] = useState<string>('main');
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // Super admin sees all users in their tenant, or branch admin sees users in their branch
    let q: any = collection(db, 'users');
    if (user.role !== 'super_admin') {
      q = query(q, where('branchId', '==', user.branchId || ''));
    } else if (activeBranchId) {
      q = query(q, where('branchId', '==', activeBranchId));
    }
    
    const unsub = safeCollectionSnapshot(q, snap => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) } as AppUser)));
    });
    
    return unsub;
  }, [user, activeBranchId]);

  useEffect(() => {
    // Defaults for new user
    if (user?.role === 'branch_admin') {
      setBranchIdForNewUser(user.branchId || 'main');
    } else {
      setBranchIdForNewUser(activeBranchId || 'main');
    }
  }, [user, activeBranchId]);

  const handleGenerateDefaults = async () => {
    if (!confirm("Are you sure you want to generate default login accounts for all branches? Existing emails will fail gracefully.")) return;
    setIsSubmitting(true);
    let successCount = 0;
    
    const branchesToProcess = [{id: 'main', name: 'Main Branch HQ'}, ...branches.filter(b=>b.id!=='main')];
    
    for (const b of branchesToProcess) {
      const bEmail = `${b.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@manzoor.com`;
      const bPass = "manzoor123";
      try {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, bEmail, bPass);
        await setDoc(doc(db, 'users', cred.user.uid), {
          email: bEmail,
          name: `${b.name} Admin`,
          role: 'branch_admin',
          branchId: b.id,
          tenantId: user?.tenantId || user?.uid
        });
        secondaryAuth.signOut().catch(()=>{});
        successCount++;
      } catch (err: any) {
        console.warn(`Failed to create ${bEmail}: ${err.message}`);
      }
    }
    
    setIsSubmitting(false);
    alert(`Generated ${successCount} branch accounts successfully! Default password is 'manzoor123'. Check the list below for the exact emails.`);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchIdForNewUser && role !== 'super_admin') {
      setErrorMsg("Please select a branch.");
      return;
    }
    
    setErrorMsg('');
    setIsSubmitting(true);
    
    let bAuth = secondaryAuth;
    try {
      if (branchIdForNewUser && branchIdForNewUser !== 'main') {
        const branch = branches.find(b => b.id === branchIdForNewUser);
        const branchConfig = (branch as any)?.firebaseConfig;
        if (branchConfig) {
          const { getSecondaryAuthForBranch } = await import('../lib/firebase');
          bAuth = getSecondaryAuthForBranch(branchConfig);
        }
      }
      
      const userCredential = await createUserWithEmailAndPassword(bAuth, email, password);
      const newUid = userCredential.user.uid;
      
      // Save profile in Firestore
      await setDoc(doc(db, 'users', newUid), {
        email,
        name,
        role,
        branchId: role === 'super_admin' ? null : branchIdForNewUser,
        tenantId: user?.tenantId || user?.uid
      });
      
      toast.success(`User ${name} created with ${getRoleLabel(role)} access!`);

      // Reset form
      setShowAdd(false);
      setName('');
      setEmail('');
      setPassword('');
      setRole('sales_stock_only');
      
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create user");
    } finally {
      setIsSubmitting(false);
      bAuth.signOut().catch(() => {});
    }
  };

  const handleStartEdit = (u: AppUser) => {
    setEditingUser(u);
    setEditRole(u.role || 'sales_stock_only');
    setEditBranchId(u.branchId || 'main');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        role: editRole,
        branchId: editRole === 'super_admin' ? null : editBranchId,
      });
      toast.success("User access permissions updated!");
      setEditingUser(null);
    } catch (err: any) {
      toast.error("Failed to update user: " + err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (targetUserId: string, targetRole: string) => {
    if (targetRole === 'super_admin' && user?.role !== 'super_admin') {
      alert("Only a Super Admin can delete another Super Admin.");
      return;
    }
    if (targetUserId === user?.uid) {
      alert("You cannot delete your own account.");
      return;
    }
    
    if (confirm("Are you sure you want to remove this user from the system?\nWarning: This only removes their profile.")) {
      try {
        await deleteDoc(doc(db, 'users', targetUserId));
        toast.success("User profile deleted.");
      } catch (e: any) {
        alert("Failed to delete user profile: " + e.message);
      }
    }
  };

  const getRoleLabel = (r: string) => {
    switch (r) {
      case 'super_admin': return 'Super Admin (Full Access)';
      case 'branch_admin': return 'Branch Admin';
      case 'staff': return 'Staff (Sales, Stock, Purchases, Vendors)';
      case 'sales_stock_only': return 'Sales/Bill, Inventory & Stock Transfer';
      case 'billing_only': return 'Billing, Inventory & Stock';
      case 'limited_access': return 'Stock, Inventory, Labour & Payroll';
      case 'online_team': return 'Online Team (Order Processing & Sales)';
      case 'online_sale_login': return 'Online Sale Login (Billing, Customers, Online Employees & Online Reports — No Dashboard)';
      case 'new_limited_access': return 'New Limited Access (Sales, Inventory, Labour & Payroll)';
      case 'cashier': return 'Casher Login (Dashboard, Inventory, Stock Transfer, Bills, Expenses, Purchase, Labour)';
      default: return r;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center">
            <UserCog className="w-6 h-6 mr-3 text-sky-600" />
            System Logins & Access Control
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Create and manage branch staff logins. Staff with Sales & Stock access can perform Billing, Inventory, and Stock Transfers.
          </p>
        </div>
        <div className="flex gap-2">
          {user?.role === 'super_admin' && (
            <button
              onClick={handleGenerateDefaults}
              disabled={isSubmitting}
              className="flex items-center px-4 py-2 bg-amber-100 text-amber-700 font-medium rounded-md hover:bg-amber-200 transition shadow-sm text-sm"
            >
              Generate Branch Logins
            </button>
          )}
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center px-4 py-2 bg-[#1e293b] text-sky-400 font-medium rounded-md hover:bg-slate-800 transition shadow-sm text-sm"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Create New Login
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAddUser} className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 space-y-4 max-w-3xl">
          <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100 mb-4 border-b pb-2">Add New User Account</h3>
          
          {errorMsg && (
            <div className="bg-red-50 text-red-600 p-3 rounded text-sm border-l-4 border-red-500">
              {errorMsg}
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Full Name</label>
              <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ali Ahmed" className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Email Address</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="user@branch.com" className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Password</label>
              <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border focus:border-sky-500 dark:focus:border-sky-400 outline-none" placeholder="Minimum 6 characters" />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">System Role & Access</label>
              <select value={role} onChange={e => setRole(e.target.value as UserRole)} className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border outline-none font-medium">
                <option value="sales_stock_only">Sales/Bill, Inventory & Stock Transfer (Recommended)</option>
                <option value="online_sale_login">Online Sale Login (Billing, Customers, Online Employees & Online Reports — No Dashboard)</option>
                <option value="billing_only">Billing, Inventory & Stock</option>
                <option value="staff">Staff (Sales, Stock, Purchases, Vendors, Customers)</option>
                <option value="online_team">Online Team (Order Processing & Sales)</option>
                <option value="new_limited_access">New Limited Access (Sales, Inventory, Labour & Payroll)</option>
                <option value="cashier">Casher Login (Dashboard, Inventory, Stock Transfer, Bills, Expenses, Purchase, Labour)</option>
                <option value="limited_access">Limited Access (Stock, Inventory, Labour, Payroll)</option>
                {user?.role === 'super_admin' && <option value="branch_admin">Branch Admin (Full Branch Control)</option>}
                {user?.role === 'super_admin' && <option value="super_admin">Super Admin (All Branches & Full Access)</option>}
              </select>
            </div>

            {role !== 'super_admin' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Assign to Branch</label>
                <select 
                  required 
                  value={branchIdForNewUser} 
                  onChange={e => setBranchIdForNewUser(e.target.value)} 
                  disabled={user?.role === 'branch_admin'}
                  className="mt-1 block w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 border outline-none disabled:bg-slate-100"
                >
                  <option value="main">Main Branch (HQ)</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          
          <div className="flex justify-end gap-3 mt-4">
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-sky-600 text-white rounded text-sm font-medium hover:bg-sky-700 disabled:opacity-50 flex items-center">
              {isSubmitting ? 'Creating...' : (
                <>
                  <KeyRound className="w-4 h-4 mr-2" />
                  Create Login Account
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveEdit} className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 max-w-lg w-full space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center">
                <ShieldCheck className="w-5 h-5 mr-2 text-sky-600" />
                Edit Access Permissions
              </h3>
              <button type="button" onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">User Account</label>
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded text-sm font-medium text-slate-800 dark:text-slate-200">
                {editingUser.name} ({editingUser.email})
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Role / Permissions</label>
              <select 
                value={editRole} 
                onChange={e => setEditRole(e.target.value as UserRole)}
                className="w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800 border outline-none font-medium"
              >
                <option value="sales_stock_only">Sales/Bill, Inventory & Stock Transfer (Recommended)</option>
                <option value="online_sale_login">Online Sale Login (Billing, Customers, Online Employees & Online Reports — No Dashboard)</option>
                <option value="billing_only">Billing, Inventory & Stock</option>
                <option value="staff">Staff (Sales, Stock, Purchases, Vendors, Customers)</option>
                <option value="online_team">Online Team (Order Processing & Sales)</option>
                <option value="new_limited_access">New Limited Access (Sales, Inventory, Labour & Payroll)</option>
                <option value="cashier">Casher Login (Dashboard, Inventory, Stock Transfer, Bills, Expenses, Purchase, Labour)</option>
                <option value="limited_access">Limited Access (Stock, Inventory, Labour & Payroll)</option>
                {user?.role === 'super_admin' && <option value="branch_admin">Branch Admin (Full Branch Control)</option>}
                {user?.role === 'super_admin' && <option value="super_admin">Super Admin (All Branches & Full Access)</option>}
              </select>
            </div>

            {editRole !== 'super_admin' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Assigned Branch</label>
                <select 
                  value={editBranchId} 
                  onChange={e => setEditBranchId(e.target.value)}
                  className="w-full rounded border-slate-300 dark:border-slate-600 py-2 px-3 bg-slate-50 dark:bg-slate-800 border outline-none"
                >
                  <option value="main">Main Branch (HQ)</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t">
              <button 
                type="button" 
                onClick={() => setEditingUser(null)} 
                className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={isUpdating} 
                className="px-4 py-2 bg-sky-600 text-white rounded text-sm font-medium hover:bg-sky-700 disabled:opacity-50 flex items-center"
              >
                {isUpdating ? 'Saving...' : (
                  <>
                    <Check className="w-4 h-4 mr-1.5" />
                    Save Permissions
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Role & Permissions</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Branch</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
            {users.map(u => (
              <tr key={u.uid} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-slate-50">
                  {u.name} {u.uid === user?.uid && <span className="text-xs text-sky-600 font-semibold">(You)</span>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">{u.email}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold ${
                    u.role === 'super_admin' ? 'bg-purple-100 text-purple-800' : 
                    u.role === 'branch_admin' ? 'bg-blue-100 text-blue-800' :
                    u.role === 'online_team' ? 'bg-purple-100 text-purple-800' :
                    u.role === 'new_limited_access' ? 'bg-indigo-100 text-indigo-800' :
                    u.role === 'billing_only' ? 'bg-amber-100 text-amber-800' :
                    u.role === 'sales_stock_only' ? 'bg-emerald-100 text-emerald-800' :
                    'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
                  }`}>
                    {getRoleLabel(u.role)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                  {u.role === 'super_admin' ? 'All Branches' : (u.branchId === 'main' ? 'Main Branch (HQ)' : branches.find(b => b.id === u.branchId)?.name || 'Main Branch (HQ)')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm flex items-center justify-end gap-3">
                  {(user?.role === 'super_admin' || user?.role === 'branch_admin') && (
                    <button 
                      onClick={() => handleStartEdit(u)} 
                      className="text-sky-600 hover:text-sky-800 font-medium inline-flex items-center text-xs bg-sky-50 px-2 py-1 rounded border border-sky-200 hover:bg-sky-100 transition"
                      title="Edit Permissions"
                    >
                      <Edit className="w-3.5 h-3.5 mr-1" />
                      Edit Access
                    </button>
                  )}
                  {u.uid !== user?.uid && user?.role === 'super_admin' && enableDeletion && (
                    <button onClick={() => handleDelete(u.uid, u.role)} className="text-red-500 hover:text-red-700" title="Delete User">
                      <Trash2 className="w-4 h-4 inline" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
