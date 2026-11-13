CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS control(singleton BOOL PRIMARY KEY CHECK(singleton),active TEXT,epoch INTEGER NOT NULL DEFAULT 1,recovering BOOL DEFAULT FALSE);
INSERT INTO control(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,role TEXT NOT NULL,enabled BOOL NOT NULL DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,domain TEXT NOT NULL CHECK(domain IN ('publico','financeiro')));
CREATE TABLE IF NOT EXISTS versions(source TEXT REFERENCES sources(id),version INTEGER CHECK(version>0),content TEXT NOT NULL,sha TEXT NOT NULL,
 authority TEXT NOT NULL,CHECK(sha=encode(digest(content,'sha256'),'hex')),PRIMARY KEY(source,version));
CREATE TABLE IF NOT EXISTS grants(principal TEXT REFERENCES principals(id),source TEXT REFERENCES sources(id),PRIMARY KEY(principal,source));
CREATE TABLE IF NOT EXISTS generations(id TEXT PRIMARY KEY,status TEXT NOT NULL,manifest TEXT NOT NULL,created TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS generation_sources(generation TEXT REFERENCES generations(id),source TEXT,version INTEGER,PRIMARY KEY(generation,source),FOREIGN KEY(source,version) REFERENCES versions(source,version));
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,owner TEXT REFERENCES principals(id),worker TEXT REFERENCES principals(id),intent TEXT NOT NULL,
 generation TEXT REFERENCES generations(id),domains JSONB NOT NULL,state TEXT NOT NULL,plan TEXT,plan_epoch INTEGER,approval TEXT,
 actual INTEGER DEFAULT 0,held INTEGER DEFAULT 0,result JSONB,created TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS account(singleton BOOL PRIMARY KEY CHECK(singleton),limit_units INTEGER NOT NULL,spent INTEGER DEFAULT 0,held INTEGER DEFAULT 0,CHECK(spent>=0 AND held>=0));
INSERT INTO account VALUES(TRUE,100,0,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS charges(run TEXT REFERENCES runs(id),operation TEXT,units INTEGER,PRIMARY KEY(run,operation));
CREATE TABLE IF NOT EXISTS findings(run TEXT REFERENCES runs(id),node TEXT,payload JSONB NOT NULL,PRIMARY KEY(run,node));
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,run TEXT REFERENCES runs(id),payload JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS audit(seq BIGSERIAL PRIMARY KEY,run TEXT,event TEXT NOT NULL,payload JSONB,created TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS replayed_security_events(id TEXT PRIMARY KEY);
