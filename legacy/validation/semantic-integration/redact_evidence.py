"""Remove expired fixture credentials from pytest diagnostics before packaging."""
import re
from pathlib import Path

if __name__=='__main__':
    base=Path(__file__).resolve().parent/'evidence'
    count=0
    for path in base.rglob('*'):
        if path.is_file() and path.suffix in ('.log','.xml'):
            text=path.read_text(encoding='utf-8')
            updated,n=re.subn(r'\b[a-f0-9]{48}\b','[ephemeral-test-credential-redacted]',text)
            if n:path.write_text(updated,encoding='utf-8');count+=n
    print('Redacted diagnostic occurrences:',count)
