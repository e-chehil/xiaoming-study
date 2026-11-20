"""Inspect the public Wangma lookup using a fresh HTTP session."""
import argparse
import http.cookiejar
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent
BASE = 'http://www.wangma.net.cn/'
ROOT.mkdir(exist_ok=True)
jar = http.cookiejar.LWPCookieJar(str(ROOT / 'session.cookies'))
if (ROOT / 'session.cookies').exists():
    jar.load(ignore_discard=True, ignore_expires=True)
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.addheaders = [('User-Agent', 'Mozilla/5.0'), ('Referer', BASE + 'search.aspx?sm=7')]

def get(path, filename):
    try:
        response = opener.open(BASE + path, timeout=30)
    except urllib.error.HTTPError as exc:
        response = exc
    body = response.read()
    (ROOT / filename).write_bytes(body)
    jar.save(ignore_discard=True, ignore_expires=True)
    print(json.dumps({'status': response.code, 'type': response.headers.get('Content-Type'), 'bytes': len(body), 'file': filename}, ensure_ascii=False))
    return body

parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest='command', required=True)
sub.add_parser('init')
query = sub.add_parser('query')
query.add_argument('text')
query.add_argument('captcha')
query.add_argument('--output', default='result.html')
args = parser.parse_args()
if args.command == 'init':
    get('search.aspx?sm=7', 'search.html')
    get('GetCode.aspx?Timer=' + str(time.time()), 'captcha.jpg')
else:
    get('search_result.aspx?' + urllib.parse.urlencode({'sm': 7, 's': args.text, 'v': args.captcha}), args.output)
