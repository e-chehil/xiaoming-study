// Field names and code order match the Wangma lookup tables.
export const WANGMA = Object.freeze({
  wubi86: '五笔86版',
  wubi98: '五笔98版',
  wubi2006: '五笔新世纪版',
  numeric6_first4_last1: '数字6键·前四末一',
  numeric9_first4_last1: '数字9键·前四末一',
  numeric6_head_rest: '数字6键·首部余部',
  numeric9_head_rest: '数字9键·首部余部',
});

const fields = Object.keys(WANGMA);
const codePatterns = [/^[A-Y]{1,4}$/, /^[A-Y]{1,4}$/, /^[A-Y]{1,4}$/,
  /^[1-6]{1,5}$/, /^[1-9]{1,5}$/, /^[1-6]{1,6}$/, /^[1-9]{1,6}$/];

export function validateWangma(data) {
  if (data?.version !== 2 || !Array.isArray(data.columns) ||
      data.columns.length !== fields.length || fields.some((field, i) => data.columns[i] !== field) ||
      !data.characters || Object.keys(data.characters).length !== 15432 ||
      !data.roots || Object.keys(data.roots).length !== 15432 ||
      !Array.isArray(data.images) || !data.images.length) throw new Error('王码表结构无效');
  for (const image of data.images) {
    if (!image || !Number.isInteger(image.width) || image.width < 1 ||
        !Number.isInteger(image.height) || image.height < 1 ||
        typeof image.src !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.src)) {
      throw new Error('王码字根图无效');
    }
  }
  for (const [glyph, codes] of Object.entries(data.characters)) {
    if ([...glyph].length !== 1 || !Array.isArray(codes) || codes.length !== fields.length ||
        codes.some((code, i) => typeof code !== 'string' || !codePatterns[i].test(code))) throw new Error('王码条目无效');
    const roots = data.roots[glyph];
    if (!Array.isArray(roots) || roots.length !== fields.length ||
        roots.some((parts, i) => fields[i] === 'numeric6_first4_last1'
          ? typeof parts !== 'string' || !/^[一丨丶丿乙口日]{1,5}$/u.test(parts)
          : !Array.isArray(parts) || !parts.length || parts.some(id => !Number.isInteger(id) || id < 0 || id >= data.images.length))) {
      throw new Error('王码拆分条目无效');
    }
  }
}

export function referenceGlyphs(item) {
  if (item.type === 'initial' || item.type === 'stroke') return (item.examples || []).map(example => example.text);
  // Match written forms exactly, including an attached variation selector.
  // Course punctuation and Latin letters have no Han character code.
  return item.text.match(/[\p{Script=Han}\p{Private_Use}][\uFE00-\uFE0F\u{E0100}-\u{E01EF}]?/gu) || [];
}

export function lookupWangma(data, glyph, scheme) {
  return data?.characters[glyph]?.[fields.indexOf(scheme)] ?? null;
}

export function lookupWangmaSplit(data, glyph, scheme) {
  const parts = data?.roots[glyph]?.[fields.indexOf(scheme)];
  if (!parts?.length) return null;
  return typeof parts === 'string' ? parts : parts.map(id => data.images[id]);
}
