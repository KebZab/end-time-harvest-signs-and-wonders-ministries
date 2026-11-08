'use strict';
const CHURCH = 'End Time Harvest Signs & Wonders Ministries, Inc.';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ADMIN_PAGE = /\/admin(?:\.html)?\/?$/.test(location.pathname);
let me = null, books = [], bibleTranslations = [], route = {}, current = null;
let liveTimer, pendingLiveChange = null;

const api = (...args) => window.ChurchAPI.api(...args);

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', 3400);
}

const fmtDate = (d, long = true) => new Date(d + 'T00:00:00').toLocaleDateString(undefined,
  long ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const isAdmin = () => ADMIN_PAGE && me?.role === 'ADMIN' && me?.active;

let stopWatchingSelection = () => {};
function watchTextSelection(element, onSelect) {
  stopWatchingSelection();
  if (!element) return;
  const capture = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && element.contains(selection.anchorNode) && element.contains(selection.focusNode)) {
      const text = selection.toString().trim();
      if (text) onSelect(text);
    }
  };
  document.addEventListener('selectionchange', capture);
  element.addEventListener('pointerup', capture);
  stopWatchingSelection = () => {
    document.removeEventListener('selectionchange', capture);
    element.removeEventListener('pointerup', capture);
  };
}

function openModal(html, isWide = false) {
  stopWatchingSelection();
  const m = $('#modal');
  const isApp = html.includes('bible-app-modal'); // full-screen Bible reader on phones
  m.className = isApp ? 'modal-app' : '';
  m.innerHTML = `<div class="dialog ${isWide ? 'dialog-wide' : ''} ${isApp ? 'dialog-app' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  (m.querySelector('[data-act=close]') || m.querySelector('button'))?.focus({ preventScroll: true });
}

function closeModal() {
  stopWatchingSelection();
  const m = $('#modal');
  m.hidden = true;
  m.innerHTML = '';
  document.body.style.overflow = '';
  if (pendingLiveChange) scheduleLiveUpdate(pendingLiveChange);
}

/* ---------- Bible reference & aliases ---------- */
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  psalm: 'Psalms', songofsongs: 'Song of Solomon', canticles: 'Song of Solomon', revelations: 'Revelation',
  '1sam': '1 Samuel', '2sam': '2 Samuel', '1kgs': '1 Kings', '2kgs': '2 Kings',
  '1chr': '1 Chronicles', '2chr': '2 Chronicles', '1cor': '1 Corinthians', '2cor': '2 Corinthians',
  '1thess': '1 Thessalonians', '2thess': '2 Thessalonians', '1tim': '1 Timothy', '2tim': '2 Timothy',
  '1pet': '1 Peter', '2pet': '2 Peter', '1jn': '1 John', '2jn': '2 John', '3jn': '3 John'
};

function findBook(name) {
  const n = norm(name); if (!n) return null;
  if (ALIASES[n]) return ALIASES[n];
  const exact = books.find(b => norm(b.name || b) === n);
  if (exact) return exact.name || exact;
  const m = books.filter(b => norm(b.name || b).startsWith(n));
  return m.length === 1 ? (m[0].name || m[0]) : null;
}

function parseRef(text) {
  const m = text.trim().match(/^((?:[123]\s*)?[A-Za-z][A-Za-z .]*?)\s*(\d+)(?:\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
  if (!m) throw new Error(`"${text.trim()}" is not a Bible reference. Use a form like John 3:16 or Psalm 23:1-6.`);
  const book = findBook(m[1]);
  if (!book) throw new Error(`The book "${m[1].trim()}" was not recognised. Check the spelling.`);
  return { book, chapter: +m[2], verse_start: m[3] ? +m[3] : null, verse_end: m[4] ? +m[4] : null };
}

function parseVerseLines(text) {
  return text.split(/\n|;/).map(l => l.trim()).filter(Boolean).map(line => {
    const [ref, ...note] = line.split('|');
    return { ...parseRef(ref), note: note.join('|').trim() };
  });
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------- Highlighting Renderer ---------- */
function renderHighlightedText(text, highlights) {
  if (!text) return '';
  if (!highlights || !Array.isArray(highlights) || !highlights.length) return esc(text);

  const sorted = [...highlights].filter(h => h && h.text && h.text.trim())
    .sort((a, b) => b.text.length - a.text.length);
  if (!sorted.length) return esc(text);

  let tokens = [];
  let s = text;
  sorted.forEach(h => {
    const phrase = h.text.trim();
    if (!phrase) return;
    try {
      const regex = new RegExp(escapeRegex(phrase), 'gi');
      s = s.replace(regex, match => {
        const token = `__HLTOK_${tokens.length}__`;
        tokens.push({ token, color: h.color || 'yellow', text: match, orig: phrase });
        return token;
      });
    } catch (e) {}
  });

  let out = esc(s);
  tokens.forEach(t => {
    out = out.replace(t.token, `<mark class="hl hl-${esc(t.color)}" data-hl-color="${esc(t.color)}" data-hl-text="${esc(t.orig)}" title="Highlighted (${esc(t.color)})">${esc(t.text)}</mark>`);
  });
  return out;
}

function formatPassageText(text, highlights) {
  if (!text) return '';
  const rendered = renderHighlightedText(text, highlights);
  return rendered.replace(/\[(\d+)\]\s*/g, '<sup class="b-vnum">$1</sup> ');
}

/* ---------- Layout Shell ---------- */
const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/>',
  archive: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 3v3m8-3v3M8 11h8M8 15h5"/>',
  book: '<path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const icon = name => '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';

function shell(inner) {
  const admin = isAdmin();
  const links = [['','Home','home'],['archive','Topics','archive'],['bible','Bible','book']];
  if(admin) links.push(['members','Settings','settings']);
  const here = ['sermon','edit','new'].includes(route.name) ? 'archive' : route.name;
  return `<a class="skip" href="#main">Skip to content</a>
    <header class="top"><div class="top-in">
      <a class="brand" href="#/" aria-label="${esc(CHURCH)} — home"><img src="static/logo.png" alt="" width="40" height="40">
        <span><span class="name">End Time Harvest</span><span class="brand-sub">Signs &amp; Wonders Ministries</span></span></a>
      ${admin ? '<div class="who"><span class="adminbar">Admin</span></div>' : ''}
    </div>
    <nav class="main" aria-label="Main navigation"><div>${links.map(([h,label,i]) => `<a href="#/${h}" ${here === h ? 'aria-current="page"' : ''}>${icon(i)}<span>${label}</span></a>`).join('')}</div></nav></header>
    <main id="main" tabindex="-1">${inner}</main>
    <footer>${esc(CHURCH)}${admin ? '<a href="viewer.html">View Sunday service topics</a>' : ''}</footer>`;
}

function sermonRow(s) {
  const d = new Date(s.sermon_date + 'T00:00:00');
  return `<a class="row" href="#/sermon/${s.id}">
    <time class="date" datetime="${s.sermon_date}"><b>${d.getDate()}</b><span>${d.toLocaleDateString(undefined,{month:'short'})}</span></time>
    <div class="row-content"><h3>${esc(s.title)}</h3><p>${esc(s.pastor)} <span aria-hidden="true">·</span> ${d.getFullYear()}</p></div>
    ${icon('arrow')}</a>`;
}

/* ---------- Dashboard View ---------- */
async function viewDashboard() {
  const d = await api('/stats'), L = d.latest, admin = isAdmin();
  const rest = d.recent.filter(s => !L || s.id !== L.id).slice(0,4);
  const explore = admin ? '' : `<nav class="viewer-explore" aria-label="Explore the library">
    <a class="browse-card" href="#/archive"><span class="browse-icon">${icon('archive')}</span>
      <span class="browse-copy"><strong>All topics</strong><span>Find a past message</span></span>${icon('arrow')}</a>
    <a class="browse-card" href="#/bible"><span class="browse-icon">${icon('book')}</span>
      <span class="browse-copy"><strong>Read the Bible</strong><span>Explore the scriptures</span></span>${icon('arrow')}</a>
  </nav>`;
  return shell(`<div class="${admin ? 'admin-home' : 'viewer-home'}"><div class="page-heading"><div><h1>Sunday Service Topics</h1><p class="muted">Read, reflect, and revisit.</p></div>
    ${admin ? `<a class="btn" href="#/new">${icon('plus')} New topic</a>` : ''}</div>
    ${L ? `<section class="hero" aria-labelledby="latest"><p class="kicker">Latest topic</p>
      <h2 id="latest">${esc(L.title)}</h2><p class="sermon-meta">${esc(L.pastor)} <span aria-hidden="true">·</span> ${fmtDate(L.sermon_date,false)}</p>
      <a class="btn" href="#/sermon/${L.id}">Read topic ${icon('arrow')}</a></section>
      <form class="search ${admin ? '' : 'viewer-search'}" data-form="search"><label class="sr-only" for="q">Search topics or scripture</label>
        ${admin ? '' : icon('search')}<input id="q" type="search" placeholder="Search topics or scripture" autocomplete="off"><button class="btn ghost" type="submit">Search</button></form>
      ${explore}
      ${rest.length ? `<div class="sec-head"><h2>Recent topics</h2>${admin ? '<a href="#/archive">View all</a>' : ''}</div><div class="rows">${rest.map(sermonRow).join('')}</div>`
        : admin ? '<a class="text-link" href="#/archive">Browse all topics →</a>' : ''}`
      : `<section class="empty-state">${icon('book')}<h2>No topics recorded yet</h2><p>${admin ? 'Add your first topic to begin the library.' : 'New messages will appear here after the next service.'}</p>
        <a class="btn ghost" href="#/bible">Read the Bible</a></section>`}</div>`);
}

/* ---------- Archive View ---------- */
function archiveList(list, q) {
  return list.length ? `<div class="rows">${list.map(sermonRow).join('')}</div>`
    : `<div class="card empty">${q ? `No topics match "${esc(q)}". Try a pastor's name, a topic, or a verse such as Romans 8.` : 'No topics have been recorded yet.'}</div>`;
}

async function viewArchive() {
  const q = route.q || '', data = await api('/sermons?q=' + encodeURIComponent(q) + '&page=' + route.page);
  return shell(`<div class="page-heading"><h1>Topics</h1>${isAdmin() ? `<a class="btn" href="#/new">${icon('plus')} New topic</a>` : ''}</div>
    <div class="archive-search"><label class="sr-only" for="q">Search topics</label>
      <input id="q" type="search" value="${esc(q)}" placeholder="Search topic, pastor, or scripture" autocomplete="off"></div>
    <p class="results-count" id="count" aria-live="polite">${archiveCount(data)}</p>
    <div id="results">${archiveList(data.items,q)}</div><div id="archive-pager">${archivePager(data,q)}</div>`);
}
function archiveCount(data) {
  if (!data.items.length) return 'No topics found';
  const start = data.page * data.page_size + 1, end = start + data.items.length - 1;
  return `Showing ${start}–${end}`;
}
function archivePager(data,q) {
  if (!data.page && !data.has_more) return '';
  const link = page => '#/archive?q=' + encodeURIComponent(q) + '&page=' + page;
  return `<nav class="archive-pagination" aria-label="Topic pages">${data.page ? `<a class="btn ghost" href="${link(data.page-1)}">← Newer</a>` : '<span></span>'}
    ${data.has_more ? `<a class="btn ghost" href="${link(data.page+1)}">Older →</a>` : ''}</nav>`;
}

/* ---------- Topic Detail View ---------- */
function passageCard(v, idx, total, admin) {
  return `<article class="passage-card" data-verse-id="${v.id}">
    <div class="p-head"><div class="p-ref"><h3>${esc(v.book)} ${v.chapter}:${esc(v.verse_list || (v.verse_start ? v.verse_start + (v.verse_end ? '-' + v.verse_end : '') : ''))}</h3>
      <span class="p-tr-badge">${esc(v.translation || 'KJV')}</span></div>
      <div class="p-actions"><button class="btn ghost small" data-act="copy-passage" data-id="${v.id}" aria-label="Copy passage">Copy</button>
      ${admin ? `<details class="more-menu"><summary aria-label="Passage options">${icon('more')}</summary><div class="menu-items">
        <button data-act="edit-passage" data-id="${v.id}">Edit / highlight</button>
        ${idx > 0 ? `<button data-act="move-verse" data-id="${v.id}" data-dir="up">Move up</button>` : ''}
        ${idx < total - 1 ? `<button data-act="move-verse" data-id="${v.id}" data-dir="down">Move down</button>` : ''}
        <button class="danger-text" data-act="del-verse" data-id="${v.id}">Delete passage</button></div></details>` : ''}</div></div>
    <div class="p-body">${formatPassageText(v.verse_text,v.highlights || []) || '<p class="muted">Text not available.</p>'}</div>
    ${v.note ? `<div class="p-note"><b>Note</b><p>${esc(v.note)}</p></div>` : ''}</article>`;
}

async function viewSermon() {
  const version = renderVersion;
  const s = await api('/sermons/' + route.id), admin = isAdmin(), verses = s.verses || [];
  if (version !== renderVersion) return '';
  current = s;
  return shell(`<a class="back" href="#/archive">← Topics</a>
    <article class="s-head"><h1>${esc(s.title)}</h1><p class="sermon-meta">${esc(s.pastor)} <span aria-hidden="true">·</span> ${fmtDate(s.sermon_date,false)}</p>
      ${s.description ? `<p class="desc">${esc(s.description)}</p>` : ''}
      ${admin ? `<div class="actions"><a class="btn ghost small" href="#/edit/${s.id}">Edit topic</a>
        <details class="more-menu"><summary aria-label="Topic options">${icon('more')}</summary><div class="menu-items"><button class="danger-text" data-act="del-sermon">Delete topic</button></div></details></div>` : ''}</article>
    <section class="scriptures"><div class="sec-head"><h2>Scripture <span class="muted" id="scripture-count">${verses.length}</span></h2>
      ${admin ? `<button class="btn small" data-act="add-bible-passage">${icon('plus')} Add passage</button>` : ''}</div>
      <div id="passages-content">${verses.length ? `<div class="passage-list">${verses.map((v,i)=>passageCard(v,i,verses.length,admin)).join('')}</div>`
        : '<div class="empty card">No scripture passages added yet.</div>'}</div></section>`);
}

/* ---------- Topic Form (Create / Edit) ---------- */
let newSermonStagedVerses = [];

async function viewForm() {
  const editing = route.name === 'edit';
  const s = editing ? await api('/sermons/' + route.id) : { title: '', pastor: localStorage.getItem('pastor') || '', sermon_date: today(), description: '' };
  if (!editing) newSermonStagedVerses = [];

  return shell(`<a class="back" href="${editing ? '#/sermon/' + s.id : '#/archive'}">Cancel</a>
    <div class="card"><h1>${editing ? 'Edit topic' : 'New topic'}</h1>
    <form data-form="sermon" ${editing ? `data-id="${s.id}"` : ''}><div id="err"></div>
      <div class="field"><label for="title">Topic title</label><input id="title" required maxlength="200" value="${esc(s.title)}"></div>
      <div class="grid2"><div class="field"><label for="pastor">Pastor's name</label><input id="pastor" required maxlength="120" value="${esc(s.pastor)}"></div>
      <div class="field"><label for="date">Date of service</label><input id="date" type="date" required value="${s.sermon_date}"></div></div>
      <div class="field"><label for="desc">Short description or notes <span class="hint">(optional)</span></label><textarea id="desc" rows="4" maxlength="5000">${esc(s.description)}</textarea></div>
      
      ${editing ? '' : `
      <div class="staging-area">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
          <div><b>Bible passages for this topic</b><br><span class="muted" id="form-staged-count">${newSermonStagedVerses.length} passage(s) staged</span></div>
          <button type="button" class="btn small" data-act="form-add-passage">Add scripture</button>
        </div>
        <div id="form-staged-list" style="margin-top:.8rem">${renderFormStagedVerses()}</div>
      </div>`}

      <button class="btn" type="submit">${editing ? 'Save changes' : 'Save topic'}</button></form></div>`);
}

function renderFormStagedVerses() {
  if (!newSermonStagedVerses.length) {
    return `<p class="hint">Choose verses from the Bible and add a note or highlight.</p>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:.5rem">${newSermonStagedVerses.map((v, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:.5rem .8rem">
      <div><b>${esc(v.book)} ${v.chapter}:${esc(v.verse_list)}</b> <span class="p-tr-badge">${esc(v.translation)}</span>
        ${v.note ? `<br><small class="muted">Note: ${esc(v.note)}</small>` : ''}</div>
      <button type="button" class="btn danger small" data-act="form-remove-staged" data-idx="${i}">Remove</button>
    </div>`).join('')}</div>`;
}

/* ---------- Standalone Bible Library View (mobile-first reader) ---------- */
let bibleViewState = {
  tr: localStorage.getItem('bible_tr') || 'KJV',
  book: 'John',
  chapter: 1,
  chapterData: null,
  pickerOpen: false,
  pickerBook: null,   // book chosen in the picker, waiting for a chapter
  bookQuery: '',
  searchOpen: false,
  searchQ: '',
  searchResults: null,
  scrollToVerse: null,
};

// Move to the previous/next chapter, rolling over between books.
function stepChapter(book, chapter, delta) {
  const i = books.findIndex(b => b.name === book);
  const cur = books[i];
  if (!cur) return null;
  const ch = Number(chapter) + delta;
  if (ch >= 1 && ch <= cur.chapters) return { book, chapter: ch };
  if (ch < 1 && i > 0) return { book: books[i - 1].name, chapter: books[i - 1].chapters };
  if (ch > cur.chapters && i < books.length - 1) return { book: books[i + 1].name, chapter: 1 };
  return null;
}

async function viewBible() {
  const S = bibleViewState;
  if (!S.chapterData) S.chapterData = await loadBibleChapter(S.book, S.chapter, S.tr);
  const trs = bibleTranslations.length ? bibleTranslations : [{ id: 'KJV', name: 'King James Version' }];
  const curTr = trs.find(t => t.id === S.tr) || trs[0];
  const verses = S.chapterData?.verses || [];

  let panel;
  if (S.pickerOpen) {
    if (S.pickerBook) {
      const b = books.find(x => x.name === S.pickerBook) || { chapters: 1 };
      panel = `<div class="lib-panel">
        <button type="button" class="btn ghost small" data-act="b-picker-back" style="margin-bottom:.8rem">‹ ${esc(S.pickerBook)}</button>
        <div class="bible-chapter-grid">${Array.from({ length: b.chapters }, (_, i) => i + 1).map(c => `
          <button type="button" class="bible-ch-btn ${S.pickerBook === S.book && c === Number(S.chapter) ? 'active' : ''}" data-act="b-pick-chapter" data-c="${c}">${c}</button>`).join('')}
        </div></div>`;
    } else {
      const q = norm(S.bookQuery);
      const btn = b => `<button type="button" class="bible-book-card ${b.name === S.book ? 'active' : ''}" data-act="b-pick-book" data-b="${esc(b.name)}"${q && !norm(b.name).includes(q) ? ' style="display:none"' : ''}>${esc(b.name)}</button>`;
      panel = `<div class="lib-panel">
        <input type="text" id="b-book-filter" class="bible-find" placeholder="Find a book…" value="${esc(S.bookQuery)}" autocomplete="off">
        <div id="b-books">
          <h4 class="bible-group">Old Testament</h4><div class="bible-books-grid">${books.filter(b => b.testament === 'OT').map(btn).join('')}</div>
          <h4 class="bible-group">New Testament</h4><div class="bible-books-grid">${books.filter(b => b.testament === 'NT').map(btn).join('')}</div>
        </div></div>`;
    }
  } else if (S.searchOpen) {
    const res = S.searchResults;
    panel = `<div class="lib-panel">
      <form data-form="bible-search" class="bible-search-row">
        <input id="b-search-q" type="search" value="${esc(S.searchQ)}" placeholder="Search a word or phrase…" autocomplete="off">
        <button class="btn" type="submit">Search</button>
      </form>
      ${!res ? '' : res.length ? `<p class="muted" style="margin:.8rem 0 .4rem">${res.length} result${res.length === 1 ? '' : 's'} in ${esc(S.tr)}</p>` + res.map(r => `
        <button type="button" class="bible-result" data-act="jump-to-passage" data-b="${esc(r.book)}" data-c="${r.chapter}" data-v="${r.verse}">
          <b>${esc(r.reference)}</b><span>${r.snippet || esc(r.text)}</span>
        </button>`).join('') : '<p class="muted" style="margin-top:.8rem">No verses found.</p>'}
    </div>`;
  } else {
    panel = `<div class="lib-reader">
      <h1 class="bible-title">${esc(S.book)} ${S.chapter}</h1>
      <p class="bible-tr-name">${esc(curTr.name || curTr.id)}</p>
      <div class="bible-text-flow">
        ${verses.length ? verses.map(v => `<span class="b-verse-ro" id="bv-${v.verse}"><sup class="b-vnum">${v.verse}</sup>${esc(v.text)}</span> `).join('')
          : `<p class="muted">This chapter isn't available in ${esc(S.tr)}.</p>`}
      </div>
      <div class="lib-pager">
        <button type="button" class="btn ghost" data-act="b-step" data-d="-1">‹ Previous</button>
        <button type="button" class="btn ghost" data-act="b-step" data-d="1">Next ›</button>
      </div>
    </div>`;
  }

  return shell(`
    <div class="lib">
      <div class="bible-top-nav lib-bar">
        <button type="button" class="bible-arrow-btn" data-act="b-step" data-d="-1" title="Previous chapter" aria-label="Previous chapter">‹</button>
        <button type="button" class="bible-nav-btn ${S.pickerOpen ? 'active' : ''}" data-act="b-toggle-picker">${esc(S.book)} ${S.chapter} ▾</button>
        <button type="button" class="bible-arrow-btn" data-act="b-step" data-d="1" title="Next chapter" aria-label="Next chapter">›</button>
        <select id="b-tr-select" class="bible-tr" aria-label="Translation" title="${esc(curTr.name || curTr.id)}">
          ${trs.map(t => `<option value="${t.id}" ${t.id === S.tr ? 'selected' : ''}>${t.id}</option>`).join('')}
        </select>
        <span class="toolbar-spacer"></span>
        <button type="button" class="bible-arrow-btn ${S.searchOpen ? 'active' : ''}" data-act="b-toggle-search" title="Search" aria-label="Search">${icon('search')}</button>
      </div>
      ${panel}
    </div>`);
}

async function bibleGo(book, chapter, verse) {
  const S = bibleViewState;
  S.book = book; S.chapter = chapter;
  S.pickerOpen = false; S.pickerBook = null; S.searchOpen = false;
  S.scrollToVerse = verse || null;
  S.chapterData = await loadBibleChapter(book, chapter, S.tr);
  await render();
  if (S.scrollToVerse) {
    const el = $('#bv-' + S.scrollToVerse);
    if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); }
    S.scrollToVerse = null;
  }
}

/* ---------- Interactive Bible Selection Modal Engine ---------- */
let modalState = {
  sermonId: null,
  onSave: null,
  tab: 'browse', // 'browse' | 'search' | 'staged'
  tr: localStorage.getItem('bible_tr') || 'KJV',
  testament: 'ALL', // 'ALL' | 'OT' | 'NT'
  book: 'Genesis',
  chapter: 1,
  chapterData: null,
  selectedVerses: new Set(),
  activeHighlights: [], // [{ text, color, verse }]
  selectedTextRange: null,
  noteText: '',
  showNoteInput: false,
  pickerOpen: false, // controls dropdown sheet for book & chapter selection
  pickerStep: 'books', // 'books' | 'chapters'
  bookSearchQuery: '',
  staged: [],
  searchQ: '',
  searchResults: null,
  searchLoading: false,
};

async function loadBibleChapter(book, chapter, tr) {
  try {
    return await api(`/bible/chapter?translation=${tr}&book=${encodeURIComponent(book)}&chapter=${chapter}`);
  } catch (e) {
    return null;
  }
}

async function changeChapter(delta) {
  const curBIndex = books.findIndex(b => b.name === modalState.book);
  const curB = books[curBIndex] || books[0];
  let newCh = Number(modalState.chapter) + delta;

  if (newCh < 1) {
    if (curBIndex > 0) {
      const prevB = books[curBIndex - 1];
      modalState.book = prevB.name;
      modalState.chapter = prevB.chapters;
    } else {
      toast('You are at Genesis 1 (beginning of the Bible)');
      return;
    }
  } else if (newCh > curB.chapters) {
    if (curBIndex < books.length - 1) {
      const nextB = books[curBIndex + 1];
      modalState.book = nextB.name;
      modalState.chapter = 1;
    } else {
      toast('You are at Revelation 22 (end of the Bible)');
      return;
    }
  } else {
    modalState.chapter = newCh;
  }
  modalState.selectedVerses = new Set();
  modalState.activeHighlights = [];
  modalState.chapterData = await loadBibleChapter(modalState.book, modalState.chapter, modalState.tr);
  renderBibleSelectorModal();
}

async function openBibleSelector(opts = {}) {
  modalState.sermonId = opts.sermonId || null;
  modalState.onSave = opts.onSave || null;
  modalState.selectedVerses = new Set();
  modalState.activeHighlights = [];
  modalState.noteText = '';
  modalState.showNoteInput = false;
  modalState.pickerOpen = false;
  modalState.pickerStep = 'books';
  modalState.bookSearchQuery = '';
  modalState.tab = 'browse';
  modalState.staged = opts.staged ? [...opts.staged] : [];
  modalState.searchQ = '';
  modalState.searchResults = null;
  
  if (!books.length) {
    try { books = await api('/bible/books'); } catch (e) {}
  }
  if (!bibleTranslations.length) {
    try { bibleTranslations = await api('/bible/translations'); } catch (e) {}
  }

  if (!modalState.chapterData) {
    modalState.chapterData = await loadBibleChapter(modalState.book, modalState.chapter, modalState.tr);
  }
  renderBibleSelectorModal();
}

function verseRangeText(set) {
  const v = Array.from(set).sort((a, b) => a - b);
  if (!v.length) return '';
  const out = [];
  let s = v[0], e = v[0];
  for (let i = 1; i < v.length; i++) {
    if (v[i] === e + 1) e = v[i];
    else { out.push(s === e ? `${s}` : `${s}-${e}`); s = e = v[i]; }
  }
  out.push(s === e ? `${s}` : `${s}-${e}`);
  return out.join(', ');
}

function renderBibleSelectorModal() {
  const trs = bibleTranslations.length ? bibleTranslations : [{ id: 'KJV', name: 'King James Version' }];
  const curTr = trs.find(t => t.id === modalState.tr) || trs[0];
  const pb = modalState.pickerBook || modalState.book; // book being browsed in the picker
  const curB = books.find(b => b.name === pb) || { chapters: 50 };
  const verses = modalState.chapterData?.verses || [];
  const nSel = modalState.selectedVerses.size;
  const nStaged = modalState.staged.length;
  const q = norm(modalState.bookSearchQuery || '');
  const bookBtn = b => `<button type="button" class="bible-book-card ${b.name === pb ? 'active' : ''}" data-act="m-pick-book" data-b="${esc(b.name)}"${q && !norm(b.name).includes(q) ? ' style="display:none"' : ''}>${esc(b.name)}</button>`;

  // ---- Book / chapter picker
  const picker = !modalState.pickerOpen ? '' : `
    <div class="bible-picker-sheet">
      ${modalState.pickerStep === 'books' ? `
        <input type="text" id="m-book-search" placeholder="Find a book…" value="${esc(modalState.bookSearchQuery || '')}" class="bible-find">
        <div id="m-books-grid">
          <h4 class="bible-group">Old Testament</h4>
          <div class="bible-books-grid">${books.filter(b => b.testament === 'OT').map(bookBtn).join('')}</div>
          <h4 class="bible-group">New Testament</h4>
          <div class="bible-books-grid">${books.filter(b => b.testament === 'NT').map(bookBtn).join('')}</div>
        </div>
      ` : `
        <button type="button" class="btn ghost small" data-act="m-picker-step" data-step="books" style="margin-bottom:.8rem">‹ ${esc(pb)}</button>
        <div class="bible-chapter-grid">
          ${Array.from({ length: curB.chapters }, (_, i) => i + 1).map(c => `
            <button type="button" class="bible-ch-btn ${pb === modalState.book && c === Number(modalState.chapter) ? 'active' : ''}" data-act="m-pick-chapter" data-c="${c}">${c}</button>`).join('')}
        </div>
      `}
    </div>`;

  // ---- Main body
  let body;
  if (modalState.tab === 'search') {
    body = `
      <div class="bible-panel">
        <form data-form="m-search" class="bible-search-row">
          <input id="m-search-input" type="search" value="${esc(modalState.searchQ)}" placeholder="Search a word or phrase…">
          <button class="btn" type="submit">Search</button>
        </form>
        ${modalState.searchLoading ? '<p class="muted">Searching…</p>' : !modalState.searchResults ? '' :
          modalState.searchResults.length ? modalState.searchResults.map(r => `
            <button type="button" class="bible-result" data-act="m-jump-browse" data-b="${esc(r.book)}" data-c="${r.chapter}" data-v="${r.verse}">
              <b>${esc(r.reference)}</b>
              <span>${r.snippet || esc(r.text)}</span>
            </button>`).join('') : '<p class="muted">No verses found.</p>'}
      </div>`;
  } else if (modalState.tab === 'staged') {
    body = `
      <div class="bible-panel">
        ${nStaged ? modalState.staged.map((p, i) => `
          <div class="staged-card">
            <div class="staged-card-head">
              <h4>${esc(p.book)} ${p.chapter}:${esc(p.verse_list)} <span class="p-tr-badge">${esc(p.translation)}</span></h4>
              <button type="button" class="btn ghost small" data-act="m-remove-staged" data-idx="${i}">Remove</button>
            </div>
            <div class="p-body">${formatPassageText(p.verse_text, p.highlights)}</div>
            ${p.note ? `<div class="p-note">${esc(p.note)}</div>` : ''}
          </div>`).join('') : '<p class="muted">Nothing added yet.</p>'}
      </div>`;
  } else {
    body = `
      <div class="bible-reader-canvas">
        <h2 class="bible-title">${esc(modalState.book)} ${modalState.chapter}</h2>
        <div class="bible-text-flow" id="m-verse-flow">
          ${verses.length ? verses.map(v => {
            const hl = renderHighlightedText(v.text, modalState.activeHighlights.filter(h => !h.verse || h.verse === v.verse));
            return `<span class="b-verse ${modalState.selectedVerses.has(v.verse) ? 'selected' : ''}" data-act="m-toggle-verse" data-v="${v.verse}"><sup class="b-vnum">${v.verse}</sup>${hl}</span> `;
          }).join('') : `<p class="muted">This chapter isn't available in ${esc(modalState.tr)}.</p>`}
        </div>
      </div>`;
  }

  // ---- Bottom bar
  let bar = '';
  if (modalState.tab === 'browse' && nSel) {
    bar = `
      <div class="bible-floating-bar">
        <div class="bible-bar-row">
          <b class="bible-selection-ref">${esc(modalState.book)} ${modalState.chapter}:${esc(verseRangeText(modalState.selectedVerses))} <small>${esc(modalState.tr)}</small></b>
          <button type="button" class="bible-x" data-act="m-clear-sel" title="Deselect">✕</button>
        </div>
        <div class="bible-palette">
          ${['yellow', 'green', 'blue', 'pink', 'orange'].map(c => `<button type="button" class="b-swatch swatch-${c}" data-act="m-apply-hl" data-color="${c}" title="Highlight ${c}" aria-label="Highlight ${c}"></button>`).join('')}
          <button type="button" class="b-swatch swatch-none" data-act="m-clear-hl" title="Remove highlight">⊘</button>
        </div>
        <input id="m-passage-note" aria-label="Passage note" class="bible-note-input" value="${esc(modalState.noteText)}" placeholder="Note (optional)">
        <div class="bible-bar-row">
          <button type="button" class="btn ghost" data-act="m-stage-passage">+ Add another</button>
          <button type="button" class="btn" data-act="m-save-direct">Save${nStaged ? ` (${nStaged + 1})` : ''}</button>
        </div>
      </div>`;
  } else if (nStaged) {
    bar = `
      <div class="bible-floating-bar">
        <div class="bible-bar-row">
          <button type="button" class="btn ghost" data-act="m-tab" data-t="${modalState.tab === 'staged' ? 'browse' : 'staged'}">
            ${modalState.tab === 'staged' ? '‹ Back to Bible' : `${nStaged} added · Review`}
          </button>
          <button type="button" class="btn" data-act="m-save-all-staged">Save (${nStaged})</button>
        </div>
      </div>`;
  }

  const back = modalState.tab !== 'browse';
  const html = `
    <div class="bible-app-modal${picker ? ' is-picking' : ''}">
      <div class="bible-top-nav">
        ${back ? `<button type="button" class="bible-arrow-btn" data-act="m-tab" data-t="browse" title="Back">‹</button>
                  <b class="bible-nav-title">${modalState.tab === 'search' ? 'Search' : 'Added passages'}</b>` : `
        <button type="button" class="bible-arrow-btn" data-act="m-prev-ch" title="Previous chapter" aria-label="Previous chapter">‹</button>
        <button type="button" class="bible-nav-btn" data-act="m-toggle-picker">${esc(modalState.book)} ${modalState.chapter} ▾</button>
        <button type="button" class="bible-arrow-btn" data-act="m-next-ch" title="Next chapter" aria-label="Next chapter">›</button>
        <select id="m-tr-select" class="bible-tr" title="${esc(curTr.name || curTr.id)}" aria-label="Translation">
          ${trs.map(t => `<option value="${t.id}" ${t.id === modalState.tr ? 'selected' : ''}>${t.id}</option>`).join('')}
        </select>`}
        <span class="toolbar-spacer"></span>
        ${back ? '' : `<button type="button" class="bible-arrow-btn" data-act="m-tab" data-t="search" title="Search" aria-label="Search">${icon('search')}</button>`}
        <button type="button" class="bible-arrow-btn" data-act="close" title="Close" aria-label="Close">✕</button>
      </div>
      ${picker}
      ${body}
      ${bar}
    </div>`;

  // Keep the reader's scroll position when re-rendering (e.g. after tapping a verse)
  const oldCanvas = $('.bible-reader-canvas');
  const keepScroll = oldCanvas && modalState._shown === modalState.book + modalState.chapter ? oldCanvas.scrollTop : 0;
  openModal(html, true);
  const canvas = $('.bible-reader-canvas');
  if (canvas) {
    if (modalState.scrollToVerse) {
      $(`.b-verse[data-v="${modalState.scrollToVerse}"]`)?.scrollIntoView({ block: 'center' });
      modalState.scrollToVerse = null;
    } else canvas.scrollTop = keepScroll;
    modalState._shown = modalState.book + modalState.chapter;
  }
  setupModalEvents();
}

function setupModalEvents() {
  const trSelect = $('#m-tr-select');
  if (trSelect) {
    trSelect.onchange = async () => {
      modalState.tr = trSelect.value;
      localStorage.setItem('bible_tr', modalState.tr);
      modalState.chapterData = await loadBibleChapter(modalState.book, modalState.chapter, modalState.tr);
      renderBibleSelectorModal();
    };
  }

  const bookSearch = $('#m-book-search');
  if (bookSearch) {
    bookSearch.oninput = () => {
      modalState.bookSearchQuery = bookSearch.value;
      const q = norm(bookSearch.value);
      $$('.bible-book-card', $('#m-books-grid')).forEach(btn => {
        const matches = norm(btn.dataset.b).includes(q);
        btn.style.display = matches ? 'flex' : 'none';
      });
    };
  }

  watchTextSelection($('#m-verse-flow'), text => { modalState.selectedTextRange = text; });

  const noteInput = $('#m-passage-note');
  if (noteInput) {
    noteInput.oninput = () => {
      modalState.noteText = noteInput.value;
    };
  }
}

function buildSelectedPassageObject() {
  const vList = Array.from(modalState.selectedVerses).sort((a, b) => a - b);
  if (!vList.length) throw new Error('Please select at least one verse from the chapter.');

  let textParts = [];
  const versesData = modalState.chapterData?.verses || [];
  vList.forEach(vNum => {
    const found = versesData.find(x => x.verse === vNum);
    if (found) textParts.push(`[${vNum}] ${found.text}`);
  });

  let ranges = [];
  let start = vList[0], end = vList[0];
  for (let i = 1; i < vList.length; i++) {
    if (vList[i] === end + 1) {
      end = vList[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = vList[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  const verseListStr = ranges.join(', ');

  return {
    book: modalState.book,
    chapter: Number(modalState.chapter),
    verse_start: vList[0],
    verse_end: vList[vList.length - 1],
    verse_list: verseListStr,
    translation: modalState.tr,
    verse_text: textParts.join(' '),
    highlights: [...modalState.activeHighlights],
    note: modalState.noteText.trim(),
  };
}

/* ---------- Verse Editor Modal (Edit Translation, Highlights, Notes) ---------- */
function openEditPassage(v) {
  const trs = bibleTranslations.length ? bibleTranslations : [{ id: 'KJV', name: 'King James Version' }];
  let editTr = v.translation || 'KJV';
  let editHighlights = Array.isArray(v.highlights) ? [...v.highlights] : [];
  let editNote = v.note || '';
  let editText = v.verse_text || '';
  let selectedText = '';

  const renderContent = () => {
    const renderedHl = formatPassageText(editText, editHighlights);
    return `
      <div class="dialog-head">
        <h2>Edit passage</h2>
        <button class="btn ghost small" data-act="close">✕ Close</button>
      </div>
      <div class="grid2">
        <div class="field">
          <label>Scripture Reference</label>
          <input value="${esc(v.book)} ${v.chapter}:${esc(v.verse_list || (v.verse_start ? v.verse_start + (v.verse_end ? '-' + v.verse_end : '') : ''))}" readonly style="background:rgba(0,0,0,.08)">
        </div>
        <div class="field">
          <label for="edit-tr">Bible Translation</label>
          <select id="edit-tr">
            ${trs.map(t => `<option value="${t.id}" ${t.id === editTr ? 'selected' : ''}>${esc(t.name || t.id)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field">
        <label>Passage Text & Highlighting</label>
        <div class="bible-bar-row" style="margin-bottom:.65rem">
          <div class="bible-palette">
            <span style="font-size:.85rem;font-weight:700;color:var(--muted)">Highlight:</span>
            <button type="button" class="b-swatch swatch-yellow" data-act="edit-apply-hl" data-color="yellow" title="Highlight Yellow"></button>
            <button type="button" class="b-swatch swatch-green" data-act="edit-apply-hl" data-color="green" title="Highlight Green"></button>
            <button type="button" class="b-swatch swatch-blue" data-act="edit-apply-hl" data-color="blue" title="Highlight Blue"></button>
            <button type="button" class="b-swatch swatch-pink" data-act="edit-apply-hl" data-color="pink" title="Highlight Pink"></button>
            <button type="button" class="b-swatch swatch-orange" data-act="edit-apply-hl" data-color="orange" title="Highlight Orange"></button>
            <button type="button" class="b-swatch swatch-none" data-act="edit-clear-hl" title="Remove highlights">⊘</button>
          </div>
          <small class="muted" style="margin-left:auto">Select text to highlight</small>
        </div>
        <div id="edit-passage-body" class="p-body" style="border:1.5px solid var(--line);border-radius:8px;padding:1rem;background:var(--surface);max-height:260px;overflow-y:auto;line-height:1.9">
          ${renderedHl}
        </div>
      </div>

      <div class="field">
        <label for="edit-note">Pastor's Note or Key Takeaway</label>
        <textarea id="edit-note" rows="3" maxlength="2000">${esc(editNote)}</textarea>
      </div>

      <div class="actions" style="justify-content:flex-end;margin-top:1rem">
        <button class="btn ghost" data-act="close">Cancel</button>
        <button class="btn" id="save-edit-btn">Save Changes</button>
      </div>
    `;
  };

  openModal(renderContent());

  const setupEditEvents = () => {
    const trEl = $('#edit-tr');
    if (trEl) {
      trEl.onchange = async () => {
        editTr = trEl.value;
        try {
          const fetched = await api(`/bible/verses?translation=${editTr}&book=${encodeURIComponent(v.book)}&chapter=${v.chapter}&verses=${encodeURIComponent(v.verse_list || v.verse_start)}`);
          if (fetched && fetched.text) editText = fetched.text;
        } catch (e) {}
        openModal(renderContent());
        setupEditEvents();
      };
    }

    watchTextSelection($('#edit-passage-body'), text => { selectedText = text; });

    $$('[data-act="edit-apply-hl"]').forEach(b => {
      b.onclick = () => {
        if (!selectedText) {
          toast('Please select a phrase or sentence with your mouse/finger first.', true);
          return;
        }
        editHighlights.push({ text: selectedText, color: b.dataset.color });
        selectedText = '';
        const curNote = $('#edit-note')?.value;
        if (curNote !== undefined) editNote = curNote;
        openModal(renderContent());
        setupEditEvents();
      };
    });

    const clearHlBtn = $('[data-act="edit-clear-hl"]');
    if (clearHlBtn) {
      clearHlBtn.onclick = () => {
        editHighlights = [];
        const curNote = $('#edit-note')?.value;
        if (curNote !== undefined) editNote = curNote;
        openModal(renderContent());
        setupEditEvents();
      };
    }

    const saveBtn = $('#save-edit-btn');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try {
          const payload = {
            book: v.book,
            chapter: v.chapter,
            verse_start: v.verse_start,
            verse_end: v.verse_end,
            verse_list: v.verse_list,
            translation: editTr,
            verse_text: editText,
            highlights: editHighlights,
            note: $('#edit-note').value.trim(),
          };
          await api('/verses/' + v.id, 'PUT', payload);
          toast('Bible passage updated successfully');
          closeModal();
          render();
        } catch (err) {
          toast(err.message, true);
          saveBtn.disabled = false;
        }
      };
    }
  };

  setupEditEvents();
}

/* ---------- Administrator access ---------- */
async function viewMembers() {
  return shell(`<div class="page-heading"><h1>Settings</h1></div>
    <section class="card settings-card"><h2>Your account</h2><p class="muted">${esc(me.email)}</p>
      <div class="actions"><button class="btn ghost" data-act="account">Change password</button><button class="btn ghost" data-act="logout">Sign out</button></div></section>
    <section class="card settings-card"><h2>Backup</h2><p class="muted">Save a copy of your topics, scripture, and notes.</p><button class="btn" data-act="export">Download backup</button></section>
    <a class="text-link" href="viewer.html">View Sunday service topics →</a>`);
}

function viewLogin() {
  document.body.className = 'gate';
  app.innerHTML = `<main class="login"><div class="login-card">
    <a class="login-brand" href="viewer.html"><img src="static/logo.png" alt="" width="56" height="56"><span>End Time Harvest</span></a>
    <h1>Admin sign in</h1><p class="muted">Manage topics and scripture.</p>
    <form data-form="login"><div id="err" role="alert"></div>
      <div class="field"><label for="un">Email</label><input id="un" type="email" required autocapitalize="off" autocomplete="username" placeholder="Your administrator email"></div>
      <div class="field"><label for="pw">Password</label><input id="pw" type="password" required autocomplete="current-password"></div>
      <button class="btn" type="submit">Sign in</button></form>
    <a class="login-back" href="viewer.html">← Back to Sunday service topics</a></div></main>`;
}

/* ---------- Router ---------- */
function parseRoute() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', id] = path.split('/');
  const known = ['', 'archive', 'sermon', 'new', 'edit', 'members', 'bible'];
  const params = new URLSearchParams(qs || '');
  return { name: known.includes(name) ? name : '', id, q: (params.get('q') || '').slice(0,200), page: Math.max(0,Math.floor(Number(params.get('page')) || 0)) };
}

let renderVersion = 0;
async function render(preserveScroll = false) {
  const version = ++renderVersion;
  const scroll = window.scrollY;
  if (ADMIN_PAGE && !isAdmin()) { window.ChurchAPI.setLive(false); return viewLogin(); }
  route = parseRoute();
  document.body.className = isAdmin() ? 'admin' : 'viewer';
  if (!isAdmin() && ['new', 'edit', 'members'].includes(route.name)) { location.hash = '#/'; return; }
  const views = { '': viewDashboard, archive: viewArchive, sermon: viewSermon, new: viewForm, edit: viewForm, members: viewMembers, bible: viewBible };
  try {
    await window.ChurchAPI.setLive(['','archive','sermon'].includes(route.name), route.name === 'sermon' ? route.id : null);
    if (version !== renderVersion) return;
    const html = await views[route.name]();
    if (version !== renderVersion) return;
    app.innerHTML = html;
    window.scrollTo(0, preserveScroll ? scroll : 0);
  } catch (e) {
    if (version !== renderVersion) return;
    app.innerHTML = shell(`<div class="card empty"><h2>This page could not be shown</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to home</a></div>`);
  }
}
window.addEventListener('hashchange', () => { closeModal(); render(); });

// Patch only changed passage cards, preserving the reader's position and inputs.
function scheduleLiveUpdate(change) {
  if (!['','archive','sermon'].includes(route.name)) return;
  if (!change.reset && !change.metadata && (route.name === '' || (route.name === 'archive' && !route.q)
    || (route.name === 'sermon' && !change.sermonIds?.includes(Number(route.id))))) return;
  pendingLiveChange = { ...change, reset: change.reset || pendingLiveChange?.reset, metadata: change.metadata || pendingLiveChange?.metadata };
  clearTimeout(liveTimer);
  liveTimer = setTimeout(async () => {
    if (document.hidden || !$('#modal').hidden || document.activeElement === $('#q')) return;
    const update = pendingLiveChange;
    pendingLiveChange = null;
    if (!update) return;
    if (route.name !== 'sermon' || update.reset || update.metadata) { await render(true); return; }
    const id = route.id;
    try {
      const s = await api('/sermons/' + id);
      if (route.name !== 'sermon' || route.id !== id || !$('#passages-content')) return;
      const before = new Map((current?.verses || []).map(v => [v.id,JSON.stringify(v)]));
      const container = $('#passages-content');
      if (!s.verses.length) container.innerHTML = '<div class="empty card">No scripture passages added yet.</div>';
      else {
        if (!$('.passage-list',container)) container.innerHTML = '<div class="passage-list"></div>';
        const list = $('.passage-list',container), ids = new Set(s.verses.map(v=>String(v.id)));
        $$('[data-verse-id]',list).forEach(node => { if (!ids.has(node.dataset.verseId)) node.remove(); });
        s.verses.forEach((v,i) => {
          let node = $(`[data-verse-id="${v.id}"]`,list);
          if (!node || before.get(v.id) !== JSON.stringify(v) || isAdmin()) {
            const template = document.createElement('template');
            template.innerHTML = passageCard(v,i,s.verses.length,isAdmin());
            const replacement = template.content.firstElementChild;
            if (node) node.replaceWith(replacement);
            node = replacement;
          }
          if (list.children[i] !== node) list.insertBefore(node,list.children[i] || null);
        });
      }
      $('#scripture-count').textContent = s.verses.length;
      current = s;
    } catch { await render(true); }
  },150);
}
window.ChurchAPI.watchLibrary(scheduleLiveUpdate);
document.addEventListener('focusout', () => { if (pendingLiveChange) scheduleLiveUpdate(pendingLiveChange); });

/* ---------- Global Action Handlers ---------- */
const showErr = msg => { const e = $('#err'); if (e) { e.innerHTML = msg ? `<div class="err" role="alert">${esc(msg)}</div>` : ''; if (msg) e.scrollIntoView({ block: 'nearest' }); } else toast(msg, true); };
const val = id => $('#' + id).value.trim();
const confirmBox = (title, msg, okLabel) => new Promise(res => {
  openModal(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><div class="actions"><button class="btn danger" id="ok">${okLabel}</button><button class="btn ghost" id="no">Cancel</button></div>`);
  $('#ok').onclick = () => { closeModal(); res(true); };
  $('#no').onclick = () => { closeModal(); res(false); };
});

const ACTIONS = {
  close: closeModal,
  retry() { boot(); },
  async logout() { try { await api('/logout', 'POST'); me = null; closeModal(); location.hash = ''; render(); } catch (e) { toast(e.message, true); } },
  async export() {
    try {
      const sermons = await api('/export');
      const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), sermons }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'sunday-service-topics-' + today() + '.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast(e.message, true); }
  },
  account() {
    openModal(`<div class="dialog-head"><h2>Your account</h2><button class="btn ghost small" data-act="close">✕ Close</button></div>
      <p><b>${esc(me.full_name)}</b><br><span class="muted">Username: ${esc(me.username)}</span></p>
      <form data-form="password"><div id="err"></div><h3>Change password</h3>
      <div class="field"><label for="cur">Current password</label><input id="cur" type="password" required autocomplete="current-password"></div>
      <div class="field"><label for="new">New password <span class="hint">(at least 12 characters)</span></label><input id="new" type="password" required minlength="12" autocomplete="new-password"></div>
      <button class="btn" type="submit">Save new password</button></form>`);
  },
  async 'del-sermon'() {
    if (!await confirmBox('Delete this topic?', `"${current.title}" and its ${current.verses.length} scripture passage(s) will be permanently removed.`, 'Delete topic')) return;
    try { await api('/sermons/' + current.id, 'DELETE'); toast('Topic deleted'); location.hash = '#/archive'; } catch (e) { toast(e.message, true); }
  },
  async 'del-verse'(el) {
    const v = current.verses.find(x => x.id == el.dataset.id);
    if (!await confirmBox('Delete this scripture?', `${v.ref} will be removed from this topic.`, 'Delete scripture')) return;
    try { await api('/verses/' + v.id, 'DELETE'); toast('Passage removed'); render(); } catch (e) { toast(e.message, true); }
  },
  'copy-passage'(el) {
    const v = current.verses.find(x => x.id == el.dataset.id);
    if (!v) return;
    const ref = `${v.book} ${v.chapter}:${v.verse_list || (v.verse_start ? v.verse_start + (v.verse_end ? '-' + v.verse_end : '') : '')} (${v.translation || 'KJV'})`;
    const cleanText = (v.verse_text || '').replace(/\[\d+\]\s*/g, '');
    const textToCopy = `"${cleanText}"\n— ${ref}` + (v.note ? `\n\nPastor's Note: ${v.note}` : '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        toast(`Copied ${ref} to clipboard`);
      }).catch(() => {
        toast(`Copied ${ref}`);
      });
    } else {
      toast(`Copied ${ref}`);
    }
  },
  'edit-passage'(el) {
    const v = current.verses.find(x => x.id == el.dataset.id);
    if (v) openEditPassage(v);
  },
  async 'move-verse'(el) {
    const vid = Number(el.dataset.id);
    const dir = el.dataset.dir;
    const vs = [...current.verses];
    const idx = vs.findIndex(x => x.id === vid);
    if (idx === -1) return;
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= vs.length) return;
    
    // Swap
    const temp = vs[idx];
    vs[idx] = vs[targetIdx];
    vs[targetIdx] = temp;
    const order = vs.map(x => x.id);
    try {
      await api(`/sermons/${current.id}/reorder-verses`, 'POST', { order });
      render();
    } catch (e) { toast(e.message, true); }
  },
  'add-bible-passage'() {
    openBibleSelector({
      sermonId: current.id,
      onSave: async (passages) => {
        await api(`/sermons/${current.id}/verses`, 'POST', { verses: passages });
        toast(`${passages.length} scripture passage(s) added to topic`);
        render();
      }
    });
  },
  'form-add-passage'() {
    openBibleSelector({
      onSave: (passages) => {
        newSermonStagedVerses.push(...passages);
        $('#form-staged-count').textContent = `${newSermonStagedVerses.length} passage(s) staged`;
        $('#form-staged-list').innerHTML = renderFormStagedVerses();
        toast(`${passages.length} scripture passage(s) added`);
      }
    });
  },
  'form-remove-staged'(el) {
    const idx = Number(el.dataset.idx);
    newSermonStagedVerses.splice(idx, 1);
    $('#form-staged-count').textContent = `${newSermonStagedVerses.length} passage(s) staged`;
    $('#form-staged-list').innerHTML = renderFormStagedVerses();
  },
  /* Bible Library handlers */
  'b-toggle-picker'() {
    const S = bibleViewState;
    S.pickerOpen = !S.pickerOpen; S.pickerBook = null; S.bookQuery = ''; S.searchOpen = false;
    render();
  },
  'b-toggle-search'() {
    const S = bibleViewState;
    S.searchOpen = !S.searchOpen; S.pickerOpen = false;
    render().then(() => S.searchOpen && $('#b-search-q')?.focus());
  },
  'b-pick-book'(el) { bibleViewState.pickerBook = el.dataset.b; render(); },
  'b-picker-back'() { bibleViewState.pickerBook = null; render(); },
  'b-pick-chapter'(el) { bibleGo(bibleViewState.pickerBook, Number(el.dataset.c)); },
  'b-step'(el) {
    const next = stepChapter(bibleViewState.book, bibleViewState.chapter, Number(el.dataset.d));
    if (next) bibleGo(next.book, next.chapter);
    else toast(Number(el.dataset.d) < 0 ? 'This is the first chapter of the Bible.' : 'This is the last chapter of the Bible.');
  },
  'jump-to-passage'(el) {
    bibleGo(el.dataset.b, Number(el.dataset.c), Number(el.dataset.v) || null);
  },

  /* Bible App Selector Handlers */
  'm-tab'(el) {
    modalState.tab = el.dataset.t;
    modalState.pickerOpen = false;
    renderBibleSelectorModal();
  },
  'm-toggle-picker'() {
    modalState.pickerOpen = !modalState.pickerOpen;
    modalState.pickerStep = 'books';
    modalState.pickerBook = null;
    modalState.bookSearchQuery = '';
    renderBibleSelectorModal();
  },
  'm-picker-step'(el) {
    modalState.pickerStep = el.dataset.step || 'books';
    renderBibleSelectorModal();
  },
  'm-set-testament'(el) {
    modalState.testament = el.dataset.t;
    renderBibleSelectorModal();
  },
  'm-pick-book'(el) {
    modalState.pickerBook = el.dataset.b;
    modalState.pickerStep = 'chapters';
    renderBibleSelectorModal();
  },
  async 'm-pick-chapter'(el) {
    modalState.book = modalState.pickerBook || modalState.book;
    modalState.pickerBook = null;
    modalState.chapter = Number(el.dataset.c);
    modalState.pickerOpen = false;
    modalState.pickerStep = 'books';
    modalState.selectedVerses = new Set();
    modalState.activeHighlights = [];
    modalState.noteText = '';
    modalState.showNoteInput = false;
    modalState.chapterData = await loadBibleChapter(modalState.book, modalState.chapter, modalState.tr);
    renderBibleSelectorModal();
  },
  async 'm-prev-ch'() {
    await changeChapter(-1);
  },
  async 'm-next-ch'() {
    await changeChapter(1);
  },
  'm-toggle-verse'(el) {
    // A text-selection gesture should not also toggle and redraw the verse.
    const selection = window.getSelection();
    if (selection?.toString().trim() && $('#m-verse-flow')?.contains(selection.anchorNode)) return;
    const v = Number(el.dataset.v);
    if (modalState.selectedVerses.has(v)) {
      modalState.selectedVerses.delete(v);
    } else {
      modalState.selectedVerses.add(v);
    }
    renderBibleSelectorModal();
  },
  'm-select-all'() {
    const vs = modalState.chapterData?.verses || [];
    vs.forEach(v => modalState.selectedVerses.add(v.verse));
    renderBibleSelectorModal();
  },
  'm-clear-sel'() {
    modalState.selectedVerses = new Set();
    modalState.activeHighlights = [];
    modalState.showNoteInput = false;
    renderBibleSelectorModal();
  },
  'm-select-range'() {
    const vs = modalState.chapterData?.verses || [];
    const maxV = vs.length || 50;
    const s = prompt(`Enter starting verse number (1 to ${maxV}):`, '1');
    if (!s) return;
    const e = prompt(`Enter ending verse number (${s} to ${maxV}):`, s);
    if (!e) return;
    const startNum = parseInt(s, 10);
    const endNum = parseInt(e, 10);
    if (isNaN(startNum) || isNaN(endNum) || startNum > endNum) {
      toast('Invalid range numbers.', true);
      return;
    }
    for (let i = startNum; i <= endNum; i++) {
      modalState.selectedVerses.add(i);
    }
    renderBibleSelectorModal();
  },
  'm-toggle-note'() {
    modalState.showNoteInput = !modalState.showNoteInput;
    renderBibleSelectorModal();
    if (modalState.showNoteInput) {
      setTimeout(() => $('#m-passage-note')?.focus(), 50);
    }
  },
  'm-apply-hl'(el) {
    const color = el.dataset.color || 'yellow';
    const versesData = modalState.chapterData?.verses || [];

    if (modalState.selectedTextRange) {
      modalState.activeHighlights.push({ text: modalState.selectedTextRange, color });
      modalState.selectedTextRange = null;
      toast(`Highlight applied to selected text`);
    } else if (modalState.selectedVerses.size > 0) {
      modalState.selectedVerses.forEach(vNum => {
        const found = versesData.find(x => x.verse === vNum);
        if (found) {
          modalState.activeHighlights = modalState.activeHighlights.filter(h => h.verse !== vNum);
          modalState.activeHighlights.push({ text: found.text, color, verse: vNum });
        }
      });
      toast(`Highlight (${color}) applied to ${modalState.selectedVerses.size} verse(s)`);
    } else {
      toast('Tap a verse or drag text to highlight.', true);
      return;
    }
    renderBibleSelectorModal();
  },
  'm-clear-hl'() {
    if (modalState.selectedVerses.size > 0) {
      modalState.activeHighlights = modalState.activeHighlights.filter(h => !modalState.selectedVerses.has(h.verse));
      toast('Highlights cleared for selected verses');
    } else {
      modalState.activeHighlights = [];
      toast('All highlights cleared');
    }
    renderBibleSelectorModal();
  },
  'm-stage-passage'() {
    try {
      const p = buildSelectedPassageObject();
      modalState.staged.push(p);
      modalState.selectedVerses = new Set();
      modalState.activeHighlights = [];
      modalState.noteText = '';
      modalState.showNoteInput = false;
      toast(`Passage ${p.book} ${p.chapter}:${p.verse_list} staged! Browse more or save.`);
      renderBibleSelectorModal();
    } catch (err) {
      toast(err.message, true);
    }
  },
  async 'm-save-direct'() {
    try {
      const p = buildSelectedPassageObject();
      const allToSave = modalState.staged.length ? [...modalState.staged, p] : [p];
      if (modalState.onSave) {
        await modalState.onSave(allToSave);
      } else if (modalState.sermonId) {
        await api(`/sermons/${modalState.sermonId}/verses`, 'POST', { verses: allToSave });
        toast(`${allToSave.length} passage(s) saved directly to topic notes`);
        render();
      }
      closeModal();
    } catch (err) {
      toast(err.message, true);
    }
  },
  'm-remove-staged'(el) {
    const idx = Number(el.dataset.idx);
    modalState.staged.splice(idx, 1);
    renderBibleSelectorModal();
  },
  async 'm-save-all-staged'() {
    if (!modalState.staged.length) return;
    try {
      if (modalState.onSave) {
        await modalState.onSave(modalState.staged);
      } else if (modalState.sermonId) {
        await api(`/sermons/${modalState.sermonId}/verses`, 'POST', { verses: modalState.staged });
        toast(`${modalState.staged.length} passage(s) saved to topic notes!`);
        render();
      }
      closeModal();
    } catch (err) {
      toast(err.message, true);
    }
  },
  async 'm-stage-search-result'(el) {
    const b = el.dataset.b;
    const c = Number(el.dataset.c);
    const v = Number(el.dataset.v);
    try {
      const fetched = await api(`/bible/verses?translation=${modalState.tr}&book=${encodeURIComponent(b)}&chapter=${c}&verses=${v}`);
      modalState.staged.push({
        book: b,
        chapter: c,
        verse_start: v,
        verse_end: v,
        verse_list: String(v),
        translation: modalState.tr,
        verse_text: fetched.text || '',
        highlights: [],
        note: '',
      });
      toast(`Added ${b} ${c}:${v} (${modalState.tr}) to staged list!`);
      modalState.tab = 'staged';
      renderBibleSelectorModal();
    } catch (e) {
      toast(e.message, true);
    }
  },
  async 'm-jump-browse'(el) {
    modalState.book = el.dataset.b;
    modalState.chapter = Number(el.dataset.c);
    modalState.selectedVerses = new Set([Number(el.dataset.v)]);
    modalState.tab = 'browse';
    modalState.pickerOpen = false;
    modalState.activeHighlights = [];
    modalState.scrollToVerse = Number(el.dataset.v);
    modalState.chapterData = await loadBibleChapter(modalState.book, modalState.chapter, modalState.tr);
    renderBibleSelectorModal();
  },
};

document.addEventListener('click', e => {
  $$('.more-menu[open]').forEach(menu => { if (!menu.contains(e.target)) menu.open = false; });
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) {
    e.preventDefault();
    ACTIONS[a.dataset.act](a);
    return;
  }
  if (e.target.id === 'modal') closeModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#modal')?.hidden) closeModal();
    $$('.more-menu[open]').forEach(menu => { menu.open = false; });
  }
});

/* ---------- Forms ---------- */
const FORMS = {
  async login() {
    await api('/login', 'POST', { username: val('un'), password: $('#pw').value });
    await boot();
  },
  search() {
    location.hash = '#/archive?q=' + encodeURIComponent(val('q'));
  },
  async sermon(f) {
    const body = {
      title: val('title'),
      pastor: val('pastor'),
      sermon_date: $('#date').value,
      description: val('desc')
    };
    localStorage.setItem('pastor', body.pastor);
    if (f.dataset.id) {
      await api('/sermons/' + f.dataset.id, 'PUT', body);
      toast('Changes saved');
      location.hash = '#/sermon/' + f.dataset.id;
      return;
    }
    body.verses = newSermonStagedVerses;
    const s = await api('/sermons', 'POST', body);
    toast('Topic created with ' + newSermonStagedVerses.length + ' scripture passage(s)');
    location.hash = '#/sermon/' + s.id;
  },
  async password() {
    await api('/account/password', 'POST', { current: $('#cur').value, new: $('#new').value });
    closeModal();
    toast('Password changed');
  },
  async 'bible-search'() {
    const q = val('b-search-q');
    if (!q) return;
    bibleViewState.searchQ = q;
    try {
      bibleViewState.searchResults = await api(`/bible/search?q=${encodeURIComponent(q)}&translation=${bibleViewState.tr}`);
      render();
    } catch (e) {
      toast(e.message, true);
    }
  },
  async 'm-search'() {
    const q = val('m-search-input');
    if (!q) return;
    modalState.searchQ = q;
    modalState.searchLoading = true;
    renderBibleSelectorModal();
    try {
      modalState.searchResults = await api(`/bible/search?q=${encodeURIComponent(q)}&translation=${modalState.tr}`);
    } catch (e) {
      toast(e.message, true);
    } finally {
      modalState.searchLoading = false;
      renderBibleSelectorModal();
    }
  }
};

document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  showErr('');
  const btn = f.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    await FORMS[f.dataset.form](f);
  } catch (err) {
    showErr(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

let searchDebounce, searchVersion = 0;
// Bible Library: switch translation
document.addEventListener('change', async e => {
  if (e.target.id !== 'b-tr-select') return;
  const S = bibleViewState;
  S.tr = e.target.value;
  localStorage.setItem('bible_tr', S.tr);
  S.searchResults = null;
  S.chapterData = await loadBibleChapter(S.book, S.chapter, S.tr);
  render();
});
document.addEventListener('input', e => {
  // Bible Library: filter the book list as you type
  if (e.target.id === 'b-book-filter') {
    bibleViewState.bookQuery = e.target.value;
    const q = norm(e.target.value);
    $$('#b-books .bible-book-card').forEach(b => { b.style.display = norm(b.dataset.b).includes(q) ? '' : 'none'; });
    return;
  }
  if (e.target.id !== 'q' || route.name !== 'archive') return;
  const version = ++searchVersion;
  const searchInput = e.target;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    const q = e.target.value.trim();
    try {
      const data = await api('/sermons?q=' + encodeURIComponent(q) + '&page=0');
      if (version !== searchVersion || route.name !== 'archive' || $('#q') !== searchInput) return;
      $('#results').innerHTML = archiveList(data.items, q);
      $('#count').textContent = archiveCount(data);
      $('#archive-pager').innerHTML = archivePager(data,q);
      route.q = q; route.page = 0;
      history.replaceState(null, '', '#/archive' + (q ? '?q=' + encodeURIComponent(q) : ''));
    } catch (err) {
      if (version === searchVersion && route.name === 'archive' && $('#q') === searchInput) toast(err.message, true);
    }
  }, 250);
});

/* ---------- Initialization ---------- */
async function boot() {
  app.innerHTML = '<main class="login"><div class="login-card"><p role="status">Loading Sunday service topics…</p></div></main>';
  try {
    const m = await api('/me');
    me = m.user;
    [books, bibleTranslations] = await Promise.all([api('/bible/books'), api('/bible/translations')]);
    if (!bibleTranslations.some(t => t.id === bibleViewState.tr)) bibleViewState.tr = 'KJV';
    if (!bibleTranslations.some(t => t.id === modalState.tr)) modalState.tr = 'KJV';
  } catch (e) {
    app.innerHTML = `<main class="login"><div class="login-card"><h1>Could not connect</h1><p>${esc(e.message)}</p><button class="btn" data-act="retry">Try again</button><a href="viewer.html">Public library</a></div></main>`;
    return;
  }
  await render();
}
// Remove plaintext credentials saved by the retired local login screen.
['saved_admin_pw','saved_viewer_pw','last_admin_user','last_viewer_user'].forEach(key => localStorage.removeItem(key));
if (ADMIN_PAGE) window.ChurchAPI.subscribeAuth(() => { me = null; closeModal(); render(); });
boot();
