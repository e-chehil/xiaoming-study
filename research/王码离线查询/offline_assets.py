"""Download deduplicated root bitmaps and localize exported image references."""
import argparse
import concurrent.futures
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path, PurePosixPath
import re
import struct
import threading
import time
import urllib.parse

ROOT = Path(__file__).resolve().parent
BASE = 'http://www.wangma.net.cn'
MANIFEST = ROOT / 'image_manifest.json'

class MissingImageError(RuntimeError):
    pass

def source_path(value):
    if value.startswith('assets/WMZG/'):
        value = '/' + value.removeprefix('assets/')
    if not re.fullmatch(r'/WMZG/(?:root86|root98|root2006|rootwbsm)/[A-Za-z0-9]+\.bmp', value):
        raise ValueError('Unexpected root image path: ' + value)
    return value

def local_path(value):
    return 'assets/' + source_path(value).lstrip('/')

def inspect_bitmap(body):
    if len(body) < 26 or body[:2] != b'BM':
        raise ValueError('Response is not a BMP image')
    declared_size, offset, dib_size = (struct.unpack_from('<I', body, n)[0] for n in (2, 10, 14))
    if declared_size != len(body) or not 14 < offset < len(body):
        raise ValueError('Invalid BMP file size or pixel offset')
    if dib_size == 12:
        width, height, planes, bits = struct.unpack_from('<HHHH', body, 18)
        compression = 0
    elif dib_size >= 40 and len(body) >= 14 + dib_size:
        width, height, planes, bits, compression = struct.unpack_from('<iiHHI', body, 18)
    else:
        raise ValueError('Unsupported or truncated BMP header')
    if planes != 1 or width <= 0 or not height or bits not in (1, 4, 8, 16, 24, 32):
        raise ValueError('Invalid BMP dimensions or bit depth')
    if compression in (0, 3):
        expected = ((width * bits + 31) // 32) * 4 * abs(height)
        if offset + expected > len(body):
            raise ValueError('Truncated BMP pixels')
    return {'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(), 'width': width, 'height': abs(height), 'bits_per_pixel': bits}

def localize_roots(roots, manifest=None):
    if manifest is None:
        if not MANIFEST.exists():
            return roots
        manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
        if not manifest.get('localization_ready', manifest.get('complete')):
            return roots
    verified_paths = {}
    for record in roots['characters'].values():
        for detail in record.values():
            rewritten = []
            for value in detail['root_images']:
                source = source_path(value)
                if source not in verified_paths:
                    asset = manifest['images'].get(source) or manifest['missing_images'].get(source)
                    relative = asset['path']
                    if relative != local_path(source) or (source in manifest['images'] and not (ROOT / relative).is_file()):
                        raise ValueError('Local image is unavailable: ' + relative)
                    verified_paths[source] = relative
                relative = verified_paths[source]
                rewritten.append(relative)
            detail['root_images'] = rewritten
    roots['source_image_base_url'] = manifest.get('source_base_url', BASE)
    roots['image_base_url'] = '.'
    roots['image_path_base'] = 'Directory containing wangma_roots.json'
    roots['images_offline'] = manifest['complete']
    roots['image_paths_relative'] = True
    roots['downloaded_image_count'] = manifest['downloaded_image_count']
    roots['available_image_count'] = len(manifest['images'])
    roots['recovered_image_count'] = manifest.get('recovered_image_count', 0)
    roots['missing_image_count'] = len(manifest.get('missing_images', {}))
    roots['image_manifest'] = 'image_manifest.json'
    roots['missing_images'] = 'missing_images.json'
    if manifest.get('recovery_report'):
        roots['image_recovery_report'] = manifest['recovery_report']
    else:
        roots.pop('image_recovery_report', None)
    if manifest.get('image_mapping_report'):
        roots['image_mapping_report'] = manifest['image_mapping_report']
    else:
        roots.pop('image_mapping_report', None)
    return roots

def write_json(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)

class Downloader:
    def __init__(self, rps, previous_images=None):
        self.interval = 1 / rps
        self.next_request = 0
        self.lock = threading.Lock()
        self.local = threading.local()
        self.previous_images = previous_images or {}

    def fetch(self, source):
        relative = local_path(source)
        destination = ROOT / relative
        if destination.is_file():
            try:
                properties = inspect_bitmap(destination.read_bytes())
                previous = self.previous_images.get(source, {})
                if previous.get('sha256') == properties['sha256']:
                    entry = {**previous, 'source_kind': previous.get('source_kind', 'official_website'), **properties}
                else:
                    entry = {'path': relative, 'source_url': BASE + source, 'source_kind': 'local_existing_bitmap', **properties}
                return source, entry, True
            except ValueError:
                pass
        for attempt in range(3):
            with self.lock:
                delay = max(0, self.next_request - time.monotonic())
                self.next_request = max(self.next_request, time.monotonic()) + self.interval
            if delay:
                time.sleep(delay)
            previous = self.previous_images.get(source, {})
            source_url = previous.get('source_url', BASE + source)
            target = urllib.parse.urlsplit(source_url)
            if target.scheme != 'http' or target.hostname not in ('www.wangma.com.cn', 'www.wangma.net.cn'):
                raise ValueError('Unsupported official image URL: ' + source_url)
            if not getattr(self.local, 'connection', None) or getattr(self.local, 'hostname', None) != target.hostname:
                if getattr(self.local, 'connection', None):
                    self.local.connection.close()
                self.local.connection = http.client.HTTPConnection(target.hostname, timeout=20)
                self.local.hostname = target.hostname
            try:
                request_path = target.path + ('?' + target.query if target.query else '')
                referer = 'http://www.wangma.com.cn/query/wmhz2.asp' if target.path.startswith('/query/pic/') else BASE + '/search.aspx?sm=7'
                self.local.connection.request('GET', request_path, headers={'User-Agent': 'Mozilla/5.0', 'Referer': referer})
                response = self.local.connection.getresponse()
                body = response.read()
                if response.status in (404, 410):
                    raise MissingImageError('HTTP ' + str(response.status))
                if response.status != 200:
                    raise RuntimeError('HTTP ' + str(response.status))
                properties = inspect_bitmap(body)
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_name(destination.name + '.tmp')
                temporary.write_bytes(body)
                temporary.replace(destination)
                kind = 'official_legacy_website' if target.path.startswith('/query/pic/') else 'official_website'
                entry = {'path': relative, 'source_url': source_url, 'source_kind': kind, **properties}
                if previous.get('source_urls'):
                    entry['source_urls'] = previous['source_urls']
                return source, entry, False
            except MissingImageError:
                raise
            except (OSError, http.client.HTTPException, RuntimeError, ValueError):
                self.local.connection.close()
                self.local.connection = None
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rps', type=float, default=8)
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    roots_file = ROOT / 'wangma_roots.json'
    roots = json.loads(roots_file.read_text(encoding='utf-8'))
    references = [source_path(p) for record in roots['characters'].values() for detail in record.values() for p in detail['root_images']]
    sources = sorted(set(references))
    previous = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {}
    downloader = Downloader(args.rps, previous.get('images'))
    images, errors = {}, {}
    reused = 0
    last_log = time.monotonic()
    print(json.dumps({'event': 'start', 'image_references': len(references), 'unique_images': len(sources)}), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(downloader.fetch, source): source for source in sources}
        for future in concurrent.futures.as_completed(futures):
            source = futures[future]
            try:
                source, entry, cached = future.result()
                images[source] = entry
                reused += int(cached)
            except Exception as exc:
                errors[source] = str(exc)
            if time.monotonic() - last_log > 10:
                print(json.dumps({'event': 'progress', 'downloaded_or_reused': len(images), 'failed': len(errors), 'total': len(sources)}), flush=True)
                last_log = time.monotonic()
    missing = {source: {'path': local_path(source), 'source_url': BASE + source, 'http_status': int(error.split()[1])} for source, error in errors.items() if error in ('HTTP 404', 'HTTP 410')}
    manifest = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'complete': not errors and len(images) == len(sources),
        'scan_complete': len(images) + len(errors) == len(sources),
        'localization_ready': len(missing) == len(errors),
        'unique_image_count': len(sources),
        'downloaded_image_count': sum(entry['source_kind'] in ('official_website', 'official_legacy_website') for entry in images.values()),
        'available_image_count': len(images),
        'recovered_image_count': sum(entry['source_kind'] == 'official_trial_bitmap_record' for entry in images.values()),
        'missing_image_count': len(missing),
        'image_reference_count': len(references),
        'total_bytes': sum(entry['bytes'] for entry in images.values()),
        'reused_local_files': reused,
        'images': dict(sorted(images.items())),
        'missing_images': dict(sorted(missing.items())),
        'errors': errors,
    }
    if previous.get('recovery_report'):
        manifest['recovery_report'] = previous['recovery_report']
    for key in ('source_base_url', 'source_query_url', 'image_mapping_report'):
        if key in previous:
            manifest[key] = previous[key]
    write_json(MANIFEST, manifest)
    write_json(ROOT / 'missing_images.json', {'checked_at': manifest['generated_at'], 'missing_image_count': len(missing), 'missing_images': dict(sorted(missing.items()))})
    if not manifest['localization_ready']:
        raise RuntimeError('Some images failed; rerun to retry. JSON references were not changed.')
    write_json(roots_file, localize_roots(roots, manifest))
    print(json.dumps({k: v for k, v in manifest.items() if k not in ('images', 'errors', 'missing_images')}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
