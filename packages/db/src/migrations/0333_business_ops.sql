-- Generated with Drizzle, then made replay-safe for the pre-migration prototype.
-- NOT VALID constraints retain legacy anomalies; reconcile and validate them
-- on a disposable restored copy before any separately approved rollout.
CREATE TABLE IF NOT EXISTS "business_ops_document_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_ops_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text DEFAULT 'knowledge' NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "business_ops_documents_category_check" CHECK ("business_ops_documents"."category" IN ('knowledge', 'policy', 'sop', 'product_doc', 'company_doc'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_ops_offerings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"billing" text DEFAULT 'one_time' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "business_ops_offerings_kind_check" CHECK ("business_ops_offerings"."kind" IN ('product', 'service')),
	CONSTRAINT "business_ops_offerings_billing_check" CHECK ("business_ops_offerings"."billing" IN ('one_time', 'subscription')),
	CONSTRAINT "business_ops_offerings_status_check" CHECK ("business_ops_offerings"."status" IN ('active', 'draft', 'archived')),
	CONSTRAINT "business_ops_offerings_price_check" CHECK ("business_ops_offerings"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_ops_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"evidence_reference" text,
	"external_reference" text,
	CONSTRAINT "business_ops_orders_status_check" CHECK ("business_ops_orders"."status" IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
	CONSTRAINT "business_ops_orders_total_check" CHECK ("business_ops_orders"."total_cents" >= 0)
);
--> statement-breakpoint
-- Adopt prototype tables without deleting or rewriting existing records.
ALTER TABLE "business_ops_offerings" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "business_ops_orders" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "business_ops_documents" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "business_ops_orders" ADD COLUMN IF NOT EXISTS "evidence_reference" text;
--> statement-breakpoint
ALTER TABLE "business_ops_orders" ADD COLUMN IF NOT EXISTS "external_reference" text;
--> statement-breakpoint
ALTER TABLE "business_ops_documents" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "business_ops_offerings" ALTER COLUMN "status" SET DEFAULT 'draft';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_ops_document_revisions_company_id_companies_id_fk' AND conrelid = 'public.business_ops_document_revisions'::regclass) THEN
    ALTER TABLE "business_ops_document_revisions" ADD CONSTRAINT "business_ops_document_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_ops_document_revisions_document_id_business_ops_docume' AND conrelid = 'public.business_ops_document_revisions'::regclass) THEN
    ALTER TABLE "business_ops_document_revisions" ADD CONSTRAINT "business_ops_document_revisions_document_id_business_ops_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."business_ops_documents"("id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_ops_documents_company_id_companies_id_fk' AND conrelid = 'public.business_ops_documents'::regclass) THEN
    ALTER TABLE "business_ops_documents" ADD CONSTRAINT "business_ops_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_ops_offerings_company_id_companies_id_fk' AND conrelid = 'public.business_ops_offerings'::regclass) THEN
    ALTER TABLE "business_ops_offerings" ADD CONSTRAINT "business_ops_offerings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_ops_orders_company_id_companies_id_fk' AND conrelid = 'public.business_ops_orders'::regclass) THEN
    ALTER TABLE "business_ops_orders" ADD CONSTRAINT "business_ops_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_ops_document_revisions_version_idx" ON "business_ops_document_revisions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_ops_documents_company_idx" ON "business_ops_documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_ops_offerings_company_idx" ON "business_ops_offerings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_ops_orders_company_idx" ON "business_ops_orders" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_ops_orders_company_external_idx" ON "business_ops_orders" USING btree ("company_id","external_reference");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_ops_offerings_price_check' AND conrelid = 'public.business_ops_offerings'::regclass) THEN
    ALTER TABLE "business_ops_offerings" ADD CONSTRAINT "business_ops_offerings_price_check" CHECK ("price_cents" >= 0) NOT VALID;
  END IF;
END $$;

--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_ops_orders_total_check' AND conrelid = 'public.business_ops_orders'::regclass) THEN
    ALTER TABLE "business_ops_orders" ADD CONSTRAINT "business_ops_orders_total_check" CHECK ("total_cents" >= 0) NOT VALID;
  END IF;
END $$;

--> statement-breakpoint
ALTER TABLE "business_ops_orders" ADD COLUMN IF NOT EXISTS "status_history" jsonb DEFAULT '[]'::jsonb NOT NULL;
