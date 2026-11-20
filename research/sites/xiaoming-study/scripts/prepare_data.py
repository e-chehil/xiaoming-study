"""Build the complete, ordered Xiaoming learning data using Python's stdlib.

Original rows and IDs are retained inside a mapping/full-ASB/character/word
curriculum. Shared sound/stroke mappings precede full-ASB root tasks, and roots
needed together are ranked by weighted downstream coverage per new lesson.
Full character codes follow the current website's ASB rules; words follow the upstream script's --trailing
algorithm. A word with symbols is retained as unsupported, never normalized
into a different word. Run this script from any working directory.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import shutil
from collections import Counter
from pathlib import Path
from mapping_curriculum import build_foundations


PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parents[1]
DEFAULT_SOURCE = (
    WORKSPACE / "outputs" / "learning_order_20261021" / "完整字词学习表_单字词去重.tsv"
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def is_han(char: str) -> bool:
    n = ord(char)
    return (
        n == 0x3007
        or 0x3400 <= n <= 0x4DBF
        or 0x4E00 <= n <= 0x9FFF
        or 0xF900 <= n <= 0xFAFF
        or 0x20000 <= n <= 0x2FFFF
        or 0x30000 <= n <= 0x323AF
    )


def character_code(root_codes: list[str]) -> str:
    if len(root_codes) == 1:
        return root_codes[0]
    if len(root_codes) == 2:
        return root_codes[0][:2] + root_codes[1][:2]
    if len(root_codes) == 3:
        return root_codes[0][:2] + root_codes[1][:1] + root_codes[2][:2]
    if len(root_codes) >= 4:
        return root_codes[0][:2] + root_codes[1][:1] + root_codes[2][:1] + root_codes[-1][:1]
    raise ValueError("A character must have at least one mapped root")


def word_code(codes: list[list[str]]) -> str:
    """Equivalent to generate-xiaoming-words-dict.pl --trailing.

    Root codes have A, S, B positions. Upstream calls their first two
    positions AB; that historical B means the small code S, not position 3.
    """
    if len(codes) < 2:
        raise ValueError("A word must contain at least two characters")
    first = codes[0]
    if len(codes) == 2:
        second = codes[1]
        result = first[0][:2]
        if len(first) > 1:
            result += first[-1][:1]
        if len(second) == 1:
            result += second[0][:2]
        else:
            result += second[0][:1]
            result += second[-1][: 5 - len(result)]
        return result
    result = first[-1][:2] + codes[1][-1][:1]
    if len(codes) == 3:
        last = codes[2]
        # A single-root last character uses AS, not duplicated AA.
        return result + (last[0][:2] if len(last) == 1 else last[0][:1] + last[-1][:1])
    return result + codes[2][-1][:1] + codes[-1][-1][:1]


def display_code(item: dict) -> str:
    code = item["code"]
    if not code:
        return ""
    if item.get("answerRole"):
        roles = item["answerRole"] * len(code)
    elif item["type"] == "char":
        count = len(item["parts"][0]["division"])
        roles = {1: "asb", 2: "asas", 3: "asaas"}.get(count, "asaaa")
    else:
        counts = [len(part["division"]) for part in item["parts"]]
        if len(counts) == 2:
            roles = ("as" + ("a" if counts[0] > 1 else "") + ("aas" if counts[1] > 1 else "as"))[:5]
        elif len(counts) == 3:
            roles = "asa" + ("aa" if counts[2] > 1 else "as")
        else:
            roles = "asaaa"
    assert len(code) == len(roles)
    return "".join(letter.upper() if role == "a" else letter.lower() for letter, role in zip(code, roles))


def build(source: Path, root_dir: Path, output_dir: Path, *, strict_source=True) -> dict:
    division_path = root_dir / "chaifen.json"
    root_path = root_dir / "zigen-xiaoming.csv"
    divisions = json.loads(division_path.read_text(encoding="utf-8-sig"))
    with root_path.open(encoding="utf-8-sig", newline="") as handle:
        roots = [
            {"text": row["font"], "code": row["ma"].lower(), "pinyin": row["pinyin"]}
            for row in csv.DictReader(handle)
        ]
    # IDs depend only on the source length and original CSV row position, never
    # on the curriculum order. Existing browser progress IDs remain valid.
    root_map = {root["text"]: root["code"] for root in roots}
    assert len(root_map) == len(roots), "Duplicate root mapping"
    assert all(re.fullmatch(r"[a-z]{3}", value) for value in root_map.values())

    part_cache: dict[str, dict] = {}

    def part(char: str) -> dict:
        if char not in part_cache:
            division = list(divisions.get(char, {}).get("d", ""))
            mapped = [root_map.get(root, "") for root in division]
            part_cache[char] = {
                "char": char,
                "division": division,
                "rootCodes": mapped,
                "code": character_code(mapped) if division and all(mapped) else "",
            }
        return part_cache[char]

    def encode(text: str) -> str:
        parts = [part(char) for char in text]
        assert all(item["code"] for item in parts), text
        return parts[0]["code"] if len(parts) == 1 else word_code([item["rootCodes"] for item in parts])

    examples = {
        "一人": "hdvj",
        "中國": "aktsh",
        "新中國": "qktsh",
        "哭哭啼啼": "ajavv",
        "好": "ckgi",
        "做": "wjnqj",
        "靈": "qdaav",
    }
    for text, expected in examples.items():
        actual = encode(text)
        assert actual == expected, (text, actual, expected)
    # Explicit regression checks for the upstream 3-character single-root rule.
    assert encode("中國人").endswith("vj")
    assert encode("中國一").endswith("hd")

    with source.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))
    by_id = {int(row["学习序号"]): row for row in rows}
    assert len(by_id) == len(rows), "Learning IDs are not unique"
    assert list(by_id) == list(range(1, len(rows) + 1)), "Learning IDs must preserve exact source order"
    characters = {row["字词"]: int(row["学习序号"]) for row in rows if len(row["字词"]) == 1}
    assert len(characters) == sum(len(row["字词"]) == 1 for row in rows), "Duplicate character rows"

    items = []
    unsupported = []
    reason_counts: Counter = Counter()
    frequency_merged = 0
    for row in rows:
        item_id = int(row["学习序号"])
        text = row["字词"]
        assert text, item_id
        dependencies = [int(value) for value in row["前置汉字学习序号"].split()]
        component_chars = row["组成汉字"].split()
        assert len(component_chars) == len(dependencies), (item_id, "Prerequisite column mismatch")
        assert len(set(dependencies)) == len(dependencies), (item_id, "Duplicate prerequisite")
        for component, dependency in zip(component_chars, dependencies):
            assert dependency < item_id, (item_id, "Prerequisite is not earlier", dependency)
            assert dependency in by_id, (item_id, "Missing prerequisite", dependency)
            assert by_id[dependency]["字词"] == component and len(component) == 1, (item_id, component, dependency)
        if len(text) > 1:
            expected_chars = list(dict.fromkeys(char for char in text if is_han(char)))
            assert component_chars == expected_chars, (item_id, component_chars, expected_chars)
        else:
            assert not dependencies, (item_id, "Single character unexpectedly has prerequisites")

        parts = [part(char) for char in text]
        reasons = []
        symbols = list(dict.fromkeys(char for char in text if not is_han(char)))
        missing = list(dict.fromkeys(item["char"] for item in parts if is_han(item["char"]) and not item["division"]))
        missing_roots = list(dict.fromkeys(
            root for item in parts for root, code in zip(item["division"], item["rootCodes"]) if not code
        ))
        if symbols:
            reasons.append("含非汉字字符（" + "、".join(symbols) + "），不符合上游纯汉字词编码规则")
            reason_counts["nonHanSymbols"] += 1
        if missing:
            reasons.append("缺少汉字拆分：" + "、".join(missing))
            reason_counts["missingDivision"] += 1
        if missing_roots:
            reasons.append("缺少字根编码：" + "、".join(missing_roots))
            reason_counts["missingRootCode"] += 1

        frequency_source = row["原词频序号"].strip()
        frequency_values = [int(value.strip()) for value in frequency_source.split("/")] if frequency_source else []
        item = {
            "id": item_id,
            "text": text,
            "pinyin": row["拼音"],
            "type": "char" if len(text) == 1 else "word",
            "sourceType": row["类型"],
            "frequency": min(frequency_values) if frequency_values else None,
            "dependencies": dependencies,
            "sourceDependencies": dependencies.copy(),
            "sourceId": item_id,
            "code": None if reasons else encode(text),
            "parts": parts,
        }
        if len(frequency_values) > 1:
            item["sourceFrequency"] = frequency_source
            frequency_merged += 1
        if reasons:
            item["unsupportedReason"] = "；".join(reasons)
            unsupported.append({"id": item_id, "text": text, "reason": item["unsupportedReason"]})
        else:
            assert re.fullmatch(r"[a-z]{3,5}" if item["type"] == "char" else r"[a-z]{4,5}", item["code"]), (item_id, item["code"])
        items.append(item)

    source_total = len(items)
    source_items = items
    root_ids = {root["text"]: source_total + index + 1 for index, root in enumerate(roots)}
    root_uses: dict[str, list[int]] = {root["text"]: [] for root in roots}
    root_characters: dict[str, list[int]] = {root["text"]: [] for root in roots}
    first_need: dict[str, int] = {}
    for item in source_items:
        covered_roots = list(dict.fromkeys(
            root for component in item["parts"] for root in component["division"]
        ))
        item["rootCoverage"] = [root_ids[root] for root in covered_roots]
        for root in covered_roots:
            root_uses[root].append(item["id"])
            if item["type"] == "char":
                root_characters[root].append(item["id"])
                first_need.setdefault(root, item["id"])
        if item["type"] == "char":
            item["dependencies"] = item["rootCoverage"].copy()
    coverage_score = {
        root: math.fsum(1 / math.log2(item_id + 2) for item_id in item_ids)
        for root, item_ids in root_uses.items()
    }
    foundations, root_facts = build_foundations(roots, root_ids, root_uses, first_need, source_total)
    root_items: dict[str, dict] = {}
    for root in roots:
        text = root["text"]
        root_id = root_ids[text]
        root["id"] = root_id
        root_items[text] = {
            "id": root_id,
            "text": text,
            "pinyin": root["pinyin"],
            "type": "root",
            "sourceType": "字根",
            "frequency": None,
            "sourceId": None,
            "sourceDependencies": [],
            "dependencies": root_facts[text]["dependencies"],
            "rootCoverage": [root_id],
            "code": root["code"],
            "fullCode": root["code"],
            "mapping": {key: value for key, value in root_facts[text].items() if key != "dependencies"},
            "parts": [{"char": text, "division": [text], "rootCodes": [root["code"]], "code": root["code"]}],
            "coverageCount": len(root_uses[text]),
            "characterCoverage": len(root_characters[text]),
            "coverageScore": coverage_score[text],
            "firstNeededSourceId": first_need.get(text),
        }

    # Shared mapping lessons are inserted once, immediately before the roots
    # which need them. Stable IDs remain independent from course positions.
    introduced: set[int] = set()
    ordered_items: list[dict] = []

    def missing_foundations(root):
        missing = set()
        def visit(item_id):
            if item_id in introduced or item_id in missing:
                return
            missing.add(item_id)
            for dependency in foundations[item_id]["dependencies"]:
                visit(dependency)
        for dependency in root_items[root]["dependencies"]:
            visit(dependency)
        return len(missing)

    def introduce_foundation(item_id):
        if item_id in introduced:
            return
        lesson = foundations[item_id]
        for dependency in lesson["dependencies"]:
            introduce_foundation(dependency)
        ordered_items.append(lesson)
        introduced.add(item_id)

    def introduce_root(root):
        for dependency in sorted(root_items[root]["dependencies"], key=lambda item_id: (
            -foundations[item_id]["coverageScore"], foundations[item_id]["type"], item_id
        )):
            introduce_foundation(dependency)
        ordered_items.append(root_items[root])
        introduced.add(root_ids[root])

    for item in source_items:
        if item["type"] == "char":
            required = [
                root for root in item["parts"][0]["division"]
                if root_ids[root] not in introduced
            ]
            required = set(required)
            while required:
                root = min(required, key=lambda root: (
                    -coverage_score[root] / (1 + missing_foundations(root)), first_need[root], root
                ))
                introduce_root(root)
                required.remove(root)
        ordered_items.append(item)
    extensions = sorted(
        (root for root in roots if root["id"] not in introduced),
        key=lambda root: (root["code"], root["text"]),
    )
    extension_rationale = "源字词表未使用这些字根；保留为完整字根表扩展，在全部原字词之后学习，避免打断常用字词进度。"
    used_root_count = sum(root_id in introduced for root_id in root_ids.values())
    for root in extensions:
        item = root_items[root["text"]]
        assert not root_uses[root["text"]], (root["text"], "A used root has no preceding character")
        item["extension"] = True
        introduce_root(root["text"])
    items = ordered_items
    for order, item in enumerate(items, 1):
        item["order"] = order

    # Validate graph order by curriculum positions, not by numeric IDs: root
    # IDs intentionally follow all original IDs to preserve saved progress.
    positions = {item["id"]: item["order"] for item in items}
    assert len(positions) == source_total + len(roots) + len(foundations), "Duplicate or dropped IDs"
    assert [item["id"] for item in items if item["sourceId"] is not None] == list(range(1, source_total + 1)), "Original source order changed"
    assert {item["id"] for item in items if item["type"] == "root"} == set(root_ids.values()), "Root coverage is not exactly once"
    for item in items:
        for dependency in item["dependencies"]:
            assert positions[dependency] < item["order"], (item["id"], "Prerequisite is not earlier in course", dependency)
            if item["type"] == "char":
                assert dependency in root_ids.values(), (item["id"], "Character prerequisite is not a root")
            if item["type"] == "word":
                assert by_id[dependency]["字词"] in characters, (item["id"], "Word prerequisite is not a character")
    if strict_source:
        assert used_root_count == 340
    stats = {
        "total": len(items),
        "roots": len(roots),
        "characters": sum(item["type"] == "char" for item in items),
        "words": sum(item["type"] == "word" for item in items),
        "unsupported": len(unsupported),
        "initials": 21,
        "strokes": 6,
    }
    if strict_source:
        assert stats == {"total": 59192, "roots": 397, "characters": 5069, "words": 53699, "unsupported": 22, "initials": 21, "strokes": 6}, stats
        assert len(extensions) == 57
    assert len(foundations) == 27
    source_info = {"name": source.name, "sha256": sha256(source)}
    curriculum_version = "sound-stroke-fullASB-char-word-v5"
    curriculum = {
        "algorithm": "just-in-time-topological-insertion",
        "ranking": "root downstream weighted coverage / (1 + number of still-missing shared mapping lessons), descending; then earliest character need and Unicode. Shared mapping lessons are inserted once before their first needed root.",
        "sourceOrderPolicy": "所有原字词的 ID 和相对学习顺序完整保留；字根仅在首次需要它的汉字之前插入。字根与同形汉字保留不同学习项目。",
        "rootIdPolicy": "sourceTotal + 1 + zero-based root CSV index",
        "usedRoots": used_root_count,
        "foundationLessons": 27,
        "extensionRoots": len(extensions),
        "extensionRootIds": [root["id"] for root in extensions],
        "extensionRationale": extension_rationale,
        "table": "声母首笔字根字词学习表.tsv",
        "tableColumns": {
            "order": f"课程实际位置（连续 1..{len(items)}）",
            "ID": f"稳定学习标识；原项目 1..{source_total}，字根随后按官方 CSV 原序编号，映射基础最后编号",
            "sourceId": "原表学习序号；新增字根为空",
            "dependencies IDs": "直接前置学习项目 ID，空格分隔",
            "root coverage": "本项目涉及的全部去重字根 ID，空格分隔；字根项目指向自身",
            "kind": "字根为 core/extension；原字词保留原类型",
            "code": "比较与输入用的小写编码；字根使用完整三位 ASB",
            "displayCode": "按 A 大写、S/B 小写显示的本项答案",
            "fullCode": "字根官方完整 ASB 的小写编码",
            "fullDisplayCode": "字根官方完整 ASB 的角色大小写显示",
        },
    }
    dataset = {
        "version": 3, "curriculumVersion": curriculum_version, "sourceTotal": source_total,
        "source": source_info, "stats": stats, "curriculum": curriculum,
        # Full coverage remains in the downloadable TSV. Avoid duplicating
        # derived graphs and original dependencies for every runtime word.
        "roots": roots, "items": [
            {key: value for key, value in item.items()
             if key not in ("sourceDependencies", "rootCoverage")}
            for item in items
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    from prepare_lessons import enrich_lessons
    enrich_lessons(dataset, divisions)
    write_json(output_dir / "learning.json", dataset)
    with (output_dir / "coverage.tsv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["课程顺序", "学习ID", "原学习序号", "类型", "字词", "编码", "状态", "原因"])
        for item in items:
            writer.writerow([item["order"], item["id"], item["sourceId"] or "", item["sourceType"], item["text"], item["code"] or "", "未编码" if item["code"] is None else "已编码", item.get("unsupportedReason", "")])
    table_path = output_dir / curriculum["table"]
    with table_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["order", "ID", "sourceId", "type", "text", "pinyin", "code", "displayCode", "fullCode", "fullDisplayCode", "dependencies IDs", "root coverage", "kind"])
        for item in items:
            writer.writerow([
                item["order"], item["id"], item["sourceId"] or "", item["type"], item["text"],
                item["pinyin"], item["code"] or "", display_code(item), item.get("fullCode", ""),
                (item["fullCode"][0].upper() + item["fullCode"][1:]) if item.get("fullCode") else "",
                " ".join(map(str, item["dependencies"])),
                " ".join(map(str, item["rootCoverage"])),
                "extension" if item.get("extension") else "core" if item["type"] == "root" else item["sourceType"],
            ])
    original_copy = output_dir / source.name
    if original_copy.resolve() != source.resolve():
        shutil.copyfile(source, original_copy)
    assert sha256(original_copy) == source_info["sha256"], "Source download was modified"

    metadata = {
        "version": 3,
        "curriculumVersion": curriculum_version,
        "sourceTotal": source_total,
        "curriculum": curriculum,
        "source": source_info,
        "stats": stats,
        "supported": stats["total"] - stats["unsupported"],
        "rootCount": len(roots),
        "reasonCounts": dict(reason_counts),
        "unsupportedItems": unsupported,
        "mergedFrequencyRows": frequency_merged,
        "frequencyPolicy": "多个原词频序号取最小值；sourceFrequency 保留原值，原字词相对学习顺序不变。",
        "ordering": "声母/首笔映射→完整字根 ASB→汉字→词语；无读音规则并入字根初识。",
        "downloads": {
            "curriculum": {"name": table_path.name, "sha256": sha256(table_path), "encoding": "UTF-8 BOM", "rows": len(items)},
            "original": {"name": original_copy.name, "sha256": sha256(original_copy), "rows": source_total},
        },
        "codeRules": {
            "initial": "21 项声母映射以注音符号显示；ㄗ/ㄓ、ㄘ/ㄔ、ㄙ/ㄕ合组，y 类显示为ㄧ/ㄩ、w 类显示为ㄨ，编码仍依官方拼音首字母规则。",
            "stroke": "横k、竖i、撇j、点f、逆时针折e、顺时针折d；类别由官方完整码第三位确定。",
            "silent": "官方 CSV 未注音的根，小码取补码；不按通用字典擅自补音，也不以 S==B 反推无音。",
            "root": "掌握对应声母与首笔映射后，输入完整 ASB；同形同码汉字与字根共用练习，原 ID 和字词顺序保留。",
            "character": "ASB；ASAS；ASAAS；ASAAA（首、次、三、末根）",
            "word": "采用上游 --trailing：二字首末／首末根；三字末／末／首末根；四字以上末／末／末／末根。三字词末字为单根时取 AS。",
            "unsupported": "含标点、字母、符号的项目保留原文及可拆分汉字，不删除符号推测编码；code 为 null。",
        },
        "examples": examples,
        "sources": [
            {"title": "潇明输入法官网", "url": "https://shurufa.app/ime/xiaoming"},
            {"title": "上游方案固定版本", "url": "https://github.com/Dieken/code_genie/tree/55e783c3973b125d3f56baac534b796c76df87a5/moling/xiaoming-output/output-20261011-061440/thread-06"},
        ],
        "inputs": {
            "chaifen.json": sha256(division_path),
            "zigen-xiaoming.csv": sha256(root_path),
            "generate-xiaoming-words-dict.pl": sha256(root_dir / "upstream" / "generate-xiaoming-words-dict.pl"),
        },
        "licenseNotes": "官网页脚标示 CC BY-NC-ND 4.0；上游仓库 LICENSE 为 MIT。字根字体保留官网原文件。",
        "learningBytes": (output_dir / "learning.json").stat().st_size,
        "learningSha256": sha256(output_dir / "learning.json"),
    }
    write_json(output_dir / "metadata.json", metadata)
    # The website's existing font is a separate asset; generating curriculum
    # files must not rewrite unrelated application assets.
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--roots", type=Path, default=WORKSPACE / "潇明码表")
    parser.add_argument("--output", type=Path, default=PROJECT / "dist" / "data")
    args = parser.parse_args()
    result = build(args.source, args.roots, args.output)
    print(json.dumps({"stats": result["stats"], "learningBytes": result["learningBytes"], "learningSha256": result["learningSha256"], "reasonCounts": result["reasonCounts"], "unsupportedItems": result["unsupportedItems"]}, ensure_ascii=False, indent=2))
    if args.output.resolve() == (PROJECT / 'dist/data').resolve():
        from build_curricula import build_and_validate
        build_and_validate('simplified')
