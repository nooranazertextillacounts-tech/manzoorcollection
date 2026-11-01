import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { useSettings } from '../context/SettingsContext';
import { InstallPWA } from './InstallPWA';
import { 
  BuildingIcon, 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Truck, 
  Users, 
  Building2, 
  UsersRound, 
  LogOut,
  ChevronDown,
  BookText,
  BarChart3,
  Bell,
  KeyRound,
  Banknote,
  Menu,
  ShieldAlert,
  ArrowRightLeft,
  X,
  Component,
  Wallet,
  History,
  TrendingUp,
  Lock,
  Eye,
  EyeOff,
  Landmark,
  Boxes,
  CalendarCheck
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import clsx from 'clsx';
import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDocs, getDoc, runTransaction, writeBatch } from '../lib/customFirestore';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, db, safeCollectionSnapshot } from '../lib/firebase';
import toast from 'react-hot-toast';

export function Layout() {
  const { user, firebaseUser, logout } = useAuth();
  const { branches, activeBranchId, setActiveBranchId } = useBranch();
  const { enableDeletion, toggleDeletion } = useSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Profit & Loss Password Lock State
  const [showProfitLossModal, setShowProfitLossModal] = useState(false);
  const [profitLossPassword, setProfitLossPassword] = useState('');
  const [showProfitLossPassword, setShowProfitLossPassword] = useState(false);
  const [profitLossError, setProfitLossError] = useState('');
  const [hasAuthSessionIssue, setHasAuthSessionIssue] = useState(false);

  useEffect(() => {
    const handleAuthIssue = () => setHasAuthSessionIssue(true);
    window.addEventListener('ais-auth-session-required', handleAuthIssue);
    return () => {
      window.removeEventListener('ais-auth-session-required', handleAuthIssue);
    };
  }, []);

  const handleUnlockProfitLoss = (e: React.FormEvent) => {
    e.preventDefault();
    if (profitLossPassword === 'superadmin@@') {
      sessionStorage.setItem('profit_loss_unlocked', 'true');
      setShowProfitLossModal(false);
      setProfitLossPassword('');
      setProfitLossError('');
      toast.success('Profit & Loss Unlocked');
      navigate('/profit-loss');
    } else {
      setProfitLossError('Incorrect password! Please try again.');
    }
  };

  // Change Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPwd, setIsChangingPwd] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');

  useEffect(() => {
    // Keep a simple low stock logger just for system logs if needed
    if (user?.role !== 'super_admin' && !activeBranchId) {
      return; // wait for context to set it
    }

    let inventoryQuery = collection(db, 'inventory');
    if (activeBranchId) {
      inventoryQuery = query(inventoryQuery, where('branchId', '==', activeBranchId)) as any;
    }

    const unsubInventory = safeCollectionSnapshot(inventoryQuery, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as any));
      const lowStock = items.filter(i => i.stock <= (i.minStockLevel || 0));
      
      if (lowStock.length > 0 && user?.role === 'branch_admin') {
        console.log(`[SYSTEM MOCK] Active low stock items: ${lowStock.length}`);
      }
    });

    return () => {
      unsubInventory();
    };
  }, [activeBranchId, user?.role, user?.email]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || 0) return;
    setIsChangingPwd(true);
    setPwdError('');
    setPwdSuccess('');

    try {
      // Re-authenticate first
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      
      // Update password
      await updatePassword(firebaseUser, newPassword);
      setPwdSuccess("Password updated successfully!");
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setPwdError(err.message || 0);
    } finally {
      setIsChangingPwd(false);
    }
  };

  
  const fullNavigation: any[] = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier'] },
    { name: 'Inventory', href: '/inventory', icon: Package, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier'] },
    { name: 'Stock Transfer', href: '/stock-transfer', icon: ArrowRightLeft, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier'] },
    { name: 'Sales / Billing', href: '/sales', icon: ShoppingCart, roles: ['super_admin', 'branch_admin', 'staff', 'billing_only', 'limited_access', 'sales_stock_only', 'new_limited_access', 'cashier', 'online_sale_login', 'online_team'] },
    { name: 'Customers', href: '/customers', icon: Users, roles: ['super_admin', 'branch_admin', 'staff', 'billing_only', 'sales_stock_only', 'new_limited_access', 'online_sale_login', 'online_team'] },
    { name: 'Purchases', href: '/purchases', icon: Truck, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access', 'cashier'] },
    { name: 'Vendors', href: '/vendors', icon: Building2, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access'] },
    { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Stock Movement Report', href: '/reports?tab=stock_movement', icon: Boxes, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'staff', 'sales_stock_only', 'cashier'] },
    { name: 'Profit & Loss', href: '/profit-loss', icon: TrendingUp, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Salesman Report', href: '/salesman-report', icon: BarChart3, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Customer Report', href: '/customer-report', icon: Users, roles: ['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access'] },
    { name: 'Expenses', href: '/expenses', icon: Wallet, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier'] },
    { name: 'Owner Account', href: '/owner-account', icon: Landmark, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier', 'staff'] },
    { name: 'Ledger', href: '/ledger', icon: BookText, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Labour', href: '/employees', icon: UsersRound, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier'] },
    { name: 'Daily Attendance', href: '/attendance', icon: CalendarCheck, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier', 'staff'] },
    { name: 'Employee Purchases', href: '/employee-purchases', icon: ShoppingCart, roles: ['super_admin', 'branch_admin', 'limited_access', 'staff', 'billing_only', 'new_limited_access'] },
    { name: 'Salesmen', href: '/salesmen', icon: UsersRound, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Payroll', href: '/payroll', icon: Banknote, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access'] },
    { name: 'Users & Logins', href: '/users', icon: KeyRound, roles: ['super_admin', 'branch_admin'] },
    { name: 'Online Employees', href: '/online-sales-employees', icon: Users, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'online_sale_login', 'online_team'] },
    { name: 'Online Sales Report', href: '/online-sales-report', icon: BarChart3, roles: ['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'online_sale_login', 'online_team'] },
  ];


  const navigation = fullNavigation.filter(item => user && item.roles.includes(user.role));

  if (user?.role === 'super_admin' || user?.role === 'branch_admin') {
    navigation.push({ name: 'Logs Activity', href: '/activity-logs', icon: History, roles: ['super_admin', 'branch_admin'] });
  }

  if (user?.role === 'super_admin') {
    navigation.push({ name: 'Manage Branches', href: '/branches', icon: BuildingIcon, roles: ['super_admin'] });
    navigation.push({ name: 'Settings', href: '/settings', icon: ShieldAlert, roles: ['super_admin'] });
  }

  const activeBranch = branches.find(b => b.id === activeBranchId) || (branches.length > 0 ? branches[0] : null);

  return (
    <div className="flex bg-slate-100 flex-1 overflow-hidden h-screen w-full print:h-auto print:overflow-visible print:block relative">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        "bg-[#0f172a] h-full flex flex-col print:hidden z-40 shrink-0 absolute md:relative transition-transform duration-300 w-60",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="p-6 border-b border-slate-800 flex justify-between items-center group overflow-hidden">
          <Link to="/" className="block">
            <h1 className="text-white font-bold text-lg tracking-tighter leading-tight logo-animation-container">
              <span className="relative inline-block overflow-hidden">
                <span className="relative z-10 block animate-logo-text-slide">MANZOOR</span>
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full animate-logo-shine"></span>
              </span>
              <br/>
              <span className="text-sky-400 font-light tracking-[0.2em] text-xs block mt-0.5 animate-logo-subtext-fade">COLLECTION</span>
            </h1>
          </Link>
          <button 
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="mt-4 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="space-y-1">
            {navigation.map((item) => {
              if (item.isHeader) {
                return (
                  <div key={item.name} className="px-5 pt-4 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {item.name}
                  </div>
                );
              }
              const isActive = item.href.includes('?') 
                ? (location.pathname + location.search === item.href)
                : (location.pathname === item.href && !location.search);
              const isAllowed = true;
              return (
                <Link
                  key={item.name}
                  to={item.href || '#'}
                  onClick={(e) => {
                    setIsMobileMenuOpen(false);
                    if (item.href === '/profit-loss') {
                      if (sessionStorage.getItem('profit_loss_unlocked') !== 'true') {
                        e.preventDefault();
                        setProfitLossPassword('');
                        setProfitLossError('');
                        setShowProfitLossModal(true);
                      }
                    }
                  }}
                  className={clsx(
                    isActive ? 'bg-[#1e293b] text-sky-400 border-l-4 border-sky-400' : 'text-slate-400 hover:text-white',
                    'flex items-center px-5 py-3 text-sm transition-colors justify-between'
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center">
                      {item.icon && <item.icon className="mr-3 flex-shrink-0 h-5 w-5" />}
                      {item.name}
                    </div>
                    {item.href === '/profit-loss' && (
                      <span className="flex items-center text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase ml-2 gap-1 border border-amber-400/20">
                        <Lock className="w-3 h-3" />
                        Lock
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="p-4 mt-auto border-t border-slate-800">
          <div className="mb-3 md:hidden">
            <InstallPWA className="w-full justify-center !py-2 !px-4 !bg-emerald-600 hover:!bg-emerald-700 text-xs rounded-lg shadow" />
          </div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-300 w-32 truncate">{user?.name}</span>
              <span className="text-xs text-slate-500 capitalize">{user?.role.replace('_', ' ')}</span>
            </div>
            <button 
              onClick={logout}
              className="text-slate-400 hover:text-white transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-2"></div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden print:overflow-visible relative print:block print:h-auto">
        {hasAuthSessionIssue && (
          <div className="bg-amber-600 text-white px-4 py-2.5 text-xs flex items-center justify-between z-50 shrink-0 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-200" />
              <span>Authentication session authorization needed in preview iframe. Open in a new tab to continue.</span>
            </div>
            <div className="flex items-center gap-2">
              <a 
                href={window.location.href} 
                target="_blank" 
                rel="noopener noreferrer"
                className="bg-white text-amber-900 font-bold px-2.5 py-1 rounded text-xs hover:bg-amber-50 shadow-xs cursor-pointer inline-flex items-center gap-1"
              >
                Open in New Tab ↗
              </a>
              <button 
                type="button"
                onClick={() => { setHasAuthSessionIssue(false); window.location.reload(); }}
                className="bg-amber-700 hover:bg-amber-800 text-white font-medium px-2 py-1 rounded text-xs cursor-pointer"
              >
                Reload
              </button>
            </div>
          </div>
        )}
        {/* Topbar */}
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 md:px-8 flex items-center justify-between z-10 shrink-0 print:hidden relative">
          <div className="flex items-center gap-3 md:gap-6">

            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-1 -ml-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 dark:hover:text-slate-300 md:hidden shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            {user?.role === 'super_admin' ? (
              <div className="flex items-center gap-3 md:gap-6">
                <div className="hidden sm:flex items-center gap-2 bg-[#d1fae5] text-[#065f46] px-3 py-1 rounded-full text-xs font-semibold">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeBranch?.color || '' }}></div>
                  <span>{activeBranch?.name || ''}</span>
                </div>
                <div className="hidden sm:block h-4 w-[1px] bg-slate-300"></div>

                <div className="relative">
                  <button 
                    onClick={() => setShowBranchMenu(!showBranchMenu)}
                    className="bg-slate-50 border border-slate-200 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:focus:ring-sky-400 flex items-center justify-between min-w-[140px] sm:min-w-[200px]"
                  >
                    <span className="truncate font-semibold">{activeBranch ? activeBranch.name : 'Select Branch'}</span>
                    <ChevronDown className="w-3 h-3 text-slate-500 ml-2 shrink-0" />
                  </button>

                  {showBranchMenu && (
                    <div className="absolute left-0 mt-1 w-full rounded shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-20 text-xs text-slate-700">
                      <div className="py-1" role="menu">
                        {branches.map(branch => (
                          <button
                            key={branch.id}
                            onClick={() => { setActiveBranchId(branch.id); setShowBranchMenu(false); }}
                            className={clsx(
                              "w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center font-medium transition",
                              activeBranchId === branch.id && "bg-sky-50 text-sky-700 font-bold"
                            )}
                          >
                            <span className="w-2.5 h-2.5 rounded-full mr-2 shrink-0" style={{ backgroundColor: branch.color }}></span>
                            <span className="truncate">{branch.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-[#d1fae5] text-[#065f46] px-3 py-1 rounded-full text-xs font-semibold">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeBranch?.color || '#10b981' }}></div>
                <span>{activeBranch?.name || 'Loading Branch...'}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-slate-700 dark:text-slate-200">
            
            <ThemeToggle />
            <InstallPWA className="!py-1.5 !px-3 !text-xs !bg-emerald-600 hover:!bg-emerald-700 hidden sm:flex" />

            <span className="hidden sm:inline-block">{user?.role === 'super_admin' ? 'Super Admin' : user?.name}</span>
            <div className="relative">
              <div 
                className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center text-white text-xs shrink-0 cursor-pointer"
                onClick={() => setShowProfileMenu(!showProfileMenu)}
              >
                {user?.name?.substring(0,2).toUpperCase()}
              </div>

              {showProfileMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-xl ring-1 ring-slate-900/5 z-50 overflow-hidden">
                  <div className="py-1" role="menu">
                    <button
                      onClick={() => { setShowProfileMenu(false); setShowChangePassword(true); }}
                      className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center"
                    >
                      <KeyRound className="w-4 h-4 mr-2 text-slate-400" />
                      Change Password
                    </button>
                    <button
                      onClick={() => { setShowProfileMenu(false); logout(); }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
            
          </div>
        </header>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-950 flex flex-col print:overflow-visible print:bg-white print:block print:h-auto print:min-h-0 relative">
          <div className={clsx("flex-1 print:p-0 print:block print:h-auto print:min-h-0", location.pathname === '/' ? "p-0" : "p-8 space-y-6")}>
            <Outlet />
          </div>
          
          <footer className="py-4 mt-auto text-center text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 print:hidden">
            <p>&copy; 2026&ndash;2080 {activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || 0)}&trade;. All Rights Reserved.</p>
            <p className="mt-0.5"></p>
          </footer>
        </div>

      </main>

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-slate-800 mb-4">Change Password</h2>
            
            {pwdError && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded border-l-4 border-red-500">{pwdError}</div>}
            {pwdSuccess && <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 text-sm rounded border-l-4 border-emerald-500">{pwdSuccess}</div>}
            
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                <input 
                  type="password" 
                  required
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <input 
                  type="password" 
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 bg-white"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button 
                  type="button" 
                  onClick={() => setShowChangePassword(false)}
                  className="px-4 py-2 rounded text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                >
                  Close
                </button>
                <button 
                  type="submit" 
                  disabled={isChangingPwd}
                  className="px-4 py-2 rounded bg-sky-600 text-white hover:bg-sky-700 font-medium disabled:opacity-50"
                >
                  {isChangingPwd ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Profit & Loss Password Lock Modal */}
      {showProfitLossModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Profit & Loss Locked</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Enter password to view Profit & Loss</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowProfitLossModal(false);
                  setProfitLossPassword('');
                  setProfitLossError('');
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {profitLossError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs rounded-xl border border-red-200 dark:border-red-900/50 font-medium">
                {profitLossError}
              </div>
            )}

            <form onSubmit={handleUnlockProfitLoss} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Enter Password
                </label>
                <div className="relative">
                  <input
                    type={showProfitLossPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    value={profitLossPassword}
                    onChange={(e) => {
                      setProfitLossPassword(e.target.value);
                      setProfitLossError('');
                    }}
                    placeholder="Enter password..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 outline-none pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowProfitLossPassword(!showProfitLossPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showProfitLossPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowProfitLossModal(false);
                    setProfitLossPassword('');
                    setProfitLossError('');
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

          </div>
  );
}
