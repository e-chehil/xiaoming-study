"""Replace every root image with original files from the official ASP site."""
import argparse
import concurrent.futures
from datetime import datetime, timezone
import http.client
import json
from pathlib import Path
import shutil
import threading
import time
import zipfile
from offline_assets import source_path, local_path, inspect_bitmap, localize_roots, write_json

ROOT = Path(__file__).resolve().parent
STAGE = ROOT / 'legacy_resources'
BASE = 'http://www.wangma.com.cn'
FOLDERS = {'wubi86': '86', 'wubi98': '98', 'wubi2006': '06', 'numeric6_head_rest': '6j', 'numeric9_first4_last1': '9j', 'numeric9_head_rest': '9j'}
# The old 9j/82 URL returns HTTP 200 with zero bytes. The official 6j copy is
# byte-identical to the original rootwbsm/82 bitmap independently saved earlier.
FALLBACKS = {'/query/pic/9j/82.bmp': '/query/pic/6j/82.bmp'}
FALLBACK_SHA256 = '9ac082f405b1aeac7288054552cfc0d96e1a09c3210a2c07d8cea707fe1fbbac'

def remote_path(field, original):
    stem = Path(original).stem
    suffix = '_1' if field == 'wubi86' else ''
    return '/query/pic/' + FOLDERS[field] + '/' + stem + suffix + '.bmp'

class Fetcher:
    def __init__(self, rps, reuse):
        self.interval = 1 / rps
        self.next_request = 0
        self.lock = threading.Lock()
        self.local = threading.local()
        self.reuse = reuse

    def fetch(self, path):
        target = STAGE / 'downloaded' / path.lstrip('/')
        if self.reuse and target.is_file():
            return path, inspect_bitmap(target.read_bytes())
        for attempt in range(3):
            with self.lock:
                delay = max(0, self.next_request - time.monotonic())
                self.next_request = max(self.next_request, time.monotonic()) + self.interval
            if delay:
                time.sleep(delay)
            if not getattr(self.local, 'connection', None):
                self.local.connection = http.client.HTTPConnection('www.wangma.com.cn', timeout=20)
            try:
                self.local.connection.request('GET', path, headers={'User-Agent': 'Mozilla/5.0', 'Referer': BASE + '/query/wmhz2.asp'})
                response = self.local.connection.getresponse()
                body = response.read()
                if response.status != 200:
                    raise RuntimeError('HTTP ' + str(response.status))
                properties = inspect_bitmap(body)
                target.parent.mkdir(parents=True, exist_ok=True)
                temp = target.with_name(target.name + '.tmp')
                temp.write_bytes(body)
                temp.replace(target)
                return path, properties
            except (OSError, http.client.HTTPException, RuntimeError, ValueError):
                self.local.connection.close()
                self.local.connection = None
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--reuse-stage', action='store_true')
    parser.add_argument('--rps', type=float, default=8)
    args = parser.parse_args()
    roots_file = ROOT / 'wangma_roots.json'
    roots = json.loads(roots_file.read_text(encoding='utf-8'))
    mapping = {}
    references = 0
    for record in roots['characters'].values():
        for field, detail in record.items():
            for image in detail['root_images']:
                original = source_path(image)
                item = mapping.setdefault(original, {'local_path': local_path(original), 'fields': set(), 'legacy_paths': set(), 'expected_legacy_paths': set()})
                item['fields'].add(field)
                expected = remote_path(field, original)
                item['expected_legacy_paths'].add(expected)
                item['legacy_paths'].add(FALLBACKS.get(expected, expected))
                references += 1
    paths = sorted({path for entry in mapping.values() for path in entry['legacy_paths']})
    print(json.dumps({'event': 'start', 'image_references': references, 'unique_local_images': len(mapping), 'remote_files': len(paths)}, ensure_ascii=False), flush=True)
    fetcher = Fetcher(args.rps, args.reuse_stage)
    downloaded, errors = {}, {}
    last_log = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fetcher.fetch, path): path for path in paths}
        for future in concurrent.futures.as_completed(futures):
            path = futures[future]
            try:
                path, properties = future.result()
                downloaded[path] = properties
            except Exception as exc:
                errors[path] = str(exc)
            if time.monotonic() - last_log > 10:
                print(json.dumps({'event': 'progress', 'downloaded': len(downloaded), 'errors': len(errors), 'total': len(paths)}), flush=True)
                last_log = time.monotonic()
    write_json(STAGE / 'download_manifest.json', {'source_base_url': BASE, 'downloaded': downloaded, 'errors': errors})
    if errors:
        raise RuntimeError('Original resource download was incomplete; existing assets were not replaced.')
    for requested, resolved in FALLBACKS.items():
        if resolved in downloaded:
            assert downloaded[resolved]['sha256'] == FALLBACK_SHA256
    aliases = []
    images = {}
    previous = json.loads((ROOT / 'image_manifest.json').read_text(encoding='utf-8'))
    byte_unchanged = 0
    for original, entry in sorted(mapping.items()):
        candidates = sorted(entry['legacy_paths'])
        selected = candidates[0]
        primary = (STAGE / 'downloaded' / selected.lstrip('/')).read_bytes()
        for candidate in candidates[1:]:
            alternate = (STAGE / 'downloaded' / candidate.lstrip('/')).read_bytes()
            exact = primary == alternate
            pixels_equal = exact
            assert pixels_equal, (original, candidates, 'Numeric versions require separate local assets')
            aliases.append({'original_reference': original, 'paths': [selected, candidate], 'bytes_identical': exact, 'pixels_identical': pixels_equal})
        old = previous['images'].get(original)
        byte_unchanged += int(old is not None and old['sha256'] == downloaded[selected]['sha256'])
        images[original] = {'path': entry['local_path'], 'source_url': BASE + selected, 'source_urls': [BASE + path for path in candidates], 'source_kind': 'official_legacy_website', 'original_reference': original, **downloaded[selected]}
        entry['fields'] = sorted(entry['fields'])
        entry['legacy_paths'] = candidates
        entry['expected_legacy_paths'] = sorted(entry['expected_legacy_paths'])
    now = datetime.now(timezone.utc).isoformat()
    report = {'generated_at': now, 'source_query_url': BASE + '/query/wmhz2.asp', 'source_base_url': BASE, 'remote_original_files_downloaded': len(downloaded), 'local_images': len(images), 'image_references': references, 'numeric_directory_alias_checks': aliases, 'fallback_resolutions': {requested: {'source': resolved, 'reason': 'Requested URL is HTTP 200 with an empty body; official alternate is byte-identical to the independently saved original rootwbsm/82.bmp', 'verified_sha256': FALLBACK_SHA256} for requested, resolved in FALLBACKS.items()}, 'same_bytes_as_previous_local_images': byte_unchanged, 'all_images_are_direct_downloads': True, 'all_numeric_aliases_pixels_identical': True, 'downloaded_files': downloaded, 'mapping': mapping}
    write_json(STAGE / 'mapping_report.json', report)
    if args.apply:
        backup = STAGE / 'before_legacy_refresh.zip'
        if not backup.exists():
            with zipfile.ZipFile(backup, 'w', zipfile.ZIP_DEFLATED) as archive:
                for file in ['wangma_roots.json', 'image_manifest.json', 'missing_images.json', 'README.txt']:
                    archive.write(ROOT / file, arcname=file)
                for item in previous['images'].values():
                    archive.write(ROOT / item['path'], arcname=item['path'])
        for original, entry in images.items():
            selected = mapping[original]['legacy_paths'][0]
            destination = ROOT / entry['path']
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(STAGE / 'downloaded' / selected.lstrip('/'), destination)
        manifest = {'generated_at': now, 'source_base_url': BASE, 'source_query_url': BASE + '/query/wmhz2.asp', 'image_mapping_report': 'legacy_image_mapping.json', 'complete': True, 'scan_complete': True, 'localization_ready': True, 'unique_image_count': len(images), 'downloaded_image_count': len(images), 'available_image_count': len(images), 'recovered_image_count': 0, 'missing_image_count': 0, 'image_reference_count': references, 'total_bytes': sum(e['bytes'] for e in images.values()), 'images': images, 'missing_images': {}, 'errors': {}}
        write_json(ROOT / 'legacy_image_mapping.json', report)
        write_json(ROOT / 'image_manifest.json', manifest)
        write_json(ROOT / 'missing_images.json', {'checked_at': now, 'missing_image_count': 0, 'missing_images': {}})
        write_json(roots_file, localize_roots(roots, manifest))
    print(json.dumps({key: value for key, value in report.items() if key not in ('mapping', 'numeric_directory_alias_checks', 'downloaded_files')}, ensure_ascii=False, indent=2), flush=True)

if __name__ == '__main__':
    main()
