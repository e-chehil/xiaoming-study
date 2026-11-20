"""Resumeable, rate-limited extraction of the public seven-code lookup.

Uses the independent session initialized with probe.py and a normally solved
captcha. No database access or hidden endpoints are used.
"""
import argparse
import concurrent.futures
from datetime import datetime, timezone
import html
import http.client
import http.cookiejar
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
import urllib.parse
import zlib
from offline_assets import localize_roots

ROOT = Path(__file__).resolve().parent
FIELDS = {
    'wubi86': '王码五笔字型86版',
    'wubi98': '王码五笔字型98版',
    'wubi2006': '王码五笔字型新世纪版',
    'numeric6_first4_last1': '数字王码6键（前四末一）',
    'numeric9_first4_last1': '数字王码9键（前四末一）',
    'numeric6_head_rest': '数字王码6键（首部余部）',
    'numeric9_head_rest': '数字王码9键（首部余部）',
}
REVERSE = {v: k for k, v in FIELDS.items()}

def text(value):
    return re.sub(r'\s+', '', html.unescape(re.sub(r'<[^>]+>', '', value)))

def parse_page(source, char):
    if '的编码查询结果是：' not in source:
        raise ValueError('Not a lookup result (session/captcha/server error)')
    titles = re.findall(r'class="font_wo"[^>]*>(.*?)</font>', source, re.S)
    if len(titles) != 1 or text(titles[0]) != char:
        raise ValueError('Returned character does not match request')
    codes, details = {}, {}
    blocks = re.findall(r'<div class="reuslt_tab_li">(.*?)</div>', source, re.S)
    for block in blocks:
        items = re.findall(r'<li\b[^>]*>(.*?)</li>', block, re.S)
        if len(items) != 2:
            raise ValueError('Unexpected result row')
        label = re.sub(r'<span>.*?</span>', '', items[0], flags=re.S)
        label = text(label).rstrip('：:')
        if label not in REVERSE:
            raise ValueError('Unknown label: ' + label)
        key = REVERSE[label]
        value = text(items[1])
        match = re.fullmatch(r'([A-Z0-9]+)\((.*?)\)', value)
        if not match:
            raise ValueError('Unexpected code: ' + value)
        if key in codes:
            raise ValueError('Duplicate result category')
        codes[key] = match[1]
        details[key] = {
            'code': match[1],
            'root_images': re.findall(r'<img\b[^>]*src="([^"]+)"', items[1]),
            'root_text': match[2],
        }
    if codes and set(codes) != set(FIELDS):
        raise ValueError('Incomplete seven-code result: ' + ','.join(codes))
    return codes, details

def legacy_candidates():
    found = set()
    for codec in ('gb2312', 'big5', 'cp950'):
        for lead in range(0x81, 0xff):
            for trail in range(0x40, 0xff):
                try:
                    char = bytes((lead, trail)).decode(codec)
                except UnicodeDecodeError:
                    continue
                if len(char) == 1 and (0x3400 <= ord(char) <= 0x9fff or 0xf900 <= ord(char) <= 0xfaff):
                    found.add(char)
    return sorted(found, key=ord)

def candidates():
    # Independently check every remaining BMP unified ideograph so a codec
    # mapping difference cannot silently hide an otherwise queryable character.
    return sorted(set(legacy_candidates()) | {chr(cp) for cp in range(0x4e00, 0xa000)}, key=ord)

def database():
    db = sqlite3.connect(ROOT / 'results.sqlite3')
    db.execute('CREATE TABLE IF NOT EXISTS results (char TEXT PRIMARY KEY, codes TEXT NOT NULL, details TEXT NOT NULL, html_zlib BLOB NOT NULL, fetched_at TEXT NOT NULL)')
    db.commit()
    return db

def export(db):
    rows = list(db.execute('SELECT char,codes,details FROM results ORDER BY char'))
    records = {c: json.loads(v) for c, v, _ in rows if json.loads(v)}
    missing = [c for c, v, _ in rows if not json.loads(v)]
    done = {c for c, _, _ in rows}
    pending = [c for c in candidates() if c not in done]
    legacy = set(legacy_candidates())
    meta = {
        'source': 'http://www.wangma.net.cn/search.aspx?sm=7',
        'endpoint': 'http://www.wangma.net.cn/search_result.aspx',
        'site_declared_character_count': 15432,
        'candidate_source': 'GB2312/Big5/Windows CP950 Han union, plus all basic CJK ideographs U+4E00..U+9FFF for boundary verification; includes two Big5 CJK compatibility characters',
        'candidate_count': len(candidates()),
        'legacy_charset_candidate_count': len(legacy),
        'legacy_charset_record_count': len(set(records) & legacy),
        'additional_cjk_record_count': len(set(records) - legacy),
        'queried_count': len(rows),
        'record_count': len(records),
        'missing_count': len(missing),
        'pending_count': len(pending),
        'complete_candidate_scan': not pending,
        'matches_site_declared_count': len(records) == 15432,
        'fields': FIELDS,
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }
    outputs = {
        'wangma_codes.json': {'metadata': meta, 'characters': records},
        'wangma_roots.json': localize_roots({'metadata': meta, 'image_base_url': 'http://www.wangma.net.cn', 'characters': {c: json.loads(d) for c, v, d in rows if json.loads(v)}}),
        'coverage.json': {
            'metadata': meta,
            'not_found': missing,
            'not_found_details': [{'character': char, 'unicode': f'U+{ord(char):04X}'} for char in missing],
            'legacy_charset_not_found': [char for char in missing if char in legacy],
            'additional_cjk_found': [char for char in records if char not in legacy],
            'pending': pending,
        },
    }
    for name, obj in outputs.items():
        temp = ROOT / (name + '.tmp')
        temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temp.replace(ROOT / name)
    return meta

class Client:
    def __init__(self, captcha, rps):
        jar = http.cookiejar.LWPCookieJar(str(ROOT / 'session.cookies'))
        jar.load(ignore_discard=True, ignore_expires=True)
        self.cookie = '; '.join(c.name + '=' + c.value for c in jar)
        self.captcha = captcha
        self.interval = 1 / rps
        self.lock = threading.Lock()
        self.next_request = 0
        self.local = threading.local()

    def fetch(self, char):
        with self.lock:
            delay = max(0, self.next_request - time.monotonic())
            self.next_request = max(self.next_request, time.monotonic()) + self.interval
        if delay:
            time.sleep(delay)
        path = '/search_result.aspx?' + urllib.parse.urlencode({'sm': 7, 's': char, 'v': self.captcha})
        for attempt in range(3):
            if not getattr(self.local, 'connection', None):
                self.local.connection = http.client.HTTPConnection('www.wangma.net.cn', timeout=30)
            try:
                self.local.connection.request('GET', path, headers={'User-Agent': 'Mozilla/5.0', 'Cookie': self.cookie, 'Referer': 'http://www.wangma.net.cn/search.aspx?sm=7'})
                response = self.local.connection.getresponse()
                body = response.read()
                if response.status != 200:
                    raise RuntimeError('HTTP ' + str(response.status))
                codes, details = parse_page(body.decode('utf-8-sig'), char)
                return char, codes, details, body
            except (OSError, http.client.HTTPException, RuntimeError):
                self.local.connection.close()
                self.local.connection = None
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--captcha')
    parser.add_argument('--rps', type=float, default=4)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--export-only', action='store_true')
    args = parser.parse_args()
    db = database()
    if args.export_only:
        print(json.dumps(export(db), ensure_ascii=False), flush=True)
        return
    if not args.captcha:
        parser.error('--captcha required for a query run')
    # Import already verified single-character probes without new HTTP requests.
    for char, name in [('的', 'result.html'), ('一', 'one.html'), ('龘', 'rare.html')]:
        file = ROOT / name
        if file.exists() and not db.execute('SELECT 1 FROM results WHERE char=?', (char,)).fetchone():
            body = file.read_bytes()
            codes, details = parse_page(body.decode('utf-8-sig'), char)
            db.execute('INSERT INTO results VALUES (?,?,?,?,?)', (char, json.dumps(codes, ensure_ascii=False), json.dumps(details, ensure_ascii=False), zlib.compress(body), datetime.now(timezone.utc).isoformat()))
    db.commit()
    done = {row[0] for row in db.execute('SELECT char FROM results')}
    todo = [c for c in candidates() if c not in done]
    if args.limit:
        todo = todo[:args.limit]
    client = Client(args.captcha, args.rps)
    start = time.monotonic()
    last_log = start
    print(json.dumps({'event': 'start', 'candidate_count': len(candidates()), 'cached': len(done), 'to_query': len(todo), 'rps': args.rps}, ensure_ascii=False), flush=True)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {}
            iterator = iter(todo)
            for _ in range(args.workers):
                char = next(iterator, None)
                if char is not None:
                    futures[pool.submit(client.fetch, char)] = char
            count = 0
            while futures:
                completed, _ = concurrent.futures.wait(futures, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in completed:
                    requested_char = futures.pop(future)
                    try:
                        char, codes, details, body = future.result()
                    except Exception as exc:
                        (ROOT / 'last_error.json').write_text(json.dumps({'char': requested_char, 'error': str(exc)}, ensure_ascii=False, indent=2), encoding='utf-8')
                        raise
                    db.execute('INSERT OR REPLACE INTO results VALUES (?,?,?,?,?)', (char, json.dumps(codes, ensure_ascii=False), json.dumps(details, ensure_ascii=False), zlib.compress(body), datetime.now(timezone.utc).isoformat()))
                    db.commit()
                    count += 1
                    if time.monotonic() - last_log > 15:
                        print(json.dumps({'event': 'progress', 'total_queried': len(done) + count, 'this_run': count, 'last_char': char, 'elapsed_seconds': round(time.monotonic() - start, 1)}, ensure_ascii=False), flush=True)
                        last_log = time.monotonic()
                    char = next(iterator, None)
                    if char is not None:
                        futures[pool.submit(client.fetch, char)] = char
    finally:
        print(json.dumps(export(db), ensure_ascii=False), flush=True)
        db.close()

if __name__ == '__main__':
    main()
