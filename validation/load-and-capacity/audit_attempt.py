"""Check retained reservation state of the cancelled setup attempt, without reading secrets."""
import json,sqlite3
from pathlib import Path
def main():
    root=Path(__file__).parent;state=min((root/'.state').iterdir(),key=lambda p:p.stat().st_ctime);db=state/'retained-authority.sqlite'
    row={'installation':state.name,'authority_database_exists':db.exists(),'model_reservations':0}
    if db.exists():
        with sqlite3.connect(db.resolve().as_uri()+'?mode=ro',uri=True) as conn:
            row['model_reservations']=conn.execute("SELECT count(*) FROM reservations WHERE scope='model'").fetchone()[0]
    (root/'evidence/attempt-setup/reservation-check.json').write_text(json.dumps(row,indent=2),encoding='utf-8');print(json.dumps(row))
if __name__=='__main__':main()
