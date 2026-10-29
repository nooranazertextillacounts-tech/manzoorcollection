/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BranchProvider, useBranch } from './context/BranchContext';
import { SettingsProvider } from './context/SettingsContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Branches } from './pages/Branches';
import { Inventory } from './pages/Inventory';
import { Settings } from './pages/Settings';
import { Sales } from './pages/Sales';
import { Purchases } from './pages/Purchases';
import { Customers } from './pages/Customers';
import { Vendors } from './pages/Vendors';
import { Employees } from './pages/Employees';
import { Attendance } from './pages/Attendance';
import { Payroll } from './pages/Payroll';
import { Ledger } from './pages/Ledger';
import { Reports } from './pages/Reports';
import { ProfitLossReport } from './pages/ProfitLossReport';
import { ChartOfAccounts } from './pages/ChartOfAccounts';
import { Expenses } from './pages/Expenses';
import { Users } from './pages/Users';
import { StockTransfer } from './pages/StockTransfer';
import { OnlineSalesEmployees } from './pages/OnlineSalesEmployees';
import { OnlineSalesReport } from './pages/OnlineSalesReport';
import { Salesmen } from './pages/Salesmen';
import { SalesmanReport } from './pages/SalesmanReport';
import { CustomerDataReport } from './pages/CustomerDataReport';
import { ActivityLogs } from './pages/ActivityLogs';
import { EmployeePurchases } from './pages/EmployeePurchases';
import { OwnerAccount } from './pages/OwnerAccount';
import { UnderDevelopment } from './components/UnderDevelopment';

import { MCLogo } from './components/MCLogo';
import { motion } from 'motion/react';

import { ThemeProvider } from './context/ThemeContext';

const IS_UNDER_MAINTENANCE = false;

function ScreenLoader() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-slate-50 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-tr from-blue-900/5 via-slate-900/5 to-transparent mix-blend-multiply pointer-events-none" />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center z-10"
      >
        <motion.div 
          animate={{ 
            boxShadow: [
              "0px 0px 0px 0px rgba(59, 130, 246, 0.2)",
              "0px 0px 0px 10px rgba(59, 130, 246, 0)",
            ]
          }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="mb-6"
        >
          <MCLogo className="w-16 h-16 shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
        </motion.div>
        <h1 className="font-bold text-2xl tracking-tight uppercase font-sans text-slate-900">
          Manzoor<span className="font-normal text-blue-500">Collection</span>
        </h1>
        <div className="mt-6 flex gap-1.5 bg-white px-3 py-2 rounded-full border border-slate-200 shadow-sm">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              initial={{ scale: 0.5, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                repeat: Infinity,
                repeatType: "reverse",
                duration: 0.4,
                delay: i * 0.15,
                ease: "easeInOut"
              }}
              className="w-2 h-2 rounded-full bg-blue-500"
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) {
  const { user, loading: authLoading } = useAuth();
  const { loading: branchLoading } = useBranch();
  
  if (authLoading) return <ScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (branchLoading) return <ScreenLoader />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // If not allowed on this specific route, send to /sales if allowed or /inventory
    if (window.location.pathname === '/sales' || window.location.pathname === '/login') {
      return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-slate-50">
          <div className="bg-white p-8 rounded-xl shadow-sm text-center max-w-md">
            <h2 className="text-xl font-bold text-red-600 mb-2">Access Denied</h2>
            <p className="text-slate-600 mb-4">Your account role ({user.role}) does not have permission to access this section. Please contact your administrator.</p>
            <a href="/" className="inline-flex items-center px-4 py-2 bg-sky-600 text-white font-medium rounded-md hover:bg-sky-700 transition">
              Go to Home / Sales
            </a>
          </div>
        </div>
      );
    }
    return <Navigate to="/sales" replace />;
  }
  return children;
}

export default function App() {
  if (IS_UNDER_MAINTENANCE) {
    return <UnderDevelopment />;
  }

  return (
    <ThemeProvider defaultTheme="light" storageKey="app-theme">
      <AuthProvider>
        <BranchProvider>
          <SettingsProvider>
            <BrowserRouter>
              <Toaster position="top-right" />
              <Routes>
                <Route path="/login" element={<Login />} />
                
                <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                  {/* Dashboard */}
                  <Route index element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'staff', 'limited_access', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier']}><Dashboard /></ProtectedRoute>} />
                  
                  {/* Core Retail / Billing / Inventory / Stock Transfer */}
                  <Route path="inventory" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'staff', 'limited_access', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier']}><Inventory /></ProtectedRoute>} />
                  <Route path="stock-transfer" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'staff', 'sales_stock_only', 'billing_only', 'new_limited_access', 'cashier']}><StockTransfer /></ProtectedRoute>} />
                  <Route path="sales" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'staff', 'billing_only', 'limited_access', 'sales_stock_only', 'new_limited_access', 'cashier', 'online_sale_login', 'online_team']}><Sales /></ProtectedRoute>} />
                  <Route path="customers" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'staff', 'billing_only', 'sales_stock_only', 'limited_access', 'new_limited_access', 'online_sale_login', 'online_team']}><Customers /></ProtectedRoute>} />
                  
                  {/* Operations & Procurement */}
                  <Route path="purchases" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access', 'cashier']}><Purchases /></ProtectedRoute>} />
                  <Route path="vendors" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access']}><Vendors /></ProtectedRoute>} />
                  
                  {/* Higher level management */}
                  <Route path="chart-of-accounts" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access']}><ChartOfAccounts /></ProtectedRoute>} />
                  <Route path="expenses" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier']}><Expenses /></ProtectedRoute>} />
                  <Route path="owner-account" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier', 'staff']}><OwnerAccount /></ProtectedRoute>} />
                  <Route path="employees" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier']}><Employees /></ProtectedRoute>} />
                  <Route path="attendance" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'cashier', 'staff']}><Attendance /></ProtectedRoute>} />
                  <Route path="employee-purchases" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'staff', 'billing_only', 'new_limited_access']}><EmployeePurchases /></ProtectedRoute>} />
                  <Route path="payroll" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access']}><Payroll /></ProtectedRoute>} />
                  <Route path="ledger" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access']}><Ledger /></ProtectedRoute>} />
                  <Route path="reports" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access']}><Reports /></ProtectedRoute>} />
                  <Route path="profit-loss" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access']}><ProfitLossReport /></ProtectedRoute>} />
                  
                  <Route path="online-sales-employees" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'online_sale_login', 'online_team']}><OnlineSalesEmployees /></ProtectedRoute>} />
                  <Route path="online-sales-report" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access', 'online_sale_login', 'online_team']}><OnlineSalesReport /></ProtectedRoute>} />
                  <Route path="salesmen" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access']}><Salesmen /></ProtectedRoute>} />
                  <Route path="salesman-report" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'limited_access', 'new_limited_access']}><SalesmanReport /></ProtectedRoute>} />
                  <Route path="customer-report" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin', 'staff', 'limited_access', 'new_limited_access']}><CustomerDataReport /></ProtectedRoute>} />
                  
                  {/* Users/Logins Management */}
                  <Route path="users" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin']}><Users /></ProtectedRoute>} />
                  <Route path="activity-logs" element={<ProtectedRoute allowedRoles={['super_admin', 'branch_admin']}><ActivityLogs /></ProtectedRoute>} />

                  {/* Super Admin Only */}
                  <Route path="branches" element={<ProtectedRoute allowedRoles={['super_admin']}><Branches /></ProtectedRoute>} />
                  <Route path="settings" element={<ProtectedRoute allowedRoles={['super_admin']}><Settings /></ProtectedRoute>} />
                </Route>
              </Routes>
            </BrowserRouter>
          </SettingsProvider>
        </BranchProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
