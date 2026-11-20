"""Produce a reproducible audit without changing any input workbooks."""
from pathlib import Path
from collections import Counter
import json
import re
from curate_traditional import PROJECT, WORKSPACE, selection, graded_words
from prepare_data import sha256, write_json
from traditional_sources import read_sources


def run():
    extracted = json.loads((PROJECT / '.local/traditional-sources.json').read_text(encoding='utf-8'))
    actual_vocabulary, actual_frequency = read_sources(WORKSPACE / '詞語表、通用詞頻表')
    verified = actual_vocabulary == extracted['vocabulary'] and actual_frequency == extracted['frequency']
    assert verified, 'Raw workbook rows differ from extraction cache; rebuild and investigate before reporting.'
    frequency = extracted['frequency'];frequency_by_word = {row['B']: row for row in frequency}
    graded = graded_words(extracted['vocabulary'])
    moe = json.loads((PROJECT / '.local/moe-readings.json').read_text(encoding='utf-8'))
    dictionary = json.loads((PROJECT / 'dist/data/cedict/dictionary.json').read_text(encoding='utf-8'))
    trad, simp = ({row[column] for row in dictionary['entries']} for column in [0, 1])
    old = json.loads((PROJECT / '.local/traditional-unfiltered-v1.json').read_text(encoding='utf-8'))
    new = json.loads((PROJECT / 'dist/data/traditional/learning.json').read_text(encoding='utf-8'))
    sc = json.loads((PROJECT / 'dist/data/learning.json').read_text(encoding='utf-8'))
    compare = []
    for limit in [1000, 10000, 50000]:
        row = {'rankLimit': limit}
        for name, data, lexicon in [('simplified', sc, simp), ('traditionalRaw', old, trad)]:
            sample = [item for item in data['items'] if item['type'] in ['char', 'word'] and 0 < (item.get('frequency') or 0) <= limit]
            matches = sum(item['text'] in lexicon for item in sample)
            row[name] = {'total': len(sample), 'matched': matches, 'percentage': round(matches/len(sample)*100, 2)}
        compare.append(row)
    examples = []
    for word in ['一', '一一', '一一一', '一一一一', '在在', '學習', '臺灣', '台積電', '螢幕', '滑鼠']:
        row = frequency_by_word[word]
        previous = next(item for item in old['items'] if item['type'] in ['char', 'word'] and item['text']==word)
        current = next((item for item in new['items'] if item['type'] in ['char', 'word'] and item['text']==word), None)
        examples.append({'word': word, 'originalRank': int(row['A']), 'excelRow': int(row['A'])+1,
                         'meanPpm': float(row['L']), 'writtenCount': int(row['C']), 'spokenCount': int(row['F']), 'newsCount': int(row['I']),
                         'moe': word in moe, 'cedict': word in trad, 'graded': word in graded,
                         'oldOrder': previous['order'], 'newOrder': current['order'] if current else None,
                         'stableId': previous['id'], 'newId': current['id'] if current else None})
    sensitivity = []
    for floor in [0, 0.05, 0.1, 0.2, 0.5, 1]:
        selected = [row for row in frequency if selection(row['B'], row, graded, moe, trad, floor)[0]]
        sensitivity.append({'minimumMeanPpm': floor, 'observedHeadwords': len(selected),
                            'multiCharacterWords': sum(len(row['B'])>1 for row in selected),
                            'cedictPercentage': round(sum(row['B'] in trad for row in selected)/len(selected)*100, 2)})
    def early(data):
        words = [item for item in data['items'][:300] if item['type']=='word']
        return {'wordsInFirst300Lessons': len(words), 'wordsBeyondRank10000': sum((item.get('frequency') or 0)>10000 for item in words),
                'examples': [{'word': item['text'], 'rank': item['frequency'], 'order': item['order']} for item in words if item['frequency']>10000][:15]}
    report = {'date': '2026-10-23', 'sourceRows': {'graded': len(extracted['vocabulary']), 'frequency': len(frequency)},
              'sources': [{'file': path.name, 'sha256': sha256(path)} for path in (WORKSPACE / '詞語表、通用詞頻表').glob('*')],
              'rawXlsxVerifiedAgainstParsedCache': verified,
              'verifiedReason': 'Direct XLSX row-by-row read equaled the cached 163701 records during this audit; A=rank, B=word, L=mean ppm. Raw workbooks were never edited.',
              'equalRankComparison': compare, 'examples': examples, 'thresholdSensitivity': sensitivity,
              'oldStats': old['stats'], 'newStats': new['stats'], 'simplifiedStats': sc['stats'],
              'earlyOld': early(old), 'earlyNew': early(new),
              'conclusions': ['Source ranks were read correctly; the teaching list incorrectly included all corpus observations.',
                              'SC used build_step_order, but TC previously used build_learning_order. The latter ignores the cost of already-unlocked word jobs.',
                              'An unmatched dictionary headword is not proof of a meaningless phrase. Exact lexical evidence and graded-word preservation are used together.',
                              '0.2 mean ppm is an explicit local teaching threshold, not an official definition of a word; the sensitivity table records its tradeoff.'],
              'coverage': json.loads((PROJECT / 'dist/data/cedict/coverage.json').read_text(encoding='utf-8'))['courses']}
    output = WORKSPACE / 'outputs/traditional_learning_order_20261023'
    write_json(output / '繁中詞庫問題審計.json', report)
    print(json.dumps({'equalRankComparison': compare, 'thresholdSensitivity': sensitivity, 'earlyOld': report['earlyOld'], 'earlyNew': report['earlyNew']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    run()
