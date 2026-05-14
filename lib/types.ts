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
  fee_percent?: number; // ex.: 3.5 = 3.5% de taxa
  fee_fixed?: number; // R$ por transação
};

export type ProductPriceHistory = {
  id: number;
  tenant_id: string;
  unit_price: number;
  started_at: string;
  changed_by: string | null;
};

export type SaleReturn = {
  id: string;
  tenant_id: string;
  sale_id: string;
  quantity: number;
  amount: number;
  reason: string | null;
  returned_at: string;
  returned_by: string | null;
  inventory_movement_id: string | null;
};

export type SaleStatus = "aberta" | "parcial" | "paga" | "cancelada";

export type Sale = {
  id: string;
  tenant_id: string;
  code: number;
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
  carga_id?: string | null;
  seller_id?: string | null;
};

export type SalePayment = {
  id: string;
  tenant_id: string;
  sale_id: string;
  payment_method_id: string;
  amount: number;
  paid_at: string;
  notes: string | null;
  attachment_url?: string | null;
  receipt_id?: string | null;
};

export type CustomerPayment = {
  id: string;
  tenant_id: string;
  customer_id: string;
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
  session_id: string | null;
  carga_id?: string | null;
  kind: "suprimento" | "sangria";
  amount: number;
  notes: string | null;
  created_at: string;
};

export type ExpenseStatus = "open" | "paid";

export type Expense = {
  id: string;
  tenant_id: string;
  description: string;
  category: string | null;
  amount: number;
  due_date: string | null;
  status: ExpenseStatus;
  paid_at: string | null;
  payment_method_id: string | null;
  notes: string | null;
  carga_id?: string | null;
  doc_number?: string | null;
  is_nf?: boolean;
  payee?: string | null;
};

export type InventoryMovementKind =
  | "entrada"
  | "perda"
  | "ajuste"
  | "carga_saida"
  | "carga_retorno"
  | "carga_perda";

export type InventoryMovement = {
  id: string;
  tenant_id: string;
  kind: InventoryMovementKind;
  quantity: number;
  unit_cost: number | null;
  notes: string | null;
  created_at: string;
  carga_id?: string | null;
};

export type Vehicle = {
  id: string;
  tenant_id: string;
  plate: string;
  model: string | null;
  description: string | null;
  active: boolean;
  created_at: string;
};

export type Route = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
};

export type CargaStatus = "aberta" | "fechada" | "conferida";

export type Carga = {
  id: string;
  tenant_id: string;
  code: number;
  operator_id: string;
  vehicle_id: string | null;
  route_id: string | null;
  status: CargaStatus;
  opened_at: string;
  opened_by: string | null;
  opening_cocos: number;
  closing_cocos_remaining: number | null;
  closing_cash_declared: number | null;
  closing_notes: string | null;
  closed_at: string | null;
  closed_by: string | null;
  conferred_at: string | null;
  conferred_by: string | null;
  notes: string | null;
  lock_version?: number;
};

export type FiadoPromissoria = {
  id: string;
  tenant_id: string;
  sale_id: string;
  carga_id: string | null;
  signer_name: string;
  signer_document: string | null;
  signer_address: string | null;
  signature_data_url: string;
  signed_at: string;
  amount: number;
  created_by: string | null;
};

export type Seller = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  active: boolean;
  created_at: string;
  commission_pct?: number;
  commission_fixed?: number;
};

export type ExpenseCategory = {
  id: string;
  tenant_id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

export type CargaSummary = {
  carga_id: string;
  tenant_id: string;
  operator_id: string;
  status: CargaStatus;
  opening_cocos: number;
  closing_cocos_remaining: number | null;
  closing_cash_declared: number | null;
  cocos_vendidos: number;
  cocos_perda: number;
  total_vendido: number;
  total_recebido: number;
  total_fiado: number;
  total_dinheiro: number;
  total_pix: number;
  total_cartao: number;
  total_outros: number;
  total_suprimento: number;
  total_sangria: number;
  total_despesas: number;
  expected_cash: number;
  cash_diff: number;
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

export type BankAccount = {
  id: string;
  tenant_id: string;
  name: string;
  bank_name: string;
  account_number: string | null;
  agency: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

export type BankReconciliationStatus = "open" | "closed";

export type BankReconciliation = {
  id: string;
  tenant_id: string;
  bank_account_id: string;
  period_start: string;
  period_end: string;
  statement_ending_balance: number | null;
  status: BankReconciliationStatus;
  notes: string | null;
  created_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
};

export type BankReconciliationItemStatus = "pending" | "matched" | "ignored";

export type BankReconciliationItem = {
  id: string;
  tenant_id: string;
  reconciliation_id: string;
  bank_date: string;
  bank_description: string;
  bank_amount: number;
  expense_id: string | null;
  status: BankReconciliationItemStatus;
  created_at: string;
};

export type PayableStatus = "pendente" | "pago" | "vencido" | "cancelado";

export type Payable = {
  id: string;
  tenant_id: string;
  supplier_name: string;
  supplier_id: string | null;
  description: string;
  amount: number;
  due_date: string;
  expense_date: string | null;
  document_number: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  status: PayableStatus;
  category: string | null;
  notes: string | null;
  recurrent: boolean;
  created_at: string;
  created_by: string | null;
};

export type Supplier = {
  id: string;
  tenant_id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};
