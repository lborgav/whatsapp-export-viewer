(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────

  const SENDER_COLORS = [
    '#e15d44', '#5b5ea6', '#e07c24', '#1b998b',
    '#9b59b6', '#2980b9', '#d35400', '#27ae60',
  ];

  const MEDIA_EXTENSIONS = {
    image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'],
    video: ['mp4', '3gp', 'mov', 'avi'],
    audio: ['m4a', 'opus', 'ogg', 'mp3', 'aac'],
  };

  const MSG_RE = /^\u200e?\[?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s+(\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?:\s*[APap][Mm])?)\]?\s*[-–]?\s*(.+)$/;
  const MEDIA_ATTACH_RE = /<attached:\s*(.+?)>/i;
  const MEDIA_FILE_RE = /^(.+?)\s*\(file attached\)$/i;
  const OMITTED_RE = /\[(image|video|audio|sticker|document|GIF) omitted\]/i;
  const LINK_RE = /(https?:\/\/[^\s<]+)/g;

  // ── View State ───────────────────────────────────────────────────────
  let chatData = null;
  let currentView = 'all';

  // ── Helpers ────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function classifyFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (MEDIA_EXTENSIONS.image.includes(ext)) {
      return filename.startsWith('STK-') ? 'sticker' : 'image';
    }
    if (MEDIA_EXTENSIONS.video.includes(ext)) return 'video';
    if (MEDIA_EXTENSIONS.audio.includes(ext)) return 'audio';
    return 'file';
  }

  function senderColor(sender) {
    let hash = 0;
    for (let i = 0; i < sender.length; i++) {
      hash = ((hash << 5) - hash + sender.charCodeAt(i)) | 0;
    }
    return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
  }

  function formatText(text) {
    text = escapeHtml(text);
    text = text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '<b>$1</b>');
    text = text.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<i>$1</i>');
    text = text.replace(/(?<!\w)~([^~\n]+)~(?!\w)/g, '<s>$1</s>');
    text = text.replace(/(?<!\w)`([^`\n]+)`(?!\w)/g, '<code>$1</code>');
    return text;
  }

  // ── File Processing ────────────────────────────────────────────────────

  function findChatFile(files) {
    const txtFiles = files.filter(f => f.name.endsWith('.txt'));
    return (
      txtFiles.find(f => f.name === '_chat.txt') ||
      txtFiles.find(f => f.name.toLowerCase() === 'chat.txt') ||
      txtFiles.find(f => /whatsapp chat/i.test(f.name)) ||
      txtFiles[0] || null
    );
  }

  function buildMediaMap(files) {
    const map = new Map();
    for (const f of files) {
      if (f.name.endsWith('.txt')) continue;
      map.set(f.name, {
        blobUrl: URL.createObjectURL(f),
        type: classifyFile(f.name),
      });
    }
    return map;
  }

  function extractFolderName(files) {
    const path = files[0]?.webkitRelativePath || '';
    const folder = path.split('/')[0] || '';
    return folder.replace(/^WhatsApp Chat\s*[-–—]\s*/i, '').trim();
  }

  // ── Parser ─────────────────────────────────────────────────────────────

  function parseChat(text, mediaMap) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.split(/\r?\n/);
    const messages = [];

    for (const line of lines) {
      const trimmed = line.replace(/^\u200e+/, '');
      const m = MSG_RE.exec(trimmed);
      if (m) {
        const [, date, time, rest] = m;
        const colonIdx = rest.indexOf(':');
        let sender = null, content = rest;
        if (colonIdx > 0 && colonIdx < 60) {
          sender = rest.slice(0, colonIdx).trim();
          content = rest.slice(colonIdx + 1).trim();
        }
        messages.push({ date, time, sender, content, media: null });
      } else if (messages.length && trimmed) {
        messages[messages.length - 1].content += '\n' + trimmed;
      }
    }

    const senders = [...new Set(messages.filter(m => m.sender).map(m => m.sender))];

    for (const msg of messages) {
      msg.isSystem = !msg.sender;
      resolveMedia(msg, mediaMap);
    }

    return { messages, senders, me: null, isGroup: senders.length >= 2 };
  }

  function resolveMedia(msg, mediaMap) {
    const attachMatch = MEDIA_ATTACH_RE.exec(msg.content);
    const fileMatch = MEDIA_FILE_RE.exec(msg.content);
    const mediaRef = (attachMatch?.[1] || fileMatch?.[1] || '').trim();

    if (mediaRef && mediaMap.has(mediaRef)) {
      msg.media = { ...mediaMap.get(mediaRef), filename: mediaRef };
      msg.content = '';
      return;
    }

    if (!mediaRef) {
      for (const [key, val] of mediaMap) {
        if (msg.content.includes(key)) {
          msg.media = { ...val, filename: key };
          msg.content = msg.content.replace(key, '').trim();
          return;
        }
      }
    }

    const omitMatch = OMITTED_RE.exec(msg.content);
    if (omitMatch) msg.omitted = omitMatch[0];
  }

  // ── Sender Identity ──────────────────────────────────────────────────

  function applyMe(data, me) {
    data.me = me;
    for (const msg of data.messages) {
      msg.isMe = msg.sender === me;
    }
  }

  function showSenderPicker(senders) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('sender-picker');
      const options = document.getElementById('sender-picker-options');
      options.innerHTML = '';

      for (const name of senders) {
        const btn = document.createElement('button');
        btn.textContent = name;
        btn.addEventListener('click', () => {
          overlay.classList.remove('active');
          resolve(name);
        });
        options.appendChild(btn);
      }

      overlay.classList.add('active');
    });
  }

  // ── Renderer ───────────────────────────────────────────────────────────

  function renderChat(data, onImageClick) {
    const { messages, senders, me, isGroup } = data;
    const frag = document.createDocumentFragment();
    let lastDate = null;

    for (const msg of messages) {
      if (msg.date !== lastDate) {
        lastDate = msg.date;
        frag.appendChild(createDateSeparator(msg.date));
      }

      if (msg.isSystem) {
        frag.appendChild(createSystemMessage(msg));
      } else {
        frag.appendChild(createBubble(msg, isGroup, onImageClick));
      }
    }

    return frag;
  }

  function createDateSeparator(date) {
    const el = document.createElement('div');
    el.className = 'date-sep';
    el.innerHTML = `<span>${escapeHtml(date)}</span>`;
    return el;
  }

  function createSystemMessage(msg) {
    const el = document.createElement('div');
    el.className = 'msg-system';
    el.innerHTML = `<div class="bubble">${formatText(msg.content)}</div>`;
    return el;
  }

  function createBubble(msg, isGroup, onImageClick) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + (msg.isMe ? 'msg-me' : 'msg-other');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (isGroup && !msg.isMe && msg.sender) {
      const sEl = document.createElement('div');
      sEl.className = 'sender';
      sEl.style.color = senderColor(msg.sender);
      sEl.textContent = msg.sender;
      bubble.appendChild(sEl);
    }

    if (msg.media) bubble.appendChild(createMediaElement(msg.media, onImageClick));
    if (msg.omitted) bubble.appendChild(createPlaceholder(msg.omitted));

    const rawContent = msg.content.trim();
    const edited = /\n?<This message was edited>/i.test(rawContent);
    const content = rawContent.replace(/\n?<This message was edited>/gi, '').trim();

    const ts = document.createElement('span');
    ts.className = 'timestamp';
    if (edited) {
      const editedMark = document.createElement('span');
      editedMark.className = 'edited-mark';
      editedMark.textContent = 'edited';
      ts.appendChild(editedMark);
      ts.appendChild(document.createTextNode(msg.time.slice(0, 5)));
    } else {
      ts.textContent = msg.time.slice(0, 5);
    }

    if (content) {
      const row = document.createElement('span');
      row.className = 'text-row';
      const tEl = document.createElement('span');
      tEl.className = 'text';
      tEl.innerHTML = formatText(content);
      row.appendChild(tEl);
      row.appendChild(ts);
      bubble.appendChild(row);
    } else {
      bubble.appendChild(ts);
    }


    row.appendChild(bubble);
    return row;
  }

  function createMediaElement(media, onImageClick) {
    if (media.type === 'image' || media.type === 'sticker') {
      const img = document.createElement('img');
      img.src = media.blobUrl;
      img.loading = 'lazy';
      img.className = media.type === 'sticker' ? 'sticker' : 'media';
      img.alt = media.filename;
      img.addEventListener('click', () => onImageClick(media.blobUrl));
      return img;
    }
    if (media.type === 'video') {
      const vid = document.createElement('video');
      vid.src = media.blobUrl;
      vid.controls = true;
      vid.preload = 'metadata';
      return vid;
    }
    const aud = document.createElement('audio');
    aud.src = media.blobUrl;
    aud.controls = true;
    aud.preload = 'metadata';
    return aud;
  }

  function createPlaceholder(text) {
    const el = document.createElement('span');
    el.className = 'media-placeholder';
    el.textContent = text;
    return el;
  }

  // ── Data Extraction ───────────────────────────────────────────────

  function extractLinks(messages) {
    const results = [];
    for (const msg of messages) {
      if (!msg.sender || !msg.content) continue;
      const urls = msg.content.match(LINK_RE);
      if (!urls) continue;
      for (const url of urls) {
        results.push({
          url,
          sender: msg.sender,
          date: msg.date,
          time: msg.time,
          context: msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content,
        });
      }
    }
    return results;
  }

  function collectMedia(messages) {
    return messages.filter(m => m.media && ['image', 'video', 'audio', 'sticker'].includes(m.media.type));
  }

  function collectDocs(messages) {
    return messages.filter(m => m.media && m.media.type === 'file');
  }

  // ── View Renderers ──────────────────────────────────────────────────

  function renderMediaView(data, onImageClick) {
    const items = collectMedia(data.messages);
    const container = document.createElement('div');

    if (!items.length) {
      container.innerHTML = '<div class="view-empty">No media found in this chat.</div>';
      return container;
    }

    const images = items.filter(m => m.media.type === 'image' || m.media.type === 'sticker');
    const videos = items.filter(m => m.media.type === 'video');
    const audios = items.filter(m => m.media.type === 'audio');

    if (images.length || videos.length) {
      const grid = document.createElement('div');
      grid.className = 'media-grid';
      for (const msg of images) {
        const cell = document.createElement('div');
        cell.className = 'media-grid-item';
        const img = document.createElement('img');
        img.src = msg.media.blobUrl;
        img.alt = msg.media.filename;
        img.loading = 'lazy';
        img.addEventListener('click', () => onImageClick(msg.media.blobUrl));
        cell.appendChild(img);
        grid.appendChild(cell);
      }
      for (const msg of videos) {
        const cell = document.createElement('div');
        cell.className = 'media-grid-item';
        const vid = document.createElement('video');
        vid.src = msg.media.blobUrl;
        vid.controls = true;
        vid.preload = 'metadata';
        cell.appendChild(vid);
        grid.appendChild(cell);
      }
      container.appendChild(grid);
    }

    if (audios.length) {
      const section = document.createElement('div');
      section.className = 'audio-list';
      for (const msg of audios) {
        const card = document.createElement('div');
        card.className = 'audio-card';
        const aud = document.createElement('audio');
        aud.src = msg.media.blobUrl;
        aud.controls = true;
        aud.preload = 'metadata';
        card.appendChild(aud);
        const meta = document.createElement('div');
        meta.className = 'card-meta';
        meta.textContent = (msg.sender || 'Unknown') + ' · ' + msg.date + ' ' + msg.time;
        card.appendChild(meta);
        section.appendChild(card);
      }
      container.appendChild(section);
    }

    return container;
  }

  function renderLinksView(data) {
    const links = extractLinks(data.messages);
    const container = document.createElement('div');
    container.className = 'links-list';

    if (!links.length) {
      container.innerHTML = '<div class="view-empty">No links found in this chat.</div>';
      return container;
    }

    for (const link of links) {
      const card = document.createElement('div');
      card.className = 'link-card';
      const a = document.createElement('a');
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'link-url';
      a.textContent = link.url;
      card.appendChild(a);
      const ctx = document.createElement('div');
      ctx.className = 'link-context';
      ctx.textContent = link.context;
      card.appendChild(ctx);
      const meta = document.createElement('div');
      meta.className = 'card-meta';
      meta.textContent = link.sender + ' · ' + link.date + ' ' + link.time;
      card.appendChild(meta);
      container.appendChild(card);
    }

    return container;
  }

  function renderDocsView(data) {
    const docs = collectDocs(data.messages);
    const container = document.createElement('div');
    container.className = 'docs-list';

    if (!docs.length) {
      container.innerHTML = '<div class="view-empty">No documents found in this chat.</div>';
      return container;
    }

    for (const msg of docs) {
      const card = document.createElement('div');
      card.className = 'doc-card';
      const icon = document.createElement('span');
      icon.className = 'doc-icon';
      icon.textContent = '\uD83D\uDCC4';
      card.appendChild(icon);
      const info = document.createElement('div');
      info.className = 'doc-info';
      const name = document.createElement('div');
      name.className = 'doc-name';
      name.textContent = msg.media.filename;
      info.appendChild(name);
      const meta = document.createElement('div');
      meta.className = 'card-meta';
      meta.textContent = (msg.sender || 'Unknown') + ' · ' + msg.date + ' ' + msg.time;
      info.appendChild(meta);
      card.appendChild(info);
      const dl = document.createElement('a');
      dl.href = msg.media.blobUrl;
      dl.download = msg.media.filename;
      dl.className = 'doc-download';
      dl.textContent = 'Download';
      card.appendChild(dl);
      container.appendChild(card);
    }

    return container;
  }

  // ── Header ─────────────────────────────────────────────────────────────

  function resolveHeaderName(data) {
    const { senders, me, isGroup, folderName } = data;
    if (folderName) return folderName;
    const others = senders.filter(s => s !== me);
    if (!isGroup) return others[0] || 'Chat';
    return others.length > 2
      ? others.slice(0, 3).join(', ') + '...'
      : others.join(', ');
  }

  // ── UI Controllers ────────────────────────────────────────────────────

  function initTheme() {
    const btn = document.getElementById('theme-toggle');
    if (localStorage.getItem('wa-theme') === 'dark') {
      document.body.classList.add('dark-theme');
    }
    btn.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      localStorage.setItem('wa-theme',
        document.body.classList.contains('dark-theme') ? 'dark' : 'light');
    });
  }

  function initLightbox() {
    const overlay = document.getElementById('lightbox');
    const img = overlay.querySelector('img');

    const open = (src) => { img.src = src; overlay.classList.add('active'); };
    const close = () => overlay.classList.remove('active');

    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    return open;
  }

  function initScrollButton(container) {
    const btn = document.getElementById('scroll-bottom');
    container.addEventListener('scroll', () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      btn.classList.toggle('visible', !atBottom);
    });
    btn.addEventListener('click', () => { container.scrollTop = container.scrollHeight; });
  }

  function initNavigation() {
    document.querySelector('#chat-header .back-btn').addEventListener('click', () => {
      document.getElementById('chat-view').classList.remove('active');
      document.getElementById('chat-view').removeAttribute('data-view');
      document.getElementById('landing').style.display = 'flex';
      document.getElementById('messages').innerHTML = '';
      document.getElementById('folder-input').value = '';
      document.getElementById('search-box').classList.remove('active');
      chatData = null;
      currentView = 'all';
      const btn = document.getElementById('view-switcher-btn');
      btn.innerHTML = 'All Messages <span class="arrow">&#9662;</span>';
      document.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
      document.querySelector('.dropdown-item[data-view="all"]').classList.add('active');
    });
  }

  function switchView(view, openLightbox) {
    currentView = view;
    const chatView = document.getElementById('chat-view');
    chatView.setAttribute('data-view', view);

    const btn = document.getElementById('view-switcher-btn');
    const labels = { all: 'All Messages', media: 'Media', links: 'Links', docs: 'Documents' };
    btn.innerHTML = escapeHtml(labels[view]) + ' <span class="arrow">&#9662;</span>';

    document.querySelectorAll('.dropdown-item').forEach(i => {
      i.classList.toggle('active', i.dataset.view === view);
    });

    const container = document.getElementById('messages');
    container.innerHTML = '';
    container.scrollTop = 0;

    if (!chatData) return;

    if (view === 'all') {
      container.appendChild(renderChat(chatData, openLightbox));
      container.scrollTop = container.scrollHeight;
    } else if (view === 'media') {
      container.appendChild(renderMediaView(chatData, openLightbox));
    } else if (view === 'links') {
      container.appendChild(renderLinksView(chatData));
    } else if (view === 'docs') {
      container.appendChild(renderDocsView(chatData));
    }
  }

  function initViewSwitcher(openLightbox) {
    const btn = document.getElementById('view-switcher-btn');
    const menu = btn.nextElementSibling;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item) return;
      const view = item.dataset.view;
      menu.classList.remove('open');
      if (view !== currentView) switchView(view, openLightbox);
    });

    document.addEventListener('click', () => menu.classList.remove('open'));
  }

  function initSearch() {
    const input = document.getElementById('search-input');
    const countEl = document.getElementById('search-count');
    const prevBtn = document.getElementById('search-prev');
    const nextBtn = document.getElementById('search-next');
    const clearBtn = document.getElementById('search-clear');
    const searchBox = document.getElementById('search-box');

    let matches = [];
    let currentIdx = -1;

    function clearHighlights() {
      document.querySelectorAll('.search-highlight').forEach(el => {
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      });
      matches = [];
      currentIdx = -1;
    }

    function doSearch() {
      clearHighlights();
      const query = input.value.trim();
      if (!query) { countEl.textContent = ''; return; }

      const container = document.getElementById('messages');
      const textNodes = [];

      // Collect all text nodes inside .text spans
      container.querySelectorAll('.bubble .text').forEach(span => {
        const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) textNodes.push(node);
      });

      const queryLower = query.toLowerCase();

      for (const node of textNodes) {
        const text = node.textContent;
        const lower = text.toLowerCase();
        let idx = 0;
        const parts = [];
        let lastEnd = 0;

        while ((idx = lower.indexOf(queryLower, idx)) !== -1) {
          if (idx > lastEnd) parts.push(document.createTextNode(text.slice(lastEnd, idx)));
          const mark = document.createElement('mark');
          mark.className = 'search-highlight';
          mark.textContent = text.slice(idx, idx + query.length);
          parts.push(mark);
          lastEnd = idx + query.length;
          idx = lastEnd;
        }

        if (parts.length) {
          if (lastEnd < text.length) parts.push(document.createTextNode(text.slice(lastEnd)));
          const frag = document.createDocumentFragment();
          parts.forEach(p => frag.appendChild(p));
          node.parentNode.replaceChild(frag, node);
        }
      }

      matches = Array.from(container.querySelectorAll('.search-highlight'));
      if (matches.length) {
        currentIdx = 0;
        goToCurrent();
      }
      updateCount();
    }

    function updateCount() {
      if (!matches.length && !input.value.trim()) {
        countEl.textContent = '';
      } else if (!matches.length) {
        countEl.textContent = '0/0';
      } else {
        countEl.textContent = (currentIdx + 1) + '/' + matches.length;
      }
    }

    function goToCurrent() {
      matches.forEach(m => m.classList.remove('current'));
      if (matches[currentIdx]) {
        matches[currentIdx].classList.add('current');
        matches[currentIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    let debounce = null;
    input.addEventListener('input', () => {
      searchBox.classList.toggle('has-query', input.value.length > 0);
      clearTimeout(debounce);
      debounce = setTimeout(doSearch, 200);
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      searchBox.classList.remove('has-query');
      clearHighlights();
      countEl.textContent = '';
      input.focus();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) goToPrev(); else goToNext();
      }
    });

    function goToNext() {
      if (!matches.length) return;
      currentIdx = (currentIdx + 1) % matches.length;
      goToCurrent();
      updateCount();
    }

    function goToPrev() {
      if (!matches.length) return;
      currentIdx = (currentIdx - 1 + matches.length) % matches.length;
      goToCurrent();
      updateCount();
    }

    prevBtn.addEventListener('click', goToPrev);
    nextBtn.addEventListener('click', goToNext);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && document.getElementById('chat-view').classList.contains('active')) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────

  document.getElementById('landing').style.display = '';
  document.getElementById('chat-view').classList.remove('active');

  initTheme();
  initNavigation();
  initSearch();
  const openLightbox = initLightbox();
  initViewSwitcher(openLightbox);

  document.getElementById('folder-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const chatFile = findChatFile(files);
    if (!chatFile) return alert('No chat .txt file found in the selected folder.');

    const mediaMap = buildMediaMap(files);
    const text = await chatFile.text();
    const data = parseChat(text, mediaMap);

    if (!data.messages.length) {
      alert('Could not parse any messages from "' + chatFile.name + '". The chat format may not be supported.');
      return;
    }

    data.folderName = extractFolderName(files);

    if (data.senders.length >= 2) {
      const me = await showSenderPicker(data.senders);
      applyMe(data, me);
    } else if (data.senders.length === 1) {
      applyMe(data, data.senders[0]);
    }

    chatData = data;

    // Show chat view
    document.getElementById('landing').style.display = 'none';
    document.getElementById('chat-view').classList.add('active');
    document.getElementById('chat-name').textContent = resolveHeaderName(data);

    switchView('all', openLightbox);
    initScrollButton(document.getElementById('messages'));
  });

})();
