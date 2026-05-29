ALTER TABLE tenants RENAME COLUMN token TO token_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_token_hash ON tenants(token_hash);
