export type ProductSettings = {
  id: string;
  name: string;
  unit_price: number;
  updated_at: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  document: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  created_by?: string | null;
};

export type PaymentMethod = {
  id: string;
  name: string;
  is_credit: boolean;
  active: boolean;
  created_at: string;
};

export type SaleStatus = "aberta" | "parcial" | "paga" | "cancelada";

export type Sale = {
  id: string;
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
  sale_id: string;
  payment_method_id: string;
  amount: number;
  paid_at: string;
  notes: string | null;
};

export type CustomerBalance = {
  customer_id: string;
  customer_name: string;
  open_balance: number;
  open_sales: number;
  oldest_open_at: string | null;
};

export type CashSession = {
  id: string;
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
  session_id: string;
  kind: "suprimento" | "sangria";
  amount: number;
  notes: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  description: string;
  category: string | null;
  amount: number;
  paid_at: string;
  payment_method_id: string | null;
  notes: string | null;
};

export type InventoryMovement = {
  id: string;
  kind: "entrada" | "perda" | "ajuste";
  quantity: number;
  unit_cost: number | null;
  notes: string | null;
  created_at: string;
};
