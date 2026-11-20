"""NAER frequency/graded vocabulary -> the same optimized Xiaoming curriculum.

Inputs remain unchanged. NAER readings take priority; MOE readings are matched
by exact traditional word, then explicitly marked automatic readings fill gaps.
"""
from pathlib import Path
from collections import Counter, defaultdict
from zipfile import ZipFile
import csv
import hashlib
import json
import math
import re
import shutil
import sys
import time
from traditional_sources import read_sources, xlsx_rows
from pronunciations import enrich, inferred
from prepare_data import build, write_json, sha256, is_han

PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parents[1]
sys.path.insert(0, str(WORKSPACE / 'learning_order'))
from build_learning_order import Corpus, greedy_order, refine, metrics


def enrich_table(path, items):
    with path.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle, delimiter='\t')
        fields = reader.fieldnames + [field for field in ['zhuyin', 'readingSource'] if field not in reader.fieldnames]
        rows = list(reader)
    by_id = {str(item['id']): item for item in items}
    with path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fields, delimiter='\t', lineterminator='\n');writer.writeheader()
        for row in rows:
            item = by_id[row['ID']]
            row.update({'pinyin': item.get('displayPinyin') or item['pinyin'], 'zhuyin': item.get('zhuyin', ''), 'readingSource': item.get('readingSource', '')})
            writer.writerow(row)


def readings(vocabulary):
    cache = PROJECT / '.local' / 'moe-readings.json'
    lexicon = {}
    if cache.exists():
        lexicon = json.loads(cache.read_text(encoding='utf-8'))
    else:
        for row in xlsx_rows(PROJECT / '.local' / 'dict_revised_2015_20260929.xlsx'):
            word, bop, py = row.get('A', '').strip(), row.get('I', '').strip(), row.get('L', '').strip()
            if not word or not py or not bop or word == '字詞名':
                continue
            # Keep complete original readings, including alternate readings.
            value = lexicon.setdefault(word, {'pinyin': [], 'zhuyin': [], 'source': 'moe'})
            if (py, bop) not in list(zip(value['pinyin'], value['zhuyin'])):
                value['pinyin'].append(py); value['zhuyin'].append(bop)
        for word, value in lexicon.items():
            value['pinyin'] = ' / '.join(value['pinyin'])
            value['zhuyin'] = ' / '.join(value['zhuyin'])
        write_json(cache, lexicon)
    for row in vocabulary:
        variants = [re.sub(r'\s*\d+$', '', s.strip()) for s in row['B'].split('/')]
        pys, bops = [s.strip() for s in row['J'].split('/')], [s.strip() for s in row['I'].split('/')]
        if len(pys) != len(bops):
            continue
        for index, word in enumerate(variants):
            pairs = []
            if len(variants) == 1:
                pairs = list(zip(pys, bops))
            elif len(pys) == len(variants):
                pairs = [(pys[index], bops[index])]
            elif len(pys) == 1:
                pairs = [(pys[0], bops[0])]
            else:
                pairs = [(py, bop) for py, bop in zip(pys, bops)
                         if len(re.findall(r'[ㄅ-ㄩ]+[ˊˇˋ˙]?', bop)) == len(word)]
            if not pairs:
                continue
            previous = lexicon.get(word)
            level = row['D']
            if previous and previous['source'] == 'naer':
                pairs = list(zip(previous['pinyin'].split(' / '), previous['zhuyin'].split(' / '))) + pairs
                level = min([previous['level'], level], key=lambda s: (int(re.search(r'\d+', s).group()), '*' in s))
            pairs = list(dict.fromkeys(pairs))
            lexicon[word] = {'pinyin': ' / '.join(p for p, b in pairs), 'zhuyin': ' / '.join(b for p, b in pairs),
                             'source': 'naer', 'level': level}
    return lexicon


def main():
    started = time.monotonic()
    output = WORKSPACE / 'outputs' / 'traditional_learning_order_20261023'
    output.mkdir(parents=True, exist_ok=True)
    cache = PROJECT / '.local' / 'traditional-sources.json'
    if cache.exists():
        extracted = json.loads(cache.read_text(encoding='utf-8'))
        vocabulary, frequency = extracted['vocabulary'], extracted['frequency']
    else:
        vocabulary, frequency = read_sources(WORKSPACE / '詞語表、通用詞頻表')
        write_json(cache, {'vocabulary': vocabulary, 'frequency': frequency})
    print(f'Inputs: {len(vocabulary)} graded rows; {len(frequency)} frequency rows', flush=True)
    lexicon = readings(vocabulary)
    entries = {r['B']: {'rank': int(r['A']), 'word': r['B'], 'pinyin': lexicon.get(r['B'], {}).get('pinyin', '')}
               for r in frequency}
    next_rank = max(r['rank'] for r in entries.values())
    for row in vocabulary:
        for variant in row['B'].split('/'):
            word = re.sub(r'\s*\d+$', '', variant.strip())
            if word not in entries:
                next_rank += 1
                entries[word] = {'rank': next_rank, 'word': word, 'pinyin': lexicon.get(word, {}).get('pinyin', '')}
    all_characters = {c for word in entries for c in word if is_han(c)}
    for word in set(entries) | all_characters:
        if word not in lexicon:
            py, bop = inferred(word)
            lexicon[word] = {'pinyin': py, 'zhuyin': bop, 'source': 'inferred'}
    for word, entry in entries.items():
        entry['pinyin'] = lexicon[word]['pinyin']
    without_han = [r for r in entries.values() if not any(is_han(c) for c in r['word'])]
    corpus = Corpus([r for r in entries.values() if any(is_han(c) for c in r['word'])])
    print(f'Vocabulary union: {len(entries)} words; {len(corpus.chars)} characters; {len(without_han)} non-Han rows', flush=True)
    candidates = [('frequency-first', list(range(len(corpus.chars))))]
    for power in [0, .5, 1, 1.5, 2, 3, 5, math.inf]:
        sequence = greedy_order(corpus, power)
        name = f'missing-character-discount p={power}'
        candidates.append((name, sequence))
        print(name, round(corpus.objective(sequence), 5), flush=True)
    for name, sequence in sorted(candidates, key=lambda pair: corpus.objective(pair[1]))[:3]:
        print('Refining', name, flush=True)
        candidates.append((name+' + exact-window-DP', refine(corpus, sequence, width=10, passes=4)))
    chosen, order = min(candidates, key=lambda pair: corpus.objective(pair[1]))
    completed = corpus.completion(order)
    buckets = defaultdict(list)
    for row, step in zip(corpus.entries, completed):
        buckets[step].append(row)
    columns = ['学习序号', '类型', '字词', '拼音', '原词频序号', '已学汉字数', '组成汉字', '前置汉字学习序号', '注音', '读音来源']
    result, introductions = [], {}
    for step, char_id in enumerate(order, 1):
        char = corpus.chars[char_id]
        introductions[char] = len(result)+1
        single = entries.get(char)
        result.append([len(result)+1, '汉字', char, lexicon.get(char, {}).get('pinyin', ''), single['rank'] if single else '', step, '', ''])
        for row in sorted(buckets[step], key=lambda row: row['rank']):
            if len(row['word']) == 1:
                continue
            chars = list(dict.fromkeys(c for c in row['word'] if is_han(c)))
            result.append([len(result)+1, '词语', row['word'], row['pinyin'], row['rank'], step,
                           ' '.join(chars), ' '.join(str(introductions[c]) for c in chars)])
    for row in sorted(without_han, key=lambda row: row['rank']):
        result.append([len(result)+1, '词语', row['word'], '', row['rank'], len(order), '', ''])
    for row in result:
        value = lexicon[row[2]]
        row.extend([value['zhuyin'], value['source']])
    source = output / '完整繁中字詞學習表.tsv'
    with source.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.writer(handle, delimiter='\t', lineterminator='\n');writer.writerow(columns);writer.writerows(result)
    assert set(r[2] for r in result) == set(entries) | set(corpus.chars)
    assert len(result) == len(set(r[2] for r in result))
    report = {'algorithm': chosen, 'wordCount': len(entries), 'characterCount': len(order),
              'sourceRows': len(result), 'baselineObjective': corpus.objective(candidates[0][1]),
              'optimizedObjective': corpus.objective(order), 'comparison': [
                  {'algorithm': name, 'objective': corpus.objective(seq)} for name, seq in candidates],
              'coverage': metrics(corpus, chosen, order)['进度'],
              'sources': [{'name': p.name, 'sha256': sha256(p)} for p in (WORKSPACE / '詞語表、通用詞頻表').glob('*.xlsx')],
              'sourceUrl': 'https://coct.naer.edu.tw/page.jsp?ID=41',
              'readingUrl': 'https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/dict_reviseddict_download.html',
              'readingVersion': 'dict_revised_2015_20260929',
              'readingZipSha256': sha256(PROJECT / '.local' / 'dict_revised_2015_20260929.zip'),
              'policy': 'Frequency table keeps every exact word. Slash-separated graded variants are separate words; trailing sense numbers are retained in source, removed only from practice text. Missing frequency variants follow the frequency table. Rank-reciprocal objective, eight greedy candidates, three best exact 10-character windows and four refinement passes.'}
    write_json(output / '算法與來源核對.json', report)
    runtime = PROJECT / 'dist' / 'data' / 'traditional'
    metadata = build(source, WORKSPACE / '潇明码表', runtime, strict_source=False)
    dataset = json.loads((runtime / 'learning.json').read_text(encoding='utf-8'))
    report['readingCounts'] = enrich(dataset, lexicon)
    dataset.update({'course': 'traditional', 'language': 'zh-Hant', 'provenance': report})
    dataset['downloads'] = {'curriculum': metadata['downloads']['curriculum']['name'], 'original': source.name}
    # Include both reading scripts and provenance in the downloadable course.
    table = runtime / dataset['downloads']['curriculum']
    enrich_table(table, dataset['items'])
    metadata['downloads']['curriculum']['sha256'] = sha256(table)
    shutil.copyfile(table, output / '繁中聲母首筆字根字詞優序學習表.tsv')
    write_json(runtime / 'learning.json', dataset)
    metadata.update({'learningBytes': (runtime / 'learning.json').stat().st_size, 'learningSha256': sha256(runtime / 'learning.json'), 'provenance': report})
    write_json(runtime / 'metadata.json', metadata)
    # A display-only enrichment keeps the simplified course's stable IDs and source hash.
    simplified_path = PROJECT / 'dist' / 'data' / 'learning.json'
    simplified = json.loads(simplified_path.read_text(encoding='utf-8'))
    sc_counts = enrich(simplified)
    simplified.update({'course': 'simplified', 'language': 'zh-Hans'})
    simplified['downloads'] = {'curriculum': simplified['curriculum']['table'], 'original': simplified['source']['name']}
    write_json(simplified_path, simplified)
    meta_path = simplified_path.parent / 'metadata.json'
    sc_meta = json.loads(meta_path.read_text(encoding='utf-8'))
    sc_table = simplified_path.parent / simplified['downloads']['curriculum']
    enrich_table(sc_table, simplified['items'])
    sc_meta['downloads']['curriculum']['sha256'] = sha256(sc_table)
    sc_meta.update({'readingCounts': sc_counts, 'learningBytes': simplified_path.stat().st_size, 'learningSha256': sha256(simplified_path)})
    write_json(meta_path, sc_meta)
    write_json(output / '算法與來源核對.json', report)
    with ZipFile(PROJECT / '.local' / 'dict_revised_2015_20260929.zip') as archive:
        notice = next(name for name in archive.namelist() if name.endswith('.xlsx') and name != 'dict_revised_2015_20260929.xlsx')
        (PROJECT / 'dist' / 'vendor' / '教育部重編辭典使用說明.xlsx').write_bytes(archive.read(notice))
    print(json.dumps({'stats': dataset['stats'], 'readingCounts': report['readingCounts'], 'simplifiedReadings': sc_counts,
                      'bytes': metadata['learningBytes'], 'elapsed': round(time.monotonic()-started, 1)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
    from curate_traditional import run as curate
    curate()
    from prepare_lessons import run as prepare_lessons
    prepare_lessons()
    import subprocess
    from build_curricula import build_and_validate
    build_and_validate()
