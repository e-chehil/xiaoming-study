"""Build a compact classic-script dataset for direct file:// offline queries."""
import json
from pathlib import Path
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parent
FIELDS = [
    ('wubi86', '86 版', '五笔字型', '', '五笔字型86版'),
    ('wubi98', '98 版', '五笔字型', '', '五笔字型98版'),
    ('wubi2006', '新世纪版', '五笔字型', '', '五笔字型新世纪版'),
    ('numeric6_first4_last1', '6 键', '数字王码', '前四末一', '数字王码6键（前四末一）'),
    ('numeric9_first4_last1', '9 键', '数字王码', '前四末一', '数字王码9键（前四末一）'),
    ('numeric6_head_rest', '6 键', '数字王码', '首部余部', '数字王码6键（首部余部）'),
    ('numeric9_head_rest', '9 键', '数字王码', '首部余部', '数字王码9键（首部余部）'),
]

def build():
    source = ROOT / 'wangma_roots.json'
    roots = json.loads(source.read_text(encoding='utf-8'))
    manifest = json.loads((ROOT / 'image_manifest.json').read_text(encoding='utf-8'))
    assert manifest['complete'] and manifest['missing_image_count'] == 0
    assert len(roots['characters']) == 15432
    images = sorted({path for record in roots['characters'].values() for detail in record.values() for path in detail['root_images']})
    assert len(images) == 866
    ids = {path: index for index, path in enumerate(images)}
    for path in images:
        assert (ROOT / path).is_file(), path
    characters = {}
    for character, record in roots['characters'].items():
        characters[character] = [[record[key]['code'], [ids[path] for path in record[key]['root_images']], record[key]['root_text']] for key, *_ in FIELDS]
    payload = {'metadata': {'characterCount': len(characters), 'imageCount': len(images), 'sourceJsonSha256': hashlib.sha256(source.read_bytes()).hexdigest()}, 'fields': [{'key': key, 'title': title, 'category': category, 'subtitle': subtitle, 'fullTitle': full} for key, title, category, subtitle, full in FIELDS], 'images': images, 'characters': characters}
    # Classic scripts load from file:// without fetch, a server, or CORS options.
    (ROOT / 'query-data.js').write_text('window.WANGMA_QUERY_DATA=' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    # Independently expand every compact record and compare it with source JSON.
    roundtrip = json.loads((ROOT / 'query-data.js').read_text(encoding='utf-8').removeprefix('window.WANGMA_QUERY_DATA=').removesuffix(';\n'))
    for character, entries in roundtrip['characters'].items():
        for index, (key, *_) in enumerate(FIELDS):
            code, image_ids, text = entries[index]
            assert {'code': code, 'root_images': [roundtrip['images'][item] for item in image_ids], 'root_text': text} == roots['characters'][character][key]
    print(json.dumps({'characters': len(characters), 'images': len(images), 'codes_verified': len(characters) * len(FIELDS), 'data_script_bytes': (ROOT / 'query-data.js').stat().st_size}, ensure_ascii=False))

def package():
    manifest = json.loads((ROOT / 'image_manifest.json').read_text(encoding='utf-8'))
    files = ['index.html', 'app.css', 'app.js', 'query-data.js', 'README.txt', 'build_offline_page.py', 'wangma_codes.json', 'wangma_roots.json', 'image_manifest.json', 'legacy_image_mapping.json', 'missing_images.json', 'validation_report.json', 'page_validation_report.json']
    files += sorted(entry['path'] for entry in manifest['images'].values())
    with zipfile.ZipFile(ROOT / 'wangma_offline_query.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in files:
            archive.write(ROOT / name, arcname=name)
    print(json.dumps({'package': 'wangma_offline_query.zip', 'files': len(files), 'bytes': (ROOT / 'wangma_offline_query.zip').stat().st_size}))

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', action='store_true')
    args = parser.parse_args()
    package() if args.package else build()
