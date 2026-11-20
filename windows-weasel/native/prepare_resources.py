"""Use Windows SDK resources instead of requiring the optional MFC package."""
from pathlib import Path
import sys
source=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).parent/'build/weasel-0.17.4'
for project in ('WeaselServer','WeaselTSF'):
    path=source/project/(project+'.rc')
    raw=path.read_bytes()
    text=raw.decode('utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig')
    text=text.replace('#include "afxres.h"','#include <winresrc.h>\n#ifndef IDC_STATIC\n#define IDC_STATIC -1\n#endif')
    path.write_text(text,encoding='utf8')
