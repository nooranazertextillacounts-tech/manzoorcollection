import React, { useState, useEffect } from 'react';
import { useBranch } from '../context/BranchContext';
import { collection, query, where, getDocs, Timestamp } from '../lib/customFirestore';
import { Search, Printer, Calendar as CalendarIcon, Users } from 'lucide-react';
import { db } from '../lib/firebase';
import { format, startOfMonth, endOfMonth, isValid } from 'date-fns';

const safeFormat = (date: any, formatStr: string) => {
  if (!date) return '';
  const d = new Date(date);
  if (!isValid(d)) return '';
  try {
    return format(d, formatStr);
  } catch (e) {
    return '';
  }
};

interface SaleCustomerData {
  id: string;
  invoiceNo?: string;
  date: number;
  customerName?: string;
  customerPhone?: string;
  customerCity?: string;
  branchId: string;
}

export function CustomerDataReport() {
  const { activeBranchId, branches } = useBranch();
  const [salesData, setSalesData] = useState<SaleCustomerData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState({
    start: format(new Date(new Date().getFullYear(), 7, 1), 'yyyy-MM-dd'), // 7 is August (0-indexed)
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });

  const fetchCustomerData = async () => {
    setIsLoading(true);
    try {
      const salesRef = collection(db, 'sales');
      let q = query(salesRef);

      const branchToUse = activeBranchId || (branches.length > 0 ? branches[0].id : '');
      if (branchToUse) {
        q = query(q, where('branchId', '==', branchToUse));
      }

      if (dateRange.start && dateRange.end) {
        const start = new Date(dateRange.start);
        start.setHours(0, 0, 0, 0);
        const end = new Date(dateRange.end);
        end.setHours(23, 59, 59, 999);
        
        q = query(
          q,
          where('date', '>=', start.getTime()),
          where('date', '<=', end.getTime())
        );
      }

      const snapshot = await getDocs(q);
      const data: SaleCustomerData[] = [];

      snapshot.forEach(doc => {
        const d = doc.data();
        
        // Only include if they have some kind of customer detail entered
        if (d.customerName || d.customerPhone || d.customerCity) {
          data.push({
            id: doc.id,
            invoiceNo: d.invoiceNo || '',
            date: d.date || (d.createdAt?.seconds ? d.createdAt.seconds * 1000 : Date.now()),
            customerName: d.customerName || '',
            customerPhone: d.customerPhone || '',
            customerCity: d.customerCity || '',
            branchId: d.branchId
          });
        }
      });

      // Sort by date descending
      data.sort((a, b) => b.date - a.date);
      setSalesData(data);
    } catch (error) {
      console.error('Error fetching customer data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomerData();
  }, [activeBranchId, dateRange]);

  const handlePrint = () => {
    const printContent = document.getElementById('customer-data-print');
    if (printContent) {
      const originalTitle = document.title;
      document.title = 'Customer Data Report';
      window.print();
      document.title = originalTitle;
    }
  };

  const filteredData = salesData.filter(sale => {
    const searchLower = searchQuery.toLowerCase();
    return (
      (sale.customerName || '').toLowerCase().includes(searchLower) ||
      (sale.customerPhone || '').toLowerCase().includes(searchLower) ||
      (sale.customerCity || '').toLowerCase().includes(searchLower) ||
      (sale.invoiceNo || sale.id.substring(0, 6)).toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
            <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 uppercase tracking-widest">
            Customer Data Report
          </h1>
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center space-x-2 px-4 py-2 bg-slate-800 dark:bg-slate-700 text-white rounded-md hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
        >
          <Printer className="w-4 h-4" />
          <span>Print Report</span>
        </button>
      </div>

      <div className="card p-4 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="w-full rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Name, Phone, City, Bill No..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div className="card overflow-hidden print:hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Bill No</th>
                  <th className="px-6 py-3">Customer Name</th>
                  <th className="px-6 py-3">Phone Number</th>
                  <th className="px-6 py-3">City</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      No customer data found for the selected period.
                    </td>
                  </tr>
                ) : (
                  filteredData.map(sale => (
                    <tr key={sale.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                        {safeFormat(sale.date, 'dd MMM yyyy, hh:mm a')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-slate-50">
                        {sale.invoiceNo || sale.id.substring(0, 6).toUpperCase()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900 dark:text-slate-50">
                        {sale.customerName || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300 font-mono">
                        {sale.customerPhone || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
                        {sale.customerCity || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Print View */}
      <div id="customer-data-print" className="hidden print:block print:bg-white print:w-full print:static print:h-auto">
        <div className="text-center border-b-[2px] border-black pb-4 mb-6">
          <h1 className="text-3xl font-black uppercase tracking-widest text-black">
            {activeBranchId === 'main' ? 'Main Branch' : (branches.find(b => b.id === activeBranchId)?.name || 'All Branches')}
          </h1>
          <h2 className="text-xl font-bold mt-2 uppercase tracking-widest">Customer Data Report</h2>
          <p className="text-sm font-medium mt-1">
            Period: {safeFormat(dateRange.start, 'dd MMM yyyy')} to {safeFormat(dateRange.end, 'dd MMM yyyy')}
          </p>
        </div>

        <table className="w-full text-sm border-collapse border border-black mb-8">
          <thead>
            <tr className="border-b-[2px] border-black uppercase tracking-widest text-left font-black text-[11px]">
              <th className="p-2 border-r border-black">Date</th>
              <th className="p-2 border-r border-black">Bill No</th>
              <th className="p-2 border-r border-black">Customer Name</th>
              <th className="p-2 border-r border-black">Phone Number</th>
              <th className="p-2">City</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black">
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-black">
                  No data found
                </td>
              </tr>
            ) : (
              filteredData.map(sale => (
                <tr key={sale.id}>
                  <td className="p-2 border-r border-black font-medium">{safeFormat(sale.date, 'dd/MM/yyyy')}</td>
                  <td className="p-2 border-r border-black font-black">{sale.invoiceNo || sale.id.substring(0, 6).toUpperCase()}</td>
                  <td className="p-2 border-r border-black font-bold">{sale.customerName || '-'}</td>
                  <td className="p-2 border-r border-black font-mono font-medium">{sale.customerPhone || '-'}</td>
                  <td className="p-2 font-medium">{sale.customerCity || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="text-xs text-center font-bold">
          Total Records: {filteredData.length}
        </div>
      </div>
    </div>
  );
}
