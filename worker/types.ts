export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_TOKEN: string;
}

export interface Tenant {
  id: string;
  token_hash: string;
  name: string;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface Import {
  import_id: string;
  tenant_id: string;
  event_name: string;
  event_date: string;
  seller_name: string;
  source_file_name: string | null;
  imported_at: string;
  transaction_count: number;
  product_count: number;
  total_quantity: number;
  csv_total: number;
  calculated_total: number;
  difference: number;
  status: string;
  csv_hash: string | null;
  warning_message: string | null;
  deleted_at: string | null;
}

export interface SalesDetail {
  import_id: string;
  tenant_id: string;
  event_name: string | null;
  event_date: string | null;
  seller_name: string | null;
  receipt_no: string | null;
  sold_at: string | null;
  product_key: string | null;
  product_name: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  source_file_name: string | null;
}

export interface ProductSummary {
  import_id: string;
  tenant_id: string;
  event_name: string | null;
  event_date: string | null;
  seller_name: string | null;
  product_key: string | null;
  product_name: string | null;
  total_quantity: number;
  unit_price: number;
  total_amount: number;
  remaining_quantity: number | null;
  status: string | null;
}
