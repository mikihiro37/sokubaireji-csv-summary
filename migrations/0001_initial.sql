-- テナント管理
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);

-- イベントごとの取込ログ
CREATE TABLE IF NOT EXISTS imports (
  import_id          TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  event_name         TEXT NOT NULL,
  event_date         TEXT NOT NULL,
  seller_name        TEXT NOT NULL,
  source_file_name   TEXT,
  imported_at        TEXT NOT NULL,
  transaction_count  INTEGER,
  product_count      INTEGER,
  total_quantity     INTEGER,
  csv_total          INTEGER,
  calculated_total   INTEGER,
  difference         INTEGER,
  status             TEXT,
  csv_hash           TEXT,
  warning_message    TEXT,
  deleted_at         TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- 取引×商品の明細
CREATE TABLE IF NOT EXISTS sales_details (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id        TEXT NOT NULL,
  tenant_id        TEXT NOT NULL,
  event_name       TEXT,
  event_date       TEXT,
  seller_name      TEXT,
  receipt_no       TEXT,
  sold_at          TEXT,
  product_key      TEXT,
  product_name     TEXT,
  quantity         INTEGER,
  unit_price       INTEGER,
  amount           INTEGER,
  source_file_name TEXT,
  FOREIGN KEY (import_id) REFERENCES imports(import_id)
);

-- イベント×商品の集計
CREATE TABLE IF NOT EXISTS product_summary (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id          TEXT NOT NULL,
  tenant_id          TEXT NOT NULL,
  event_name         TEXT,
  event_date         TEXT,
  seller_name        TEXT,
  product_key        TEXT,
  product_name       TEXT,
  total_quantity     INTEGER,
  unit_price         INTEGER,
  total_amount       INTEGER,
  remaining_quantity INTEGER,
  status             TEXT,
  FOREIGN KEY (import_id) REFERENCES imports(import_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_imports_tenant        ON imports(tenant_id, deleted_at, imported_at);
CREATE INDEX IF NOT EXISTS idx_imports_csv_hash      ON imports(tenant_id, csv_hash);
CREATE INDEX IF NOT EXISTS idx_sales_import          ON sales_details(import_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_summary_import ON product_summary(import_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_summary_tenant ON product_summary(tenant_id, product_name);
