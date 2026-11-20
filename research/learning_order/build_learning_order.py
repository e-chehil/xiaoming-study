"""Reproducible character-first vocabulary curriculum; Python 3.10+, stdlib only.

Run from any directory: python build_learning_order.py
The source TSV is never modified. Ranks identify entries, including homographs.
"""
from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import heapq
import json
import math
from pathlib import Path
import time
import unicodedata


def is_han(c):
    name = unicodedata.name(c, "")
    return c == "〇" or name.startswith(("CJK UNIFIED IDEOGRAPH", "CJK COMPATIBILITY IDEOGRAPH"))


def unique_han(text):
    return tuple(dict.fromkeys(c for c in text if is_han(c)))


class Corpus:
    def __init__(self, entries, exponent=1.0):
        self.entries = sorted(entries, key=lambda r: r["rank"])
        ranks = [r["rank"] for r in self.entries]
        if len(set(ranks)) != len(ranks) or any(r <= 0 for r in ranks):
            raise ValueError("频序号须为不重复的正整数")
        if any(not r["word"] for r in self.entries):
            raise ValueError("词语不能为空")
        self.chars = list(dict.fromkeys(c for r in self.entries for c in unique_han(r["word"])))
        self.char_id = {c: i for i, c in enumerate(self.chars)}
        self.deps = [tuple(self.char_id[c] for c in unique_han(r["word"])) for r in self.entries]
        if any(not d for d in self.deps):
            raise ValueError("存在不含汉字的词条，请明确其学习规则后处理")
        self.weights = [r["rank"] ** -exponent for r in self.entries]
        self.adj = [[] for _ in self.chars]
        self.first_rank = [max(ranks) + 1] * len(self.chars)
        for i, d in enumerate(self.deps):
            for c in d:
                self.adj[c].append(i)
                self.first_rank[c] = min(self.first_rank[c], ranks[i])
        self.total_weight = math.fsum(self.weights)
        self.exponent = exponent

    @classmethod
    def read(cls, source, exponent=1.0):
        with source.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f, delimiter="\t")
            if reader.fieldnames != ["频序号", "词语", "拼音"]:
                raise ValueError(f"不支持的表头: {reader.fieldnames}")
            rows = [{"rank": int(r["频序号"]), "word": r["词语"], "pinyin": r["拼音"]} for r in reader]
        return cls(rows, exponent)

    def completion(self, order):
        if len(order) != len(self.chars) or set(order) != set(range(len(self.chars))):
            raise ValueError("汉字顺序不完整或包含重复项")
        positions = [0] * len(order)
        for i, c in enumerate(order, 1):
            positions[c] = i
        return [max(positions[c] for c in d) for d in self.deps]

    def objective(self, order):
        return math.fsum(w * t for w, t in zip(self.weights, self.completion(order))) / self.total_weight


def greedy_order(corpus, power):
    """Sum w / missing_count**power for each missing character.

    power=0 is static weighted participation; infinity is immediate reward.
    A positive potential tie-break lets the immediate-reward baseline progress
    when no single character can complete any word.
    """
    missing = [set(d) for d in corpus.deps]
    scores = [0.0] * len(corpus.chars)
    potential = [0.0] * len(corpus.chars)
    versions = [0] * len(corpus.chars)
    learned = set()
    def share(w, k):
        return w if k == 1 else (0.0 if math.isinf(power) else w / k ** power)
    for w, ms in zip(corpus.weights, missing):
        for c in ms:
            scores[c] += share(w, len(ms))
            potential[c] += w / len(ms)
    def item(c):
        return (-scores[c], -potential[c], corpus.first_rank[c], ord(corpus.chars[c]), versions[c], c)
    heap = [item(c) for c in range(len(scores))]
    heapq.heapify(heap)
    order = []
    while len(order) < len(scores):
        *_, ver, c = heapq.heappop(heap)
        if c in learned or ver != versions[c]:
            continue
        learned.add(c)
        order.append(c)
        touched = set()
        for wi in corpus.adj[c]:
            ms = missing[wi]
            old_k = len(ms)
            ms.remove(c)
            if not ms:
                continue
            w = corpus.weights[wi]
            delta = share(w, old_k - 1) - share(w, old_k)
            dp = w / (old_k - 1) - w / old_k
            for other in ms:
                scores[other] += delta
                potential[other] += dp
                touched.add(other)
        for other in sorted(touched):
            versions[other] += 1
            heapq.heappush(heap, item(other))
    return order


def solve_block(block, masks):
    """Exact subset DP: maximize sum of unlocked weight after each step.

    masks maps required-character bitmask to combined vocabulary weight.
    A subset zeta transform computes its total unlocked weight. The DP then
    selects the last character in each prefix. The full block is exact; the
    surrounding sequence stays fixed. Equal solutions preserve input order.
    """
    size = 1 << len(block)
    unlocked = [0.0] * size
    for mask, weight in masks.items():
        unlocked[mask] += weight
    for j in range(len(block)):
        bit = 1 << j
        for mask in range(size):
            if mask & bit:
                unlocked[mask] += unlocked[mask ^ bit]
    dp = [0.0] * size
    last = [0] * size
    for mask in range(1, size):
        bits = mask
        best = -math.inf
        chosen = 0
        while bits:
            bit = 1 << (bits.bit_length() - 1)
            value = dp[mask ^ bit]
            if value > best + 1e-14:
                best, chosen = value, bit
            bits ^= bit
        dp[mask] = best + unlocked[mask]
        last[mask] = chosen
    mask = size - 1
    rev = []
    while mask:
        bit = last[mask]
        rev.append(block[bit.bit_length() - 1])
        mask ^= bit
    return list(reversed(rev))


def refine(corpus, order, width=10, passes=4):
    order = order.copy()
    positions = [0] * len(order)
    for i, c in enumerate(order):
        positions[c] = i
    for pass_num in range(passes):
        offset = 0 if pass_num % 2 == 0 else width // 2
        before = corpus.objective(order)
        starts = ([0] if offset else []) + list(range(offset, len(order), width))
        for start in starts:
            end = offset if start == 0 and offset else min(start + width, len(order))
            block = order[start:end]
            if len(block) < 2:
                continue
            bits = {c: 1 << j for j, c in enumerate(block)}
            words = set(wi for c in block for wi in corpus.adj[c])
            masks = collections.defaultdict(float)
            for wi in sorted(words):
                d = corpus.deps[wi]
                # A word needing any later character cannot unlock in this block.
                if max(positions[c] for c in d) >= end:
                    continue
                mask = 0
                for c in d:
                    mask |= bits.get(c, 0)
                masks[mask] += corpus.weights[wi]
            new = solve_block(block, masks)
            order[start:end] = new
            for i, c in enumerate(new, start):
                positions[c] = i
        after = corpus.objective(order)
        if after > before + 1e-9:
            raise AssertionError("局部优化使目标函数恶化")
        print(f"  DP pass {pass_num + 1}: {before:.6f} -> {after:.6f}", flush=True)
    return order


def metrics(corpus, name, order):
    done = corpus.completion(order)
    stages = sorted(set(k for k in [10, 20, 50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 2500, 3000, 4000, len(order)] if k <= len(order)))
    limits = [100, 500, 1000, 3000, 5000, 10000]
    progress = []
    for k in stages:
        unlocked = [i for i, t in enumerate(done) if t <= k]
        row = {"已学汉字数": k, "可解锁词条数": len(unlocked)}
        for limit in limits:
            row[f"前{limit}词覆盖数"] = sum(corpus.entries[i]["rank"] <= limit for i in unlocked)
        row["频序倒数权重覆盖率"] = math.fsum(corpus.weights[i] for i in unlocked) / corpus.total_weight
        progress.append(row)
    avg = corpus.objective(order)
    return {"方案": name, "加权平均解锁字数": avg,
            "覆盖曲线平均值": (len(order) + 1 - avg) / len(order), "进度": progress,
            "完全覆盖所需汉字数": {str(limit): max((t for t, r in zip(done, corpus.entries) if r["rank"] <= limit), default=0) for limit in limits}}


def write_tsv(path, columns, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, columns, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def export(corpus, order, output, source, comparisons):
    output.mkdir(parents=True, exist_ok=True)
    done = corpus.completion(order)
    buckets = collections.defaultdict(list)
    char_pinyin = collections.defaultdict(list)
    for i, (row, step) in enumerate(zip(corpus.entries, done)):
        buckets[step].append(i)
        if len(row["word"]) == 1 and is_han(row["word"]):
            if row["pinyin"] not in char_pinyin[row["word"]]:
                char_pinyin[row["word"]].append(row["pinyin"])
    main, chars = [], []
    intro_rows = {}
    total = total1000 = 0
    columns = ["学习序号", "类型", "字词", "拼音", "原词频序号", "已学汉字数", "组成汉字", "前置汉字学习序号"]
    for step, ci in enumerate(order, 1):
        c = corpus.chars[ci]
        intro_rows[c] = len(main) + 1
        main.append(dict(zip(columns, [len(main) + 1, "汉字", c, " / ".join(char_pinyin[c]), "", step, "", ""])))
        for wi in buckets[step]:
            row = corpus.entries[wi]
            deps = unique_han(row["word"])
            main.append(dict(zip(columns, [len(main) + 1, "词语", row["word"], row["pinyin"], row["rank"], step,
                                           " ".join(deps), " ".join(str(intro_rows[ch]) for ch in deps)])))
        new1000 = sum(corpus.entries[wi]["rank"] <= 1000 for wi in buckets[step])
        total += len(buckets[step])
        total1000 += new1000
        chars.append({"汉字序号": step, "汉字": c, "单字词原音": " / ".join(char_pinyin[c]),
                      "首次出现词频序号": corpus.first_rank[ci], "新增可解锁词条": len(buckets[step]),
                      "累计可解锁词条": total, "累计前1000词覆盖": total1000,
                      "本步高频词示例": "、".join(corpus.entries[wi]["word"] for wi in buckets[step][:6])})
    # Independent sequential prerequisite and exact-source-preservation audit.
    seen = {}
    recovered = {}
    for i, row in enumerate(main, 1):
        assert row["学习序号"] == i
        if row["类型"] == "汉字":
            assert row["字词"] not in seen
            seen[row["字词"]] = i
        else:
            deps = unique_han(row["字词"])
            assert all(c in seen and seen[c] < i for c in deps)
            assert [seen[c] for c in deps] == list(map(int, row["前置汉字学习序号"].split()))
            rank = row["原词频序号"]
            assert rank not in recovered
            recovered[rank] = (row["字词"], row["拼音"])
    assert recovered == {r["rank"]: (r["word"], r["pinyin"]) for r in corpus.entries}
    assert set(seen) == set(corpus.chars)
    assert total == len(corpus.entries)
    write_tsv(output / "完整字词学习表.tsv", columns, main)
    write_tsv(output / "汉字学习顺序.tsv", list(chars[0]), chars)
    selected = metrics(corpus, "最终方案", order)
    write_tsv(output / "分阶段覆盖.tsv", list(selected["进度"][0]), selected["进度"])
    comp_rows = []
    for m in comparisons:
        for p in m["进度"]:
            comp_rows.append({"方案": m["方案"], "加权平均解锁字数": m["加权平均解锁字数"], **p})
    write_tsv(output / "算法对比.tsv", list(comp_rows[0]), comp_rows)
    non_han = [{"原词频序号": r["rank"], "词语": r["word"], "拼音": r["pinyin"],
                "非汉字字符": " ".join(dict.fromkeys(c for c in r["word"] if not is_han(c)))}
               for r in corpus.entries if any(not is_han(c) for c in r["word"])]
    if non_han:
        write_tsv(output / "含非汉字词条.tsv", list(non_han[0]), non_han)
    report = {"输入文件": str(source.resolve()), "输入SHA256": hashlib.sha256(source.read_bytes()).hexdigest(),
              "原词条数": len(corpus.entries), "不同汉字数": len(order), "完整表行数": len(main),
              "同形词额外记录数": len(corpus.entries) - len(set(r["word"] for r in corpus.entries)),
              "含非汉字词条数": len(non_han), "权重指数": corpus.exponent,
              "校验": {"词条无遗漏无重复": True, "词语拼音频序号完全保留": True,
                       "汉字各引入一次": True, "全部词语汉字前置": True, "词语在最早解锁步出现": True},
              "最终方案": selected, "算法对比": comparisons}
    (output / "校验与评估.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "workbook_data.json").write_text(json.dumps({"main": main, "chars": chars, "report": report}, ensure_ascii=False), encoding="utf-8")
    # A compact plain-text reading edition is useful without spreadsheet software.
    lines = ["汉语字词学习顺序（完整）", "每节先学汉字，再读已解锁词语；词后 # 为原频序号。", ""]
    for step, ci in enumerate(order, 1):
        c = corpus.chars[ci]
        lines.append(f"{step}. 学字：{c}  {' / '.join(char_pinyin[c])}")
        for wi in buckets[step]:
            r = corpus.entries[wi]
            lines.append(f"    {r['word']}  {r['pinyin']}  #{r['rank']}")
        lines.append("")
    (output / "完整字词学习表.txt").write_text("\n".join(lines), encoding="utf-8-sig")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parent.parent
    parser.add_argument("--input", type=Path, default=root / "现代汉语常用词表.tsv")
    parser.add_argument("--output", type=Path, default=root / "outputs" / "learning_order_20261021")
    parser.add_argument("--rank-exponent", type=float, default=1.0)
    parser.add_argument("--passes", type=int, default=4)
    args = parser.parse_args()
    if args.rank_exponent <= 0 or args.passes < 0:
        parser.error("rank-exponent 必须大于 0，passes 不能小于 0")
    started = time.monotonic()
    corpus = Corpus.read(args.input, args.rank_exponent)
    candidates = [("按词频逐词补齐汉字", list(range(len(corpus.chars))))]
    for power in [0, 0.5, 1, 1.5, 2, 3, 5, math.inf]:
        name = "仅即时解锁贪心" if math.isinf(power) else f"缺字折扣贪心 p={power}"
        order = greedy_order(corpus, power)
        candidates.append((name, order))
        print(f"{name}: {corpus.objective(order):.6f}", flush=True)
    best3 = sorted(candidates, key=lambda x: corpus.objective(x[1]))[:3]
    for name, order in best3:
        print(f"Refining {name}", flush=True)
        candidates.append((name + " + 窗口精确优化", refine(corpus, order, passes=args.passes)))
    name, order = min(candidates, key=lambda x: corpus.objective(x[1]))
    comparisons = [metrics(corpus, name, order) for name, order in candidates]
    report = export(corpus, order, args.output, args.input, comparisons)
    report["选中算法"] = name
    report["运行秒数"] = round(time.monotonic() - started, 3)
    (args.output / "校验与评估.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"chosen": name, "characters": len(order), "words": len(corpus.entries),
                      "objective": corpus.objective(order), "first_100_characters": "".join(corpus.chars[c] for c in order[:100]),
                      "elapsed": report["运行秒数"], "output": str(args.output)}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
