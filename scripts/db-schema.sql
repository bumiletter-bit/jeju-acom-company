-- 제주아꼼이네 DB 표 틀 (scripts/db-schema-dump.js 가 만듦 · 손으로 고치지 말 것)
-- 쓰임: 빈 DB 에 node scripts/db-restore.js <백업> --init --yes (이 파일을 먼저 실행한 뒤 자료를 넣음 · 한 트랜잭션)
-- 다시 찍기: node scripts/db-schema-dump.js (DATABASE_URL 의 틀) · 맞는지만: --check
-- 표 107 · 시퀀스 87 · 인덱스(제약 밖) 53 · 외래 키 36

-- ── 시퀀스
CREATE SEQUENCE "agent_feedback_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "agent_lessons_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "agent_runs_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "agent_tools_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "agents_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "audit_logs_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "bot_products_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "box_inventory_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "box_movements_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "card_transactions_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "cc_instructions_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "cj_carryover_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "cj_daily_payments_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "company_rules_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "coupang_item_backups_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "cs_categories_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "cs_templates_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "dev_backlog_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "documents_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "expense_reports_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "experience_bookings_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "inquiry_scenarios_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "invoice_auto_runs_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "items_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "kakao_notify_log_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "keyword_rankings_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "leave_adjustments_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lms_guide_log_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_assets_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_ro1183b_assets_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_ro1183b_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_ro11852_assets_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_ro11852_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_ro1185_assets_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_ro1185_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_v943_assets_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_v943_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_vhead_assets_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "lucky_events_vtest_assets_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "mail_index_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "mall_game_invites_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "mall_game_scores_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "mall_members_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "message_logs_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "naver_product_backups_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "naver_product_snapshot_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "naver_settle_snapshot_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "notifications_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "order_memo_entries_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "order_memo_preorders_id_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;
CREATE SEQUENCE "order_memo_rows_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "payslip_queue_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "payslips_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "pending_orders_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "planner_ddays_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "planner_habit_logs_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "planner_habits_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "planner_memos_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "planner_todos_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "points_ledger_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "prepayments_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "pricing_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "product_mappings_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "product_season_knowledge_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "push_subscriptions_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "report_files_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "response_preview_log_id_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;
CREATE SEQUENCE "reward_grants_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "roulette_spins_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "schedules_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "season_waitlist_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "settlement_completions_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "settlement_status_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "settlements_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "shipping_holidays_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "sms_images_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "sms_messages_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "sms_preorders_id_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;
CREATE SEQUENCE "sms_selfcheck_hits_id_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1;
CREATE SEQUENCE "sms_threads_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "talk_outbox_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "tax_invoice_payments_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "tax_invoices_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "unmatched_messages_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "users_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;
CREATE SEQUENCE "work_logs_id_seq" AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1;

-- ── 표
CREATE TABLE "agent_feedback" (
    "id" integer DEFAULT nextval('agent_feedback_id_seq'::regclass) NOT NULL,
    "agent_id" integer,
    "run_id" integer,
    "feedback_type" character varying(10) NOT NULL,
    "original_output" text,
    "corrected_output" text,
    "comment" text,
    "is_deleted" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT now(),
    "created_by" text,
    CONSTRAINT "agent_feedback_pkey" PRIMARY KEY (id)
);
CREATE TABLE "agent_lessons" (
    "id" integer DEFAULT nextval('agent_lessons_id_seq'::regclass) NOT NULL,
    "agent_id" integer,
    "lesson" text NOT NULL,
    "source_feedback_ids" jsonb DEFAULT '[]'::jsonb,
    "category" character varying(20) DEFAULT ''::character varying,
    "status" character varying(20) DEFAULT 'active'::character varying,
    "is_deleted" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT now(),
    "approved_at" timestamp without time zone,
    CONSTRAINT "agent_lessons_pkey" PRIMARY KEY (id)
);
CREATE TABLE "agent_office_config" (
    "key" character varying(50) NOT NULL,
    "value" jsonb NOT NULL,
    "updated_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "agent_office_config_pkey" PRIMARY KEY (key)
);
CREATE TABLE "agent_runs" (
    "id" integer DEFAULT nextval('agent_runs_id_seq'::regclass) NOT NULL,
    "agent_id" integer,
    "status" character varying(20) DEFAULT 'running'::character varying,
    "steps" jsonb DEFAULT '[]'::jsonb,
    "result" jsonb,
    "started_at" timestamp without time zone DEFAULT now(),
    "finished_at" timestamp without time zone,
    "is_deleted" boolean DEFAULT false,
    "is_test" boolean DEFAULT false,
    "archived_by" text,
    CONSTRAINT "agent_runs_pkey" PRIMARY KEY (id)
);
CREATE TABLE "agent_tools" (
    "id" integer DEFAULT nextval('agent_tools_id_seq'::regclass) NOT NULL,
    "agent_id" integer,
    "tool_name" character varying(100) NOT NULL,
    "tool_type" character varying(20) NOT NULL,
    "config" jsonb DEFAULT '{}'::jsonb,
    "enabled" boolean DEFAULT true,
    "is_deleted" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "agent_tools_pkey" PRIMARY KEY (id)
);
CREATE TABLE "agents" (
    "id" integer DEFAULT nextval('agents_id_seq'::regclass) NOT NULL,
    "code" character varying(30) NOT NULL,
    "name" character varying(20) NOT NULL,
    "role" character varying(10) NOT NULL,
    "team" character varying(30) NOT NULL,
    "duty" character varying(50) DEFAULT ''::character varying,
    "description" text DEFAULT ''::text,
    "workplace" character varying(20) DEFAULT '공통'::character varying,
    "knowledge_files" jsonb DEFAULT '[]'::jsonb,
    "status" character varying(20) DEFAULT 'idle'::character varying,
    "last_run_at" timestamp without time zone,
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "is_deleted" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "agents_code_key" UNIQUE (code),
    CONSTRAINT "agents_pkey" PRIMARY KEY (id)
);
CREATE TABLE "audit_logs" (
    "id" integer DEFAULT nextval('audit_logs_id_seq'::regclass) NOT NULL,
    "action" character varying(50) NOT NULL,
    "target_type" character varying(50) NOT NULL,
    "target_id" integer,
    "changes" jsonb,
    "source" character varying(20) DEFAULT 'mcp'::character varying,
    "actor_id" integer,
    "actor_name" character varying(100),
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id)
);
CREATE TABLE "bot_products" (
    "id" integer DEFAULT nextval('bot_products_id_seq'::regclass) NOT NULL,
    "name" text NOT NULL,
    "status" text DEFAULT '판매중'::text NOT NULL,
    "price" text DEFAULT ''::text,
    "memo" text DEFAULT ''::text,
    "updated_at" timestamp with time zone DEFAULT now(),
    "deleted_at" timestamp with time zone,
    "updated_by" character varying(50),
    "notify_message" text,
    "shipping_guide" text,
    "naver_product_no" bigint,
    "reserve_ship_start" date,
    CONSTRAINT "bot_products_name_key" UNIQUE (name),
    CONSTRAINT "bot_products_pkey" PRIMARY KEY (id)
);
CREATE TABLE "box_inventory" (
    "id" integer DEFAULT nextval('box_inventory_id_seq'::regclass) NOT NULL,
    "product_name" character varying(50) NOT NULL,
    "company_stock" integer DEFAULT 0,
    "daesong_stock" integer DEFAULT 0,
    "updated_by" integer,
    "updated_at" timestamp without time zone DEFAULT now(),
    "base_date" date,
    "hyodon_stock" integer DEFAULT 0,
    CONSTRAINT "box_inventory_pkey" PRIMARY KEY (id),
    CONSTRAINT "box_inventory_product_name_key" UNIQUE (product_name)
);
CREATE TABLE "box_movements" (
    "id" integer DEFAULT nextval('box_movements_id_seq'::regclass) NOT NULL,
    "product_name" character varying(50) NOT NULL,
    "movement_type" character varying(20) NOT NULL,
    "qty" integer NOT NULL,
    "date" date NOT NULL,
    "note" text DEFAULT ''::text,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "box_movements_pkey" PRIMARY KEY (id)
);
CREATE TABLE "card_transactions" (
    "id" integer DEFAULT nextval('card_transactions_id_seq'::regclass) NOT NULL,
    "transaction_date" date NOT NULL,
    "merchant_name" character varying(200) NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "category" character varying(50) DEFAULT '기타'::character varying,
    "memo" text DEFAULT ''::text,
    "expense_report_id" integer,
    "card_name" character varying(100) DEFAULT '제주은행 법인카드'::character varying,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "is_processed" boolean DEFAULT false,
    CONSTRAINT "card_transactions_pkey" PRIMARY KEY (id)
);
CREATE TABLE "cc_instructions" (
    "id" integer DEFAULT nextval('cc_instructions_id_seq'::regclass) NOT NULL,
    "content" text NOT NULL,
    "status" character varying(10) DEFAULT '대기'::character varying,
    "source" character varying(50) DEFAULT '똑똑이'::character varying,
    "response" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "responded_at" timestamp without time zone,
    "notified_status" character varying(10),
    "notified_resp_hash" character varying(40),
    CONSTRAINT "cc_instructions_pkey" PRIMARY KEY (id)
);
CREATE TABLE "cj_carryover" (
    "id" integer DEFAULT nextval('cj_carryover_id_seq'::regclass) NOT NULL,
    "month" character varying(7) NOT NULL,
    "amount" integer DEFAULT 0,
    "note" character varying(200),
    "updated_by" integer,
    "updated_at" timestamp without time zone DEFAULT now(),
    "start_date" date,
    "end_date" date,
    CONSTRAINT "cj_carryover_month_key" UNIQUE (month),
    CONSTRAINT "cj_carryover_pkey" PRIMARY KEY (id)
);
CREATE TABLE "cj_daily_payments" (
    "id" integer DEFAULT nextval('cj_daily_payments_id_seq'::regclass) NOT NULL,
    "date" date NOT NULL,
    "amount" integer DEFAULT 0,
    "is_paid" boolean DEFAULT false,
    "paid_at" timestamp without time zone,
    CONSTRAINT "cj_daily_payments_date_key" UNIQUE (date),
    CONSTRAINT "cj_daily_payments_pkey" PRIMARY KEY (id)
);
CREATE TABLE "company_rules" (
    "id" integer DEFAULT nextval('company_rules_id_seq'::regclass) NOT NULL,
    "title" character varying(120) NOT NULL,
    "version" character varying(60) DEFAULT ''::character varying NOT NULL,
    "effective_date" date,
    "file_name" character varying(200) NOT NULL,
    "mime" character varying(60) DEFAULT 'application/pdf'::character varying NOT NULL,
    "data" bytea NOT NULL,
    "size_bytes" integer NOT NULL,
    "uploaded_by" integer,
    "uploaded_by_name" character varying(60),
    "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" integer,
    CONSTRAINT "company_rules_pkey" PRIMARY KEY (id)
);
CREATE TABLE "coupang_item_backups" (
    "id" integer DEFAULT nextval('coupang_item_backups_id_seq'::regclass) NOT NULL,
    "seller_product_id" character varying(30),
    "vendor_item_id" character varying(30),
    "order_id" integer,
    "before_json" jsonb NOT NULL,
    "patch_json" jsonb,
    "after_json" jsonb,
    "applied_at" timestamp without time zone,
    "reverted_at" timestamp without time zone,
    "result_json" jsonb,
    "created_by" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "kind" character varying(10) DEFAULT 'item'::character varying NOT NULL,
    CONSTRAINT "coupang_item_backups_pkey" PRIMARY KEY (id)
);
CREATE TABLE "cs_categories" (
    "id" integer DEFAULT nextval('cs_categories_id_seq'::regclass) NOT NULL,
    "name" character varying(50) NOT NULL,
    "color" character varying(20) DEFAULT '#9E9E9E'::character varying,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "cs_categories_name_key" UNIQUE (name),
    CONSTRAINT "cs_categories_pkey" PRIMARY KEY (id)
);
CREATE TABLE "cs_templates" (
    "id" integer DEFAULT nextval('cs_templates_id_seq'::regclass) NOT NULL,
    "category" character varying(50) NOT NULL,
    "title" character varying(100) NOT NULL,
    "content" text NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "cs_templates_pkey" PRIMARY KEY (id)
);
CREATE TABLE "delivery_shipments" (
    "tracking" text NOT NULL,
    "ship_date" date NOT NULL,
    "partner" text,
    "recipient" text,
    "phone" text,
    "addr" text,
    "option_text" text,
    "qty" integer,
    "memo" text,
    "source" text DEFAULT 'index'::text,
    "uploaded_at" timestamp with time zone DEFAULT now(),
    "buyer_phone" text,
    "phone_digits" text GENERATED ALWAYS AS (regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) STORED,
    "buyer_digits" text GENERATED ALWAYS AS (regexp_replace(COALESCE(buyer_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) STORED,
    CONSTRAINT "delivery_shipments_pkey" PRIMARY KEY (tracking)
);
CREATE TABLE "delivery_status" (
    "tracking" text NOT NULL,
    "bucket" text,
    "code" text,
    "label" text,
    "msg" text,
    "event_time" text,
    "branch" text,
    "driver_name" text,
    "driver_phone" text,
    "events" jsonb,
    "delivered" boolean DEFAULT false,
    "checked_at" timestamp with time zone DEFAULT now(),
    "first_trouble_at" timestamp with time zone,
    "handled_at" timestamp with time zone,
    "handled_by" text,
    CONSTRAINT "delivery_status_pkey" PRIMARY KEY (tracking)
);
CREATE TABLE "dev_backlog" (
    "id" integer DEFAULT nextval('dev_backlog_id_seq'::regclass) NOT NULL,
    "title" character varying(200) NOT NULL,
    "note" text,
    "status" character varying(10) DEFAULT '대기'::character varying,
    "created_at" timestamp without time zone DEFAULT now(),
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "dev_backlog_pkey" PRIMARY KEY (id)
);
CREATE TABLE "documents" (
    "id" integer DEFAULT nextval('documents_id_seq'::regclass) NOT NULL,
    "type" character varying(20) NOT NULL,
    "sub_type" character varying(50) NOT NULL,
    "applicant_id" integer,
    "approver_id" integer,
    "start_date" date NOT NULL,
    "end_date" date,
    "reason" text DEFAULT ''::text,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "deducted_leave" numeric DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT now(),
    "processed_at" timestamp without time zone,
    "start_time" character varying(10),
    "end_time" character varying(10),
    "modification_type" character varying(20),
    "modification_reason" text,
    "new_start_date" date,
    "new_end_date" date,
    "new_start_time" character varying(10),
    "new_end_time" character varying(10),
    CONSTRAINT "documents_pkey" PRIMARY KEY (id)
);
CREATE TABLE "expense_reports" (
    "id" integer DEFAULT nextval('expense_reports_id_seq'::regclass) NOT NULL,
    "title" character varying(200) NOT NULL,
    "applicant_id" integer,
    "total_amount" integer DEFAULT 0,
    "purpose" text,
    "items" jsonb DEFAULT '[]'::jsonb,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "manager_id" integer,
    "manager_status" character varying(20) DEFAULT 'pending'::character varying,
    "manager_approved_at" timestamp without time zone,
    "ceo_id" integer,
    "ceo_status" character varying(20) DEFAULT 'pending'::character varying,
    "ceo_approved_at" timestamp without time zone,
    "rejected_by" integer,
    "reject_reason" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "use_date" date,
    CONSTRAINT "expense_reports_pkey" PRIMARY KEY (id)
);
CREATE TABLE "experience_bookings" (
    "id" integer DEFAULT nextval('experience_bookings_id_seq'::regclass) NOT NULL,
    "source" character varying(10) NOT NULL,
    "ext_key" character varying(120) NOT NULL,
    "order_no" character varying(60),
    "name" character varying(80),
    "phone" character varying(20),
    "visit_date" date,
    "visit_time" character varying(5),
    "exp_count" integer DEFAULT 0 NOT NULL,
    "entry_count" integer DEFAULT 0 NOT NULL,
    "infant_count" integer DEFAULT 0 NOT NULL,
    "amount" integer,
    "status" character varying(12) DEFAULT 'confirmed'::character varying NOT NULL,
    "date_ok" boolean DEFAULT false NOT NULL,
    "date_why" character varying(40),
    "date_fixed" boolean DEFAULT false NOT NULL,
    "option_text" text,
    "raw" text,
    "items" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "memo" text,
    "sms_recv_at" timestamp with time zone,
    "sms_eve_at" timestamp with time zone,
    "sms_error" text,
    "visited_at" timestamp with time zone,
    "visited_by" character varying(60),
    "ordered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "sms_recv_try_at" timestamp with time zone,
    "sms_recv_tries" integer DEFAULT 0 NOT NULL,
    "sms_eve_try_at" timestamp with time zone,
    "sms_eve_tries" integer DEFAULT 0 NOT NULL,
    "sms_skip" character varying(20),
    "confirm_state" character varying(12),
    "confirm_tries" integer DEFAULT 0 NOT NULL,
    "confirm_at" timestamp with time zone,
    "confirm_error" text,
    "dispatch_tries" integer DEFAULT 0 NOT NULL,
    "dispatch_at" timestamp with time zone,
    "dispatch_error" text,
    "contact_at" timestamp with time zone,
    "contact_by" character varying(60),
    "sms_recv_via" character varying(10),
    "sms_eve_via" character varying(10),
    CONSTRAINT "experience_bookings_ext_key_key" UNIQUE (ext_key),
    CONSTRAINT "experience_bookings_pkey" PRIMARY KEY (id)
);
CREATE TABLE "experience_daily_notes" (
    "day" date NOT NULL,
    "note" text NOT NULL,
    "updated_by" character varying(60),
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "experience_daily_notes_pkey" PRIMARY KEY (day)
);
CREATE TABLE "experience_daily_sales" (
    "day" date NOT NULL,
    "amount" integer DEFAULT 0 NOT NULL,
    "memo" character varying(200),
    "updated_by" character varying(60),
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "experience_daily_sales_pkey" PRIMARY KEY (day)
);
CREATE TABLE "experience_mail_seen" (
    "message_id" character varying(200) NOT NULL,
    "uid" bigint,
    "booking_id" integer,
    "state" character varying(16),
    "seen_at" timestamp with time zone DEFAULT now() NOT NULL,
    "uidv" bigint,
    CONSTRAINT "experience_mail_seen_pkey" PRIMARY KEY (message_id)
);
CREATE TABLE "final_order_marks" (
    "ship_date" date NOT NULL,
    "indiv" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "hold" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_by" text,
    CONSTRAINT "final_order_marks_pkey" PRIMARY KEY (ship_date)
);
CREATE TABLE "inbox_thread_drafts" (
    "ch" character varying(10) NOT NULL,
    "tkey" character varying(40) NOT NULL,
    "body" text NOT NULL,
    "src_id" bigint,
    "made_by" character varying(50),
    "made_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "inbox_thread_drafts_pkey" PRIMARY KEY (ch, tkey)
);
CREATE TABLE "inbox_thread_reads" (
    "ch" character varying(10) NOT NULL,
    "tkey" character varying(40) NOT NULL,
    "read_at" timestamp without time zone DEFAULT now(),
    "read_by" character varying(50),
    "forced_unread" boolean DEFAULT false,
    CONSTRAINT "inbox_thread_reads_pkey" PRIMARY KEY (ch, tkey)
);
CREATE TABLE "inquiry_scenarios" (
    "id" integer DEFAULT nextval('inquiry_scenarios_id_seq'::regclass) NOT NULL,
    "scenario_no" integer NOT NULL,
    "name" character varying(100) NOT NULL,
    "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "response" text NOT NULL,
    "action" character varying(20) DEFAULT '자동응답'::character varying NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "channel" character varying(20) DEFAULT '톡톡'::character varying NOT NULL,
    "updated_by" character varying(50),
    "updated_at" timestamp without time zone DEFAULT now(),
    "deleted_at" timestamp without time zone,
    CONSTRAINT "inquiry_scenarios_pkey" PRIMARY KEY (id)
);
CREATE TABLE "invoice_auto_items" (
    "idem_key" text NOT NULL,
    "run_id" integer,
    "channel" text,
    "order_key" text,
    "tracking" text,
    "state" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "error_text" text,
    "sent_at" timestamp with time zone,
    CONSTRAINT "invoice_auto_items_pkey" PRIMARY KEY (idem_key)
);
CREATE TABLE "invoice_auto_runs" (
    "id" integer DEFAULT nextval('invoice_auto_runs_id_seq'::regclass) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "created_by" text,
    "ship_date" date,
    "file_hash" text,
    "files" jsonb,
    "fetch_info" jsonb,
    "summary" jsonb,
    "result" jsonb,
    "register_state" text,
    "register" jsonb,
    "registered_at" timestamp with time zone,
    "registered_by" text,
    CONSTRAINT "invoice_auto_runs_pkey" PRIMARY KEY (id)
);
CREATE TABLE "items" (
    "id" integer DEFAULT nextval('items_id_seq'::regclass) NOT NULL,
    "name" character varying(300) NOT NULL,
    "alias" character varying(300) DEFAULT ''::character varying,
    "spec" character varying(100) DEFAULT ''::character varying,
    "is_active" boolean DEFAULT true,
    "is_deleted" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "items_pkey" PRIMARY KEY (id)
);
CREATE TABLE "kakao_notify_log" (
    "id" integer DEFAULT nextval('kakao_notify_log_id_seq'::regclass) NOT NULL,
    "order_key" character varying(50),
    "product_name" text,
    "receiver_masked" character varying(30),
    "message" text,
    "mode" character varying(10),
    "status" character varying(30),
    "error" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "confirm_status" character varying(20),
    "confirm_error" text,
    "confirmed_at" timestamp without time zone,
    "resend_count" integer DEFAULT 0,
    "backfill" boolean DEFAULT false,
    "deleted_at" timestamp without time zone,
    "order_at" timestamp without time zone,
    "cp_name" character varying(50),
    "cp_tel" character varying(30),
    CONSTRAINT "kakao_notify_log_order_key_key" UNIQUE (order_key),
    CONSTRAINT "kakao_notify_log_pkey" PRIMARY KEY (id)
);
CREATE TABLE "keyword_rankings" (
    "id" integer DEFAULT nextval('keyword_rankings_id_seq'::regclass) NOT NULL,
    "date" date NOT NULL,
    "keyword" character varying(80) NOT NULL,
    "shopping_rank" integer,
    "ad_rank" integer,
    "powerlink_rank" integer,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now(),
    "source" text,
    CONSTRAINT "keyword_rankings_date_keyword_key" UNIQUE (date, keyword),
    CONSTRAINT "keyword_rankings_pkey" PRIMARY KEY (id)
);
CREATE TABLE "leave_adjustments" (
    "id" integer DEFAULT nextval('leave_adjustments_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "adjustment" numeric(6,3) NOT NULL,
    "reason" character varying(200) NOT NULL,
    "adjusted_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "leave_adjustments_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lms_guide_log" (
    "id" integer DEFAULT nextval('lms_guide_log_id_seq'::regclass) NOT NULL,
    "order_key" character varying(50),
    "product_name" text,
    "receiver_masked" character varying(30),
    "message" text,
    "mode" character varying(10),
    "status" character varying(30),
    "error" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "resend_count" integer DEFAULT 0,
    "order_at" timestamp without time zone,
    "cp_name" character varying(50),
    "cp_tel" character varying(30),
    "guide_token" character varying(20),
    "guide_opt" text,
    "guide_pno" bigint,
    "guide_pid" integer,
    CONSTRAINT "lms_guide_log_order_key_key" UNIQUE (order_key),
    CONSTRAINT "lms_guide_log_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_assets" (
    "id" integer DEFAULT nextval('lucky_assets_id_seq'::regclass) NOT NULL,
    "round_id" integer,
    "slot" text NOT NULL,
    "label" text,
    "mime" text NOT NULL,
    "bytes" bytea,
    "size" integer DEFAULT 0 NOT NULL,
    "width" integer,
    "height" integer,
    "sha1" text,
    "source" text,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "purged_at" timestamp without time zone,
    CONSTRAINT "lucky_assets_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events" (
    "id" integer DEFAULT nextval('lucky_events_id_seq'::regclass) NOT NULL,
    "title" text,
    "data" jsonb NOT NULL,
    "is_current" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now(),
    "archived_at" timestamp without time zone,
    CONSTRAINT "lucky_events_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_ro1183b" (
    "id" integer DEFAULT nextval('lucky_events_ro1183b_id_seq'::regclass) NOT NULL,
    "title" text,
    "data" jsonb NOT NULL,
    "is_current" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now(),
    "archived_at" timestamp without time zone,
    CONSTRAINT "lucky_events_ro1183b_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_ro1183b_assets" (
    "id" integer DEFAULT nextval('lucky_events_ro1183b_assets_id_seq'::regclass) NOT NULL,
    "round_id" integer,
    "slot" text NOT NULL,
    "label" text,
    "mime" text NOT NULL,
    "bytes" bytea,
    "size" integer DEFAULT 0 NOT NULL,
    "width" integer,
    "height" integer,
    "sha1" text,
    "source" text,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "purged_at" timestamp without time zone,
    CONSTRAINT "lucky_events_ro1183b_assets_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_ro1185" (
    "id" integer DEFAULT nextval('lucky_events_ro1185_id_seq'::regclass) NOT NULL,
    "title" text,
    "data" jsonb NOT NULL,
    "is_current" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now(),
    "archived_at" timestamp without time zone,
    CONSTRAINT "lucky_events_ro1185_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_ro11852" (
    "id" integer DEFAULT nextval('lucky_events_ro11852_id_seq'::regclass) NOT NULL,
    "title" text,
    "data" jsonb NOT NULL,
    "is_current" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now(),
    "archived_at" timestamp without time zone,
    CONSTRAINT "lucky_events_ro11852_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_ro11852_assets" (
    "id" integer DEFAULT nextval('lucky_events_ro11852_assets_id_seq'::regclass) NOT NULL,
    "round_id" integer,
    "slot" text NOT NULL,
    "label" text,
    "mime" text NOT NULL,
    "bytes" bytea,
    "size" integer DEFAULT 0 NOT NULL,
    "width" integer,
    "height" integer,
    "sha1" text,
    "source" text,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "purged_at" timestamp without time zone,
    CONSTRAINT "lucky_events_ro11852_assets_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_ro1185_assets" (
    "id" integer DEFAULT nextval('lucky_events_ro1185_assets_id_seq'::regclass) NOT NULL,
    "round_id" integer,
    "slot" text NOT NULL,
    "label" text,
    "mime" text NOT NULL,
    "bytes" bytea,
    "size" integer DEFAULT 0 NOT NULL,
    "width" integer,
    "height" integer,
    "sha1" text,
    "source" text,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "purged_at" timestamp without time zone,
    CONSTRAINT "lucky_events_ro1185_assets_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_v943" (
    "id" integer DEFAULT nextval('lucky_events_v943_id_seq'::regclass) NOT NULL,
    "title" text,
    "data" jsonb NOT NULL,
    "is_current" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now(),
    "archived_at" timestamp without time zone,
    CONSTRAINT "lucky_events_v943_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_v943_assets" (
    "id" integer DEFAULT nextval('lucky_events_v943_assets_id_seq'::regclass) NOT NULL,
    "round_id" integer,
    "slot" text NOT NULL,
    "label" text,
    "mime" text NOT NULL,
    "bytes" bytea,
    "size" integer DEFAULT 0 NOT NULL,
    "width" integer,
    "height" integer,
    "sha1" text,
    "source" text,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "purged_at" timestamp without time zone,
    CONSTRAINT "lucky_events_v943_assets_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_vhead_assets" (
    "id" integer DEFAULT nextval('lucky_events_vhead_assets_id_seq'::regclass) NOT NULL,
    "round_id" integer,
    "slot" text NOT NULL,
    "label" text,
    "mime" text NOT NULL,
    "bytes" bytea,
    "size" integer DEFAULT 0 NOT NULL,
    "width" integer,
    "height" integer,
    "sha1" text,
    "source" text,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "purged_at" timestamp without time zone,
    CONSTRAINT "lucky_events_vhead_assets_pkey" PRIMARY KEY (id)
);
CREATE TABLE "lucky_events_vtest_assets" (
    "id" integer DEFAULT nextval('lucky_events_vtest_assets_id_seq'::regclass) NOT NULL,
    "round_id" integer,
    "slot" text NOT NULL,
    "label" text,
    "mime" text NOT NULL,
    "bytes" bytea,
    "size" integer DEFAULT 0 NOT NULL,
    "width" integer,
    "height" integer,
    "sha1" text,
    "source" text,
    "created_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "purged_at" timestamp without time zone,
    CONSTRAINT "lucky_events_vtest_assets_pkey" PRIMARY KEY (id)
);
CREATE TABLE "mail_index" (
    "id" integer DEFAULT nextval('mail_index_id_seq'::regclass) NOT NULL,
    "folder" text NOT NULL,
    "folder_name" text,
    "uidvalidity" bigint,
    "uid" bigint NOT NULL,
    "from_addr" text,
    "from_name" text,
    "subject" text,
    "msg_date" text,
    "at" timestamp with time zone,
    "has_attach" boolean DEFAULT false NOT NULL,
    "attach_names" text,
    "size" integer,
    "parsed" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
    "snippet" text,
    CONSTRAINT "mail_index_folder_uid_key" UNIQUE (folder, uid),
    CONSTRAINT "mail_index_pkey" PRIMARY KEY (id)
);
CREATE TABLE "mall_game_invites" (
    "id" integer DEFAULT nextval('mall_game_invites_id_seq'::regclass) NOT NULL,
    "inviter_member_id" integer NOT NULL,
    "friend_member_id" integer NOT NULL,
    "code" character varying(16) NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT now(),
    "done_at" timestamp with time zone,
    "done_day" date,
    "inviter_plays" integer DEFAULT 0,
    "friend_plays" integer DEFAULT 0,
    CONSTRAINT "mall_game_invites_friend_member_id_key" UNIQUE (friend_member_id),
    CONSTRAINT "mall_game_invites_pkey" PRIMARY KEY (id)
);
CREATE TABLE "mall_game_scores" (
    "id" integer DEFAULT nextval('mall_game_scores_id_seq'::regclass) NOT NULL,
    "member_id" integer NOT NULL,
    "game" character varying(20) NOT NULL,
    "score" integer NOT NULL,
    "stage" integer,
    "stats" jsonb,
    "play_id" character varying(40) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "mall_game_scores_pkey" PRIMARY KEY (id),
    CONSTRAINT "mall_game_scores_play_id_key" UNIQUE (play_id)
);
CREATE TABLE "mall_members" (
    "id" integer DEFAULT nextval('mall_members_id_seq'::regclass) NOT NULL,
    "member_key" character varying(100) NOT NULL,
    "nickname" character varying(50),
    "created_at" timestamp without time zone DEFAULT now(),
    "deleted_at" timestamp without time zone,
    CONSTRAINT "mall_members_member_key_key" UNIQUE (member_key),
    CONSTRAINT "mall_members_pkey" PRIMARY KEY (id)
);
CREATE TABLE "message_logs" (
    "id" integer DEFAULT nextval('message_logs_id_seq'::regclass) NOT NULL,
    "user_id" text,
    "item" text,
    "message" text,
    "answered" boolean DEFAULT false,
    "bot_response" text,
    "received_at" timestamp without time zone DEFAULT now(),
    "staff_response" text,
    "scenario_name" text,
    "response_source" text,
    "scenario_nos" text,
    "reviewed_at" timestamp without time zone,
    "reviewed_by" character varying(50),
    "image_url" text,
    "image_meta" jsonb,
    "staff_at" timestamp with time zone,
    "talk_store" text,
    CONSTRAINT "message_logs_pkey" PRIMARY KEY (id)
);
CREATE TABLE "naver_auto_collect" (
    "key" character varying(30) NOT NULL,
    "enabled" boolean DEFAULT false,
    "interval_min" integer NOT NULL,
    "last_run_at" timestamp without time zone,
    "last_status" character varying(20),
    "updated_at" timestamp without time zone DEFAULT now(),
    "run_at_time" character varying(5),
    "last_error" text,
    "fail_count" integer,
    CONSTRAINT "naver_auto_collect_pkey" PRIMARY KEY (key)
);
CREATE TABLE "naver_claim_alerted" (
    "product_order_id" character varying(50) NOT NULL,
    "claim_kind" character varying(20) NOT NULL,
    "alerted_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "naver_claim_alerted_pkey" PRIMARY KEY (product_order_id, claim_kind)
);
CREATE TABLE "naver_inquiries" (
    "inquiry_id" character varying(50) NOT NULL,
    "raw" jsonb,
    "answered" boolean,
    "collected_at" timestamp without time zone DEFAULT now(),
    "ai_status" character varying(10),
    "ai_scenarios" jsonb,
    "ai_draft" text,
    "posted_at" timestamp without time zone,
    "posted_by" character varying(50),
    "post_error" text,
    "reviewed_at" timestamp without time zone,
    "reviewed_by" character varying(50),
    "posting_at" timestamp without time zone,
    "store" character varying(10),
    CONSTRAINT "naver_inquiries_pkey" PRIMARY KEY (inquiry_id)
);
CREATE TABLE "naver_invoice_uploaded" (
    "product_order_id" character varying(50) NOT NULL,
    "uploaded_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "naver_invoice_uploaded_pkey" PRIMARY KEY (product_order_id)
);
CREATE TABLE "naver_product_backups" (
    "id" integer DEFAULT nextval('naver_product_backups_id_seq'::regclass) NOT NULL,
    "product_no" character varying(30) NOT NULL,
    "origin_product_no" character varying(30),
    "order_id" integer,
    "before_json" jsonb NOT NULL,
    "patch_json" jsonb,
    "after_json" jsonb,
    "applied_at" timestamp without time zone,
    "reverted_at" timestamp without time zone,
    "result_json" jsonb,
    "created_by" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "store" character varying(10),
    CONSTRAINT "naver_product_backups_pkey" PRIMARY KEY (id)
);
CREATE TABLE "naver_product_snapshot" (
    "id" integer DEFAULT nextval('naver_product_snapshot_id_seq'::regclass) NOT NULL,
    "run_at" timestamp with time zone DEFAULT now(),
    "total" integer,
    "items" jsonb,
    "note" text,
    "reviews" jsonb,
    "store_meta" jsonb,
    CONSTRAINT "naver_product_snapshot_pkey" PRIMARY KEY (id)
);
CREATE TABLE "naver_qnas" (
    "question_id" bigint NOT NULL,
    "raw" jsonb,
    "answered" boolean,
    "ai_status" character varying(10),
    "ai_scenario_id" integer,
    "ai_draft" text,
    "posted_at" timestamp without time zone,
    "posted_by" character varying(50),
    "post_error" text,
    "collected_at" timestamp without time zone DEFAULT now(),
    "ai_scenarios" jsonb,
    "reviewed_at" timestamp without time zone,
    "reviewed_by" character varying(50),
    "posting_at" timestamp without time zone,
    "store" character varying(10),
    CONSTRAINT "naver_qnas_pkey" PRIMARY KEY (question_id)
);
CREATE TABLE "naver_settle_recon" (
    "expect_date" date NOT NULL,
    "basis_start" date,
    "basis_end" date,
    "complete_date" date,
    "pay_amount" numeric,
    "commission" numeric,
    "benefit" numeric,
    "return_care" numeric,
    "deduction" numeric,
    "settle_amount" numeric,
    "case_total" numeric,
    "in_period" numeric,
    "in_period_count" integer,
    "carried_in" numeric,
    "carried_in_count" integer,
    "unknown_amount" numeric,
    "unknown_count" integer,
    "pending_out_count" integer,
    "pending_out_ids" jsonb,
    "input_sum" numeric,
    "input_dates" jsonb,
    "diff1" numeric,
    "status" character varying(20),
    "detail" jsonb,
    "computed_at" timestamp with time zone,
    "notified_at" timestamp with time zone,
    "notified_status" character varying(20),
    "reversal" numeric,
    "reversal_count" integer,
    "other_adj" numeric,
    "other_detail" jsonb,
    CONSTRAINT "naver_settle_recon_pkey" PRIMARY KEY (expect_date)
);
CREATE TABLE "naver_settle_snapshot" (
    "id" integer DEFAULT nextval('naver_settle_snapshot_id_seq'::regclass) NOT NULL,
    "from_date" date,
    "to_date" date,
    "count" integer,
    "elements" jsonb,
    "collected_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "naver_settle_snapshot_pkey" PRIMARY KEY (id)
);
CREATE TABLE "notifications" (
    "id" integer DEFAULT nextval('notifications_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "type" character varying(50) NOT NULL,
    "title" character varying(200) NOT NULL,
    "message" text,
    "link" character varying(100),
    "is_read" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT now(),
    "pushed_at" timestamp without time zone,
    "level" text,
    "push_held" boolean,
    CONSTRAINT "notifications_pkey" PRIMARY KEY (id)
);
CREATE TABLE "order_memo_entries" (
    "id" integer DEFAULT nextval('order_memo_entries_id_seq'::regclass) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" text,
    "created_by_id" integer,
    "raw" text NOT NULL,
    "tags" text[] DEFAULT '{}'::text[] NOT NULL,
    "source" text DEFAULT 'manual'::text NOT NULL,
    CONSTRAINT "order_memo_entries_pkey" PRIMARY KEY (id)
);
CREATE TABLE "order_memo_preorders" (
    "id" bigint DEFAULT nextval('order_memo_preorders_id_seq'::regclass) NOT NULL,
    "channel" text NOT NULL,
    "order_key" text NOT NULL,
    "product_order_no" text,
    "buyer_name" text,
    "buyer_digits" text DEFAULT ''::text NOT NULL,
    "recv_name" text,
    "recv_digits" text DEFAULT ''::text NOT NULL,
    "addr" text,
    "option_text" text,
    "qty" integer,
    "paid_at" timestamp with time zone,
    "seen_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "miss" smallint DEFAULT 0 NOT NULL,
    CONSTRAINT "order_memo_preorders_channel_order_key_key" UNIQUE (channel, order_key),
    CONSTRAINT "order_memo_preorders_pkey" PRIMARY KEY (id)
);
CREATE TABLE "order_memo_rows" (
    "id" integer DEFAULT nextval('order_memo_rows_id_seq'::regclass) NOT NULL,
    "entry_id" integer NOT NULL,
    "kind" text NOT NULL,
    "ship_date" date,
    "line_key" text,
    "note" text,
    "plat" text,
    "line" text,
    "cells" jsonb,
    "sure" boolean DEFAULT false NOT NULL,
    "check_why" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "src" text DEFAULT 'rule'::text NOT NULL,
    "used_on" date,
    "state" text DEFAULT 'open'::text NOT NULL,
    "cleared_at" timestamp with time zone,
    "cleared_by" text,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_by" text,
    "checked" jsonb,
    "addr_ok" jsonb,
    "service" boolean DEFAULT false NOT NULL,
    "pair_orig" jsonb,
    "exp_site" boolean DEFAULT false NOT NULL,
    "boxes" jsonb,
    "out_k" text,
    CONSTRAINT "order_memo_rows_pkey" PRIMARY KEY (id)
);
CREATE TABLE "payslip_queue" (
    "id" integer DEFAULT nextval('payslip_queue_id_seq'::regclass) NOT NULL,
    "order_id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "pay_month" character varying(7) NOT NULL,
    "pay_date" character varying(10),
    "file_name" character varying(200),
    "data" bytea,
    "replace" boolean DEFAULT false NOT NULL,
    "notify" boolean DEFAULT true NOT NULL,
    "status" character varying(10) DEFAULT 'wait'::character varying NOT NULL,
    "error" text,
    "payslip_id" integer,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "done_at" timestamp with time zone,
    CONSTRAINT "payslip_queue_pkey" PRIMARY KEY (id)
);
CREATE TABLE "payslips" (
    "id" integer DEFAULT nextval('payslips_id_seq'::regclass) NOT NULL,
    "user_id" integer NOT NULL,
    "pay_month" character varying(7) NOT NULL,
    "pay_date" date,
    "title" character varying(120) NOT NULL,
    "file_name" character varying(200) NOT NULL,
    "mime" character varying(60) DEFAULT 'application/pdf'::character varying NOT NULL,
    "data" bytea NOT NULL,
    "size_bytes" integer NOT NULL,
    "uploaded_by" integer,
    "uploaded_by_name" character varying(60),
    "viewed_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "deleted_by" integer,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "payslips_pkey" PRIMARY KEY (id)
);
CREATE TABLE "pending_orders" (
    "id" integer DEFAULT nextval('pending_orders_id_seq'::regclass) NOT NULL,
    "content" text NOT NULL,
    "status" character varying(20) DEFAULT '대기'::character varying,
    "created_at" timestamp without time zone DEFAULT now(),
    "is_deleted" boolean DEFAULT false,
    "result" jsonb,
    "run_id" integer,
    "processed_at" timestamp without time zone,
    "image_data" text,
    "image_mime" character varying(40),
    "created_by" text,
    "created_by_id" integer,
    "mine_hidden" boolean DEFAULT false,
    "reply_to" integer,
    "payload" jsonb,
    "file_name" text,
    "hist_hidden" boolean DEFAULT false,
    "image_more" jsonb,
    CONSTRAINT "pending_orders_pkey" PRIMARY KEY (id)
);
CREATE TABLE "phone_view_log" (
    "viewed_date" date NOT NULL,
    "user_id" integer NOT NULL,
    "actor_name" text,
    "view_count" integer DEFAULT 0,
    "last_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "phone_view_log_pkey" PRIMARY KEY (viewed_date, user_id)
);
CREATE TABLE "planner_ddays" (
    "id" integer DEFAULT nextval('planner_ddays_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "title" character varying(100) NOT NULL,
    "target_date" date NOT NULL,
    "color" character varying(7) DEFAULT '#F5A623'::character varying,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "planner_ddays_pkey" PRIMARY KEY (id)
);
CREATE TABLE "planner_habit_logs" (
    "id" integer DEFAULT nextval('planner_habit_logs_id_seq'::regclass) NOT NULL,
    "habit_id" integer,
    "date" date NOT NULL,
    "is_done" boolean DEFAULT true,
    CONSTRAINT "planner_habit_logs_habit_id_date_key" UNIQUE (habit_id, date),
    CONSTRAINT "planner_habit_logs_pkey" PRIMARY KEY (id)
);
CREATE TABLE "planner_habits" (
    "id" integer DEFAULT nextval('planner_habits_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "title" character varying(50) NOT NULL,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "planner_habits_pkey" PRIMARY KEY (id)
);
CREATE TABLE "planner_memos" (
    "id" integer DEFAULT nextval('planner_memos_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "date" date NOT NULL,
    "content" text NOT NULL,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "planner_memos_pkey" PRIMARY KEY (id),
    CONSTRAINT "planner_memos_user_id_date_key" UNIQUE (user_id, date)
);
CREATE TABLE "planner_todos" (
    "id" integer DEFAULT nextval('planner_todos_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "date" date NOT NULL,
    "content" character varying(200) NOT NULL,
    "is_completed" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "planner_todos_pkey" PRIMARY KEY (id)
);
CREATE TABLE "points_ledger" (
    "id" integer DEFAULT nextval('points_ledger_id_seq'::regclass) NOT NULL,
    "member_id" integer NOT NULL,
    "delta" integer NOT NULL,
    "balance_after" integer NOT NULL,
    "reason" character varying(100),
    "ref_type" character varying(30),
    "ref_id" character varying(80),
    "idem_key" character varying(120),
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "points_ledger_idem_key_key" UNIQUE (idem_key),
    CONSTRAINT "points_ledger_pkey" PRIMARY KEY (id)
);
CREATE TABLE "prepayments" (
    "id" integer DEFAULT nextval('prepayments_id_seq'::regclass) NOT NULL,
    "partner" character varying(50) NOT NULL,
    "amount" numeric NOT NULL,
    "date" date NOT NULL,
    "note" text DEFAULT ''::text,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "prepayments_pkey" PRIMARY KEY (id)
);
CREATE TABLE "pricing" (
    "id" integer DEFAULT nextval('pricing_id_seq'::regclass) NOT NULL,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "partner" character varying(50) NOT NULL,
    "items" jsonb DEFAULT '[]'::jsonb,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "pricing_pkey" PRIMARY KEY (id)
);
CREATE TABLE "product_mappings" (
    "id" integer DEFAULT nextval('product_mappings_id_seq'::regclass) NOT NULL,
    "sales_name" text NOT NULL,
    "pricing_name" text NOT NULL,
    "partner" character varying(50) NOT NULL,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "product_mappings_pkey" PRIMARY KEY (id),
    CONSTRAINT "product_mappings_sales_name_partner_key" UNIQUE (sales_name, partner)
);
CREATE TABLE "product_season_knowledge" (
    "id" integer DEFAULT nextval('product_season_knowledge_id_seq'::regclass) NOT NULL,
    "item_key" character varying(40) NOT NULL,
    "label" character varying(80) NOT NULL,
    "start_md" character(5) NOT NULL,
    "end_md" character(5) NOT NULL,
    "knowledge" text NOT NULL,
    "sort" integer DEFAULT 0,
    "enabled" boolean DEFAULT true,
    "deleted_at" timestamp with time zone,
    "updated_by" character varying(50),
    "updated_at" timestamp with time zone DEFAULT now(),
    "sell_match" text,
    "sell_rule" text,
    CONSTRAINT "product_season_knowledge_pkey" PRIMARY KEY (id)
);
CREATE TABLE "push_subscriptions" (
    "id" integer DEFAULT nextval('push_subscriptions_id_seq'::regclass) NOT NULL,
    "user_id" integer NOT NULL,
    "endpoint" text NOT NULL,
    "p256dh" text NOT NULL,
    "auth" text NOT NULL,
    "label" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "last_ok_at" timestamp without time zone,
    "fail_count" integer DEFAULT 0,
    CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE (endpoint),
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY (id)
);
CREATE TABLE "report_files" (
    "id" integer DEFAULT nextval('report_files_id_seq'::regclass) NOT NULL,
    "filename" character varying(200) NOT NULL,
    "run_id" integer,
    "data" bytea NOT NULL,
    "size_bytes" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "is_deleted" boolean DEFAULT false,
    "purged_at" timestamp without time zone,
    CONSTRAINT "report_files_pkey" PRIMARY KEY (id)
);
CREATE TABLE "response_preview_log" (
    "id" bigint DEFAULT nextval('response_preview_log_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "user_name" text,
    "channel" text NOT NULL,
    "question" text NOT NULL,
    "answer" text,
    "source" text,
    "scenario_nos" jsonb,
    "ms" integer,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "response_preview_log_pkey" PRIMARY KEY (id)
);
CREATE TABLE "reward_grants" (
    "id" integer DEFAULT nextval('reward_grants_id_seq'::regclass) NOT NULL,
    "member_id" integer NOT NULL,
    "kind" character varying(20),
    "amount" integer,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "month_key" character varying(7),
    "idem_key" character varying(120),
    "created_at" timestamp without time zone DEFAULT now(),
    "granted_at" timestamp with time zone,
    "granted_by" text,
    "coupon_no" text,
    "issue_no" text,
    "issued_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "used_at" timestamp with time zone,
    "used_order_id" text,
    "notify_issue_status" character varying(20),
    "notify_issue_at" timestamp with time zone,
    "notify_expire_status" character varying(20),
    "notify_expire_at" timestamp with time zone,
    "grant_error" text,
    CONSTRAINT "reward_grants_idem_key_key" UNIQUE (idem_key),
    CONSTRAINT "reward_grants_pkey" PRIMARY KEY (id)
);
CREATE TABLE "roulette_spins" (
    "id" integer DEFAULT nextval('roulette_spins_id_seq'::regclass) NOT NULL,
    "member_id" integer NOT NULL,
    "spin_date" date NOT NULL,
    "result_key" character varying(30),
    "points" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "roulette_spins_pkey" PRIMARY KEY (id)
);
CREATE TABLE "schedules" (
    "id" integer DEFAULT nextval('schedules_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "date" date NOT NULL,
    "title" character varying(200) NOT NULL,
    "type" character varying(20) DEFAULT 'normal'::character varying,
    "created_at" timestamp without time zone DEFAULT now(),
    "document_id" integer,
    "is_completed" boolean DEFAULT false,
    "is_deleted" boolean DEFAULT false,
    "start_time" character varying(10),
    "content" text,
    "category" character varying(20) DEFAULT '일반'::character varying,
    "end_date" date,
    CONSTRAINT "schedules_pkey" PRIMARY KEY (id)
);
CREATE TABLE "season_waitlist" (
    "id" integer DEFAULT nextval('season_waitlist_id_seq'::regclass) NOT NULL,
    "item" text NOT NULL,
    "contact" character varying(30) NOT NULL,
    "memo" text,
    "notified" boolean DEFAULT false,
    "created_by" character varying(50),
    "created_at" timestamp without time zone DEFAULT now(),
    "deleted_at" timestamp without time zone,
    "member_key" character varying(60),
    "notified_at" timestamp without time zone,
    "notify_result" text,
    CONSTRAINT "season_waitlist_pkey" PRIMARY KEY (id)
);
CREATE TABLE "settlement_completions" (
    "id" integer DEFAULT nextval('settlement_completions_id_seq'::regclass) NOT NULL,
    "partner" character varying(50) NOT NULL,
    "week_start" date NOT NULL,
    "week_end" date NOT NULL,
    "total_amount" numeric DEFAULT 0,
    "completed_by" integer,
    "completed_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "settlement_completions_partner_week_start_key" UNIQUE (partner, week_start),
    CONSTRAINT "settlement_completions_pkey" PRIMARY KEY (id)
);
CREATE TABLE "settlement_status" (
    "id" integer DEFAULT nextval('settlement_status_id_seq'::regclass) NOT NULL,
    "date" date NOT NULL,
    "current_cash" numeric DEFAULT 0,
    "settlement_scheduled" numeric DEFAULT 0,
    "unsettled" numeric DEFAULT 0,
    "coupang_unpaid" numeric DEFAULT 0,
    "selfmall_unpaid" numeric DEFAULT 0,
    "ad_naver" numeric DEFAULT 0,
    "ad_gfa" numeric DEFAULT 0,
    "card_fee" numeric DEFAULT 0,
    "corp_card" numeric DEFAULT 0,
    "hyodong" numeric DEFAULT 0,
    "daesong" numeric DEFAULT 0,
    "delivery" numeric DEFAULT 0,
    "memo" text DEFAULT ''::text,
    "updated_by" integer,
    "created_at" timestamp without time zone DEFAULT now(),
    "updated_at" timestamp without time zone DEFAULT now(),
    "aewol" numeric DEFAULT 0,
    CONSTRAINT "settlement_status_date_key" UNIQUE (date),
    CONSTRAINT "settlement_status_pkey" PRIMARY KEY (id)
);
CREATE TABLE "settlements" (
    "id" integer DEFAULT nextval('settlements_id_seq'::regclass) NOT NULL,
    "date" date NOT NULL,
    "partner" character varying(50) NOT NULL,
    "amount" numeric DEFAULT 0,
    "items" jsonb DEFAULT '[]'::jsonb,
    "from_pricing" boolean DEFAULT false,
    "created_at" timestamp without time zone DEFAULT now(),
    "is_paid" boolean DEFAULT false,
    "paid_at" timestamp without time zone,
    "box_adjusted_at" timestamp without time zone,
    "paid_amount" numeric,
    CONSTRAINT "settlements_pkey" PRIMARY KEY (id)
);
CREATE TABLE "shipping_holidays" (
    "id" integer DEFAULT nextval('shipping_holidays_id_seq'::regclass) NOT NULL,
    "holiday_date" date NOT NULL,
    "reason" text,
    "created_by" character varying(50),
    "created_at" timestamp without time zone DEFAULT now(),
    "deleted_at" timestamp without time zone,
    "notice" text,
    "no_ship" boolean,
    "no_arrive" boolean,
    CONSTRAINT "shipping_holidays_holiday_date_key" UNIQUE (holiday_date),
    CONSTRAINT "shipping_holidays_pkey" PRIMARY KEY (id)
);
CREATE TABLE "sms_images" (
    "id" integer DEFAULT nextval('sms_images_id_seq'::regclass) NOT NULL,
    "message_id" integer NOT NULL,
    "content_type" text,
    "name" text,
    "size_bytes" integer,
    "data" bytea,
    "purged_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "sms_images_pkey" PRIMARY KEY (id)
);
CREATE TABLE "sms_messages" (
    "id" integer DEFAULT nextval('sms_messages_id_seq'::regclass) NOT NULL,
    "thread_id" integer NOT NULL,
    "direction" text NOT NULL,
    "kind" text DEFAULT 'sms'::text NOT NULL,
    "body" text,
    "sender" text NOT NULL,
    "state" text DEFAULT 'received'::text NOT NULL,
    "gateway_id" text,
    "sim_number" integer,
    "bucket" text,
    "rule_kind" text,
    "ai_json" jsonb,
    "send_after" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "fail_reason" text,
    "event_at" timestamp with time zone DEFAULT now(),
    "created_at" timestamp with time zone DEFAULT now(),
    "envelope_id" text,
    "priority" integer DEFAULT 0,
    "decided_at" timestamp with time zone,
    "deciding_at" timestamp with time zone,
    CONSTRAINT "sms_messages_pkey" PRIMARY KEY (id)
);
CREATE TABLE "sms_preorders" (
    "id" bigint DEFAULT nextval('sms_preorders_id_seq'::regclass) NOT NULL,
    "channel" text NOT NULL,
    "order_key" text NOT NULL,
    "buyer_digits" text DEFAULT ''::text NOT NULL,
    "recipient_digits" text DEFAULT ''::text NOT NULL,
    "recipient_initial" text DEFAULT ''::text NOT NULL,
    "option_text" text,
    "qty" integer,
    "paid_at" timestamp with time zone,
    "seen_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "miss" smallint DEFAULT 0 NOT NULL,
    CONSTRAINT "sms_preorders_channel_order_key_key" UNIQUE (channel, order_key),
    CONSTRAINT "sms_preorders_pkey" PRIMARY KEY (id)
);
CREATE TABLE "sms_selfcheck_hits" (
    "id" bigint DEFAULT nextval('sms_selfcheck_hits_id_seq'::regclass) NOT NULL,
    "kind" text NOT NULL,
    "key_hash" text NOT NULL,
    "at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "sms_selfcheck_hits_pkey" PRIMARY KEY (id)
);
CREATE TABLE "sms_threads" (
    "id" integer DEFAULT nextval('sms_threads_id_seq'::regclass) NOT NULL,
    "phone_digits" text NOT NULL,
    "status" text DEFAULT 'new'::text NOT NULL,
    "last_in_at" timestamp with time zone,
    "last_out_at" timestamp with time zone,
    "last_in_text" text,
    "last_out_text" text,
    "has_image" boolean DEFAULT false,
    "cooldown_until" timestamp with time zone,
    "bot_count_day" date,
    "bot_count" integer DEFAULT 0,
    "ask_count" integer DEFAULT 0,
    "staff_user_id" integer,
    "staff_name" text,
    "handled_at" timestamp with time zone,
    "draft_text" text,
    "draft_kind" text,
    "order_hint" text,
    "order_json" jsonb,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    "last_out_state" text,
    "ask_kind" text,
    "ask_at" timestamp with time zone,
    "last_notify_at" timestamp with time zone,
    "staff_read_at" timestamp with time zone,
    "staff_why" text,
    "gated_ai_n" integer DEFAULT 0 NOT NULL,
    "gated_ai_day" text,
    "done_json" jsonb,
    CONSTRAINT "sms_threads_phone_digits_key" UNIQUE (phone_digits),
    CONSTRAINT "sms_threads_pkey" PRIMARY KEY (id)
);
CREATE TABLE "talk_outbox" (
    "id" integer DEFAULT nextval('talk_outbox_id_seq'::regclass) NOT NULL,
    "log_id" integer,
    "user_id" text NOT NULL,
    "body" text NOT NULL,
    "order_id" integer,
    "requested_by" character varying(50),
    "status" character varying(12) DEFAULT 'queued'::character varying,
    "error" text,
    "created_at" timestamp without time zone DEFAULT now(),
    "sent_at" timestamp without time zone,
    CONSTRAINT "talk_outbox_pkey" PRIMARY KEY (id)
);
CREATE TABLE "tax_invoice_checks" (
    "supplier" text NOT NULL,
    "month" text NOT NULL,
    "checked_by" integer,
    "checked_name" text,
    "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tax_invoice_checks_pkey" PRIMARY KEY (supplier, month)
);
CREATE TABLE "tax_invoice_payments" (
    "id" integer DEFAULT nextval('tax_invoice_payments_id_seq'::regclass) NOT NULL,
    "supplier" text NOT NULL,
    "paid_on" date NOT NULL,
    "amount" bigint NOT NULL,
    "memo" text DEFAULT ''::text NOT NULL,
    "source" text DEFAULT 'manual'::text NOT NULL,
    "created_by" integer,
    "created_name" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "tax_invoice_payments_pkey" PRIMARY KEY (id)
);
CREATE TABLE "tax_invoice_seen" (
    "dedup_key" text NOT NULL,
    "why" text NOT NULL,
    "sig" text,
    "at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tax_invoice_seen_pkey" PRIMARY KEY (dedup_key)
);
CREATE TABLE "tax_invoices" (
    "id" integer DEFAULT nextval('tax_invoices_id_seq'::regclass) NOT NULL,
    "supplier" text DEFAULT 'other'::text NOT NULL,
    "supplier_name" text,
    "supplier_bizno" text,
    "approval_no" text,
    "kind" text,
    "orig_approval_no" text,
    "issue_date" date,
    "supply_amount" bigint,
    "vat_amount" bigint,
    "total_amount" bigint,
    "mail_folder" text,
    "mail_uid" bigint,
    "mail_uidvalidity" bigint,
    "mail_subject" text,
    "mail_at" timestamp with time zone,
    "pdf_name" text,
    "pdf_data" bytea,
    "read_status" text DEFAULT 'check'::text NOT NULL,
    "read_note" text,
    "status" text DEFAULT 'draft'::text NOT NULL,
    "memo" text,
    "confirmed_by" text,
    "confirmed_at" timestamp with time zone,
    "dedup_key" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "tax_invoices_dedup_key_key" UNIQUE (dedup_key),
    CONSTRAINT "tax_invoices_pkey" PRIMARY KEY (id)
);
CREATE TABLE "tree_state" (
    "member_id" integer NOT NULL,
    "level" integer DEFAULT 1,
    "water_count" integer DEFAULT 0,
    "updated_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "tree_state_pkey" PRIMARY KEY (member_id)
);
CREATE TABLE "unmatched_messages" (
    "id" integer DEFAULT nextval('unmatched_messages_id_seq'::regclass) NOT NULL,
    "user_id" text,
    "message" text,
    "received_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "unmatched_messages_pkey" PRIMARY KEY (id)
);
CREATE TABLE "users" (
    "id" integer DEFAULT nextval('users_id_seq'::regclass) NOT NULL,
    "username" character varying(50) NOT NULL,
    "password_hash" character varying(255) NOT NULL,
    "name" character varying(50) NOT NULL,
    "position" character varying(50) DEFAULT ''::character varying,
    "color" character varying(20) DEFAULT '#3b82f6'::character varying,
    "role" character varying(20) DEFAULT 'user'::character varying,
    "annual_leave" numeric DEFAULT 15,
    "created_at" timestamp without time zone DEFAULT now(),
    "signature_image" text,
    "deleted_at" timestamp without time zone,
    "idle_hours" numeric,
    CONSTRAINT "users_pkey" PRIMARY KEY (id),
    CONSTRAINT "users_username_key" UNIQUE (username)
);
CREATE TABLE "work_logs" (
    "id" integer DEFAULT nextval('work_logs_id_seq'::regclass) NOT NULL,
    "user_id" integer,
    "date" date NOT NULL,
    "content" text NOT NULL,
    "created_at" timestamp without time zone DEFAULT now(),
    CONSTRAINT "work_logs_pkey" PRIMARY KEY (id),
    CONSTRAINT "work_logs_user_id_date_key" UNIQUE (user_id, date)
);

-- ── 시퀀스 주인 칸(칸·표를 지우면 시퀀스도 같이)
ALTER SEQUENCE "agent_feedback_id_seq" OWNED BY "agent_feedback"."id";
ALTER SEQUENCE "agent_lessons_id_seq" OWNED BY "agent_lessons"."id";
ALTER SEQUENCE "agent_runs_id_seq" OWNED BY "agent_runs"."id";
ALTER SEQUENCE "agent_tools_id_seq" OWNED BY "agent_tools"."id";
ALTER SEQUENCE "agents_id_seq" OWNED BY "agents"."id";
ALTER SEQUENCE "audit_logs_id_seq" OWNED BY "audit_logs"."id";
ALTER SEQUENCE "bot_products_id_seq" OWNED BY "bot_products"."id";
ALTER SEQUENCE "box_inventory_id_seq" OWNED BY "box_inventory"."id";
ALTER SEQUENCE "box_movements_id_seq" OWNED BY "box_movements"."id";
ALTER SEQUENCE "card_transactions_id_seq" OWNED BY "card_transactions"."id";
ALTER SEQUENCE "cc_instructions_id_seq" OWNED BY "cc_instructions"."id";
ALTER SEQUENCE "cj_carryover_id_seq" OWNED BY "cj_carryover"."id";
ALTER SEQUENCE "cj_daily_payments_id_seq" OWNED BY "cj_daily_payments"."id";
ALTER SEQUENCE "company_rules_id_seq" OWNED BY "company_rules"."id";
ALTER SEQUENCE "coupang_item_backups_id_seq" OWNED BY "coupang_item_backups"."id";
ALTER SEQUENCE "cs_categories_id_seq" OWNED BY "cs_categories"."id";
ALTER SEQUENCE "cs_templates_id_seq" OWNED BY "cs_templates"."id";
ALTER SEQUENCE "dev_backlog_id_seq" OWNED BY "dev_backlog"."id";
ALTER SEQUENCE "documents_id_seq" OWNED BY "documents"."id";
ALTER SEQUENCE "expense_reports_id_seq" OWNED BY "expense_reports"."id";
ALTER SEQUENCE "experience_bookings_id_seq" OWNED BY "experience_bookings"."id";
ALTER SEQUENCE "inquiry_scenarios_id_seq" OWNED BY "inquiry_scenarios"."id";
ALTER SEQUENCE "invoice_auto_runs_id_seq" OWNED BY "invoice_auto_runs"."id";
ALTER SEQUENCE "items_id_seq" OWNED BY "items"."id";
ALTER SEQUENCE "kakao_notify_log_id_seq" OWNED BY "kakao_notify_log"."id";
ALTER SEQUENCE "keyword_rankings_id_seq" OWNED BY "keyword_rankings"."id";
ALTER SEQUENCE "leave_adjustments_id_seq" OWNED BY "leave_adjustments"."id";
ALTER SEQUENCE "lms_guide_log_id_seq" OWNED BY "lms_guide_log"."id";
ALTER SEQUENCE "lucky_assets_id_seq" OWNED BY "lucky_assets"."id";
ALTER SEQUENCE "lucky_events_id_seq" OWNED BY "lucky_events"."id";
ALTER SEQUENCE "lucky_events_ro1183b_assets_id_seq" OWNED BY "lucky_events_ro1183b_assets"."id";
ALTER SEQUENCE "lucky_events_ro1183b_id_seq" OWNED BY "lucky_events_ro1183b"."id";
ALTER SEQUENCE "lucky_events_ro11852_assets_id_seq" OWNED BY "lucky_events_ro11852_assets"."id";
ALTER SEQUENCE "lucky_events_ro11852_id_seq" OWNED BY "lucky_events_ro11852"."id";
ALTER SEQUENCE "lucky_events_ro1185_assets_id_seq" OWNED BY "lucky_events_ro1185_assets"."id";
ALTER SEQUENCE "lucky_events_ro1185_id_seq" OWNED BY "lucky_events_ro1185"."id";
ALTER SEQUENCE "lucky_events_v943_assets_id_seq" OWNED BY "lucky_events_v943_assets"."id";
ALTER SEQUENCE "lucky_events_v943_id_seq" OWNED BY "lucky_events_v943"."id";
ALTER SEQUENCE "lucky_events_vhead_assets_id_seq" OWNED BY "lucky_events_vhead_assets"."id";
ALTER SEQUENCE "lucky_events_vtest_assets_id_seq" OWNED BY "lucky_events_vtest_assets"."id";
ALTER SEQUENCE "mail_index_id_seq" OWNED BY "mail_index"."id";
ALTER SEQUENCE "mall_game_invites_id_seq" OWNED BY "mall_game_invites"."id";
ALTER SEQUENCE "mall_game_scores_id_seq" OWNED BY "mall_game_scores"."id";
ALTER SEQUENCE "mall_members_id_seq" OWNED BY "mall_members"."id";
ALTER SEQUENCE "message_logs_id_seq" OWNED BY "message_logs"."id";
ALTER SEQUENCE "naver_product_backups_id_seq" OWNED BY "naver_product_backups"."id";
ALTER SEQUENCE "naver_product_snapshot_id_seq" OWNED BY "naver_product_snapshot"."id";
ALTER SEQUENCE "naver_settle_snapshot_id_seq" OWNED BY "naver_settle_snapshot"."id";
ALTER SEQUENCE "notifications_id_seq" OWNED BY "notifications"."id";
ALTER SEQUENCE "order_memo_entries_id_seq" OWNED BY "order_memo_entries"."id";
ALTER SEQUENCE "order_memo_preorders_id_seq" OWNED BY "order_memo_preorders"."id";
ALTER SEQUENCE "order_memo_rows_id_seq" OWNED BY "order_memo_rows"."id";
ALTER SEQUENCE "payslip_queue_id_seq" OWNED BY "payslip_queue"."id";
ALTER SEQUENCE "payslips_id_seq" OWNED BY "payslips"."id";
ALTER SEQUENCE "pending_orders_id_seq" OWNED BY "pending_orders"."id";
ALTER SEQUENCE "planner_ddays_id_seq" OWNED BY "planner_ddays"."id";
ALTER SEQUENCE "planner_habit_logs_id_seq" OWNED BY "planner_habit_logs"."id";
ALTER SEQUENCE "planner_habits_id_seq" OWNED BY "planner_habits"."id";
ALTER SEQUENCE "planner_memos_id_seq" OWNED BY "planner_memos"."id";
ALTER SEQUENCE "planner_todos_id_seq" OWNED BY "planner_todos"."id";
ALTER SEQUENCE "points_ledger_id_seq" OWNED BY "points_ledger"."id";
ALTER SEQUENCE "prepayments_id_seq" OWNED BY "prepayments"."id";
ALTER SEQUENCE "pricing_id_seq" OWNED BY "pricing"."id";
ALTER SEQUENCE "product_mappings_id_seq" OWNED BY "product_mappings"."id";
ALTER SEQUENCE "product_season_knowledge_id_seq" OWNED BY "product_season_knowledge"."id";
ALTER SEQUENCE "push_subscriptions_id_seq" OWNED BY "push_subscriptions"."id";
ALTER SEQUENCE "report_files_id_seq" OWNED BY "report_files"."id";
ALTER SEQUENCE "response_preview_log_id_seq" OWNED BY "response_preview_log"."id";
ALTER SEQUENCE "reward_grants_id_seq" OWNED BY "reward_grants"."id";
ALTER SEQUENCE "roulette_spins_id_seq" OWNED BY "roulette_spins"."id";
ALTER SEQUENCE "schedules_id_seq" OWNED BY "schedules"."id";
ALTER SEQUENCE "season_waitlist_id_seq" OWNED BY "season_waitlist"."id";
ALTER SEQUENCE "settlement_completions_id_seq" OWNED BY "settlement_completions"."id";
ALTER SEQUENCE "settlement_status_id_seq" OWNED BY "settlement_status"."id";
ALTER SEQUENCE "settlements_id_seq" OWNED BY "settlements"."id";
ALTER SEQUENCE "shipping_holidays_id_seq" OWNED BY "shipping_holidays"."id";
ALTER SEQUENCE "sms_images_id_seq" OWNED BY "sms_images"."id";
ALTER SEQUENCE "sms_messages_id_seq" OWNED BY "sms_messages"."id";
ALTER SEQUENCE "sms_preorders_id_seq" OWNED BY "sms_preorders"."id";
ALTER SEQUENCE "sms_selfcheck_hits_id_seq" OWNED BY "sms_selfcheck_hits"."id";
ALTER SEQUENCE "sms_threads_id_seq" OWNED BY "sms_threads"."id";
ALTER SEQUENCE "talk_outbox_id_seq" OWNED BY "talk_outbox"."id";
ALTER SEQUENCE "tax_invoice_payments_id_seq" OWNED BY "tax_invoice_payments"."id";
ALTER SEQUENCE "tax_invoices_id_seq" OWNED BY "tax_invoices"."id";
ALTER SEQUENCE "unmatched_messages_id_seq" OWNED BY "unmatched_messages"."id";
ALTER SEQUENCE "users_id_seq" OWNED BY "users"."id";
ALTER SEQUENCE "work_logs_id_seq" OWNED BY "work_logs"."id";

-- ── 인덱스
CREATE INDEX company_rules_live ON public.company_rules USING btree (title, uploaded_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX coupang_item_backups_vid_idx ON public.coupang_item_backups USING btree (vendor_item_id, id DESC);
CREATE INDEX experience_bookings_visit ON public.experience_bookings USING btree (visit_date);
CREATE INDEX idx_agent_runs_agent ON public.agent_runs USING btree (agent_id, started_at DESC);
CREATE INDEX idx_audit_created ON public.audit_logs USING btree (created_at);
CREATE INDEX idx_card_tx_date ON public.card_transactions USING btree (transaction_date);
CREATE INDEX idx_card_tx_dup ON public.card_transactions USING btree (transaction_date, merchant_name, amount);
CREATE INDEX idx_delivery_shipments_date ON public.delivery_shipments USING btree (ship_date);
CREATE INDEX idx_ds_buyer_digits ON public.delivery_shipments USING btree (buyer_digits) WHERE (buyer_digits <> ''::text);
CREATE INDEX idx_ds_phone_digits ON public.delivery_shipments USING btree (phone_digits) WHERE (phone_digits <> ''::text);
CREATE INDEX idx_ds_tail_buyer ON public.delivery_shipments USING btree ("right"(buyer_digits, 4)) WHERE (length(buyer_digits) >= 9);
CREATE INDEX idx_ds_tail_phone ON public.delivery_shipments USING btree ("right"(phone_digits, 4)) WHERE (length(phone_digits) >= 9);
CREATE INDEX idx_inquiry_scenarios_no ON public.inquiry_scenarios USING btree (scenario_no);
CREATE INDEX idx_items_name ON public.items USING btree (name);
CREATE INDEX idx_kakao_notify_log_created ON public.kakao_notify_log USING btree (created_at DESC);
CREATE INDEX idx_lms_guide_log_created ON public.lms_guide_log USING btree (created_at DESC);
CREATE INDEX idx_lms_guide_log_token ON public.lms_guide_log USING btree (guide_token) WHERE (guide_token IS NOT NULL);
CREATE INDEX idx_mall_game_invites_inviter ON public.mall_game_invites USING btree (inviter_member_id, done_day);
CREATE INDEX idx_mall_game_scores_member ON public.mall_game_scores USING btree (member_id, game);
CREATE INDEX idx_mall_game_scores_rank ON public.mall_game_scores USING btree (game, score DESC, created_at);
CREATE INDEX idx_message_logs_received ON public.message_logs USING btree (received_at);
CREATE INDEX idx_message_logs_user_id ON public.message_logs USING btree (user_id, id);
CREATE INDEX idx_notifications_user_read ON public.notifications USING btree (user_id, is_read);
CREATE INDEX idx_pending_orders_by ON public.pending_orders USING btree (created_by_id, id);
CREATE INDEX idx_pending_orders_reply ON public.pending_orders USING btree (reply_to) WHERE (reply_to IS NOT NULL);
CREATE INDEX idx_points_ledger_member ON public.points_ledger USING btree (member_id, id DESC);
CREATE INDEX idx_reward_grants_month ON public.reward_grants USING btree (month_key, kind);
CREATE INDEX idx_roulette_spins_member ON public.roulette_spins USING btree (member_id);
CREATE INDEX idx_season_waitlist_member ON public.season_waitlist USING btree (member_key) WHERE (member_key IS NOT NULL);
CREATE INDEX idx_sms_images_msg ON public.sms_images USING btree (message_id);
CREATE UNIQUE INDEX idx_sms_messages_envelope ON public.sms_messages USING btree (envelope_id) WHERE (envelope_id IS NOT NULL);
CREATE INDEX idx_sms_messages_event_at ON public.sms_messages USING btree (event_at);
CREATE INDEX idx_sms_messages_gw ON public.sms_messages USING btree (gateway_id) WHERE (gateway_id IS NOT NULL);
CREATE INDEX idx_sms_messages_queue ON public.sms_messages USING btree (state, send_after) WHERE (state = 'queued'::text);
CREATE INDEX idx_sms_messages_thread ON public.sms_messages USING btree (thread_id, id);
CREATE INDEX idx_sms_messages_undecided ON public.sms_messages USING btree (id) WHERE ((direction = 'in'::text) AND (decided_at IS NULL));
CREATE INDEX idx_sms_pre_buyer ON public.sms_preorders USING btree (buyer_digits) WHERE (buyer_digits <> ''::text);
CREATE INDEX idx_sms_pre_recipient ON public.sms_preorders USING btree (recipient_digits) WHERE (recipient_digits <> ''::text);
CREATE INDEX idx_sms_selfcheck_hits ON public.sms_selfcheck_hits USING btree (kind, key_hash, at);
CREATE INDEX idx_sms_threads_status ON public.sms_threads USING btree (status, updated_at DESC);
CREATE INDEX mail_index_at ON public.mail_index USING btree (at DESC);
CREATE INDEX mail_index_kind ON public.mail_index USING btree (((parsed ->> 'kind'::text)), at DESC);
CREATE INDEX naver_product_backups_pno_idx ON public.naver_product_backups USING btree (product_no, id DESC);
CREATE INDEX order_memo_pre_buyer ON public.order_memo_preorders USING btree (buyer_digits) WHERE (buyer_digits <> ''::text);
CREATE INDEX order_memo_pre_recv ON public.order_memo_preorders USING btree (recv_digits) WHERE (recv_digits <> ''::text);
CREATE INDEX order_memo_rows_state ON public.order_memo_rows USING btree (state, entry_id);
CREATE INDEX payslip_queue_wait ON public.payslip_queue USING btree (status, id);
CREATE INDEX payslips_user ON public.payslips USING btree (user_id, pay_month DESC);
CREATE UNIQUE INDEX payslips_user_month_live ON public.payslips USING btree (user_id, pay_month) WHERE (deleted_at IS NULL);
CREATE INDEX response_preview_log_created_idx ON public.response_preview_log USING btree (created_at DESC);
CREATE INDEX tax_invoice_payments_sup ON public.tax_invoice_payments USING btree (supplier, paid_on);
CREATE UNIQUE INDEX tax_invoices_approval ON public.tax_invoices USING btree (approval_no) WHERE (approval_no IS NOT NULL);
CREATE INDEX tax_invoices_issue ON public.tax_invoices USING btree (issue_date, supplier);

-- ── 외래 키(맨 끝 · 복원은 자료를 다 넣은 뒤 다시 걸며 전 줄 검사)
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id);
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_run_id_fkey" FOREIGN KEY (run_id) REFERENCES agent_runs(id);
ALTER TABLE "agent_lessons" ADD CONSTRAINT "agent_lessons_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id);
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id);
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id);
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES users(id);
ALTER TABLE "box_inventory" ADD CONSTRAINT "box_inventory_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE "box_movements" ADD CONSTRAINT "box_movements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_expense_report_id_fkey" FOREIGN KEY (expense_report_id) REFERENCES expense_reports(id) ON DELETE SET NULL;
ALTER TABLE "cj_carryover" ADD CONSTRAINT "cj_carryover_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE "cs_templates" ADD CONSTRAINT "cs_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE "documents" ADD CONSTRAINT "documents_applicant_id_fkey" FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_approver_id_fkey" FOREIGN KEY (approver_id) REFERENCES users(id);
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_applicant_id_fkey" FOREIGN KEY (applicant_id) REFERENCES users(id);
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_ceo_id_fkey" FOREIGN KEY (ceo_id) REFERENCES users(id);
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_manager_id_fkey" FOREIGN KEY (manager_id) REFERENCES users(id);
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_rejected_by_fkey" FOREIGN KEY (rejected_by) REFERENCES users(id);
ALTER TABLE "keyword_rankings" ADD CONSTRAINT "keyword_rankings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_adjusted_by_fkey" FOREIGN KEY (adjusted_by) REFERENCES users(id);
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE "order_memo_rows" ADD CONSTRAINT "order_memo_rows_entry_id_fkey" FOREIGN KEY (entry_id) REFERENCES order_memo_entries(id) ON DELETE CASCADE;
ALTER TABLE "planner_ddays" ADD CONSTRAINT "planner_ddays_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE "planner_habit_logs" ADD CONSTRAINT "planner_habit_logs_habit_id_fkey" FOREIGN KEY (habit_id) REFERENCES planner_habits(id) ON DELETE CASCADE;
ALTER TABLE "planner_habits" ADD CONSTRAINT "planner_habits_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE "planner_memos" ADD CONSTRAINT "planner_memos_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE "planner_todos" ADD CONSTRAINT "planner_todos_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_document_id_fkey" FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE "settlement_completions" ADD CONSTRAINT "settlement_completions_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES users(id);
ALTER TABLE "settlement_status" ADD CONSTRAINT "settlement_status_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE "sms_images" ADD CONSTRAINT "sms_images_message_id_fkey" FOREIGN KEY (message_id) REFERENCES sms_messages(id);
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES sms_threads(id);
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
