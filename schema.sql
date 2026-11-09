PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS bills (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 bank TEXT NOT NULL,
 card_last4 TEXT NOT NULL DEFAULT '',
 customer_name TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT 'credit_card',
 display_name TEXT NOT NULL DEFAULT '',
 schedule_id INTEGER,
 amount REAL NOT NULL CHECK(amount >= 0),
 statement_date TEXT,
 minimum_amount REAL,
 annual_fee_info TEXT NOT NULL DEFAULT '',
 details_json TEXT NOT NULL DEFAULT '[]',
 currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency = 'CNY'),
 due_date TEXT NOT NULL CHECK(length(due_date)=10 AND date(due_date)=due_date),
 is_paid INTEGER NOT NULL DEFAULT 0 CHECK(is_paid IN (0,1)),
 paid_at TEXT,
 subject TEXT NOT NULL DEFAULT '',
 sender TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(bank,due_date)
);
CREATE INDEX IF NOT EXISTS bills_due ON bills(is_paid,due_date);
CREATE TABLE IF NOT EXISTS incoming_emails (
 id TEXT PRIMARY KEY,
 sender TEXT NOT NULL,
 subject TEXT NOT NULL,
 bank TEXT,
 status TEXT NOT NULL CHECK(status IN ('processing','parsed','review','ignored')),
 reason TEXT,
 extracted_json TEXT NOT NULL DEFAULT '{}',
 bill_id INTEGER REFERENCES bills(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS attachments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email_id TEXT NOT NULL REFERENCES incoming_emails(id),
 bill_id INTEGER REFERENCES bills(id),
 object_key TEXT NOT NULL UNIQUE,
 filename TEXT NOT NULL,
 sha256 TEXT,
 size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_bill ON attachments(bill_id);
CREATE INDEX IF NOT EXISTS attachments_hash ON attachments(sha256);
CREATE TABLE IF NOT EXISTS notification_deliveries (
 bill_id INTEGER NOT NULL REFERENCES bills(id),
 day TEXT NOT NULL,
 channel TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
 lease_until TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 1,
 sent_at TEXT,
 PRIMARY KEY(bill_id,day,channel)
);
CREATE TABLE IF NOT EXISTS payment_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 bill_id INTEGER NOT NULL REFERENCES bills(id),
 action TEXT NOT NULL CHECK(action IN ('pay','unpay')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS login_attempts (
 bucket TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recurring_schedules (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 institution TEXT NOT NULL DEFAULT '',
 customer_name TEXT NOT NULL DEFAULT '',
 card_last4 TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT 'mortgage' CHECK(category IN ('mortgage','recurring')),
 amount REAL NOT NULL CHECK(amount>=0),
 interval_months INTEGER NOT NULL CHECK(interval_months BETWEEN 1 AND 120),
 due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 start_date TEXT NOT NULL,
 end_date TEXT,
 next_due_date TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS reminder_runs (
 day TEXT NOT NULL,
 channel TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
 lease_until TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 1,
 bill_count INTEGER NOT NULL DEFAULT 0,
 sent_at TEXT,
 PRIMARY KEY(day,channel)
);
