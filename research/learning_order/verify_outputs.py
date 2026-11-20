"""Independently verify saved TSV and XLSX outputs against the unchanged source."""
import collections
import csv
import json
import math
from pathlib import Path
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "outputs" / "learning_order_20261021"

def han(c):
    return c == "〇" or unicodedata.name(c, "").startswith(("CJK UNIFIED IDEOGRAPH", "CJK COMPATIBILITY IDEOGRAPH"))

def read(p):
    with p.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))

original = read(ROOT / "现代汉语常用词表.tsv")
rows = read(OUT / "完整字词学习表.tsv")
seen, steps, recovered = {}, {}, {}
for number, row in enumerate(rows, 1):
    assert int(row["学习序号"]) == number
    if row["类型"] == "汉字":
        char = row["字词"]
        assert len(char) == 1 and han(char) and char not in seen
        seen[char] = number
        steps[char] = len(seen)
        assert int(row["已学汉字数"]) == len(seen)
    else:
        assert row["类型"] == "词语"
        deps = list(dict.fromkeys(c for c in row["字词"] if han(c)))
        assert deps and all(c in seen and seen[c] < number for c in deps)
        assert row["组成汉字"].split() == deps
        assert list(map(int, row["前置汉字学习序号"].split())) == [seen[c] for c in deps]
        assert max(steps[c] for c in deps) <= len(seen)
        assert int(row["已学汉字数"]) == len(seen)
        rank = int(row["原词频序号"])
        assert rank not in recovered
        recovered[rank] = (row["字词"], row["拼音"])
assert recovered == {int(r["频序号"]): (r["词语"], r["拼音"]) for r in original}
assert set(seen) == {c for r in original for c in r["词语"] if han(c)}
for stage in read(OUT / "分阶段覆盖.tsv"):
    k = int(stage["学习总步数"])
    eligible = [r for r in rows[:k] if r["类型"] == "词语"]
    assert len(eligible) == int(stage["已学词条数"])
    assert k - len(eligible) == int(stage["已学汉字数"])
    for n in [100, 500, 1000, 3000, 5000, 10000]:
        assert sum(int(r["原词频序号"]) <= n for r in eligible) == int(stage[f"前{n}词已学数"])
report = json.loads((OUT / "校验与评估.json").read_text("utf-8"))
exponent = report["权重指数"]
total_weight = math.fsum(int(r["频序号"]) ** -exponent for r in original)
actual_objective = math.fsum(int(r["学习序号"]) * int(r["原词频序号"]) ** -exponent for r in rows if r["类型"] == "词语") / total_weight
assert abs(actual_objective - report["最终方案"]["加权平均词语出现步数"]) < 1e-8

# Verify all exported Excel detail cells, plus its filtering and freeze panes.
xlsx = OUT / "汉语字词学习表.xlsx"
assert xlsx.exists(), f"未找到 Excel 导出文件：{xlsx}"
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(xlsx) as z:
    assert z.testzip() is None
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = ["".join(si.itertext()) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
    def cell_value(cell):
        if cell.get("t") == "inlineStr":
            return "".join(cell.find("s:is", ns).itertext())
        v = cell.find("s:v", ns)
        if v is None:
            return ""
        if cell.get("t") == "s":
            return shared[int(v.text)]
        return v.text or ""
    root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    actual_rows = root.findall("s:sheetData/s:row", ns)
    detail = [r for r in actual_rows if 8 <= int(r.get("r")) <= 7 + len(rows)]
    assert len(detail) == len(rows)
    fields = list(rows[0])
    for xml_row, source_row in zip(detail, rows):
        values = {"".join(c for c in cell.get("r") if c.isalpha()): cell_value(cell) for cell in xml_row}
        for i, field in enumerate(fields):
            assert values.get(chr(65+i), "") == source_row[field], (xml_row.get("r"), field)
    panes = root.find("s:sheetViews/s:sheetView/s:pane", ns)
    assert panes is not None and panes.get("state") == "frozen"
    assert root.find("s:tableParts", ns) is not None
    table = ET.fromstring(z.read("xl/tables/table1.xml"))
    assert table.find("s:autoFilter", ns) is not None
    assert not root.findall(".//s:c[@t='e']", ns)

result = {"原词条逐项一致": len(recovered), "完整学习项": len(rows), "汉字前置校验": len(seen),
          "阶段覆盖独立复算": "通过", "Excel全部明细单元格对照TSV": "通过", "Excel筛选与冻结窗格": "通过"}
(OUT / "独立文件校验.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
