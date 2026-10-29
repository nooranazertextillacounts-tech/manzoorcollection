import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, Timestamp } from '../lib/customFirestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import { Search, Calendar, Filter, Users, Hash, FileSpreadsheet, Printer } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import { format } from 'date-fns';

export function OnlineSalesReport() {
  const { user } = useAuth();
  const { branches, activeBranchId } = useBranch();
  
  const [sales, setSales] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [startDate, setStartDate] = useState(
    format(new Date(), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(
    format(new Date(), 'yyyy-MM-dd')
  );
  const [selectedEmployee, setSelectedEmployee] = useState('');
  
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [startDate, endDate, user, activeBranchId]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const tenantId = user?.tenantId || user?.uid;
      if (!tenantId) return;

      const branchToQuery = activeBranchId || (branches.length > 0 ? branches[0].id : '');

      // 1. Fetch Online Employees
      let empQ: any = collection(db, 'onlineSalesEmployees');
      empQ = query(empQ, where('tenantId', '==', tenantId));
      
      const empSnap = await getDocs(empQ);
      let emps = empSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      if (activeBranchId) {
        emps = emps.filter(e => e.branchId === activeBranchId || (!e.branchId && activeBranchId === 'main'));
      }
      setEmployees(emps);

      // 2. Fetch Sales within date range
      const [sy, sm, sd] = startDate.split('-');
      const start = new Date(Number(sy), Number(sm) - 1, Number(sd));
      start.setHours(0, 0, 0, 0);
      const [ey, em, ed] = endDate.split('-');
      const end = new Date(Number(ey), Number(em) - 1, Number(ed));
      end.setHours(23, 59, 59, 999);

      let salesQ = query(
        collection(db, 'sales'),
        where('tenantId', '==', tenantId),
        where('date', '>=', start.getTime()),
        where('date', '<=', end.getTime())
      );
      
      const salesSnap = await getDocs(salesQ);
      let salesData = salesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      
      // Filter for online sales only, and apply branch filter
      salesData = salesData.filter(s => 
        s.saleType === 'Online' && 
        (branchToQuery === 'all' || branchToQuery === 'main' || !branchToQuery ? true : s.branchId === branchToQuery)
      );
      
      setSales(salesData);
    } catch (error) {
      console.error("Error fetching online sales report:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const reportData = useMemo(() => {
        const grouped = new Map<string, {
      employeeId: string;
      employeeName: string;
      onlineCode: string;
      totalOrders: number;
      totalQuantity: number;
      discount: number;
      netSale: number;
      invoices: any[];
    }>();

    // Initialize with selected or all online employees
    employees.forEach(emp => {
      if (selectedEmployee && emp.id !== selectedEmployee) return;
      
      grouped.set(emp.id, {
        employeeId: emp.id,
        employeeName: emp.name,
        onlineCode: emp.onlineCode,
        totalOrders: 0,
        totalQuantity: 0,
        discount: 0,
        netSale: 0,
        invoices: []
      });
    });

    sales.forEach(sale => {
      const empId = sale.onlineEmployeeId;
      // If sale has an employee that we filtered out, skip
      if (selectedEmployee && empId !== selectedEmployee) return;

      // Group for "Unknown" if not found
      const key = empId || 'unknown';
      
      if (!grouped.has(key)) {
        grouped.set(key, {
          employeeId: key,
          employeeName: sale.onlineEmployeeName || 'Unknown Employee',
          onlineCode: sale.onlineEmployeeCode || 'N/A',
          totalOrders: 0,
          totalQuantity: 0,
          discount: 0,
          netSale: 0,
          invoices: []
        });
      }

      const group = grouped.get(key)!;
      group.totalOrders += 1;
      
      const qty = sale.items?.reduce((acc: number, item: any) => acc + (item.qty || 0), 0) || 0;
      group.totalQuantity += qty;
      
      group.discount += (Number(sale.discount) || 0);
      group.netSale += (Number(sale.total) || 0);
      
      group.invoices.push(sale);
    });

    return Array.from(grouped.values()).filter(g => g.totalOrders > 0 || (selectedEmployee && g.employeeId === selectedEmployee));
  }, [sales, employees, selectedEmployee]);

  // Calculations for totals
  const totals = reportData.reduce((acc, curr) => ({
    orders: acc.orders + curr.totalOrders,
    qty: acc.qty + curr.totalQuantity,
    discount: acc.discount + curr.discount,
    net: acc.net + curr.netSale,
  }), { orders: 0, qty: 0, discount: 0, net: 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <FileSpreadsheet className="w-6 h-6 text-emerald-500" />
          Online Sales Report
        </h1>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors print:hidden"
        >
          <Printer className="w-4 h-4" />
          Print Report
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Date From</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Date To</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Online Employee</label>
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">All Employees</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}{emp.onlineCode ? ` - ${emp.onlineCode}` : ""}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Orders</span>
          <span className="text-2xl font-bold text-slate-800 dark:text-white">{totals.orders}</span>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Qty</span>
          <span className="text-2xl font-bold text-slate-800 dark:text-white">{totals.qty}</span>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Discount</span>
          <span className="text-lg font-bold text-red-500 dark:text-red-400">PKR {totals.discount.toLocaleString()}</span>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center text-center bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20">
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Net Sale</span>
          <span className="text-xl font-bold text-emerald-700 dark:text-emerald-300">PKR {totals.net.toLocaleString()}</span>
        </div>
      </div>

      {/* Report Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="px-4 py-3 font-semibold text-center">Orders</th>
                <th className="px-4 py-3 font-semibold text-center">Quantity</th>
                <th className="px-4 py-3 font-semibold text-right">Discount</th>
                <th className="px-4 py-3 font-semibold text-right">Net Sale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading report data...</td>
                </tr>
              ) : reportData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">Please select an employee to view their sales.</td>
                </tr>
              ) : (
                reportData.map((row) => (
                  <React.Fragment key={row.employeeId}>
                    <tr 
                      className={clsx(
                        "hover:bg-slate-50 dark:hover:bg-slate-750/50 cursor-pointer transition-colors",
                        expandedEmployeeId === row.employeeId && "bg-slate-50 dark:bg-slate-750/50"
                      )}
                      onClick={() => setExpandedEmployeeId(expandedEmployeeId === row.employeeId ? null : row.employeeId)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {row.onlineCode && row.onlineCode !== 'N/A' && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{row.onlineCode} - </span>}
                          <span className="text-slate-700 dark:text-slate-300">{row.employeeName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-medium">{row.totalOrders}</td>
                      <td className="px-4 py-3 text-center font-medium">{row.totalQuantity}</td>
                      <td className="px-4 py-3 text-right text-red-500">PKR {row.discount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">PKR {row.netSale.toLocaleString()}</td>
                    </tr>
                    <AnimatePresence>
                      {expandedEmployeeId === row.employeeId && (
                        <motion.tr
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="bg-slate-50/50 dark:bg-slate-800/20"
                        >
                          <td colSpan={5} className="p-0 border-b border-slate-200 dark:border-slate-700">
                            <div className="p-4 pl-12 overflow-x-auto">
                              <table className="w-full text-xs text-left">
                                <thead className="text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                  <tr>
                                    <th className="pb-2 font-medium">Inv #</th>
                                    <th className="pb-2 font-medium">Date</th>
                                    <th className="pb-2 font-medium">Customer</th>
                                    <th className="pb-2 font-medium text-center">Items</th>
                                    <th className="pb-2 font-medium text-right">Net Total</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/50 dark:divide-slate-700/50">
                                  {row.invoices.sort((a, b) => b.date - a.date).map((inv, idx) => (
                                    <tr key={idx} className="text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/30">
                                      <td className="py-2 font-medium">{String(inv.invoiceNo || inv.id?.substring(0,6) || '').toUpperCase()}</td>
                                      <td className="py-2">{new Date(inv.date).toLocaleDateString()}</td>
                                      <td className="py-2">{inv.customerName || 'Walk-in'}</td>
                                      <td className="py-2 text-center">{inv.items?.length || 0}</td>
                                      <td className="py-2 text-right font-medium">PKR {(Number(inv.total) || 0).toLocaleString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-8 text-center text-xs font-bold text-black uppercase print:block hidden"></div>
    </div>
  );
}
