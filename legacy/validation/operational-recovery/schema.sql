CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY,name TEXT,role TEXT,enabled BOOL DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,domain TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grants(principal TEXT REFERENCES principals(id),source TEXT REFERENCES sources(id),PRIMARY KEY(principal,source));
CREATE TABLE IF NOT EXISTS projections(key TEXT PRIMARY KEY,status TEXT NOT NULL,manifest JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS decision_admissions(id UUID PRIMARY KEY,owner TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions(id UUID PRIMARY KEY REFERENCES decision_admissions(id),owner TEXT NOT NULL,source TEXT NOT NULL,
 record_json TEXT NOT NULL,sha256 TEXT NOT NULL,CHECK(sha256=encode(digest(record_json,'sha256'),'hex')));
REVOKE ALL ON decisions,decision_admissions FROM PUBLIC;
GRANT CONNECT ON DATABASE pilot TO decision_writer;
GRANT USAGE ON SCHEMA public TO decision_writer;
GRANT INSERT,SELECT ON decisions TO decision_writer;
GRANT INSERT,SELECT,UPDATE ON decision_admissions TO decision_writer;

CREATE TABLE IF NOT EXISTS decision_receipts(id UUID PRIMARY KEY REFERENCES decision_admissions(id),owner TEXT NOT NULL,source TEXT NOT NULL,
 record_json TEXT NOT NULL,sha256 TEXT NOT NULL,CHECK(sha256=encode(digest(record_json,'sha256'),'hex')));
REVOKE ALL ON decision_receipts FROM PUBLIC;
GRANT INSERT,SELECT ON decision_receipts TO decision_writer;

CREATE TABLE IF NOT EXISTS request_context(id UUID PRIMARY KEY REFERENCES decision_admissions(id),input_json TEXT NOT NULL,source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS request_closures(id UUID PRIMARY KEY REFERENCES decision_admissions(id),closer TEXT NOT NULL,reason TEXT NOT NULL,evidence_sha TEXT NOT NULL,closed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS request_replacements(parent UUID PRIMARY KEY REFERENCES request_closures(id),id UUID UNIQUE NOT NULL,owner TEXT NOT NULL,input_json TEXT NOT NULL,approver TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_control(id BOOL PRIMARY KEY DEFAULT TRUE CHECK(id),recovering BOOL NOT NULL);
INSERT INTO recovery_control VALUES(TRUE,FALSE) ON CONFLICT DO NOTHING;
REVOKE ALL ON request_context,request_closures,request_replacements FROM PUBLIC;
GRANT INSERT,SELECT ON request_context,request_closures,request_replacements TO decision_writer;
