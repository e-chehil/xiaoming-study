"""Read the user's NAER workbooks without modifying them (stdlib only)."""
from pathlib import Path
from zipfile import ZipFile
from collections import Counter
import xml.etree.ElementTree as ET
import json
import re

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def xlsx_rows(path):
    with ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            for _, element in ET.iterparse(archive.open('xl/sharedStrings.xml'), events=('end',)):
                if element.tag.endswith('}si'):
                    strings.append(''.join(t.text or '' for t in element.iter() if t.tag.endswith('}t')))
                    element.clear()
        sheet = next(n for n in archive.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))
        for _, element in ET.iterparse(archive.open(sheet), events=('end',)):
            if not element.tag.endswith('}row'):
                continue
            row = {}
            for cell in element:
                value = cell.find('m:v', NS)
                text = value.text if value is not None else ''
                if cell.get('t') == 's':
                    text = strings[int(text)]
                elif cell.get('t') == 'inlineStr':
                    text = ''.join(t.text or '' for t in cell.iter() if t.tag.endswith('}t'))
                row[re.sub(r'\d+', '', cell.get('r'))] = text or ''
            yield row
            element.clear()


def read_sources(directory):
    vocabulary = list(xlsx_rows(directory / '14452詞語表202504.xlsx'))[1:]
    frequency = list(xlsx_rows(directory / '通用詞頻表 - 定稿1141208.xlsx'))[1:]
    return vocabulary, frequency


if __name__ == '__main__':
    workspace = Path(__file__).resolve().parents[3]
    vocabulary, frequency = read_sources(workspace / '詞語表、通用詞頻表')
    cache = Path(__file__).resolve().parents[1] / '.local' / 'traditional-sources.json'
    cache.write_text(json.dumps({'vocabulary': vocabulary, 'frequency': frequency}, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({
        'vocabularyRows': len(vocabulary), 'frequencyRows': len(frequency),
        'vocabularyLevels': dict(Counter(r['D'] for r in vocabulary)),
        'frequencyDuplicateWords': len(frequency)-len(set(r['B'] for r in frequency)),
        'vocabularyExamples': [r for r in vocabulary if any(c in r['B'] for c in '/0123456789（）()')][:20],
        'vocabularyMissingReading': [r for r in vocabulary if not r.get('I') or not r.get('J')][:12],
        'frequencyTail': frequency[-5:],
    }, ensure_ascii=False, indent=2))
