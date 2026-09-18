-- FrostLine CRM schema. Datetimes are stored as local (Europe/London) naive
-- ISO strings "YYYY-MM-DDTHH:MM[:SS]"; dates as "YYYY-MM-DD".

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('manager','coordinator','sales','engineer')),
  job_title TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  -- engineer attributes
  skills TEXT NOT NULL DEFAULT '[]',          -- JSON array of skill codes
  base_region TEXT,
  is_subcontractor INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,                -- JSON encoded
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  account_ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sector TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('prospect','active','inactive')),
  phone TEXT,
  email TEXT,
  billing_address TEXT,
  account_hold INTEGER NOT NULL DEFAULT 0,
  account_hold_note TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id INTEGER REFERENCES sites(id),
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sites (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  postcode TEXT,
  region TEXT,
  access_notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE equipment_categories (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  suggested_skill TEXT          -- used only as a scheduling hint
);

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  category TEXT NOT NULL REFERENCES equipment_categories(code),
  asset_tag TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  location TEXT,
  refrigerant TEXT,
  refrigerant_kg REAL,
  install_date TEXT,
  warranty_expiry TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','out_of_service','decommissioned')),
  notes TEXT
);

CREATE TABLE contracts (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  reference TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','suspended','ended')),
  -- response targets in hours per priority; NULL = no contractual target
  response_emergency_hours REAL,
  response_urgent_hours REAL,
  response_routine_hours REAL,
  out_of_hours_cover INTEGER NOT NULL DEFAULT 0,
  ppm_visits_per_year INTEGER,
  ppm_visit_hours REAL,
  labour_included INTEGER NOT NULL DEFAULT 0,
  parts_included INTEGER NOT NULL DEFAULT 0,
  annual_value REAL,
  terms_notes TEXT
);

CREATE TABLE contract_sites (
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  PRIMARY KEY (contract_id, site_id)
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  contract_id INTEGER REFERENCES contracts(id),
  job_type TEXT NOT NULL CHECK (job_type IN ('reactive','planned_maintenance','quoted_works','installation','survey','warranty')),
  priority TEXT NOT NULL CHECK (priority IN ('emergency','urgent','routine','planned')),
  status TEXT NOT NULL CHECK (status IN ('to_schedule','scheduled','in_progress','on_hold','completed','closed','cancelled')),
  hold_reason TEXT CHECK (hold_reason IN ('awaiting_parts','awaiting_quote','awaiting_access','awaiting_customer','review','other')),
  next_action TEXT,
  title TEXT NOT NULL,
  description TEXT,
  reported_via TEXT CHECK (reported_via IN ('phone','email','engineer','planned','quote','other')),
  reported_by_contact_id INTEGER REFERENCES contacts(id),
  reported_by_name TEXT,
  customer_order_ref TEXT,
  estimated_hours REAL,
  due_date TEXT,                     -- target date for planned work
  response_due_at TEXT,              -- computed at logging; NULL = no committed target
  response_target_source TEXT,       -- human readable explanation of how response_due_at was derived
  first_attended_at TEXT,
  quote_id INTEGER REFERENCES quotes(id),
  parent_job_id INTEGER REFERENCES jobs(id),
  ppm_key TEXT UNIQUE,               -- contract:site:period for generated planned maintenance
  completed_at TEXT,
  closed_at TEXT,
  cancelled_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_equipment (
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  PRIMARY KEY (job_id, equipment_id)
);

CREATE TABLE engineer_absences (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('holiday','sick','training','other')),
  note TEXT
);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  engineer_id INTEGER NOT NULL REFERENCES users(id),
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','travelling','on_site','completed','no_access','cancelled')),
  instructions TEXT,
  travel_started_at TEXT,
  arrived_at TEXT,
  departed_at TEXT,
  work_notes TEXT,
  outcome TEXT CHECK (outcome IN ('resolved','return_visit','parts_required','quote_required','no_access')),
  outcome_notes TEXT,
  signoff_name TEXT,
  signature_file TEXT,
  cancelled_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE visit_equipment (
  visit_id INTEGER NOT NULL REFERENCES visits(id),
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  condition TEXT CHECK (condition IN ('good','attention','failed','not_checked')),
  readings TEXT,
  notes TEXT,
  PRIMARY KEY (visit_id, equipment_id)
);

CREATE TABLE visit_photos (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id),
  equipment_id INTEGER REFERENCES equipment(id),
  file_name TEXT NOT NULL,
  caption TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);

CREATE TABLE recommendations (
  id INTEGER PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id),
  visit_id INTEGER REFERENCES visits(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  equipment_id INTEGER REFERENCES equipment(id),
  description TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high','safety')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','quoted','dismissed')),
  quote_id INTEGER REFERENCES quotes(id),
  dismissed_reason TEXT,
  raised_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id INTEGER REFERENCES sites(id),
  contact_id INTEGER REFERENCES contacts(id),
  origin_job_id INTEGER REFERENCES jobs(id),
  quote_type TEXT NOT NULL CHECK (quote_type IN ('repair','installation','replacement','other')),
  title TEXT NOT NULL,
  scope TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','sent','accepted','rejected','superseded','withdrawn')),
  valid_until TEXT,
  vat_rate REAL NOT NULL,
  sent_at TEXT,
  decided_at TEXT,
  decision_by_name TEXT,
  customer_po TEXT,
  rejection_reason TEXT,
  converted_job_id INTEGER REFERENCES jobs(id),
  superseded_by_id INTEGER REFERENCES quotes(id),
  prepared_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (reference, revision)
);

CREATE TABLE quote_lines (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  sort INTEGER NOT NULL DEFAULT 0,
  line_type TEXT NOT NULL CHECK (line_type IN ('labour','part','material','subcontract','other')),
  description TEXT NOT NULL,
  part_id INTEGER REFERENCES parts(id),
  equipment_id INTEGER REFERENCES equipment(id),
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  account_ref TEXT,
  notes TEXT
);

CREATE TABLE parts (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'each',
  unit_cost REAL,
  sell_price REAL,
  preferred_supplier_id INTEGER REFERENCES suppliers(id),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE stock_locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('store','van')),
  engineer_id INTEGER UNIQUE REFERENCES users(id)
);

CREATE TABLE stock_levels (
  part_id INTEGER NOT NULL REFERENCES parts(id),
  location_id INTEGER NOT NULL REFERENCES stock_locations(id),
  quantity REAL NOT NULL DEFAULT 0,
  min_quantity REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (part_id, location_id)
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  from_location_id INTEGER REFERENCES stock_locations(id),
  to_location_id INTEGER REFERENCES stock_locations(id),
  quantity REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('receipt','transfer','used','return','adjustment')),
  visit_id INTEGER REFERENCES visits(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE visit_parts (
  id INTEGER PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits(id),
  part_id INTEGER REFERENCES parts(id),
  description TEXT,             -- for non-catalogue items
  quantity REAL NOT NULL,
  location_id INTEGER REFERENCES stock_locations(id),
  movement_id INTEGER REFERENCES stock_movements(id)
);

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL CHECK (status IN ('draft','ordered','part_received','received','cancelled')),
  deliver_to_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
  job_id INTEGER REFERENCES jobs(id),
  supplier_ref TEXT,
  expected_date TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  ordered_at TEXT
);

CREATE TABLE po_lines (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  part_id INTEGER REFERENCES parts(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  received_quantity REAL NOT NULL DEFAULT 0,
  unit_cost REAL
);

-- Parts a job needs (from an engineer "parts required" outcome, or an accepted quote).
CREATE TABLE job_parts (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  part_id INTEGER REFERENCES parts(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'needed' CHECK (status IN ('needed','ordered','available','cancelled')),
  po_line_id INTEGER REFERENCES po_lines(id),
  created_at TEXT NOT NULL
);

-- Unified activity / audit trail. Entity columns make history queries cheap.
CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  via TEXT NOT NULL DEFAULT 'ui' CHECK (via IN ('ui','ai','system')),
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  customer_id INTEGER, site_id INTEGER, job_id INTEGER, visit_id INTEGER,
  quote_id INTEGER, equipment_id INTEGER, contract_id INTEGER, po_id INTEGER,
  details TEXT
);

CREATE TABLE ai_conversations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT,
  messages TEXT NOT NULL DEFAULT '[]',   -- Anthropic MessageParam[] JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Consequential actions the assistant proposes; executed only when a user confirms.
CREATE TABLE ai_actions (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  tool TEXT NOT NULL,
  input TEXT NOT NULL,
  summary TEXT NOT NULL,
  preview TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed','executed','rejected','failed')),
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_site ON jobs(site_id);
CREATE INDEX idx_visits_engineer ON visits(engineer_id, scheduled_start);
CREATE INDEX idx_visits_job ON visits(job_id);
CREATE INDEX idx_activity_job ON activity(job_id);
CREATE INDEX idx_activity_customer ON activity(customer_id);
CREATE INDEX idx_equipment_site ON equipment(site_id);
