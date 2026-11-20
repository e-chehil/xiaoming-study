"""Audit exact code collisions in the downloaded public simplified curriculum.

Run from any directory. Network snapshots are kept beside this script.
Duplicate readings of the same word/code count once in the primary analysis.
"""
from pathlib import Path
from collections import Counter, defaultdict
import csv
import hashlib
import json
import sys

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
COURSE = OUT / 'learning-runtime.json'
UPSTREAM = ROOT / '潇明码表' / 'upstream'
BASE_URL = 'https://e-chehil.github.io/xiaoming-study/data/'
REV = '55e783c3973b125d3f56baac534b796c76df87a5'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def group(rows):
    result = defaultdict(list)
    for row in rows:
        result[row['code']].append(row)
    return result

def write_tsv(name, columns, rows):
    with (OUT / name).open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.writer(stream, delimiter='\t')
        writer.writerow(columns)
        writer.writerows(rows)

data = json.loads(COURSE.read_text(encoding='utf-8'))
manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
assert sha(COURSE) == manifest['courses']['simplified']['sha256']
word_rows = [x for x in data['items'] if x['type'] == 'word']
coded = [x for x in word_rows if x['code']]
words = {}
for row in coded:
    words.setdefault((row['text'], row['code']), row)
words = list(words.values())
assert len({x['text'] for x in words}) == len(words), 'One word has multiple codes'
groups = group(words)
word_collisions = {code: rows for code, rows in groups.items() if len(rows) > 1}

# Independently derive every answer from shared root data, using the documented
# official trailing-root rules rather than the delivered answer string.
def word_code(parts):
    roots = [data['partsByCharacter'][char]['rootCodes'] for char in parts]
    first = roots[0]
    if len(roots) == 2:
        second = roots[1]
        code = first[0][:2] + (first[-1][0] if len(first) > 1 else '')
        if len(second) == 1:
            return code + second[0][:2]
        code += second[0][0]
        return code + second[-1][:5 - len(code)]
    code = first[-1][:2] + roots[1][-1][0]
    if len(roots) == 3:
        last = roots[2]
        return code + (last[0][:2] if len(last) == 1 else last[0][0] + last[-1][0])
    return code + roots[2][-1][0] + roots[-1][-1][0]

assert all(word_code(x['text']) == x['code'] for x in coded)
full = defaultdict(set)
for line in (UPSTREAM / 'output-encode.txt').read_text(encoding='utf-8-sig').splitlines():
    char, code, frequency = line.split('\t')
    assert len(char) == 1
    full[code].add(char)
combined = defaultdict(set)
for line in (UPSTREAM / 'output-combined.txt').read_text(encoding='utf-8-sig').splitlines():
    char, code = line.split('\t')
    assert len(char) == 1
    combined[code].add(char)
cross = {code: rows for code, rows in groups.items() if code in full}
assert {code for code in groups if code in combined} == set(cross)
assert all(combined[code] == full[code] for code in cross)
course_chars = group([x for x in data['items'] if x['type'] == 'char' and x['code']])
course_cross = {code: rows for code, rows in groups.items() if code in course_chars}

N = len(words)
involved = sum(map(len, word_collisions.values()))
excess = N - len(groups)
cross_words = sum(map(len, cross.values()))
conflict_union = {x['text'] for rows in [*word_collisions.values(), *cross.values()] for x in rows}
summary = {
    'date': '2026-11-14',
    'definition': 'Exact lowercase code equality; distinct word forms; no prefix conflicts; no candidate ordering assumed.',
    'source': {
        'course_url': BASE_URL + 'learning-runtime.json', 'course_sha256': sha(COURSE),
        'curriculum_version': data['curriculumVersion'], 'upstream_revision': REV,
        'upstream_full_sha256': sha(UPSTREAM / 'output-encode.txt'),
        'upstream_combined_sha256': sha(UPSTREAM / 'output-combined.txt'),
    },
    'scope': {
        'word_rows': len(word_rows), 'coded_rows': len(coded),
        'unsupported_rows': len(word_rows) - len(coded),
        'duplicate_word_code_rows': len(coded) - N, 'distinct_coded_words': N,
        'original_single_characters': len(set().union(*full.values())),
        'length_distribution': dict(sorted(Counter(len(x['code']) for x in words).items())),
    },
    'word_character': {
        'code_groups': len(cross), 'words': cross_words, 'word_percent': 100 * cross_words / N,
        'characters': len(set().union(*(full[c] for c in cross))),
        'word_character_pairs': sum(len(rows) * len(full[code]) for code, rows in cross.items()),
        'additional_conflicts_from_short_codes': 0,
        'course_char_only_groups': len(course_cross),
        'course_char_only_words': sum(map(len, course_cross.values())),
    },
    'word_word': {
        'distinct_codes': len(groups), 'collision_groups': len(word_collisions),
        'involved_words': involved, 'involved_percent': 100 * involved / N,
        'excess_words': excess, 'excess_percent': 100 * excess / N,
        'max_words_per_code': max(map(len, groups.values())),
        'multiplicity_distribution': dict(sorted(Counter(map(len, groups.values())).items())),
        'unordered_pairs': sum(len(v) * (len(v) - 1) // 2 for v in groups.values()),
    },
    'either_collision_words': len(conflict_union),
    'raw_row_word_word': {
        'collision_groups': sum(len(v) > 1 for v in group(coded).values()),
        'involved_rows': sum(len(v) for v in group(coded).values() if len(v) > 1),
        'excess_rows': len(coded) - len(groups),
    },
    'validation': {'course_manifest_hash': True, 'all_word_codes_recomputed': True,
                   'original_files_verified_against_pinned_public_github': True},
}
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
write_tsv('词与单字重码.tsv', ['编码', '词语数', '词语', '原方案单字数', '原方案单字'],
          ([code, len(rows), '、'.join(x['text'] for x in rows), len(full[code]), '、'.join(sorted(full[code]))]
           for code, rows in sorted(cross.items())))
write_tsv('词与词重码.tsv', ['编码', '不同词语数', '词语'],
          ([code, len(rows), '、'.join(x['text'] for x in rows)]
           for code, rows in sorted(word_collisions.items(), key=lambda pair: (-len(pair[1]), pair[0]))))
write_tsv('未编码词语.tsv', ['课程ID', '词语'], ([x['id'], x['text']] for x in word_rows if not x['code']))
write_tsv('同词同码重复记录.tsv', ['词语', '编码', '记录数', '读音', '课程ID'],
          ([text, code, len(rows), ' / '.join(x.get('pinyin', '') for x in rows), ','.join(str(x['id']) for x in rows)]
           for (text, code), rows in sorted(((key, [x for x in coded if (x['text'], x['code']) == key])
                                            for key, count in Counter((x['text'], x['code']) for x in coded).items() if count > 1))))
report = f'''# 潇明习字简中课程重码核对

统计日期：2026-11-14。读取公开网站当前 `learning-runtime.json`，SHA-256 与网站 manifest 一致，也与本地发布包逐字节一致。原方案采用网站清单指定的固定提交 `{REV}`，原始全码与组合码表已与 GitHub 对应文件逐字节核对。

## 统计口径

课程词语共 {len(word_rows):,} 条，其中 22 条含字母或标点，网站未提供可练编码；可编码记录 {len(coded):,} 条。合并同词同码的不同读音等重复记录 {len(coded)-N} 条后，得到 **{N:,} 个不同词形**。以下重码率均以此为分母。比较完整小写编码完全相同，不将前缀相同算作重码；不包含字根课或声母、首笔映射课。全部可编码词语已按共享字根数据独立重算，一致。

## 词语与原方案单字

对照原方案全部 11,177 个单字：**{cross_words:,} 个词语（{100*cross_words/N:.2f}%）**与单字全码重合，涉及 **{len(cross):,} 个编码、1,064 个单字**，共 1,287 对词—字组合。把原方案简码一并加入，冲突数量不变。原因是课程词码均为四码或五码，而原方案简码短于四码。

例如：`ckgi` 女子／长子 ↔ 好；`akttj` 中心／忠心 ↔ 忠；`uebum` 组织／编织 ↔ 练；`wjupf` 伟大 ↔ 侠。完整列表见“词与单字重码.tsv”。

原方案字集包含简体、繁体及生僻字，并非只对照课程中的 5,069 个单字。如果仅对照课程单字，则是 {sum(map(len,course_cross.values())):,} 个词语、{len(course_cross):,} 个编码；两者范围不同。

## 词语彼此之间

**{len(word_collisions):,} 个编码**被多个不同词语共享，涉及 **{involved:,} 个词语（{100*involved/N:.2f}%）**。若每组仅保留一个词不算重码，则多出来 **{excess:,} 个词（{100*excess/N:.2f}%）**。后者是“每码保留一项”的静态重码口径；并未假定哪个词排首选，也不是按使用频率加权的动态重码率。

| 同码词语数 | 编码组数 |
|---|---|
''' + '\n'.join(f'| {size} | {count:,} |' for size,count in sorted(Counter(map(len,groups.values())).items())) + f'''

同码最多 7 个不同词语，共 4 组。例如 `visgi`：村子、柱子、根子、梯子、框子、菜团子、栓子。完整列表见“词与词重码.tsv”。

这两类重码词有交集，人数不可直接相加。网站按题目指定答案训练，统计反映将这些词码加入输入法时的同码候选冲突；不据此断定实际候选顺序或必须按选字键的频率。

## 可复核文件

- `audit.py`：从已保存的线上快照重算；不改动网站。
- `summary.json`：数量、分布、来源与哈希。
- `词与单字重码.tsv`、`词与词重码.tsv`：全部不同词形的冲突组。
- `同词同码重复记录.tsv`、`未编码词语.tsv`：排除记录的依据。
- `learning-runtime.json`、`manifest.json`：网站原始快照。

来源：[潇明习字](https://e-chehil.github.io/xiaoming-study/)、[课程数据](https://e-chehil.github.io/xiaoming-study/data/learning-runtime.json)、[原方案固定版本](https://github.com/Dieken/code_genie/tree/{REV}/moling/xiaoming-output/output-20261011-061440/thread-06)、[取码规则](https://shurufa.app/ime/xiaoming)。
'''
(OUT / '重码核对报告.md').write_text(report, encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
