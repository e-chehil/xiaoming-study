"""Audited Xiaoming sound/stroke foundations, using the official CSV readings."""
from __future__ import annotations

import math
import unicodedata

INITIAL_KEYS = {
    "0": "d", "h": "d", "y": "d", "b": "e", "s": "e", "w": "e",
    "d": "f", "g": "f", "t": "f", "f": "i", "m": "i", "z": "i",
    "l": "j", "p": "j", "q": "j", "r": "j", "x": "j",
    "c": "k", "j": "k", "k": "k", "n": "k",
}
STROKES = {"k": "横", "i": "竖", "j": "撇", "f": "点", "e": "逆时针折", "d": "顺时针折"}
ALIASES = {"c": ["c", "ch"], "s": ["s", "sh"], "z": ["z", "zh"], "0": ["a", "e", "o"]}
INITIAL_SYMBOLS = {
    "0": ["○"], "b": ["ㄅ"], "p": ["ㄆ"], "m": ["ㄇ"], "f": ["ㄈ"],
    "d": ["ㄉ"], "t": ["ㄊ"], "n": ["ㄋ"], "l": ["ㄌ"], "g": ["ㄍ"],
    "k": ["ㄎ"], "h": ["ㄏ"], "j": ["ㄐ"], "q": ["ㄑ"], "x": ["ㄒ"],
    "z": ["ㄗ", "ㄓ"], "c": ["ㄘ", "ㄔ"], "s": ["ㄙ", "ㄕ"], "r": ["ㄖ"],
    # These are the scheme's spelling classes, not additional consonants.
    "y": ["ㄧ", "ㄩ"], "w": ["ㄨ"],
}
STROKE_GLYPHS = {"k": "㇐", "i": "㇑", "j": "㇒", "f": "㇔", "e": "㇜", "d": "㇕"}


def initial_of(pinyin: str) -> str | None:
    if not pinyin.strip():
        return None
    plain = "".join(char for char in unicodedata.normalize("NFD", pinyin.lower()) if not unicodedata.combining(char))
    return "0" if plain[0] in "aeouiv" else plain[0]


def build_foundations(roots, root_ids, root_uses, first_need, source_total):
    initial_ids = {token: source_total + len(roots) + i + 1 for i, token in enumerate(sorted(INITIAL_KEYS))}
    stroke_ids = {key: source_total + len(roots) + len(initial_ids) + i + 1 for i, key in enumerate(STROKES)}
    facts = {}
    for root in roots:
        code, pinyin = root["code"], root["pinyin"]
        initial = initial_of(pinyin)
        assert code[2] in STROKES, root
        assert code[1] == (INITIAL_KEYS[initial] if initial is not None else code[2]), root
        facts[root["text"]] = {
            "initial": initial, "strokeKey": code[2], "stroke": STROKES[code[2]],
            "smallSource": "initial" if initial is not None else "stroke",
            "dependencies": [initial_ids[initial], stroke_ids[code[2]]] if initial is not None else [stroke_ids[code[2]]],
        }

    def common(item_id, kind, text, code, role, affected):
        ids = sorted({item_id for root in affected for item_id in root_uses[root["text"]]})
        samples = sorted(affected, key=lambda root: (first_need.get(root["text"], math.inf), root["text"]))[:3]
        return {
            "id": item_id, "type": kind, "text": text, "code": code, "answerRole": role,
            "pinyin": "", "sourceType": {"initial": "声母映射", "stroke": "首笔映射"}[kind],
            "sourceId": None, "frequency": None, "dependencies": [], "sourceDependencies": [], "parts": [],
            "rootCoverage": [root_ids[root["text"]] for root in affected],
            "coverageCount": len(ids), "rootCount": len(affected),
            "coverageScore": math.fsum(1 / math.log2(source_id + 2) for source_id in ids),
            "firstNeededSourceId": min((first_need[root["text"]] for root in affected if root["text"] in first_need), default=None),
            "examples": [{"text": root["text"], "pinyin": root["pinyin"]} for root in samples],
        }

    items = {}
    for token in sorted(INITIAL_KEYS):
        aliases = ALIASES.get(token, [token])
        symbols = INITIAL_SYMBOLS[token]
        item = common(initial_ids[token], "initial", "零声母" if token == "0" else "/".join(symbols),
                      INITIAL_KEYS[token], "s", [root for root in roots if facts[root["text"]]["initial"] == token])
        item.update({"initial": token, "aliases": aliases, "symbols": symbols, "prompt": "声母 → 小码"})
        items[item["id"]] = item
    for key, label in STROKES.items():
        item = common(stroke_ids[key], "stroke", label, key, "b", [root for root in roots if root["code"][2] == key])
        item.update({"strokeKey": key, "strokeGlyph": STROKE_GLYPHS[key], "prompt": "首笔 → 补码"})
        items[item["id"]] = item
    assert len(items) == 27
    assert sum(bool(root["pinyin"]) for root in roots) == 222
    return items, facts
