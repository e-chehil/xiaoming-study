"""Verify exported data against every saved original response, then package it."""
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import sqlite3
import zipfile
import zlib
from offline_assets import source_path, local_path, inspect_bitmap

ROOT = Path(__file__).resolve().parent
KEYS = ['wubi86', 'wubi98', 'wubi2006', 'numeric6_first4_last1', 'numeric9_first4_last1', 'numeric6_head_rest', 'numeric9_head_rest']

def main():
    data = json.loads((ROOT / 'wangma_codes.json').read_text(encoding='utf-8'))
    roots = json.loads((ROOT / 'wangma_roots.json').read_text(encoding='utf-8'))
    coverage = json.loads((ROOT / 'coverage.json').read_text(encoding='utf-8'))
    recheck = json.loads((ROOT / 'empty_recheck.json').read_text(encoding='utf-8'))
    db = sqlite3.connect(ROOT / 'results.sqlite3')
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert data['metadata'] == roots['metadata'] == coverage['metadata']
    records = data['characters']
    offline = roots.get('image_paths_relative', roots.get('images_offline', False))
    image_manifest = json.loads((ROOT / 'image_manifest.json').read_text(encoding='utf-8')) if offline else None
    seen_images = set()
    image_references = 0
    missing_image_references = 0
    if offline:
        assert roots['image_base_url'] == '.'
        assert image_manifest['scan_complete'] and image_manifest['localization_ready']
    assert records.keys() == roots['characters'].keys()
    raw_rows = list(db.execute('SELECT char,codes,html_zlib,fetched_at FROM results'))
    missing = []
    checked = 0
    for char, cached, raw, fetched_at in raw_rows:
        source = zlib.decompress(raw).decode('utf-8-sig')
        assert '的编码查询结果是：' in source, char
        title = re.search(r'class="font_wo"[^>]*>(.*?)</font>', source, re.S)
        assert title and html.unescape(title[1]).strip() == char, char
        original_codes = re.findall(r'</li>\s*<li[^>]*>\s*([A-Z0-9]+)\(', source)
        assert len(original_codes) in (0, 7), (char, original_codes)
        if not original_codes:
            assert char not in records and json.loads(cached) == {}, char
            missing.append(char)
            continue
        result = records[char]
        assert set(result) == set(KEYS), char
        assert result == json.loads(cached), char
        assert [result[k] for k in KEYS] == original_codes, char
        for key in KEYS:
            assert type(result[key]) is str and result[key], (char, key)
            assert roots['characters'][char][key]['code'] == result[key], (char, key)
            for path in roots['characters'][char][key]['root_images']:
                original_path = source_path(path)
                assert original_path in source, (char, path)
                if offline:
                    asset = image_manifest['images'].get(original_path) or image_manifest['missing_images'].get(original_path)
                    assert asset and path == local_path(original_path) == asset['path'], (char, path)
                    missing_image_references += int(original_path in image_manifest['missing_images'])
                else:
                    assert path.startswith('/WMZG/'), (char, key, path)
                seen_images.add(original_path)
                image_references += 1
        checked += 1
    meta = data['metadata']
    assert len(raw_rows) == meta['queried_count']
    assert checked == len(records) == meta['record_count']
    assert set(missing) == set(coverage['not_found'])
    assert recheck['all_still_empty']
    assert {row['character'] for row in recheck['characters']} == set(coverage['legacy_charset_not_found'])
    assert meta['candidate_count'] == len(raw_rows) + len(coverage['pending'])
    assert meta['complete_candidate_scan'] and not coverage['pending'], 'Scan is not finished'
    assert set(coverage['pending']).isdisjoint(records)
    files = ['wangma_codes.json', 'wangma_roots.json', 'coverage.json', 'empty_recheck.json', 'README.txt', 'extract.py', 'probe.py', 'validate.py', 'offline_assets.py', 'results.sqlite3']
    for page_file in ('index.html', 'app.css', 'app.js', 'query-data.js', 'build_offline_page.py', 'page_validation_report.json'):
        if (ROOT / page_file).is_file():
            files.append(page_file)
    if offline:
        assert seen_images == set(image_manifest['images']) | set(image_manifest['missing_images'])
        assert set(image_manifest['images']).isdisjoint(image_manifest['missing_images'])
        assert len(seen_images) == image_manifest['unique_image_count']
        assert len(image_manifest['images']) == image_manifest.get('available_image_count', image_manifest['downloaded_image_count'])
        assert len(image_manifest['missing_images']) == image_manifest['missing_image_count']
        assert image_references == image_manifest['image_reference_count']
        for entry in image_manifest['images'].values():
            properties = inspect_bitmap((ROOT / entry['path']).read_bytes())
            assert all(entry[key] == value for key, value in properties.items()), entry['path']
        files += ['image_manifest.json', 'missing_images.json'] + sorted(entry['path'] for entry in image_manifest['images'].values())
        if image_manifest.get('image_mapping_report'):
            mapping = json.loads((ROOT / image_manifest['image_mapping_report']).read_text(encoding='utf-8'))
            assert mapping['local_images'] == len(image_manifest['images'])
            assert mapping['image_references'] == image_references
            assert mapping['remote_original_files_downloaded'] == len(mapping['downloaded_files'])
            for entry in image_manifest['images'].values():
                assert entry['source_kind'] == 'official_legacy_website'
                url_path = entry['source_url'].removeprefix('http://www.wangma.com.cn')
                assert mapping['downloaded_files'][url_path]['sha256'] == entry['sha256']
            for alias in mapping['numeric_directory_alias_checks']:
                if alias['bytes_identical']:
                    assert len({mapping['downloaded_files'][path]['sha256'] for path in alias['paths']}) == 1
            files += [image_manifest['image_mapping_report'], 'refresh_legacy_assets.py']
    report = {
        'validated_at': datetime.now(timezone.utc).isoformat(),
        'sqlite_integrity': 'ok',
        'complete_candidate_scan': True,
        'queried_characters': len(raw_rows),
        'characters_with_seven_codes': checked,
        'total_codes_verified_against_original_html': checked * 7,
        'not_found': sorted(missing, key=ord),
        'empty_results_rechecked': True,
        'empty_results_recheck_scope': 'GB2312/Big5/CP950 candidate set',
        'additional_cjk_found': coverage['additional_cjk_found'],
        'site_declared_count': 15432,
        'matches_site_declared_count': checked == 15432,
        'first_fetched_at': min(r[3] for r in raw_rows),
        'last_fetched_at': max(r[3] for r in raw_rows),
        'images_offline': roots.get('images_offline', False),
        'image_paths_relative': offline,
        'unique_root_images': len(seen_images),
        'root_image_references': image_references,
        'local_image_hashes_verified': len(image_manifest['images']) if offline else 0,
        'missing_root_images': len(image_manifest['missing_images']) if offline else 0,
        'missing_root_image_references': missing_image_references,
        'images_downloaded_from_website': image_manifest['downloaded_image_count'] if offline else 0,
        'images_recovered_from_official_trial': image_manifest.get('recovered_image_count', 0) if offline else 0,
        'files': {name: {'bytes': (ROOT / name).stat().st_size, 'sha256': hashlib.sha256((ROOT / name).read_bytes()).hexdigest()} for name in files},
    }
    (ROOT / 'validation_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if offline:
        offline_files = ['wangma_codes.json', 'wangma_roots.json', 'coverage.json', 'README.txt', 'image_manifest.json', 'missing_images.json', 'validation_report.json']
        offline_files += sorted(entry['path'] for entry in image_manifest['images'].values())
        if image_manifest.get('image_mapping_report'):
            offline_files += [image_manifest['image_mapping_report']]
        with zipfile.ZipFile(ROOT / 'wangma_offline_original.zip', 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in offline_files:
                archive.write(ROOT / name, arcname=name)
    print(json.dumps({key: value for key, value in report.items() if key not in ('not_found', 'files')}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
