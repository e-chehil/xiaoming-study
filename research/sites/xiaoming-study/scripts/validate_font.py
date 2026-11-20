"""Verify actual TrueType cmap coverage, rather than relying on a font-family name."""
from pathlib import Path
import json,struct,hashlib
ROOT=Path(__file__).resolve().parents[1]
def run(update_metadata=False):
    meta=json.loads((ROOT/'dist/fonts/taiwan-font.json').read_text(encoding='utf-8'))
    blob=(ROOT/'dist/fonts'/meta['file']).read_bytes()
    assert hashlib.sha256(blob).hexdigest()==meta['sha256']
    u16=lambda p:struct.unpack_from('>H',blob,p)[0]
    u32=lambda p:struct.unpack_from('>I',blob,p)[0]
    tables={}
    for i in range(u16(4)):
        tag,_,offset,length=struct.unpack_from('>4sIII',blob,12+i*16);tables[tag]=offset
    cmap=tables[b'cmap']
    offsets={cmap+u32(cmap+4+i*8+4) for i in range(u16(cmap+2))}
    def covers(cp):
        for off in offsets:
            fmt=u16(off)
            if fmt==12:
                for i in range(u32(off+12)):
                    start,end,glyph=struct.unpack_from('>III',blob,off+16+i*12)
                    if start<=cp<=end and glyph+cp-start:return True
            elif fmt==4 and cp<=65535:
                count=u16(off+6)//2;ends=off+14;starts=ends+count*2+2;deltas=starts+count*2;ranges=deltas+count*2
                for i in range(count):
                    start,end=u16(starts+i*2),u16(ends+i*2)
                    if not start<=cp<=end:continue
                    ro=u16(ranges+i*2);delta=u16(deltas+i*2)
                    glyph=u16(ranges+i*2+ro+2*(cp-start)) if ro else cp
                    if glyph and (glyph+delta)%65536:return True
        return False
    needed=set();traditional=set()
    for sub in ['', 'traditional']:
        data=json.loads((ROOT/'dist/data'/sub/'learning.json').read_text(encoding='utf-8'));needed.update(data['glyphVariants'])
        if sub:traditional.update(data['glyphVariants'])
    assert needed<=set(meta['characters']),'Font subset manifest must be regenerated'
    missing=[c for c in needed if not covers(ord(c))]
    assert not set(missing)&traditional,('Missing traditional training glyphs',set(missing)&traditional)
    if update_metadata:
        meta.update(fallbackCharacters=sorted(missing),coveredGlyphs=len(needed)-len(missing))
        (ROOT/'dist/fonts/taiwan-font.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    else:assert set(meta.get('fallbackCharacters',[]))==set(missing),'Regional font fallback metadata is outdated'
    assert 'SIL OPEN FONT LICENSE' in (ROOT/'dist/vendor/NotoSerifTC-OFL.txt').read_text(encoding='utf-8').upper()
    print('Taiwan glyph cmap verified:',len(traditional),'traditional training characters;',len(missing),'simplified-only fallbacks explicitly labelled')
if __name__=='__main__':run()
