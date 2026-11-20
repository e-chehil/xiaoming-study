(() => {
  'use strict';
  const data = window.WANGMA_QUERY_DATA;
  const $ = (id) => document.getElementById(id);
  const form = $('search-form');
  const input = $('query-input');
  let characters = [];
  let selectedIndex = 0;
  let enlarged = false;
  let toastTimer;

  const node = (tag, className, content) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  };

  if (!data || !data.characters || !data.images || !data.fields) {
    $('results').hidden = true;
    $('load-error').hidden = false;
    form.querySelector('button').disabled = true;
    return;
  }

  const unicode = (character) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  const isHan = (character) => /\p{Script=Han}/u.test(character);

  function notify(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2300);
  }

  async function copy(text) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Use local fallback');
      await navigator.clipboard.writeText(text);
      notify('已复制编码');
    } catch {
      const area = node('textarea');
      area.value = text;
      area.setAttribute('aria-label', '待复制的编码');
      area.style.cssText = 'position:fixed;left:12px;bottom:12px;width:calc(100% - 24px);height:100px;z-index:5';
      document.body.append(area);
      area.focus();
      area.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* Selection remains available. */ }
      if (copied) {
        area.remove();
        notify('已复制编码');
      } else {
        notify('编码已选中，可按 Ctrl+C 复制');
        area.addEventListener('blur', () => area.remove(), { once: true });
      }
    }
  }

  function copyIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8 8h12v13H8zM16 8V3H3v14h5');
    svg.append(path);
    return svg;
  }

  function card(field, entry, character) {
    const [code, imageIds, rootText] = entry;
    const article = node('article', 'code-card');
    article.dataset.field = field.key;
    const top = node('div', 'card-topline');
    top.append(node('h3', 'card-title', field.title), node('span', 'card-category', field.category));
    article.append(top);
    if (field.subtitle) article.append(node('p', 'card-subtitle', field.subtitle));
    const line = node('div', 'code-line');
    const value = node('span', 'code-value', code);
    value.setAttribute('aria-label', `编码 ${Array.from(code).join(' ')}`);
    const copyButton = node('button', 'copy-code');
    copyButton.type = 'button';
    copyButton.title = `复制${field.fullTitle}编码`;
    copyButton.setAttribute('aria-label', `复制${field.fullTitle}编码 ${code}`);
    copyButton.append(copyIcon());
    copyButton.addEventListener('click', () => copy(code));
    line.append(value, copyButton);
    article.append(line);
    const area = node('div', 'root-area');
    area.append(node('span', 'root-label', imageIds.length ? '字根拆分' : '笔画拆分'));
    const sequence = node('div', 'root-sequence');
    sequence.setAttribute('aria-label', `${character}的${field.fullTitle}拆分`);
    if (imageIds.length) {
      imageIds.forEach((imageId, index) => {
        if (index) sequence.append(node('span', 'root-plus', '+'));
        const tile = node('span', 'root-tile');
        const img = document.createElement('img');
        img.src = data.images[imageId];
        img.alt = `${field.fullTitle}第 ${index + 1} 个字根`;
        img.width = 32;
        img.height = 32;
        img.decoding = 'async';
        img.addEventListener('error', () => {
          $('image-error').hidden = false;
          tile.textContent = '缺图';
          tile.title = data.images[imageId];
        }, { once: true });
        tile.append(img);
        sequence.append(tile);
      });
    } else if (rootText) {
      Array.from(rootText).forEach((stroke, index) => {
        if (index) sequence.append(node('span', 'root-plus', '+'));
        sequence.append(node('span', 'root-tile stroke-tile', stroke));
      });
    } else {
      sequence.append(node('p', 'no-roots', '官网未提供拆分图'));
    }
    area.append(sequence);
    article.append(area);
    return article;
  }

  function renderTabs() {
    const tabs = $('character-tabs');
    tabs.replaceChildren();
    tabs.hidden = characters.length <= 1;
    characters.forEach((character, index) => {
      const found = Object.hasOwn(data.characters, character);
      const button = node('button', `character-tab${found ? '' : ' unlisted'}`, character);
      button.type = 'button';
      button.setAttribute('aria-current', String(index === selectedIndex));
      button.setAttribute('aria-label', `查看 ${character}${found ? '' : '（未收录）'}`);
      button.addEventListener('click', () => select(index));
      tabs.append(button);
    });
  }

  function renderHeading(character, found) {
    const heading = $('result-heading');
    const selected = node('div', 'selected-character');
    selected.append(node('span', 'hanzi', character));
    const info = node('div', 'character-info');
    const title = node('h2', null, found ? '七种编码查询结果' : '查询结果');
    title.append(node('span', 'found-badge', found ? '已收录' : '未收录'));
    info.append(title, node('span', 'unicode', unicode(character)));
    selected.append(info);
    const controls = node('div', 'result-controls');
    if (found) {
      const zoom = node('button', 'zoom-button', enlarged ? '还原字根' : '放大字根');
      zoom.type = 'button';
      zoom.id = 'zoom-roots';
      zoom.setAttribute('aria-pressed', String(enlarged));
      zoom.addEventListener('click', () => {
        enlarged = !enlarged;
        $('code-sections').classList.toggle('large-roots', enlarged);
        zoom.textContent = enlarged ? '还原字根' : '放大字根';
        zoom.setAttribute('aria-pressed', String(enlarged));
      });
      const copyAll = node('button', 'copy-all', '复制全部编码');
      copyAll.id = 'copy-all';
      copyAll.type = 'button';
      copyAll.addEventListener('click', () => {
        const entries = data.characters[character];
        const lines = data.fields.map((field, index) => `${field.fullTitle}：${entries[index][0]}`);
        copy(`${character}\n${lines.join('\n')}`);
      });
      controls.append(zoom, copyAll);
    }
    heading.replaceChildren(selected, controls);
  }

  function select(index) {
    selectedIndex = index;
    const character = characters[index];
    const found = Object.hasOwn(data.characters, character);
    renderTabs();
    renderHeading(character, found);
    $('image-error').hidden = true;
    $('wubi-cards').replaceChildren();
    $('numeric-cards').replaceChildren();
    $('not-found').hidden = found;
    $('code-sections').hidden = !found;
    if (!found) {
      $('not-found-description').textContent = `“${character}”（${unicode(character)}）在当前字表中没有查询结果。`;
      return;
    }
    const entries = data.characters[character];
    data.fields.forEach((field, fieldIndex) => {
      $(fieldIndex < 3 ? 'wubi-cards' : 'numeric-cards').append(card(field, entries[fieldIndex], character));
    });
    $('code-sections').classList.toggle('large-roots', enlarged);
  }

  function search(raw) {
    const han = Array.from(new Set(Array.from(raw).filter(isHan)));
    if (!han.length) {
      $('input-message').textContent = '请输入至少一个汉字。';
      $('input-message').hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    characters = han;
    const foundCount = han.filter((character) => Object.hasOwn(data.characters, character)).length;
    $('input-message').hidden = han.length === 1;
    $('input-message').textContent = `共 ${han.length} 个不同汉字，${foundCount} 个已收录。点击汉字切换结果。`;
    select(0);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search(input.value.trim());
  });
  document.querySelectorAll('[data-example]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.example;
      search(input.value);
    });
  });
  $('character-tabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    select((selectedIndex + (event.key === 'ArrowRight' ? 1 : characters.length - 1)) % characters.length);
    $('character-tabs').children[selectedIndex]?.focus();
  });
  input.value = '的';
  search('的');
  document.documentElement.dataset.ready = 'true';
})();
