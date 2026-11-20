from pathlib import Path
import json,urllib.request,urllib.parse,re,hashlib
root=Path(__file__).resolve().parents[1];data=json.loads((root/'dist/data/traditional/learning.json').read_text(encoding='utf-8'))
simplified=json.loads((root/'dist/data/learning.json').read_text(encoding='utf-8'))
text=''.join(sorted(set(data['glyphVariants'])|set(simplified['glyphVariants'])))
url='https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400&text='+urllib.parse.quote(text)
def get(url):return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=25).read()
css=get(url).decode('utf-8')
font_url=re.search(r'url\((https://[^)]+)\)',css).group(1)
blob=get(font_url);suffix='woff2' if blob[:4]==b'wOF2' else 'woff' if blob[:4]==b'wOFF' else 'ttf'
dest=root/'dist/fonts'/('NotoSerifTC-compat.'+suffix);dest.write_bytes(blob)
license_url='https://raw.githubusercontent.com/google/fonts/main/ofl/notoseriftc/OFL.txt'
(root/'dist/vendor/NotoSerifTC-OFL.txt').write_bytes(get(license_url))
meta={'family':'Noto Serif TC','glyphs':len(text),'characters':text,'source':url,'fontSource':font_url,'licenseSource':license_url,'file':dest.name,'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob),'format':suffix}
(root/'dist/fonts/taiwan-font.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
from validate_font import run as validate_font
validate_font(update_metadata=True)
print(json.dumps({k:v for k,v in meta.items() if k not in ['source','fontSource','characters']},ensure_ascii=False))
