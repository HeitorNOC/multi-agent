
CREATE EXTENSION pgcrypto;
CREATE ROLE corpus_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE reader_sales LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE reader_finance LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE ingestion LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE TABLE source_versions(source_id TEXT,version INTEGER CHECK(version>0),content TEXT NOT NULL,hash BYTEA NOT NULL,
 valid_from TIMESTAMPTZ NOT NULL,valid_to TIMESTAMPTZ,CHECK(valid_to IS NULL OR valid_to>valid_from),
 CHECK(hash=digest(content,'sha256')),PRIMARY KEY(source_id,version));
ALTER TABLE source_versions OWNER TO corpus_owner;
CREATE TABLE doc_acl(source_id TEXT,principal NAME,PRIMARY KEY(source_id,principal));
CREATE TABLE facts(id TEXT PRIMARY KEY,value TEXT);
CREATE TABLE fact_sources(fact TEXT REFERENCES facts(id),source_id TEXT,version INTEGER,
 FOREIGN KEY(source_id,version) REFERENCES source_versions(source_id,version),PRIMARY KEY(fact,source_id,version));
INSERT INTO source_versions VALUES('public',1,'Revenue 100',digest('Revenue 100','sha256'),'2026-01-01',NULL),
 ('finance',1,'SECRET_FINANCE',digest('SECRET_FINANCE','sha256'),'2026-01-01',NULL);
INSERT INTO doc_acl VALUES('public','reader_sales'),('public','reader_finance'),('finance','reader_finance');
INSERT INTO facts VALUES('derived','Joint public/private conclusion');
INSERT INTO fact_sources VALUES('derived','public',1),('derived','finance',1);
GRANT SELECT ON source_versions,doc_acl,facts,fact_sources TO reader_sales,reader_finance;
GRANT SELECT ON doc_acl TO corpus_owner;
GRANT INSERT ON source_versions TO ingestion;
ALTER TABLE source_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_acl ON source_versions USING(EXISTS(SELECT 1 FROM doc_acl a WHERE a.source_id=source_versions.source_id AND a.principal=current_user));
ALTER TABLE facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE facts FORCE ROW LEVEL SECURITY;
CREATE POLICY fact_acl ON facts USING(EXISTS(SELECT 1 FROM fact_sources s WHERE s.fact=facts.id) AND NOT EXISTS(
 SELECT 1 FROM fact_sources s WHERE s.fact=facts.id AND NOT EXISTS(SELECT 1 FROM doc_acl a WHERE a.source_id=s.source_id AND a.principal=current_user)));
CREATE TABLE budget(id TEXT PRIMARY KEY,budget INTEGER,spent INTEGER DEFAULT 0,held INTEGER DEFAULT 0,CHECK(spent>=0 AND held>=0 AND spent+held<=budget));
INSERT INTO budget VALUES('period-A',6,0,0);
CREATE TABLE active_snapshot(singleton BOOLEAN PRIMARY KEY CHECK(singleton),snapshot TEXT NOT NULL);
CREATE TABLE snapshots(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
CREATE TABLE parts(snapshot TEXT REFERENCES snapshots(id),kind TEXT CHECK(kind IN ('graph','vector','chunks')),ready BOOLEAN,digest BYTEA CHECK(octet_length(digest)=32),PRIMARY KEY(snapshot,kind));
CREATE FUNCTION publish_snapshot(s TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT count(*) FROM parts WHERE snapshot=s AND ready AND digest IS NOT NULL)<>3 THEN RAISE EXCEPTION 'Incomplete index generation';END IF;
 INSERT INTO active_snapshot VALUES(TRUE,s) ON CONFLICT(singleton) DO UPDATE SET snapshot=excluded.snapshot;
END$$;
INSERT INTO snapshots VALUES('g1',1),('g2',2);
INSERT INTO parts VALUES('g1','graph',TRUE,digest('g1graph','sha256')),('g1','vector',TRUE,digest('g1vector','sha256')),('g1','chunks',TRUE,digest('g1chunks','sha256'));
SELECT publish_snapshot('g1');
