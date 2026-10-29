import { Timestamp } from 'firebase/firestore';

export interface Sale {
  id: string;
  invoiceNo?: string;
  branchId: string;
  customerId?: string;
  customerName: string;
  total: number;
  items: Array<SaleItem>;
  returnItems?: Array<SaleItem>;
  createdAt: any;
  date?: number;
  transactionType?: 'Sale' | 'Return';
  paymentMethod?: 'Cash' | 'Online' | 'Owner Account' | 'Split';
  splitCashAmount?: number;
  splitOnlineAmount?: number;
  paymentAccount?: string;
  directVendorPaymentId?: string;
  saleType?: 'In-Store' | 'Online';
  shippingCost?: number;
  discount?: number;
  lumpSumReturnAmount?: number;
  subtotal?: number;
  courier?: string;
  courierVendorId?: string;
  trackingNumber?: string;
  shippingAddress?: string;
  customerPhone?: string;
  customerCity?: string;
  description?: string;
  notes?: string;
  received?: number;
  returnedValue?: number;
  advanceAmount?: number;
  advancePaymentMethod?: 'Cash' | 'Online' | 'Owner Account' | 'Split';
  advancePaymentAccount?: string;
  advanceDescription?: string;
  advanceDirectVendorPaymentId?: string;
  onlineEmployeeId?: string;
  onlineEmployeeName?: string;
  onlineEmployeeCode?: string;
  salesmanId?: string;
  salesmanName?: string;
  tenantId?: string;
  codCashReceived?: boolean;
}

export interface Salesman {
  id: string;
  name: string;
  phone: string;
  status: 'Active' | 'Inactive';
  notes: string;
  branchId: string;
  tenantId?: string;
  createdAt: any;
}

export interface SaleItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  cost?: number;
  sku?: string;
  salePrice?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku?: string;
  price: number;
  cost?: number;
  stock: number;
  branchId?: string;
  category?: string;
  minStockLevel?: number;
  description?: string;
  unit?: string;
  tenantId?: string;
  createdAt?: any;
}

export interface Vendor {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  balance?: number;
  branchId?: string;
  tenantId?: string;
  isCourier?: boolean;
  isGlobal?: boolean;
  createdAt?: any;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  balance?: number;
  branchId?: string;
  tenantId?: string;
  createdAt?: any;
}

export interface LedgerEntry {
  id: string;
  branchId: string;
  date: number;
  description: string;
  category: string;
  type: 'IN' | 'OUT';
  amount: number;
  reference?: string;
  customerId?: string;
  vendorId?: string;
  employeeId?: string;
  saleId?: string;
  purchaseId?: string;
  expenseId?: string;
  tenantId?: string;
  createdAt: any;
  saleType?: 'In-Store' | 'Online';
  cashReceived?: boolean;
}

export interface Purchase {
  id: string;
  branchId: string;
  vendorId?: string;
  vendorName?: string;
  total: number;
  items: Array<PurchaseItem>;
  createdAt: any;
  date?: number;
  paymentMethod?: 'Cash' | 'Online' | 'Credit';
  paymentAccount?: string;
  description?: string;
  tenantId?: string;
}

export interface PurchaseItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  salePrice: number;
  sku?: string;
}

export interface EmployeePurchase {
  id: string;
  invoiceNo: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  items: Array<SaleItem>;
  total: number;
  date: number;
  createdAt: any;
  tenantId?: string;
}

export interface EmployeeReturn {
  id: string;
  returnNo: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  items: Array<SaleItem>;
  total: number;
  date: number;
  createdAt: any;
  tenantId?: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  phone?: string;
  salary: number;
  branchId: string;
  tenantId?: string;
  createdAt: any;
}

export interface OwnerTransaction {
  id: string;
  branchId: string;
  date: number;
  type: 'OUT' | 'IN'; // OUT = Cash Given to Owner (مالک کو دیا), IN = Cash / Online Received into Owner Account (وصول ہوا)
  amount: number;
  ownerName: string;
  handledBy?: string;
  category?: 'Cash Handover' | 'Owner Drawing' | 'Owner Capital' | 'Online Received' | 'Sale Payment' | 'Other';
  paymentMode?: 'Cash by Hand' | 'JazzCash' | 'Meezan Bank' | 'UBL Bank' | 'EasyPaisa' | 'Bank Transfer' | 'Online Account' | 'Cheque' | string;
  accountHead?: string; // e.g. 'Meezan Bank', 'UBL Bank', 'JazzCash', 'EasyPaisa', 'Owner Account', 'Shop Counter Cash'
  trxId?: string; // Online transaction ID / Ref #
  senderName?: string; // Customer / client / sender name
  description: string;
  voucherNo?: string;
  saleInvoiceId?: string;
  saleInvoiceNo?: string;
  ledgerId?: string;
  tenantId?: string;
  createdAt: any;
  updatedAt?: any;
}
