"""Create a new TSV merging each single-character word into its character row."""
import collections
import csv
import hashlib
import json
from pathlib import Path

from build_learning_order import unique_han

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'outputs' / 'learning_order_20261021'
SOURCE = OUT / '完整字词学习表.tsv'
TARGET = OUT / '完整字词学习表_单字词去重.tsv'
SEP = ' / '


def read_tsv(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f, delimiter='\t')
        return reader.fieldnames, list(reader)


before_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
columns, old_rows = read_tsv(SOURCE)
singles = collections.defaultdict(list)
for row in old_rows:
    if row['类型'] == '词语' and len(row['字词']) == 1:
        assert unique_han(row['字词']) == (row['字词'],)
        assert SEP not in row['拼音']
        singles[row['字词']].append(row)
for group in singles.values():
    group.sort(key=lambda row: int(row['原词频序号']))

rows, old_to_new = [], {}
for old in old_rows:
    if old['类型'] == '词语' and len(old['字词']) == 1:
        continue
    row = old.copy()
    row['学习序号'] = str(len(rows) + 1)
    old_to_new[old['学习序号']] = row['学习序号']
    if old['类型'] == '汉字' and old['字词'] in singles:
        group = singles[old['字词']]
        row['类型'] = '汉字兼单字词'
        # Lists in these two columns correspond position by position, preserving
        # every original homograph / reading without repeated learning rows.
        row['拼音'] = SEP.join(r['拼音'] for r in group)
        row['原词频序号'] = SEP.join(r['原词频序号'] for r in group)
    rows.append(row)
for row in rows:
    if row['前置汉字学习序号']:
        row['前置汉字学习序号'] = ' '.join(old_to_new[n] for n in row['前置汉字学习序号'].split())

removed = sum(map(len, singles.values()))
assert len(rows) == len(old_rows) - removed
with TARGET.open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, columns, delimiter='\t', lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)

# Verify the saved file, all prerequisite references, and all source records.
saved_columns, saved_rows = read_tsv(TARGET)
assert saved_columns == columns and saved_rows == rows
seen, recovered = {}, {}
for n, row in enumerate(saved_rows, 1):
    assert int(row['学习序号']) == n
    if row['类型'] in ('汉字', '汉字兼单字词'):
        assert row['字词'] not in seen
        seen[row['字词']] = n
        assert not row['组成汉字'] and not row['前置汉字学习序号']
        if row['类型'] == '汉字兼单字词':
            ranks, readings = row['原词频序号'].split(SEP), row['拼音'].split(SEP)
            assert len(ranks) == len(readings)
            for rank, reading in zip(ranks, readings):
                assert rank not in recovered
                recovered[rank] = (row['字词'], reading)
    else:
        assert row['类型'] == '词语' and len(row['字词']) > 1
        deps = unique_han(row['字词'])
        assert all(c in seen and seen[c] < n for c in deps)
        assert row['组成汉字'].split() == list(deps)
        assert [int(x) for x in row['前置汉字学习序号'].split()] == [seen[c] for c in deps]
        assert row['原词频序号'] not in recovered
        recovered[row['原词频序号']] = (row['字词'], row['拼音'])
    assert int(row['已学汉字数']) == len(seen)
_, original = read_tsv(ROOT / '现代汉语常用词表.tsv')
assert recovered == {r['频序号']: (r['词语'], r['拼音']) for r in original}
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == before_hash

print(json.dumps({'output': str(TARGET), '原学习项': len(old_rows), '合并单字词记录': removed,
                  '涉及汉字数': len(singles), '新学习项': len(saved_rows), '汉字数': len(seen),
                  '原词条完整保留': len(recovered), '前置汉字及重新编号校验': '通过',
                  '示例': [row for row in saved_rows if row['字词'] in ('的','和','我们')]},
                 ensure_ascii=False, indent=2))
