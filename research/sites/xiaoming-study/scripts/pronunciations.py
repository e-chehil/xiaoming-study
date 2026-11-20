"""Display readings; never use dictionary readings to change official root codes."""
import sys
import re
import unicodedata
from pathlib import Path
from functools import lru_cache

WORKSPACE = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(WORKSPACE / 'ocr_comparison' / 'proofread_deps'))
from pypinyin import pinyin, Style
from pypinyin.constants import PINYIN_DICT
from pypinyin.contrib.tone_convert import to_normal
from pypinyin.style.bopomofo import converter

SYLLABLES = {unicodedata.normalize('NFC', s) for values in PINYIN_DICT.values() for s in values.split(',')}
SYLLABLES |= {to_normal(s) for s in SYLLABLES}
SYLLABLES |= {'r', 'ê', 'ń', 'ň', 'ǹ', 'ḿ'}
BY_FIRST = {}
for syllable in SYLLABLES:
    BY_FIRST.setdefault(syllable[0], []).append(syllable)
for values in BY_FIRST.values():
    values.sort(key=lambda s: (-len(s), s))


@lru_cache(maxsize=300000)
def split_syllables(text):
    text = unicodedata.normalize('NFC', text.lower().replace('u:', 'ü'))
    if not text:
        return ()
    if text[0] in " '’ʼ-":
        return split_syllables(text[1:])
    for syllable in BY_FIRST.get(text[0], []):
        if text.startswith(syllable):
            tail = split_syllables(text[len(syllable):])
            if tail is not None:
                return (syllable,) + tail
    return None


def transliterate(value, text=''):
    readings = []
    predicted = [v[0] for v in pinyin(text, style=Style.TONE)] if text else []
    def plain(s):
        return re.sub(r"[ '’ʼ-]", '', unicodedata.normalize('NFC', s.lower()))
    for variant in re.split(r'\s*[/／]\s*', value):
        # When the original spelling agrees, use the word-aware syllable
        # boundaries (e.g. 心肝 xīn+gān, not xīng+ān). Never replace its tones.
        syllables = tuple(predicted) if predicted and plain(''.join(predicted)) == plain(variant) else split_syllables(variant.strip())
        if not syllables:
            return ''
        readings.append(' '.join(converter.to_bopomofo(s) for s in syllables))
    return ' / '.join(dict.fromkeys(readings))


def inferred(text):
    values = pinyin(text, style=Style.TONE, errors=lambda s: [s])
    syllables = [v[0] for v in values]
    return ' '.join(syllables), ' '.join(converter.to_bopomofo(s) for s in syllables)


def enrich(dataset, lexicon=None):
    lexicon = lexicon or {}
    counts = {}
    for item in dataset['items']:
        if item['type'] in ('initial', 'stroke', 'rule'):
            continue
        found = lexicon.get(item['text']) if item['type'] != 'root' else None
        if found:
            item['pinyin'], item['zhuyin'], item['readingSource'] = found['pinyin'], found['zhuyin'], found['source']
            if found.get('level'):
                item['level'] = found['level']
        elif item.get('pinyin') and transliterate(item['pinyin'], item['text']):
            item['zhuyin'] = transliterate(item['pinyin'], item['text'])
            item['readingSource'] = 'scheme' if item['type'] == 'root' else 'source-pinyin'
        elif item['type'] != 'root' and all('\u3400' <= c <= '\u9fff' for c in item['text']):
            item['displayPinyin'], item['zhuyin'] = inferred(item['text'])
            item['readingSource'] = 'inferred'
        counts[item.get('readingSource', 'none')] = counts.get(item.get('readingSource', 'none'), 0) + 1
    return counts
