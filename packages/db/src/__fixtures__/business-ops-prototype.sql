-- Exact prototype table definitions from b20ccd0, for upgrade preservation tests.
CREATE TABLE IF NOT EXISTS business_ops_offerings (
          id UUID PRIMARY KEY,
          company_id UUID NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('product', 'service')),
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          price_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'usd',
          billing TEXT NOT NULL DEFAULT 'one_time' CHECK (billing IN ('one_time', 'subscription')),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
CREATE INDEX IF NOT EXISTS business_ops_offerings_company_idx
          ON business_ops_offerings (company_id);
CREATE TABLE IF NOT EXISTS business_ops_orders (
          id UUID PRIMARY KEY,
          company_id UUID NOT NULL,
          customer_name TEXT NOT NULL,
          customer_email TEXT,
          items JSONB NOT NULL DEFAULT '[]',
          total_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'usd',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
CREATE INDEX IF NOT EXISTS business_ops_orders_company_idx
          ON business_ops_orders (company_id);
CREATE TABLE IF NOT EXISTS business_ops_documents (
          id UUID PRIMARY KEY,
          company_id UUID NOT NULL,
          category TEXT NOT NULL DEFAULT 'knowledge'
            CHECK (category IN ('knowledge', 'policy', 'sop', 'product_doc', 'company_doc')),
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          tags JSONB NOT NULL DEFAULT '[]',
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
CREATE INDEX IF NOT EXISTS business_ops_documents_company_idx
          ON business_ops_documents (company_id);
