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
