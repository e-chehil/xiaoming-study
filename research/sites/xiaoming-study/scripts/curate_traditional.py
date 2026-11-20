"""Curate NAER observations into a comparable lexical course; retain stable IDs.

The source frequency workbook is an observation inventory, not a teaching list.
Use the same mixed character/word-step optimizer as the delivered SC course.
"""
from collections import Counter, defaultdict
from pathlib import Path
import copy
import csv
import json
import math
import re
import shutil
import sys
import time

PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parents[1]
sys.path.insert(0, str(WORKSPACE / 'learning_order'))
from build_learning_order import Corpus, is_han
from build_step_order import baseline, density_order, refine_jobs, objective, audit, evaluate
from prepare_data import sha256, write_json, build, display_code

MIN_PPM = 0.2
RUNTIME = PROJECT / 'dist/data/traditional'
OUTPUT = WORKSPACE / 'outputs/traditional_learning_order_20261023'


def graded_words(rows):
    return {re.sub(r'\s*\d+$', '', variant.strip()) for row in rows for variant in row['B'].split('/')}


def selection(word, row, graded, moe, cedict, threshold=MIN_PPM):
    if not word or not all(is_han(c) for c in word):
        return False, 'annotation_or_non_han'
    if word in graded:
        return True, 'graded'
    if word not in moe and word not in cedict:
        return False, 'no_lexical_evidence'
    if row is None or float(row['L']) < threshold:
        return False, 'below_frequency_floor'
    return True, 'dictionary_and_frequency'


def load_base():
    """The old published source table remains the canonical identity manifest."""
    current = json.loads((RUNTIME / 'learning.json').read_text(encoding='utf-8'))
    cache = PROJECT / '.local/traditional-unfiltered-v1.json'
    if 'curation' not in current:
        cache.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(RUNTIME / 'learning.json', cache)
        shutil.copyfile(RUNTIME / 'metadata.json', cache.with_name('traditional-unfiltered-v1-metadata.json'))
        return current
    if cache.exists():
        saved = json.loads(cache.read_text(encoding='utf-8'))
        if saved['source']['sha256'] == current['source']['sha256']:
            return saved
    # Reconstruct stable IDs from the retained original TSV on a fresh checkout.
    from prepare_traditional import readings
    from traditional_sources import read_sources
    from pronunciations import enrich
    recovery = PROJECT / '.local/traditional-recovered-v1'
    build(RUNTIME / current['source']['name'], WORKSPACE / '潇明码表', recovery, strict_source=False)
    restored = json.loads((recovery / 'learning.json').read_text(encoding='utf-8'))
    vocabulary, _ = read_sources(WORKSPACE / '詞語表、通用詞頻表')
    enrich(restored, readings(vocabulary))
    for key in ['course', 'language', 'downloads', 'provenance']:
        restored[key] = current.get('legacyProvenance', current[key]) if key == 'provenance' else current[key]
    write_json(cache, restored)
    return restored


def run():
    started = time.monotonic()
    data = load_base()
    source_cache = PROJECT / '.local/traditional-sources.json'
    if not source_cache.exists():
        from traditional_sources import read_sources
        vocabulary, frequency_rows = read_sources(WORKSPACE / '詞語表、通用詞頻表')
        write_json(source_cache, {'vocabulary': vocabulary, 'frequency': frequency_rows})
    extracted = json.loads(source_cache.read_text(encoding='utf-8'))
    frequency = {row['B']: row for row in extracted['frequency']}
    graded = graded_words(extracted['vocabulary'])
    moe = json.loads((PROJECT / '.local/moe-readings.json').read_text(encoding='utf-8'))
    dictionary = json.loads((PROJECT / 'dist/data/cedict/dictionary.json').read_text(encoding='utf-8'))
    cedict = {row[0] for row in dictionary['entries']}
    original = {item['id']: item for item in data['items']}
    root_id_by_text = {root['text']: root['id'] for root in data['roots']}
    by_text = {item['text']: item for item in data['items'] if item['type'] in ['char', 'word']}
    chosen, decisions = {}, []
    for item in data['items']:
        if item['type'] not in ['char', 'word'] or not item.get('frequency'):
            continue
        word, row = item['text'], frequency.get(item['text'])
        keep, reason = selection(word, row, graded, moe, cedict)
        if keep:
            chosen[word] = {'rank': item['frequency'], 'word': word, 'pinyin': item.get('displayPinyin') or item['pinyin']}
        decisions.append({'id': item['id'], 'word': word, 'originalRank': item['frequency'],
                          'ppm': float(row['L']) if row else None, 'graded': word in graded,
                          'moe': word in moe, 'cedict': word in cedict, 'selected': keep, 'reason': reason})
    corpus = Corpus(list(chosen.values()))
    print(f'Curated lexical entries: {len(chosen)}; characters: {len(corpus.chars)}', flush=True)
    candidates = [('frequency prerequisite insertion', baseline(corpus))]
    for penalty, power in [(0.5, 2), (0.75, 2), (1, 2), (1.25, 2), (1.5, 2), (2, 2), (1, 0)]:
        jobs = density_order(corpus, penalty, power);audit(corpus, jobs)
        name = f'mixed-step density lambda={penalty}, p={power}'
        candidates.append((name, jobs));print(name, round(objective(corpus, jobs), 5), flush=True)
    for name, jobs in sorted(candidates, key=lambda pair: objective(corpus, pair[1]))[:3]:
        candidates.append((name+' + mixed-step exact DP', refine_jobs(corpus, jobs, width=8, passes=4)))
    name, jobs = min(candidates, key=lambda pair: objective(corpus, pair[1]));audit(corpus, jobs)
    # Merge single-character words after optimization, exactly as in the SC table.
    main = []
    for kind, identifier in jobs:
        word = corpus.entries[identifier]['word'] if kind else corpus.chars[identifier]
        if kind and len(word) == 1:
            continue
        main.append(copy.deepcopy(by_text[word]))
    active_ids = {item['id'] for item in main}
    roots = {item['id']: copy.deepcopy(item) for item in data['items'] if item['type'] == 'root'}
    foundations = {item['id']: copy.deepcopy(item) for item in data['items'] if item['type'] in ['initial', 'stroke', 'rule']}
    uses, character_uses = defaultdict(list), defaultdict(list)
    for item in main:
        root_ids = {root_id_by_text[glyph] for part in item['parts'] for glyph in part['division']}
        for root_id in root_ids:
            uses[root_id].append(item)
            if item['type'] == 'char':
                character_uses[root_id].append(item)
    for root_id, root in roots.items():
        root['coverageCount'] = len(uses[root_id]);root['characterCoverage'] = len(character_uses[root_id])
        root['coverageScore'] = math.fsum(1 / max(1, item.get('frequency') or 163747) for item in uses[root_id])
        root.pop('extension', None)
        root['firstNeededSourceId'] = next((item['id'] for item in main if item['type'] == 'char' and root_id in item['dependencies']), None)
    ordered, introduced = [], set()
    def introduce(identifier):
        if identifier in introduced:
            return
        item = roots.get(identifier) or foundations[identifier]
        for dependency in item['dependencies']:
            introduce(dependency)
        ordered.append(item);introduced.add(identifier)
    for item in main:
        if item['type'] == 'char':
            for root_id in sorted(item['dependencies'], key=lambda identifier: (-roots[identifier]['coverageScore'], identifier)):
                introduce(root_id)
        ordered.append(item);introduced.add(item['id'])
    extensions = [root for root in roots.values() if root['id'] not in introduced]
    for root in sorted(extensions, key=lambda item: (item['fullCode'], item['text'])):
        root['extension'] = True;introduce(root['id'])
    for identifier in foundations:
        introduce(identifier)
    for order, item in enumerate(ordered, 1):
        item['order'] = order
    retired = [{key: item[key] for key in ['id', 'text', 'type', 'code', 'frequency']} | {'retired': True}
               for item in data['items'] if item['type'] in ['char', 'word'] and item['id'] not in active_ids]
    positions = {item['id']: item['order'] for item in ordered}
    for item in ordered:
        assert all(positions[identifier] < item['order'] for identifier in item['dependencies'])
        assert item['code'] == original[item['id']]['code'], item['text']
    assert len(positions) == len(ordered)
    assert len(ordered) + len(retired) == data['stats']['total']
    assert all(by_text[word]['id'] in active_ids for word in graded if word in by_text and all(is_han(c) for c in word))
    stats = {'total': len(ordered), 'roots': len(roots), 'characters': sum(item['type']=='char' for item in ordered),
             'words': sum(item['type']=='word' for item in ordered), 'unsupported': sum(not item['code'] for item in ordered),
             'initials': 21, 'strokes': 6, 'rules': 1}
    report = {'version': 2, 'minimumMeanPpm': MIN_PPM, 'algorithm': name,
              'actualScAlgorithm': 'learning_order/build_step_order.py + merge_single_character_words.py',
              'previousTcAlgorithm': 'learning_order/build_learning_order.py (character-unlock objective only)',
              'policy': 'Keep all directly practicable NAER graded headwords. Other headwords require exact MOE or CC-CEDICT traditional lexical evidence and mean frequency >= 0.2 per million. Character prerequisites are included. Unselected observations are archived, not declared meaningless.',
              'baselineObjective': objective(corpus, candidates[0][1]), 'optimizedObjective': objective(corpus, jobs),
              'objectiveUnit': 'Every emitted character and word costs one step, before merging single-character words and inserting roots; same as SC.',
              'originalStats': data['stats'], 'stats': stats, 'archived': len(retired),
              'decisions': dict(Counter(row['reason'] for row in decisions)),
              'comparison': [{'algorithm': label, 'objective': objective(corpus, sequence)} for label, sequence in candidates],
              'progress': evaluate(corpus, name, jobs)['进度'],
              'sources': data['provenance']['sources'], 'cedictTextSha256': dictionary['source']['textSha256'],
              'stability': 'All existing IDs and code answers retained; archived card and log identities remain valid; original source SHA unchanged.'}
    # Keep source identity: this is a new selection/order over the same identity manifest.
    data['legacyProvenance'] = data['provenance']
    reading_counts = dict(Counter(item.get('readingSource', 'none') for item in ordered if item['type'] in ['char', 'word', 'root']))
    data['provenance'] = {**data['provenance'], 'algorithm': name, 'policy': report['policy'],
                          'wordCount': len(chosen), 'characterCount': stats['characters'],
                          'baselineObjective': report['baselineObjective'], 'optimizedObjective': report['optimizedObjective'],
                          'comparison': report['comparison'], 'coverage': report['progress'], 'readingCounts': reading_counts}
    data.update({'items': ordered, 'retiredItems': retired, 'stats': stats, 'curation': report,
                 'curriculumVersion': 'mapping-rootA-mixed-step-curated-tc-v2'})
    data['curriculum'].update({'algorithm': 'mixed-character-word-step-density-with-lexical-selection',
                               'usedRoots': len(roots)-len(extensions), 'extensionRoots': len(extensions),
                               'extensionRootIds': [root['id'] for root in extensions],
                               'sourceOrderPolicy': 'Stable original IDs; selected words and characters rescheduled with the same mixed-step objective as SC. Low-frequency ready words may wait.'})
    report_path = OUTPUT / '繁中詞庫篩選與排序核對.json'
    write_json(report_path, report)
    write_json(OUTPUT / '繁中詞條保留與歸檔.json', decisions)
    table_path = RUNTIME / data['downloads']['curriculum']
    fields = ['order','ID','sourceId','type','text','pinyin','code','displayCode','fullCode','fullDisplayCode','dependencies IDs','root coverage','kind','zhuyin','readingSource']
    temporary_table = table_path.with_suffix('.next.tsv')
    with temporary_table.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fields, delimiter='\t', lineterminator='\n');writer.writeheader()
        for item in ordered:
            coverage = list(dict.fromkeys(root_id_by_text[glyph] for part in item['parts'] for glyph in part['division']))
            full = item.get('fullCode', '')
            row = {'order': item['order'], 'ID': item['id'], 'sourceId': item.get('sourceId') or '',
                   'type': item['type'], 'text': item['text'], 'pinyin': item.get('displayPinyin') or item['pinyin'],
                   'code': item['code'] or '', 'displayCode': display_code(item), 'fullCode': full,
                   'fullDisplayCode': full[0].upper()+full[1:] if full else '',
                   'dependencies IDs': ' '.join(map(str, item['dependencies'])), 'root coverage': ' '.join(map(str, coverage)),
                   'kind': 'extension' if item.get('extension') else 'core' if item['type']=='root' else item['sourceType'],
                   'zhuyin': item.get('zhuyin', ''), 'readingSource': item.get('readingSource', '')}
            writer.writerow(row)
    temporary_table.replace(table_path)
    shutil.copyfile(table_path, OUTPUT / '繁中聲母首筆字根字詞優序學習表.tsv')
    with (RUNTIME / 'coverage.tsv').open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.writer(handle, delimiter='\t', lineterminator='\n');writer.writerow(['课程顺序','学习ID','原学习序号','类型','字词','编码','状态','原因'])
        for item in ordered:
            writer.writerow([item['order'],item['id'],item.get('sourceId') or '',item['sourceType'],item['text'],item['code'] or '', '已编码' if item['code'] else '未编码',item.get('unsupportedReason','')])
    metadata = json.loads((RUNTIME / 'metadata.json').read_text(encoding='utf-8'))
    temporary = RUNTIME / 'learning.next.json';write_json(temporary, data);temporary.replace(RUNTIME / 'learning.json')
    metadata.update({'stats': stats, 'supported': stats['total']-stats['unsupported'], 'curation': report,
                     'curriculum': data['curriculum'], 'curriculumVersion': data['curriculumVersion'], 'provenance': data['provenance'],
                     'reasonCounts': {}, 'unsupportedItems': [], 'readingCounts': reading_counts,
                     'ordering': report['objectiveUnit'], 'archivedItems': len(retired),
                     'learningBytes': (RUNTIME / 'learning.json').stat().st_size, 'learningSha256': sha256(RUNTIME / 'learning.json')})
    metadata['downloads']['curriculum'].update({'sha256': sha256(table_path), 'rows': len(ordered)})
    write_json(RUNTIME / 'metadata.json', metadata)
    print(json.dumps({'stats': stats, 'archived': len(retired), 'selected': name, 'elapsed': round(time.monotonic()-started, 1)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    run()
    from prepare_lessons import run as prepare_lessons
    prepare_lessons()
    import subprocess
    from build_curricula import build_and_validate
    build_and_validate()
