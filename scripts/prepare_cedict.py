"""Build the complete, shared offline CC-CEDICT asset; never modify a curriculum."""
import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path
from urllib.request import urlretrieve

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public/data/cedict'
URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz'
LINE = re.compile(r'^(\S+) (\S+) (\[\[.*?\]\]|\[.*?\]) /(.+)/$')


def parse(text):
    metadata, entries = {}, []
    for number, line in enumerate(text.splitlines(), 1):
        if line.startswith('#! '):
            key, value = line[3:].split('=', 1)
            metadata[key] = value
        elif line and not line.startswith('#'):
            match = LINE.fullmatch(line)
            if not match:
                raise ValueError(f'Invalid CC-CEDICT record at line {number}: {line}')
            traditional, simplified, pinyin, definition = match.groups()
            # Keep every sense, usage label, reference and original numbered reading.
            entries.append([traditional, simplified, pinyin.strip('[]'), definition.split('/'), 2 if pinyin.startswith('[[') else 1])
    if int(metadata.get('entries', len(entries))) != len(entries):
        raise ValueError('CC-CEDICT header count does not match parsed records')
    return metadata, entries


def build(update=False):
    DEST.mkdir(parents=True, exist_ok=True)
    archive = ROOT / '.cache/cedict_1_0_ts_utf-8_mdbg.txt.gz'
    archive.parent.mkdir(parents=True, exist_ok=True)
    if update or not archive.exists():
        temporary = archive.with_suffix('.download')
        urlretrieve(URL, temporary)
        # Validate before replacing the previous, usable source.
        parse(gzip.decompress(temporary.read_bytes()).decode('utf-8-sig'))
        temporary.replace(archive)
    raw = gzip.decompress(archive.read_bytes())
    metadata, entries = parse(raw.decode('utf-8-sig'))
    license_url = metadata.get('license', '')
    if license_url != 'https://creativecommons.org/licenses/by-sa/4.0/':
        raise ValueError(f'Review upstream license before rebuilding: {license_url}')
    info = {
        'name': 'CC-CEDICT', 'publisher': metadata['publisher'], 'date': metadata['date'],
        'entries': len(entries), 'license': 'CC BY-SA 4.0', 'licenseUrl': license_url,
        'url': URL, 'homepage': 'https://cc-cedict.org/',
        'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'textSha256': hashlib.sha256(raw).hexdigest(),
        'modifications': 'Parsed into JSON arrays; all headwords, readings and definition senses preserved. Runtime matching, summaries and reference expansion are derived views.',
    }
    content = {'version': 1, 'source': info, 'fields': ['traditional', 'simplified', 'pinyin', 'definitions', 'formatVersion'], 'entries': entries}
    (DEST / 'dictionary.json').write_text(json.dumps(content, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (DEST / 'metadata.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    header = '\n'.join(line for line in raw.decode('utf-8-sig').splitlines() if line.startswith('#'))
    (DEST / 'NOTICE.txt').write_text(header + '\n\nLocal adaptation: ' + info['modifications'] + '\nDerived dictionary data is distributed under CC BY-SA 4.0.\nLicense: ' + license_url + '\n', encoding='utf-8')
    manifest_path = ROOT / 'public/data/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    dictionary_bytes = (DEST / 'dictionary.json').read_bytes()
    manifest['dictionary'].update(bytes=len(dictionary_bytes), sha256=hashlib.sha256(dictionary_bytes).hexdigest())
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({**info, 'jsonBytes': len(dictionary_bytes)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--update', action='store_true', help='Download and validate the latest official release')
    build(parser.parse_args().update)
