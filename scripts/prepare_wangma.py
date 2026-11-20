"""Build the optional lookup table from the archived Wangma seven-scheme lookup ZIP."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import struct
import zipfile
import zlib


COLUMNS = (
    'wubi86', 'wubi98', 'wubi2006', 'numeric6_first4_last1',
    'numeric9_first4_last1', 'numeric6_head_rest', 'numeric9_head_rest',
)
STROKE_COLUMN = 'numeric6_first4_last1'
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / 'public/data/wangma.json'


def png_chunk(kind, data):
    return (struct.pack('>I', len(data)) + kind + data
            + struct.pack('>I', zlib.crc32(kind + data)))


def root_png(bmp, width, height):
    """Read the archive's Windows indexed BMPs exactly, including their backgrounds."""
    offset, dib_size, w, h, planes, depth, compression = struct.unpack_from('<IIiiHHI', bmp, 10)
    if (bmp[:2], dib_size, w, h, planes, depth, compression) != (b'BM', 40, width, height, 1, 4, 0):
        raise ValueError('Unexpected source bitmap format')
    # Indexed BMP scan lines are bottom-up and padded to four bytes. PNG uses
    # top-down rows. Retain even the fifteenth column on the narrower glyphs.
    stride = ((w * depth + 31) // 32) * 4
    palette = [bmp[54 + i * 4:57 + i * 4][::-1] for i in range(16)]
    colors = []
    rows = []
    for y in reversed(range(h)):
        row = []
        for x in range(w):
            byte = bmp[offset + y * stride + x // 2]
            color = palette[(byte >> (0 if x % 2 else 4)) & 15]
            if color not in colors:
                colors.append(color)
            row.append(colors.index(color))
        rows.append(row)
    bits = next(n for n in (1, 2, 4) if len(colors) <= 1 << n)
    pixels = bytearray()
    for row in rows:
        pixels.append(0)  # PNG filter type None precedes every scan line.
        packed = bytearray((w * bits + 7) // 8)
        for x, value in enumerate(row):
            bit = x * bits
            packed[bit // 8] |= value << (8 - bits - bit % 8)
        pixels.extend(packed)
    # The tiny scan lines fit in a single stored DEFLATE block. This makes
    # the PNG bytes reproducible across Python and compression-library versions.
    length = len(pixels)
    stream = (b'\x78\x01\x01' + struct.pack('<HH', length, length ^ 0xffff) + pixels
              + struct.pack('>I', zlib.adler32(pixels)))
    header = struct.pack('>IIBBBBB', w, h, bits, 3, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', header) + png_chunk(b'PLTE', b''.join(colors))
            + png_chunk(b'IDAT', stream) + png_chunk(b'IEND', b''))


def build(archive):
    manifest = json.loads(archive.read('image_manifest.json'))
    entries = sorted(manifest['images'].values(), key=lambda entry: entry['path'])
    if not manifest['complete'] or manifest['missing_image_count'] or len(entries) != 866:
        raise ValueError('Incomplete archive image manifest')
    images, ids = [], {}
    for index, entry in enumerate(entries):
        path = entry['path']
        original = archive.read(path)
        if path in ids or hashlib.sha256(original).hexdigest() != entry['sha256']:
            raise ValueError(f'Duplicate path or invalid source digest: {path}')
        width, height = entry['width'], entry['height']
        encoded = base64.b64encode(root_png(original, width, height)).decode('ascii')
        images.append({'src': 'data:image/png;base64,' + encoded, 'width': width, 'height': height})
        ids[path] = index

    source = json.loads(archive.read('wangma_roots.json'))['characters']
    codes = json.loads(archive.read('wangma_codes.json'))['characters']
    if source.keys() != codes.keys() or len(source) != 15432:
        raise ValueError('Character tables disagree')
    characters, roots, referenced = {}, {}, set()
    count = 0
    for glyph in sorted(source):
        characters[glyph], roots[glyph] = [], []
        for key in COLUMNS:
            record = source[glyph][key]
            code, paths, strokes = record['code'], record['root_images'], record['root_text']
            if not isinstance(code, str) or not code or code != codes[glyph][key]:
                raise ValueError(f'Code mismatch: {glyph} {key}')
            characters[glyph].append(code)
            if key == STROKE_COLUMN:
                if paths or not strokes:
                    raise ValueError(f'Unexpected stroke sequence: {glyph} {key}')
                roots[glyph].append(strokes)
            else:
                if not paths or strokes:
                    raise ValueError(f'Unexpected image sequence: {glyph} {key}')
                roots[glyph].append([ids[path] for path in paths])
                referenced.update(paths)
                count += len(paths)
    if referenced != set(ids) or count != manifest['image_reference_count'] or count != 427838:
        raise ValueError('Image references disagree with source manifest')
    return {'version': 2, 'columns': COLUMNS, 'characters': characters, 'roots': roots, 'images': images}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--check', action='store_true', help='compare with the existing resource without writing')
    args = parser.parse_args()
    with zipfile.ZipFile(args.archive) as archive:
        data = build(archive)
    encoded = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    if args.check:
        if args.output.read_bytes() != encoded:
            raise SystemExit('Generated resource differs from the existing file')
    else:
        args.output.write_bytes(encoded)
    print(f'{len(data["characters"])} characters, {len(data["images"])} images, {len(encoded)} bytes; '
          f'SHA-256 {hashlib.sha256(encoded).hexdigest()}')


if __name__ == '__main__':
    main()
