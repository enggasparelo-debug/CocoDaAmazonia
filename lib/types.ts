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
};

export type PaymentMethod = {
  id: string;
  name: string;
  is_credit: boolean;
  active: boolean;
  created_at: string;
};

export type SaleStatus = "aberta" | "parcial" | "paga";

export type Sale = {
  id: string;
  customer_id: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  paid_amount: number;
  status: SaleStatus;
  notes: string | null;
  created_at: string;
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
};
