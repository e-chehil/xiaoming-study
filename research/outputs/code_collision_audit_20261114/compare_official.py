"""Reproduce the official 4.108% word collision result using its cited corpus."""
from collections import Counter, defaultdict
from pathlib import Path
import hashlib
import json
import re

OUT = Path(__file__).resolve().parent
UPSTREAM = OUT.parents[1] / '潇明码表' / 'upstream'
divisions = {}
for line in (UPSTREAM / 'chaifen-all.txt').read_text(encoding='utf-8-sig').splitlines():
    fields = line.split('\t')
    if len(fields) >= 2:
        divisions[fields[0]] = fields[1].split()
roots = {}
for line in (UPSTREAM / 'output-keymap.txt').read_text(encoding='utf-8-sig').splitlines():
    if line.startswith('#'):
        continue
    fields = line.split()
    if len(fields) >= 2:
        roots[fields[0]] = fields[1].lower()

def encode(word):
    parts = [[roots[root] for root in divisions[char]] for char in word]
    first = parts[0]
    if len(parts) == 2:
        last = parts[1]
        code = first[0][:2] + (first[-1][0] if len(first) > 1 else '')
        if len(last) == 1:
            return code + last[0][:2]
        code += last[0][0]
        return code + last[-1][:5 - len(code)]
    code = first[-1][:2] + parts[1][-1][0]
    if len(parts) == 3:
        last = parts[2]
        return code + (last[0][:2] if len(last) == 1 else last[0][0] + last[-1][0])
    return code + parts[2][-1][0] + parts[-1][-1][0]

words = []
excluded = []
source = OUT / 'kc6000.txt'
lines = source.read_text(encoding='utf-8-sig').splitlines()
for line in lines:
    text, frequency = line.split()
    if len(text) == 1:
        continue
    if re.search('[A-Za-z]', text):
        excluded.append(text)
        continue
    words.append({'text': text, 'frequency': int(frequency), 'code': encode(text)})
assert excluded == ['阿Q', '卡拉OK']
assert len(words) == len({x['text'] for x in words}) == 59998
groups = defaultdict(list)
for word in words:
    groups[word['code']].append(word)
frequency_sum = sum(word['frequency'] for word in words)
nonfirst_frequency = sum(sum(word['frequency'] for word in group) -
                         max(word['frequency'] for word in group)
                         for group in groups.values())
N = len(words)
involved = sum(len(group) for group in groups.values() if len(group) > 1)
data = json.loads((OUT / 'learning-runtime.json').read_text(encoding='utf-8'))
course_words = {word['text']: word for word in data['items'] if word['type'] == 'word' and word['code']}
assert all(encode(word['text']) == word['code'] for word in course_words.values())
course_summary = json.loads((OUT / 'summary.json').read_text(encoding='utf-8'))
result = {
    'source_url': 'https://github.com/hertz-hwang/CHS/blob/main/data/kc6000.txt',
    'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'original_lines': len(lines), 'single_char_rows': 6000,
    'excluded_words': excluded, 'coded_distinct_words': N,
    'distinct_codes': len(groups),
    'collision_groups': sum(len(group) > 1 for group in groups.values()),
    'static_excess_words': N - len(groups), 'static_excess_percent': 100 * (N - len(groups)) / N,
    'involved_words': involved, 'involved_percent': 100 * involved / N,
    'frequency_sum': frequency_sum, 'nonfirst_frequency': nonfirst_frequency,
    'dynamic_excess_percent': 100 * nonfirst_frequency / frequency_sum,
    'dynamic_definition': 'For each code, retain the maximum-frequency word; sum all remaining frequencies and divide by all word frequencies.',
    'course_distinct_words': len(course_words),
    'course_codes_match_original_divisions_and_roots': True,
    'course_static_excess_percent': course_summary['word_word']['excess_percent'],
    'course_involved_percent': course_summary['word_word']['involved_percent'],
    'overlap_words': len(set(course_words) & {word['text'] for word in words}),
    'course_dynamic_excess_percent': None,
}
assert round(result['dynamic_excess_percent'], 3) == 4.108
(OUT / 'official_comparison.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
report = f'''# 官网 4.108% 与课程重码率的口径核对

已使用官网链接的 kc6000.txt，以及网站当前采用的原方案固定版本字根和拆分，精确复现 **4.1081426608%**。去掉 6,000 条单字和“阿Q”“卡拉OK”后，共 59,998 个词语。全部课程词码也用原方案拆分和字根重新生成，53,546 个不同词语全部一致。

| 指标 | 官网测评词表 | 潇明习字简中课程 |
|---|---:|---:|
| 不同可编码词语 | 59,998 | 53,546 |
| 每码保留一个后的重码词数 | 7,694 | 6,061 |
| 静态重码率（上述词数 / 全部词数） | 12.82% | 11.32% |
| 所有处于同码组的词语占比 | 23.37% | 20.71% |
| 按词频加权的动态重码率 | **4.108%** | 本次未计算 |

官网数字对应动态重码：每个编码以最高频词作首选，累加其余词的词频，再除以全部词频。本次得到 **39,175,956 / 953,617,224 × 100% = 4.1081426608%**。大量重码落在相对低频词上，因此它低于按词条数等权计算的静态值。

此前课程报告中的 11.32% 是静态重码率；20.71% 把同组首选也算作“涉及重码的词”。直接与官网动态词重比较，会造成重码显著增加的错觉。用同一静态口径比较，课程为 11.32%，官网测评表为 12.82%；这两个词表的结果不能证明课程编码规则更差。

两份词表还存在取词差异，共有 30,686 个词形重合。此处没有把另一份词表的词频强加到课程全体词语上，因而未报告课程全体的动态词重。

可复核：`compare_official.py`、`official_comparison.json`、`kc6000.txt`。

来源：[潇明官网](https://shurufa.app/ime/xiaoming)、[官方引用的科学测评词表](https://github.com/hertz-hwang/CHS/blob/main/data/kc6000.txt)。
'''
(OUT / '官网词重口径核对.md').write_text(report, encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
