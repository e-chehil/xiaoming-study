"""Fetch pinned, public build inputs into this workspace (never install VS components)."""
from pathlib import Path
import os, concurrent.futures, hashlib, json, urllib.request, zipfile

ROOT = Path(__file__).parent / 'build'
ROOT.mkdir(exist_ok=True)
CATALOG = Path(os.environ['VS_CATALOG']) if __name__ == '__main__' else None

def fetch(url, path, digest=None):
    if not path.exists():
        with urllib.request.urlopen(url, timeout=60) as response, path.with_suffix('.part').open('wb') as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        path.with_suffix('.part').replace(path)
    if digest:
        assert hashlib.sha256(path.read_bytes()).hexdigest().lower() == digest.lower(), path
    print('Downloaded', path.name, path.stat().st_size, flush=True)
    return path

def boost(name):
    file = fetch(f'https://api.nuget.org/v3-flatcontainer/{name}/1.84.0/{name}.1.84.0.nupkg', ROOT / f'{name}.nupkg')
    with zipfile.ZipFile(file) as archive:
        count=0
        for member in archive.infolist():
            name=member.filename
            if member.is_dir(): continue
            if '/boost/' in name and not name.endswith('.lib'):
                relative='boost/'+name.split('/boost/',1)[1]
                target=ROOT/'boost184'/relative
            elif name.endswith('.lib') and '-gd-' not in name and '-sgd-' not in name:
                target=ROOT/'boost184/stage/lib'/Path(name).name
            else: continue
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(archive.read(member));count+=1
        print('Extracted',file.name,count,flush=True)

def atl(package):
    for payload in package.get('payloads',[]):
        file=fetch(payload['url'],ROOT/Path(payload['fileName']).name,payload.get('sha256'))
        with zipfile.ZipFile(file) as archive:
            for item in archive.infolist():
                name=item.filename.replace('\\','/')
                if '/atlmfc/' not in name.lower() or item.is_dir():continue
                relative=name[name.lower().index('/atlmfc/')+8:]
                target=ROOT/'atl'/relative
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(archive.read(item))

def source():
    file=fetch('https://codeload.github.com/rime/weasel/zip/refs/tags/0.17.4',ROOT/'weasel-0.17.4.zip')
    with zipfile.ZipFile(file) as archive:archive.extractall(ROOT)
    dest=ROOT/'weasel-0.17.4/librime/include'
    dest.mkdir(parents=True,exist_ok=True)
    fetch('https://raw.githubusercontent.com/rime/librime/1.13.1/src/rime_api.h',dest/'rime_api.h')

if __name__=='__main__':
    packages=json.loads(CATALOG.read_text(encoding='utf-8-sig'))['packages']
    selected=[p for p in packages if p['id'] in ('Microsoft.VC.14.43.17.13.ATL.Headers.base','Microsoft.VC.14.43.17.13.ATL.X64.base','Microsoft.VC.14.43.17.13.ATL.X86.base')]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures=[pool.submit(source)]+[pool.submit(atl,p) for p in selected]
        futures += [pool.submit(boost,n) for n in ('boost','boost_serialization-vc143','boost_wserialization-vc143','boost_thread-vc143','boost_chrono-vc143','boost_atomic-vc143','boost_date_time-vc143')]
        for future in concurrent.futures.as_completed(futures):
            try:future.result()
            except Exception as error: raise RuntimeError('Could not prepare build input') from error
