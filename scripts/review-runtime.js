export function bootReview() {
  const payloadNode = document.querySelector('script[data-he-review-payload]');
  const runtimeNode = document.querySelector('script[data-he-review-runtime]');
  const MAX_SELECTION = 2000;
  const MAX_COMMENT = 5000;
  const MAX_SUGGESTION = 3000;
  const CONTEXT = 64;
  const COLORS = [
    { id: 'yellow', label: '黄色', ink: '#966600', fill: 'rgba(255,213,79,.48)', active: 'rgba(255,213,79,.70)' },
    { id: 'blue', label: '蓝色', ink: '#17689e', fill: 'rgba(100,181,246,.40)', active: 'rgba(100,181,246,.65)' },
    { id: 'pink', label: '粉色', ink: '#a43464', fill: 'rgba(244,143,177,.40)', active: 'rgba(244,143,177,.65)' }
  ];
  const ICON_PATHS = {
    download: 'M12 3v12m0 0 4-4m-4 4-4-4M5 21h14',
    'message-square': 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    highlighter: 'm9 11-6 6v4h4l6-6m1-10 4 4m-1-5 2-2a2.1 2.1 0 0 1 3 3l-9 9-4-4 4-4',
    'trash-2': 'M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6',
    pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z',
    x: 'M18 6 6 18M6 6l12 12',
    'chevrons-right': 'm13 17 5-5-5-5m-6 10 5-5-5-5'
  };
  let payload;
  try {
    payload = payloadNode ? JSON.parse(payloadNode.textContent || '{}') : null;
  } catch (error) {
    payload = null;
  }
  if (!payload || payload.version !== 1) {
    return;
  }
  if (typeof payload.source !== 'string') payload.source = '';

  const state = {
    comments: Array.isArray(payload.comments) ? payload.comments.slice() : [],
    // Reviewer identity comes from this browser's draft or explicit input,
    // not the author who last exported the portable file.
    author: '',
    authorColors: Object.create(null),
    focusAnchor: null,
    revision: Number.isFinite(Number(payload.revision)) ? Number(payload.revision) : 0,
    dirty: false,
    open: false,
    composer: null,
    selection: null,
    resolved: new Map()
  };
  const documentId = typeof payload.documentId === 'string' && payload.documentId
    ? payload.documentId
    : 'anonymous-document';
  const embeddedCommentSignature = JSON.stringify(Array.isArray(payload.comments) ? payload.comments : []);
  const hasPayloadRevision = Object.prototype.hasOwnProperty.call(payload, 'revision') && Number.isFinite(Number(payload.revision));
  const storageKey = 'he-review:' + documentId;
  const excludedTags = new Set([
    'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT',
    'OPTION', 'BUTTON', 'FIELDSET', 'OUTPUT', 'DATALIST', 'METER', 'PROGRESS'
  ]);
  const host = document.createElement('div');
  host.setAttribute('data-he-review-ui', '');
  (document.body || document.documentElement).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const ui = {};
  let overlayContainer = null;
  let overlayFrame = 0;
  let ownedStyle = null;

  function text(value) {
    return value == null ? '' : String(value);
  }

  function colorById(id) {
    return COLORS.find((color) => color.id === id) || COLORS[0];
  }

  function authorKey(author) {
    return text(author).trim() || '匿名';
  }

  function nextAuthorColor(author) {
    const key = authorKey(author);
    if (state.authorColors[key]) return state.authorColors[key];
    const counts = COLORS.map((color) => Object.values(state.authorColors).filter((id) => id === color.id).length);
    return COLORS[counts.indexOf(Math.min(...counts))].id;
  }

  function restoreAuthorColors(saved) {
    if (saved && typeof saved === 'object') {
      Object.entries(saved).forEach(([author, color]) => {
        if (COLORS.some((item) => item.id === color)) state.authorColors[authorKey(author)] = color;
      });
    }
    state.comments.forEach((comment) => {
      const author = authorKey(comment.author);
      if (!state.authorColors[author]) {
        state.authorColors[author] = COLORS.some((color) => color.id === comment.color)
          ? comment.color : nextAuthorColor(author);
      }
      comment.color = state.authorColors[author];
    });
  }

  function setAuthorColor(author, id) {
    const key = authorKey(author);
    state.authorColors[key] = colorById(id).id;
    state.comments.forEach((comment) => {
      if (authorKey(comment.author) === key) comment.color = state.authorColors[key];
    });
  }

  function commentColor(comment) {
    return colorById(state.authorColors[authorKey(comment.author)] || comment.color);
  }

  function icon(name, label) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON_PATHS[name] || '');
    svg.appendChild(path);
    if (label) svg.setAttribute('aria-label', label);
    return svg;
  }

  function makeButton(label, iconName, handler, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className || '';
    button.setAttribute('aria-label', label);
    button.title = label;
    if (iconName) button.appendChild(icon(iconName, label));
    if (label && (!iconName || (className && className.indexOf('he-review-text-button') >= 0))) {
      const span = document.createElement('span');
      span.textContent = label;
      button.appendChild(span);
    }
    button.addEventListener('click', handler);
    return button;
  }

  function comparePoints(nodeA, offsetA, nodeB, offsetB) {
    try {
      const a = document.createRange();
      const b = document.createRange();
      a.setStart(nodeA, Math.max(0, Math.min(offsetA, nodeA.nodeType === Node.TEXT_NODE ? nodeA.nodeValue.length : nodeA.childNodes.length)));
      a.collapse(true);
      b.setStart(nodeB, Math.max(0, Math.min(offsetB, nodeB.nodeType === Node.TEXT_NODE ? nodeB.nodeValue.length : nodeB.childNodes.length)));
      b.collapse(true);
      return a.compareBoundaryPoints(Range.START_TO_START, b);
    } catch (error) {
      return 0;
    }
  }

  function isExcludedElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (excludedTags.has(element.tagName)) return true;
    if (element === host || element.closest('[data-he-review-ui]')) return true;
    if (element.hasAttribute('data-he-review-owned')) return true;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
    try {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    } catch (error) {
      return false;
    }
    return false;
  }

  function isEligibleTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.nodeValue) return false;
    if (node === payloadNode || node === runtimeNode) return false;
    let current = node.parentElement;
    while (current) {
      if (isExcludedElement(current)) return false;
      current = current.parentElement;
    }
    return node.isConnected;
  }

  function collectStream() {
    const segments = [];
    let stream = '';
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!isEligibleTextNode(node)) continue;
      const start = stream.length;
      stream += node.nodeValue;
      segments.push({ node, start, end: stream.length });
    }
    return { stream, segments };
  }

  function boundaryOffset(container, offset, map) {
    if (!container) return 0;
    for (let index = 0; index < map.segments.length; index += 1) {
      const segment = map.segments[index];
      if (comparePoints(container, offset, segment.node, 0) <= 0) return segment.start;
      if (comparePoints(container, offset, segment.node, segment.node.nodeValue.length) <= 0) {
        return segment.start + Math.max(0, Math.min(offset, segment.node.nodeValue.length));
      }
    }
    return map.stream.length;
  }

  function offsetToPoint(offset, map) {
    if (!map.segments.length) return null;
    const bounded = Math.max(0, Math.min(offset, map.stream.length));
    for (let index = 0; index < map.segments.length; index += 1) {
      const segment = map.segments[index];
      if (bounded < segment.end || (bounded === segment.end && index === map.segments.length - 1)) {
        return { node: segment.node, offset: bounded - segment.start };
      }
    }
    const last = map.segments[map.segments.length - 1];
    return { node: last.node, offset: last.node.nodeValue.length };
  }

  function rangeFromOffsets(start, end, map) {
    if (!map || start < 0 || end <= start || end > map.stream.length) return null;
    const from = offsetToPoint(start, map);
    const to = offsetToPoint(end, map);
    if (!from || !to) return null;
    try {
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      return range;
    } catch (error) {
      return null;
    }
  }

  function makeAnchor(start, end, stream) {
    return {
      exact: stream.slice(start, end),
      prefix: stream.slice(Math.max(0, start - CONTEXT), start),
      suffix: stream.slice(end, Math.min(stream.length, end + CONTEXT)),
      start,
      end
    };
  }

  function commentAnchor(comment) {
    if (!comment || typeof comment !== 'object') return null;
    const anchor = comment.anchor && typeof comment.anchor === 'object' ? comment.anchor : comment;
    const exact = text(anchor.exact || comment.quote || comment.selectedText);
    if (!exact) return null;
    return {
      exact,
      prefix: text(anchor.prefix),
      suffix: text(anchor.suffix),
      start: Number.isInteger(anchor.start) ? anchor.start : null,
      end: Number.isInteger(anchor.end) ? anchor.end : null
    };
  }

  function findOccurrences(stream, exact) {
    const found = [];
    let from = 0;
    while (from <= stream.length - exact.length) {
      const index = stream.indexOf(exact, from);
      if (index < 0) break;
      found.push(index);
      from = index + Math.max(1, exact.length);
    }
    return found;
  }

  function resolveAnchor(anchor, map) {
    if (!anchor || !anchor.exact || !map.stream) return null;
    const exact = anchor.exact;
    if (Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.end > anchor.start &&
        anchor.start >= 0 && anchor.end <= map.stream.length && map.stream.slice(anchor.start, anchor.end) === exact) {
      return { range: rangeFromOffsets(anchor.start, anchor.end, map), start: anchor.start, end: anchor.end };
    }
    const occurrences = findOccurrences(map.stream, exact);
    if (occurrences.length === 1) {
      const start = occurrences[0];
      return { range: rangeFromOffsets(start, start + exact.length, map), start, end: start + exact.length };
    }
    if (occurrences.length < 2) return null;
    const contextual = occurrences.filter((start) => {
      const prefix = map.stream.slice(Math.max(0, start - anchor.prefix.length), start);
      const suffixStart = start + exact.length;
      const suffix = map.stream.slice(suffixStart, suffixStart + anchor.suffix.length);
      return prefix === anchor.prefix && suffix === anchor.suffix;
    });
    if (contextual.length !== 1) return null;
    const start = contextual[0];
    return { range: rangeFromOffsets(start, start + exact.length, map), start, end: start + exact.length };
  }

  function getResolved(comment, map) {
    const resolved = resolveAnchor(commentAnchor(comment), map);
    if (resolved && resolved.range) return resolved;
    return null;
  }

  function clearVisuals() {
    if (ownedStyle) {
      ownedStyle.remove();
      ownedStyle = null;
    }
    if (window.CSS && CSS.highlights) {
      state.resolved.forEach((name) => CSS.highlights.delete(name));
    }
    state.resolved.clear();
    if (overlayContainer) {
      overlayContainer.remove();
      overlayContainer = null;
    }
  }

  function ensureHighlightStyle() {
    ownedStyle = document.createElement('style');
    ownedStyle.setAttribute('data-he-review-owned', '');
    ownedStyle.textContent = COLORS.map((color) =>
      '::highlight(he-review-' + color.id + '){background-color:' + color.fill + ';color:inherit;text-decoration:underline;text-decoration-color:' + color.ink + ';}' +
      '::highlight(he-review-active-' + color.id + '){background-color:' + color.active + ';color:inherit;text-decoration:underline;text-decoration-color:' + color.ink + ';text-decoration-thickness:3px;}'
    ).join('');
    (document.head || document.documentElement).appendChild(ownedStyle);
  }

  function renderFallbackOverlays(entries) {
    if (!entries.length) return;
    overlayContainer = document.createElement('div');
    overlayContainer.setAttribute('data-he-review-owned', '');
    overlayContainer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    (document.body || document.documentElement).appendChild(overlayContainer);
    entries.forEach(({ range, color, active }) => {
      Array.from(range.getClientRects()).forEach((rect) => {
        if (!rect.width || !rect.height) return;
        const mark = document.createElement('div');
        mark.setAttribute('data-he-review-owned', '');
        mark.setAttribute('data-he-review-color', color.id);
        mark.setAttribute('data-he-review-active', String(Boolean(active)));
        mark.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;background:' + (active ? color.active : color.fill) + ';border-bottom:' + (active ? '3' : '2') + 'px solid ' + color.ink + ';pointer-events:none;';
        overlayContainer.appendChild(mark);
      });
    });
  }

  function scheduleFallback() {
    if (overlayFrame) return;
    overlayFrame = window.requestAnimationFrame(() => {
      overlayFrame = 0;
      renderVisuals();
    });
  }

  function placeReviewPanel(range) {
    if (!ui.panel || !state.open) return;
    if (window.innerWidth > 600 || !range) {
      ui.panel.style.removeProperty('top');
      ui.panel.style.removeProperty('bottom');
      ui.panel.style.removeProperty('max-height');
      return;
    }
    const rect = range.getBoundingClientRect();
    const above = rect.top - 66;
    const below = window.innerHeight - rect.bottom - 24;
    const placeBelow = below >= above;
    ui.panel.style.top = placeBelow ? 'auto' : '54px';
    ui.panel.style.bottom = placeBelow ? '12px' : 'auto';
    ui.panel.style.maxHeight = Math.max(160, Math.min(window.innerHeight * .55, Math.max(above, below))) + 'px';
  }

  function renderVisuals() {
    clearVisuals();
    const map = collectStream();
    const entries = [];
    const supportsHighlights = window.CSS && CSS.highlights && typeof Highlight === 'function';
    state.comments.forEach((comment) => {
      const result = getResolved(comment, map);
      if (result && result.range) entries.push({ range: result.range, color: commentColor(comment), active: false });
    });
    const activeAnchor = state.selection ? state.selection.anchor : state.focusAnchor;
    const active = activeAnchor && resolveAnchor(activeAnchor, map);
    placeReviewPanel(active && active.range);
    if (active && active.range) {
      const color = state.composer ? state.composer.color : state.focusColor;
      entries.push({ range: active.range, color: colorById(color), active: true });
    }
    if (supportsHighlights) {
      ensureHighlightStyle();
      COLORS.forEach((color) => {
        [false, true].forEach((active) => {
          const ranges = entries.filter((entry) => entry.color.id === color.id && entry.active === active).map((entry) => entry.range);
          if (!ranges.length) return;
          const name = 'he-review-' + (active ? 'active-' : '') + color.id;
          const highlight = new Highlight(...ranges);
          highlight.priority = active ? 10 : 0;
          CSS.highlights.set(name, highlight);
          state.resolved.set(name, name);
        });
      });
    } else {
      renderFallbackOverlays(entries);
    }
  }

  function cacheIsNewer(cache) {
    if (!cache || !Array.isArray(cache.comments)) return false;
    const cachedRevision = Number(cache.revision);
    const baseRevision = Number(payload.revision);
    if (Number.isFinite(cachedRevision) && cachedRevision > (Number.isFinite(baseRevision) ? baseRevision : 0)) return hasPayloadRevision || cache.baseSignature === embeddedCommentSignature;
    if (Number.isFinite(cachedRevision) && Number.isFinite(baseRevision) && cachedRevision < baseRevision) return false;
    if (cache.updatedAt && payload.updatedAt) return String(cache.updatedAt) > String(payload.updatedAt) && (hasPayloadRevision || cache.baseSignature === embeddedCommentSignature);
    return !hasPayloadRevision && cache.baseSignature === embeddedCommentSignature && cachedRevision > 0;
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const cache = JSON.parse(raw);
      if (cache && typeof cache.author === 'string') state.author = cache.author;
      if (cacheIsNewer(cache)) {
        state.comments = cache.comments.slice();
        state.authorColors = Object.create(null);
        restoreAuthorColors(cache.authorColors);
        if (typeof cache.author === 'string') state.author = cache.author;
        state.revision = Math.max(state.revision, Number(cache.revision) || 0);
      }
    } catch (error) {
      return;
    }
  }

  function saveCache() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        version: 1,
        documentId,
        baseSignature: embeddedCommentSignature,
        comments: state.comments,
        author: state.author,
        authorColors: state.authorColors,
        revision: state.revision,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      return;
    }
  }

  function markDirty() {
    state.dirty = true;
    state.revision = Math.max(state.revision, Number(payload.revision) || 0) + 1;
    saveCache();
  }

  function displayAuthor(comment) {
    return authorKey(comment && comment.author);
  }

  function displayBody(comment) {
    return text(comment && (comment.text || comment.comment || comment.body));
  }

  function showError(message) {
    ui.error.textContent = text(message);
    ui.error.hidden = !message;
  }

  function closeComposer() {
    state.composer = null;
    state.selection = null;
    ui.composer.hidden = true;
    ui.composer.replaceChildren();
    showError('');
    renderVisuals();
  }

  function addField(parent, labelText, tagName, value, maxLength, placeholder) {
    const label = document.createElement('label');
    label.className = 'he-review-field';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    label.appendChild(caption);
    const control = document.createElement(tagName);
    control.value = value || '';
    control.maxLength = maxLength;
    control.placeholder = placeholder || '';
    control.setAttribute('aria-label', labelText);
    label.appendChild(control);
    parent.appendChild(label);
    return control;
  }

  function showComposer(selection, existing) {
    state.selection = selection || (existing ? { anchor: commentAnchor(existing) } : null);
    state.focusAnchor = null;
    state.composer = {
      editingId: existing ? existing.id : null,
      color: existing ? commentColor(existing).id : nextAuthorColor(state.author)
    };
    ui.composer.replaceChildren();
    ui.composer.hidden = false;
    const heading = document.createElement('h3');
    heading.textContent = existing ? '编辑批注' : '添加批注';
    ui.composer.appendChild(heading);
    const author = addField(ui.composer, '作者', 'input', existing ? displayAuthor(existing) : state.author, 120, '请输入姓名');
    const colors = document.createElement('div');
    colors.className = 'he-review-colors';
    colors.setAttribute('role', 'radiogroup');
    colors.setAttribute('aria-label', '批注颜色');
    const swatches = COLORS.map((color) => {
      const button = makeButton(color.label, null, () => {
        state.composer.color = color.id;
        syncSwatches();
        renderVisuals();
      }, 'he-review-swatch');
      button.replaceChildren();
      button.style.setProperty('--he-swatch', color.fill);
      button.style.setProperty('--he-ink', color.ink);
      button.dataset.color = color.id;
      button.setAttribute('role', 'radio');
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
        const next = swatches[(COLORS.indexOf(color) + step + COLORS.length) % COLORS.length];
        next.click();
        next.focus();
      });
      colors.appendChild(button);
      return button;
    });
    function syncSwatches() {
      swatches.forEach((button) => {
        const checked = button.dataset.color === state.composer.color;
        button.setAttribute('aria-checked', String(checked));
        button.tabIndex = checked ? 0 : -1;
      });
      const color = colorById(state.composer.color);
      ui.composer.style.setProperty('--he-review-ink', color.ink);
      ui.composer.style.setProperty('--he-review-fill', color.fill);
    }
    author.addEventListener('input', () => {
      state.composer.color = nextAuthorColor(author.value);
      syncSwatches();
      renderVisuals();
    });
    syncSwatches();
    ui.composer.appendChild(colors);
    const quote = document.createElement('blockquote');
    quote.className = 'he-review-quote';
    quote.textContent = existing ? text(existing.quote || commentAnchor(existing)?.exact) : text(selection && selection.anchor.exact);
    quote.title = '选中的原文';
    ui.composer.appendChild(quote);
    const body = addField(ui.composer, '批注', 'textarea', existing ? displayBody(existing) : '', MAX_COMMENT, '写下你的批注');
    const suggestion = addField(ui.composer, '建议（可选）', 'textarea', existing ? text(existing.suggestion) : '', MAX_SUGGESTION, '可选的修改建议');
    const actions = document.createElement('div');
    actions.className = 'he-review-actions';
    actions.appendChild(makeButton('取消', 'x', closeComposer, 'he-review-text-button he-review-muted'));
    const save = makeButton(existing ? '保存修改' : '保存批注', null, () => {
      const bodyText = text(body.value).trim();
      if (!bodyText) {
        showError('请填写批注内容。');
        body.focus();
        return;
      }
      if (bodyText.length > MAX_COMMENT) {
        showError('批注不能超过 ' + MAX_COMMENT + ' 个字符。');
        return;
      }
      const savedAuthor = authorKey(author.value);
      setAuthorColor(savedAuthor, state.composer.color);
      if (existing) {
        existing.author = savedAuthor;
        existing.color = state.authorColors[savedAuthor];
        existing.text = bodyText;
        existing.suggestion = text(suggestion.value).trim();
        existing.updatedAt = new Date().toISOString();
      } else {
        if (!selection || !selection.anchor.exact) {
          showError('无法定位选中的原文，请重新选择。');
          return;
        }
        state.comments.push({
          id: window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : 'he-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
          anchor: selection.anchor,
          quote: selection.anchor.exact,
          author: savedAuthor,
          color: state.authorColors[savedAuthor],
          text: bodyText,
          suggestion: text(suggestion.value).trim(),
          createdAt: new Date().toISOString(),
          resolved: false
        });
      }
      state.author = savedAuthor;
      markDirty();
      closeComposer();
      renderList();
      renderVisuals();
    }, 'he-review-primary he-review-text-button');
    actions.appendChild(save);
    ui.composer.appendChild(actions);
    renderVisuals();
    author.focus();
  }

  function scrollToComment(comment) {
    const result = getResolved(comment, collectStream());
    if (!result || !result.range) {
      showError('找不到这条批注对应的原文，可能原文已改变。');
      return;
    }
    showError('');
    state.focusAnchor = commentAnchor(comment);
    state.focusColor = commentColor(comment).id;
    renderVisuals();
    const rect = result.range.getBoundingClientRect();
    window.scrollBy({ top: rect.top - Math.max(80, window.innerHeight * 0.2), behavior: 'smooth' });
  }

  function renderList() {
    ui.list.replaceChildren();
    ui.count.textContent = String(state.comments.length);
    if (!state.comments.length) {
      const empty = document.createElement('p');
      empty.className = 'he-review-empty';
      empty.textContent = '暂无批注。选择正文中的文字即可添加。';
      ui.list.appendChild(empty);
      return;
    }
    state.comments.forEach((comment, index) => {
      const item = document.createElement('article');
      item.className = 'he-review-item' + (comment.resolved ? ' he-review-resolved' : '');
      const color = commentColor(comment);
      item.dataset.color = color.id;
      item.style.setProperty('--he-review-ink', color.ink);
      item.style.setProperty('--he-review-fill', color.fill);
      const top = document.createElement('div');
      top.className = 'he-review-item-top';
      const who = document.createElement('strong');
      who.textContent = displayAuthor(comment);
      top.appendChild(who);
      const status = document.createElement('span');
      status.className = 'he-review-status';
      status.textContent = comment.resolved ? '已解决' : '待处理';
      top.appendChild(status);
      item.appendChild(top);
      const quote = document.createElement('button');
      quote.type = 'button';
      quote.className = 'he-review-quote-button';
      quote.textContent = text(comment.quote || commentAnchor(comment)?.exact || '原文不可用');
      quote.title = '定位到原文';
      quote.setAttribute('aria-label', '定位到原文');
      quote.addEventListener('click', () => scrollToComment(comment));
      item.appendChild(quote);
      const body = document.createElement('p');
      body.textContent = displayBody(comment);
      item.appendChild(body);
      if (comment.suggestion) {
        const suggestion = document.createElement('p');
        suggestion.className = 'he-review-suggestion';
        suggestion.textContent = '建议：' + text(comment.suggestion);
        item.appendChild(suggestion);
      }
      const actions = document.createElement('div');
      actions.className = 'he-review-item-actions';
      actions.appendChild(makeButton('编辑批注', 'pencil', () => showComposer(null, comment), 'he-review-icon-button'));
      actions.appendChild(makeButton(comment.resolved ? '重新打开' : '标记为已解决', 'chevrons-right', () => {
        comment.resolved = !comment.resolved;
        markDirty();
        renderList();
        renderVisuals();
      }, 'he-review-icon-button'));
      actions.appendChild(makeButton('删除批注', 'trash-2', () => {
        if (!window.confirm('确定删除这条批注吗？')) return;
        state.comments.splice(index, 1);
        markDirty();
        renderList();
        renderVisuals();
      }, 'he-review-icon-button'));
      item.appendChild(actions);
      ui.list.appendChild(item);
    });
  }

  function selectionIsOutsideUi(selection) {
    if (!selection || !selection.rangeCount) return false;
    const nodes = [selection.anchorNode, selection.focusNode];
    return nodes.every((node) => {
      if (!node) return false;
      if (node.getRootNode && node.getRootNode() === shadow) return false;
      return node !== host && !host.contains(node);
    });
  }

  function captureSelection(event) {
    if (event && event.composedPath().includes(host)) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selectionIsOutsideUi(selection)) return;
    const range = selection.getRangeAt(0);
    const map = collectStream();
    const start = boundaryOffset(range.startContainer, range.startOffset, map);
    const end = boundaryOffset(range.endContainer, range.endOffset, map);
    if (end <= start) return;
    const exact = map.stream.slice(start, end);
    if (!exact || exact.length > MAX_SELECTION) {
      showError(exact ? '选择内容不能超过 ' + MAX_SELECTION + ' 个字符。' : '请选择正文中的文字。');
      return;
    }
    const anchor = makeAnchor(start, end, map.stream);
    showComposer({ anchor, range }, null);
    setOpen(true);
  }

  function setOpen(open) {
    state.open = Boolean(open);
    ui.panel.hidden = !state.open;
    const toggleLabel = state.open ? '收起批注' : '打开批注';
    ui.toggle.setAttribute('aria-label', toggleLabel);
    ui.toggle.title = toggleLabel;
    ui.toggle.setAttribute('aria-expanded', String(state.open));
    ui.toggle.classList.toggle('he-review-toggle-open', state.open);
    if (state.open) renderVisuals();
  }

  function cleanLiveSource() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-he-review-ui],[data-he-review-owned],script[data-he-review-payload],script[data-he-review-runtime]').forEach((node) => node.remove());
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function exportReviewedHtml() {
    try {
      const parser = new DOMParser();
      const source = payload.source.trim() ? payload.source : cleanLiveSource();
      const output = parser.parseFromString(source, 'text/html');
      output.querySelectorAll('script[data-he-review-payload],script[data-he-review-runtime]').forEach((node) => node.remove());
      const nextPayload = Object.assign({}, payload, {
        comments: state.comments,
        author: state.author,
        authorColors: state.authorColors,
        revision: state.revision,
        updatedAt: new Date().toISOString()
      });
      const data = output.createElement('script');
      data.type = 'application/json';
      data.setAttribute('data-he-review-payload', '');
      data.textContent = JSON.stringify(nextPayload).replace(/</g, '\\u003c');
      const runtime = output.createElement('script');
      runtime.setAttribute('data-he-review-runtime', '');
      runtime.textContent = runtimeNode ? runtimeNode.textContent || '' : '';
      const target = output.body || output.head || output.documentElement;
      target.appendChild(data);
      target.appendChild(runtime);
      const sourceText = '<!DOCTYPE html>\n' + output.documentElement.outerHTML;
      const blob = new Blob([sourceText], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const originalName = text(payload.filename || 'document.html').split(/[\\/]/).pop() || 'document.html';
      const stem = originalName.replace(/\.[^.]+$/, '') || 'document';
      link.href = url;
      link.download = stem + '.reviewed.html';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      state.dirty = false;
      showError('');
    } catch (error) {
      showError('导出失败，请检查文档内容后重试。');
    }
  }

  const style = document.createElement('style');
  style.textContent = ':host{all:initial;position:fixed;right:16px;top:16px;z-index:2147483646;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#202124;font-size:14px;line-height:1.45}*{box-sizing:border-box}button,input,textarea{font:inherit}button{cursor:pointer}.he-review-toggle{display:inline-flex;align-items:center;gap:6px;border:1px solid #b8bec7;background:#fff;color:#24303d;border-radius:6px;padding:8px 11px;box-shadow:0 2px 10px rgba(0,0,0,.12)}.he-review-toggle:hover,.he-review-toggle:focus-visible{background:#f2f6fa;border-color:#607d99;outline:2px solid #87b9e6;outline-offset:1px}.he-review-toggle svg,.he-review-icon-button svg,.he-review-text-button svg,.he-review-export svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.he-review-count{min-width:18px;text-align:center;border-radius:9px;background:#e7edf3;color:#2a4a62;font-size:12px;padding:0 5px}.he-review-panel{margin-top:8px;width:320px;max-height:65vh;display:flex;flex-direction:column;background:#fff;border:1px solid #c9d0d8;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);overflow:hidden}.he-review-header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e1e5e9}.he-review-header h2{font-size:15px;margin:0;flex:1}.he-review-header button,.he-review-item-actions button{border:0;background:transparent;color:#52606d;padding:5px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center}.he-review-header button:hover,.he-review-item-actions button:hover,.he-review-header button:focus-visible,.he-review-item-actions button:focus-visible{background:#eef2f5;color:#1b4f72;outline:2px solid #87b9e6;outline-offset:1px}.he-review-body{overflow:auto;padding:10px}.he-review-list{display:grid;gap:8px}.he-review-empty{color:#65727e;margin:16px 4px;text-align:center}.he-review-item{border:1px solid #dce2e8;border-radius:6px;padding:9px;background:#fff}.he-review-item.he-review-resolved{opacity:.68}.he-review-item-top{display:flex;align-items:center;gap:8px}.he-review-item-top strong{font-size:13px;flex:1}.he-review-status{font-size:11px;color:#65727e}.he-review-quote-button{display:block;width:100%;text-align:left;border:0;background:#fff8d8;color:#574b1c;margin:7px 0;padding:5px 7px;border-left:3px solid #e1b522;border-radius:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.he-review-quote-button:hover,.he-review-quote-button:focus-visible{background:#fff0ac;outline:2px solid #d6a800;outline-offset:1px}.he-review-item p{margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}.he-review-suggestion{color:#385b45;font-size:13px}.he-review-item-actions{display:flex;justify-content:flex-end;gap:2px;border-top:1px solid #edf0f2;margin-top:7px;padding-top:5px}.he-review-composer{border-top:1px solid #dce2e8;padding:10px}.he-review-composer h3{font-size:14px;margin:0 0 8px}.he-review-field{display:block;margin:7px 0}.he-review-field>span{display:block;color:#52606d;font-size:12px;margin-bottom:3px}.he-review-field input,.he-review-field textarea{display:block;width:100%;border:1px solid #b9c3cd;border-radius:4px;padding:6px 7px;background:#fff;color:#202124}.he-review-field textarea{min-height:58px;resize:vertical}.he-review-field input:focus,.he-review-field textarea:focus{outline:2px solid #87b9e6;outline-offset:1px;border-color:#4f83ac}.he-review-quote{max-height:58px;overflow:auto;border-left:3px solid #e1b522;background:#fff8d8;margin:8px 0;padding:6px 8px;font-size:12px;white-space:pre-wrap}.he-review-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:9px}.he-review-text-button{display:inline-flex;align-items:center;gap:5px;border:1px solid #b9c3cd;border-radius:4px;padding:6px 9px;background:#fff;color:#33414f}.he-review-text-button.he-review-primary{border-color:#2b6b93;background:#2b6b93;color:#fff}.he-review-text-button:hover,.he-review-text-button:focus-visible{filter:brightness(.96);outline:2px solid #87b9e6;outline-offset:1px}.he-review-error{color:#a22626;background:#fff0f0;border-top:1px solid #f1c5c5;padding:7px 10px;font-size:12px}.he-review-export{margin-left:auto}.he-review-muted{color:#65727e}@media(max-width:600px){:host{left:8px;right:8px;top:8px}.he-review-panel{width:100%;max-width:100%;max-height:65vh}.he-review-toggle{margin-left:auto}}';
  style.textContent += `
    [hidden]{display:none!important}
    .he-review-colors{display:flex;gap:10px;margin:10px 0 12px;align-items:center}
    .he-review-swatch{position:relative;width:32px;height:32px;flex:0 0 32px;border:2px solid transparent;border-radius:50%;padding:0;background:var(--he-swatch);box-shadow:inset 0 0 0 1px var(--he-ink)}
    .he-review-swatch[aria-checked="true"]{border-color:var(--he-ink);outline:2px solid var(--he-ink);outline-offset:2px}
    .he-review-swatch[aria-checked="true"]::after{content:"";position:absolute;width:6px;height:11px;border:solid var(--he-ink);border-width:0 2px 2px 0;transform:rotate(45deg);left:11px;top:6px}
    .he-review-swatch:focus-visible{outline:3px solid #202124;outline-offset:3px}
    .he-review-item{border-left:3px solid var(--he-review-ink,#966600)}
    .he-review-item-top strong{display:flex;align-items:center;gap:6px;min-width:0;overflow-wrap:anywhere}
    .he-review-item-top strong::before{content:"";flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:var(--he-review-ink,#966600)}
    .he-review-quote,.he-review-quote-button{border-left:3px solid var(--he-review-ink,#966600);background:var(--he-review-fill,rgba(255,213,79,.18));overflow-wrap:anywhere}
    @media(max-width:600px){:host{right:12px;top:12px}.he-review-panel{position:fixed;right:12px;bottom:12px;margin:0;width:calc(100vw - 24px);max-height:55vh}}
  `;
  shadow.appendChild(style);

  ui.toggle = makeButton('打开批注', 'message-square', () => setOpen(!state.open), 'he-review-toggle');
  ui.toggle.setAttribute('aria-expanded', 'false');
  ui.toggle.setAttribute('aria-controls', 'he-review-panel');
  ui.count = document.createElement('span');
  ui.count.className = 'he-review-count';
  ui.count.textContent = '0';
  ui.toggle.appendChild(ui.count);
  shadow.appendChild(ui.toggle);

  ui.panel = document.createElement('section');
  ui.panel.id = 'he-review-panel';
  ui.panel.className = 'he-review-panel';
  ui.panel.hidden = true;
  ui.panel.setAttribute('aria-label', '文档批注');
  const header = document.createElement('header');
  header.className = 'he-review-header';
  const heading = document.createElement('h2');
  heading.textContent = '文档批注';
  header.appendChild(heading);
  header.appendChild(makeButton('导出审阅文件', 'download', exportReviewedHtml, 'he-review-header-button he-review-export'));
  header.appendChild(makeButton('关闭批注面板', 'x', () => setOpen(false), 'he-review-header-button'));
  ui.panel.appendChild(header);
  ui.body = document.createElement('div');
  ui.body.className = 'he-review-body';
  ui.list = document.createElement('div');
  ui.list.className = 'he-review-list';
  ui.body.appendChild(ui.list);
  ui.composer = document.createElement('div');
  ui.composer.className = 'he-review-composer';
  ui.composer.hidden = true;
  ui.body.appendChild(ui.composer);
  ui.panel.appendChild(ui.body);
  ui.error = document.createElement('div');
  ui.error.className = 'he-review-error';
  ui.error.hidden = true;
  ui.error.setAttribute('role', 'alert');
  ui.panel.appendChild(ui.error);
  shadow.appendChild(ui.panel);

  host.addEventListener('pointerdown', (event) => event.stopPropagation());
  host.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('pointerup', captureSelection, true);
  document.addEventListener('keyup', captureSelection, true);
  window.addEventListener('scroll', scheduleFallback, true);
  window.addEventListener('resize', scheduleFallback);
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  restoreAuthorColors(payload.authorColors);
  loadCache();
  renderList();
  renderVisuals();
}
