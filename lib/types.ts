export type Tenant = {
  id: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  receipt_msg: string | null;
  edit_window_hours: number;
  created_at: string;
};

export type Membership = {
  user_id: string;
  tenant_id: string;
  role: "admin" | "operador";
  created_at: string;
};

export type ProductSettings = {
  id: string;
  tenant_id: string;
  name: string;
  unit_price: number;
  min_stock: number | null;
  updated_at: string;
};

export type Customer = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  document: string | null;
  address: string | null;
  notes: string | null;
  credit_limit: number | null;
  active: boolean;
  created_at: string;
  created_by?: string | null;
};

export type PaymentMethod = {
  id: string;
  tenant_id: string;
  name: string;
  is_credit: boolean;
  active: boolean;
  created_at: string;
};

export type SaleStatus = "aberta" | "parcial" | "paga" | "cancelada";

export type Sale = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  paid_amount: number;
  status: SaleStatus;
  notes: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  created_by?: string | null;
};

export type SalePayment = {
  id: string;
  tenant_id: string;
  sale_id: string;
  payment_method_id: string;
  amount: number;
  paid_at: string;
  notes: string | null;
};

export type CustomerBalance = {
  customer_id: string;
  customer_name: string;
  tenant_id: string;
  credit_limit: number | null;
  open_balance: number;
  open_sales: number;
  oldest_open_at: string | null;
};

export type CashSession = {
  id: string;
  tenant_id: string;
  opened_at: string;
  opened_by: string | null;
  opening_amt: number;
  closed_at: string | null;
  closed_by: string | null;
  closing_amt: number | null;
  notes: string | null;
};

export type CashMovement = {
  id: string;
  tenant_id: string;
  session_id: string;
  kind: "suprimento" | "sangria";
  amount: number;
  notes: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  tenant_id: string;
  description: string;
  category: string | null;
  amount: number;
  paid_at: string;
  payment_method_id: string | null;
  notes: string | null;
};

export type InventoryMovement = {
  id: string;
  tenant_id: string;
  kind: "entrada" | "perda" | "ajuste";
  quantity: number;
  unit_cost: number | null;
  notes: string | null;
  created_at: string;
};

export type AuditLog = {
  id: number;
  tenant_id: string | null;
  user_id: string | null;
  table_name: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  row_id: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  at: string;
};
