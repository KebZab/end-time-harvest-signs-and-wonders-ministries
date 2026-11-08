'use strict';
const CHURCH = 'End Time Harvest Signs & Wonders Ministries, Inc.';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let me = null, serverInfo = null, books = [], bibleTranslations = [], setupNeeded = false, route = {}, current = null;

const isFileOrCrossPort = window.location.protocol === 'file:' || (window.location.port && window.location.port !== '8000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'));
const API_BASE = isFileOrCrossPort ? 'http://localhost:8000/api' : '/api';

/* ---------- API helper ---------- */
async function api(path, method = 'GET', body) {
  const opt = { method, credentials: isFileOrCrossPort ? 'include' : 'same-origin', headers: {} };
  if (method !== 'GET') { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body || {}); }
  let r;
  try {
    r = await fetch(API_BASE + path, opt);
  } catch (err) {
    console.error('API call failed:', API_BASE + path, err);
    throw new Error('Cannot reach the server. Check that it is running at http://localhost:8000');
  }
  let data = null; try { data = await r.json(); } catch { }
  if (r.status === 401 && me) { me = null; render(); throw new Error('Your session has ended. Please sign in again.'); }
  if (!r.ok) throw new Error(data?.error || 'Something went wrong.');
  return data;
}

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', 3400);
}

const fmtDate = (d, long = true) => new Date(d + 'T00:00:00').toLocaleDateString(undefined,
  long ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const isAdmin = () => me?.role === 'ADMIN';

function openModal(html, isWide = false) {
  const m = $('#modal');
  const isApp = html.includes('bible-app-modal'); // full-screen Bible reader on phones
  m.className = isApp ? 'modal-app' : '';
  m.innerHTML = `<div class="dialog ${isWide ? 'dialog-wide' : ''} ${isApp ? 'dialog-app' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  (m.querySelector('input,textarea,select') || m.querySelector('button'))?.focus();
}

function closeModal() {
  const m = $('#modal');
  m.hidden = true;
  m.innerHTML = '';
  document.body.style.overflow = '';
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
function shell(inner) {
  const admin = isAdmin();
  // [hash, desktop label, short mobile label, icon]
  const links = admin ? [
    ['', 'Dashboard', 'Home', '🏠'],
    ['archive', 'Sermon archive', 'Sermons', '📚'],
    ['bible', 'Bible Library', 'Bible', '📖'],
    ['new', 'New sermon', 'New', '➕'],
    ['members', 'Members and access', 'Members', '👥']
  ] : [
    ['', 'Home', 'Home', '🏠'],
    ['archive', 'Sermon archive', 'Sermons', '📚'],
    ['bible', 'Bible Library', 'Bible', '📖']
  ];
  const here = route.name === 'sermon' || route.name === 'edit' ? 'archive' : route.name;

  return `<a class="skip" href="#main">Skip to content</a>
  ${admin ? '<div class="adminbar">Administrator panel: you have full control over sermons, verses, and member accounts.</div>' : ''}
  <header class="top"><div class="top-in">
    <a class="brand" href="#/"><img src="/static/logo.png" alt="Church logo"><span class="name">${esc(CHURCH)}</span></a>
    <div class="who"><span class="badge ${admin ? '' : 'viewer'}">${admin ? 'Admin' : 'Viewer'}</span> <span class="who-name">${esc(me.full_name)}</span>
      <button class="linkbtn" data-act="account">Account</button><button class="linkbtn" data-act="logout">Sign out</button></div></div>
  <nav class="main" aria-label="Main"><div>${links.map(([h, t, s, i]) => `<a href="#/${h}" ${(here || '') === h ? 'aria-current="page"' : ''}><span class="nav-ico" aria-hidden="true">${i}</span><span class="nav-full">${t}</span><span class="nav-short">${s}</span></a>`).join('')}</div></nav></header>
  <main id="main">${inner}</main><footer>${esc(CHURCH)}</footer>`;
}

function sermonRow(s) {
  const d = new Date(s.sermon_date + 'T00:00:00');
  const refs = s.refs || [];
  return `<a class="row" href="#/sermon/${s.id}">
    <div class="date"><b>${d.getDate()}</b><span>${d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span></div>
    <div><h3>${esc(s.title)}</h3><p>${esc(s.pastor)}</p>
      ${refs.length ? `<div class="chips">${refs.slice(0, 5).map(r => `<span class="chip">${esc(r)}</span>`).join('')}${refs.length > 5 ? `<span class="chip">+${refs.length - 5} more</span>` : ''}</div>` : ''}</div>
    <div class="count">${refs.length} verse${refs.length === 1 ? '' : 's'}</div></a>`;
}

/* ---------- Dashboard View ---------- */
async function viewDashboard() {
  const d = await api('/stats'), L = d.latest, admin = isAdmin();
  const hero = L ? `<section class="hero" aria-labelledby="latest">
      <p class="kicker">Latest message</p>
      <h1 id="latest">${esc(L.title)}</h1>
      <p class="by">Preached by <b>${esc(L.pastor)}</b></p><p class="when">${fmtDate(L.sermon_date)}</p>
      ${L.verses.length ? `<h2>Bible passages mentioned</h2><div class="chips" style="margin-bottom:1.2rem">${L.verses.map(v => `<span class="chip" style="font-size:.95rem;padding:.2rem .75rem"><b>${esc(v.ref)}</b></span>`).join('')}</div>` : '<p>No Bible verses have been recorded for this sermon yet.</p>'}
      <div class="actions"><a class="btn" href="#/sermon/${L.id}">Open full sermon & scriptures</a>${admin ? `<a class="btn ghost" style="color:#ffe39a;border-color:#ffe39a" href="#/edit/${L.id}">Edit sermon</a>` : ''}</div>
    </section>` : `<section class="hero"><p class="kicker">Welcome</p><h1>No sermons recorded yet</h1>
      <p>${admin ? 'Record your first sermon to start building the church library.' : 'Please check back soon. New messages will appear here.'}</p>
      ${admin ? '<div class="actions"><a class="btn" href="#/new">Record the first sermon</a></div>' : ''}</section>`;

  const rest = d.recent.filter(s => !L || s.id !== L.id).slice(0, 5);
  return shell(`${hero}
    <dl class="facts"><div><dd>${d.total_sermons}</dd><dt>Sermons recorded</dt></div><div><dd>${d.total_verses}</dd><dt>Bible verses recorded</dt></div>
    ${L ? `<div><dd>${fmtDate(L.sermon_date, false)}</dd><dt>Date of latest service</dt></div>` : ''}</dl>
    <div class="sec-head"><h2>Find a sermon or Bible verse</h2></div>
    <form class="search" data-form="search"><label class="hint" for="q" style="display:none">Search</label>
      <input id="q" type="search" placeholder="Search by topic, pastor, date, or scripture (e.g., John 3:16, grace)" autocomplete="off">
      <button class="btn" type="submit">Search</button></form>
    <div class="sec-head"><h2>Recent sermons</h2><a href="#/archive">Open the complete sermon archive</a></div>
    ${rest.length ? `<div class="rows">${rest.map(sermonRow).join('')}</div>` : '<div class="card empty">Earlier sermons will be listed here.</div>'}`);
}

/* ---------- Archive View ---------- */
function archiveList(list, q) {
  return list.length ? `<div class="rows">${list.map(sermonRow).join('')}</div>`
    : `<div class="card empty">${q ? `No sermons match "${esc(q)}". Try a pastor's name, a topic, or a verse such as Romans 8.` : 'No sermons have been recorded yet.'}</div>`;
}

async function viewArchive() {
  const q = route.q || '', list = await api('/sermons?q=' + encodeURIComponent(q));
  return shell(`<div class="sec-head" style="margin-top:0"><h1 style="margin:0">Sermon archive</h1>${isAdmin() ? '<a class="btn" href="#/new">New sermon</a>' : ''}</div>
    <div class="card"><label for="q">Search sermons</label>
    <input id="q" type="search" value="${esc(q)}" placeholder="Topic, pastor, date (2026-11), or scripture (John 3:16)" autocomplete="off"></div>
    <p class="muted" id="count" style="margin:1rem 0 .5rem">${list.length} sermon${list.length === 1 ? '' : 's'}</p>
    <div id="results">${archiveList(list, q)}</div>`);
}

/* ---------- Sermon Detail View ---------- */
function passageCard(v, idx, total, admin) {
  const highlights = v.highlights || [];
  const renderedText = formatPassageText(v.verse_text, highlights);

  return `<article class="passage-card" data-verse-id="${v.id}">
    <div class="p-head">
      <div class="p-ref">
        <h3>${esc(v.book)} ${v.chapter}:${esc(v.verse_list || (v.verse_start ? v.verse_start + (v.verse_end ? '-' + v.verse_end : '') : ''))}</h3>
        <span class="p-tr-badge">${esc(v.translation || 'KJV')}</span>
      </div>
      <div class="p-actions">
        <button class="btn ghost small" data-act="copy-passage" data-id="${v.id}" title="Copy scripture with reference" aria-label="Copy">📋<span class="t"> Copy</span></button>
        ${admin ? `
          ${idx > 0 ? `<button class="btn ghost small" data-act="move-verse" data-id="${v.id}" data-dir="up" title="Move up" aria-label="Move up">▲</button>` : ''}
          ${idx < total - 1 ? `<button class="btn ghost small" data-act="move-verse" data-id="${v.id}" data-dir="down" title="Move down" aria-label="Move down">▼</button>` : ''}
          <button class="btn ghost small" data-act="edit-passage" data-id="${v.id}" title="Edit / Highlight" aria-label="Edit">✏️<span class="t"> Edit</span></button>
          <button class="btn danger small" data-act="del-verse" data-id="${v.id}" title="Delete" aria-label="Delete">🗑<span class="t"> Delete</span></button>
        ` : ''}
      </div>
    </div>
    <div class="p-body">
      ${renderedText ? renderedText : '<p class="muted">Text not available.</p>'}
    </div>
    ${v.note ? `<div class="p-note"><b>Pastor's Note:</b> ${esc(v.note)}</div>` : ''}
  </article>`;
}

async function viewSermon() {
  const s = current = await api('/sermons/' + route.id), admin = isAdmin();
  const verses = s.verses || [];

  return shell(`<a class="back" href="#/archive">← Back to sermon archive</a>
    <article class="s-head"><h1>${esc(s.title)}</h1><p><b>${esc(s.pastor)}</b></p><p>${fmtDate(s.sermon_date)}</p>
      ${s.description ? `<p class="desc">${esc(s.description)}</p>` : ''}
      ${admin ? `<div class="actions" style="margin-top:1.2rem"><button class="btn" data-act="add-bible-passage">📖 Add Bible Verse</button><a class="btn ghost" href="#/edit/${s.id}">Edit sermon info</a><button class="btn danger" data-act="del-sermon">Delete sermon</button></div>` : ''}</article>
    
    <section class="card" style="margin-top:1.5rem">
      <div class="sec-head" style="margin-top:0">
        <h2>Bible Passages Mentioned (${verses.length})</h2>
        ${admin ? `<button class="btn small" data-act="add-bible-passage">+ Add Bible Verse</button>` : ''}
      </div>
      ${verses.length ? `<div class="passage-list">${verses.map((v, i) => passageCard(v, i, verses.length, admin)).join('')}</div>`
        : `<div class="card empty"><p>No Bible passages have been recorded for this sermon yet.</p>
           ${admin ? `<button class="btn" data-act="add-bible-passage">Add the first Bible passage</button>` : ''}</div>`}
    </section>`);
}

/* ---------- Sermon Form (Create / Edit) ---------- */
let newSermonStagedVerses = [];

async function viewForm() {
  const editing = route.name === 'edit';
  const s = editing ? await api('/sermons/' + route.id) : { title: '', pastor: localStorage.getItem('pastor') || '', sermon_date: today(), description: '' };
  if (!editing) newSermonStagedVerses = [];

  return shell(`<a class="back" href="${editing ? '#/sermon/' + s.id : '#/archive'}">Cancel</a>
    <div class="card"><h1>${editing ? 'Edit sermon' : 'New sermon'}</h1>
    <form data-form="sermon" ${editing ? `data-id="${s.id}"` : ''}><div id="err"></div>
      <div class="field"><label for="title">Sermon title or topic</label><input id="title" required maxlength="200" value="${esc(s.title)}"></div>
      <div class="grid2"><div class="field"><label for="pastor">Pastor's name</label><input id="pastor" required maxlength="120" value="${esc(s.pastor)}"></div>
      <div class="field"><label for="date">Date of service</label><input id="date" type="date" required value="${s.sermon_date}"></div></div>
      <div class="field"><label for="desc">Short description or notes <span class="hint">(optional)</span></label><textarea id="desc" rows="4" maxlength="5000">${esc(s.description)}</textarea></div>
      
      ${editing ? '' : `
      <div class="card" style="background:rgba(242,181,27,.06);border:1.5px dashed var(--gold);padding:1rem;margin-bottom:1.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
          <div><b>Bible passages for this sermon</b><br><span class="muted" id="form-staged-count">${newSermonStagedVerses.length} passage(s) staged</span></div>
          <button type="button" class="btn small" data-act="form-add-passage">📖 Add Bible Verse from Library</button>
        </div>
        <div id="form-staged-list" style="margin-top:.8rem">${renderFormStagedVerses()}</div>
      </div>`}

      <button class="btn" type="submit">${editing ? 'Save changes' : 'Save sermon'}</button></form></div>`);
}

function renderFormStagedVerses() {
  if (!newSermonStagedVerses.length) {
    return `<p class="hint">No passages added yet. Click "Add Bible Verse from Library" above to browse, highlight, and stage passages.</p>`;
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
        <span style="flex:1"></span>
        <button type="button" class="bible-arrow-btn ${S.searchOpen ? 'active' : ''}" data-act="b-toggle-search" title="Search" aria-label="Search">🔍</button>
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
          ${['yellow', 'green', 'blue', 'pink', 'orange'].map(c => `<button type="button" class="b-swatch swatch-${c}" data-act="m-apply-hl" data-color="${c}" title="Highlight ${c}"></button>`).join('')}
          <button type="button" class="b-swatch swatch-none" data-act="m-clear-hl" title="Remove highlight">⊘</button>
        </div>
        <input id="m-passage-note" class="bible-note-input" value="${esc(modalState.noteText)}" placeholder="Note (optional)">
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
    <div class="bible-app-modal">
      <div class="bible-top-nav">
        ${back ? `<button type="button" class="bible-arrow-btn" data-act="m-tab" data-t="browse" title="Back">‹</button>
                  <b class="bible-nav-title">${modalState.tab === 'search' ? 'Search' : 'Added passages'}</b>` : `
        <button type="button" class="bible-arrow-btn" data-act="m-prev-ch" title="Previous chapter">‹</button>
        <button type="button" class="bible-nav-btn" data-act="m-toggle-picker">${esc(modalState.book)} ${modalState.chapter} ▾</button>
        <button type="button" class="bible-arrow-btn" data-act="m-next-ch" title="Next chapter">›</button>
        <select id="m-tr-select" class="bible-tr" title="${esc(curTr.name || curTr.id)}" aria-label="Translation">
          ${trs.map(t => `<option value="${t.id}" ${t.id === modalState.tr ? 'selected' : ''}>${t.id}</option>`).join('')}
        </select>`}
        <span style="flex:1"></span>
        ${back ? '' : '<button type="button" class="bible-arrow-btn" data-act="m-tab" data-t="search" title="Search">🔍</button>'}
        <button type="button" class="bible-arrow-btn" data-act="close" title="Close">✕</button>
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

  const verseFlow = $('#m-verse-flow');
  if (verseFlow) {
    verseFlow.addEventListener('mouseup', () => {
      const sel = window.getSelection();
      const txt = sel ? sel.toString().trim() : '';
      if (txt.length > 0) {
        modalState.selectedTextRange = txt;
      }
    });
  }

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
        <h2>Edit Bible Passage & Highlights</h2>
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

    const textBody = $('#edit-passage-body');
    if (textBody) {
      textBody.addEventListener('mouseup', () => {
        const sel = window.getSelection();
        const txt = sel.toString().trim();
        if (txt.length > 0) selectedText = txt;
      });
    }

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

/* ---------- User Management View ---------- */
async function viewMembers() {
  const users = await api('/users');
  return shell(`<h1>Members and access</h1>
    <p class="muted">Viewers can read sermons and scriptures in read-only mode. Administrators can manage sermons, scriptures, and users.</p>
    <div class="card"><h2>Add a member</h2><form data-form="user"><div id="err"></div>
      <div class="grid2"><div class="field"><label for="fn">Full name</label><input id="fn" required maxlength="100"></div>
      <div class="field"><label for="un">Username</label><input id="un" required minlength="3" maxlength="40" autocapitalize="off" autocomplete="off"></div>
      <div class="field"><label for="pw">Temporary password <span class="hint">(at least 8 characters)</span></label><input id="pw" type="text" required minlength="8" autocomplete="off"></div>
      <div class="field"><label for="role">Access level</label><select id="role"><option value="VIEWER">Viewer (read only)</option><option value="ADMIN">Admin / Lead (full access)</option></select></div></div>
      <button class="btn" type="submit">Add member</button></form></div>
    <div class="card"><h2>Everyone with access (${users.length})</h2><div class="users">${users.map(u => `
      <div class="u"><div><b>${esc(u.full_name)}</b> <span class="badge ${u.role === 'ADMIN' ? '' : 'viewer'}" style="${u.role === 'ADMIN' ? '' : 'color:var(--muted);border-color:var(--line)'}">${u.role === 'ADMIN' ? 'Admin' : 'Viewer'}</span>
        ${u.active ? '' : '<span class="badge off">Deactivated</span>'}<br><span class="muted">${esc(u.username)}</span></div>
        ${u.id === me.id ? '<span class="muted">This is you</span>' : `<div class="actions">
          <button class="btn ghost small" data-act="reset-pw" data-id="${u.id}" data-name="${esc(u.full_name)}">Reset password</button>
          <button class="btn ghost small" data-act="toggle-user" data-id="${u.id}" data-active="${u.active ? 0 : 1}">${u.active ? 'Deactivate' : 'Reactivate'}</button>
          <button class="btn danger small" data-act="del-user" data-id="${u.id}" data-name="${esc(u.full_name)}">Delete</button></div>`}</div>`).join('')}</div></div>
    <div class="card"><h2>Backup</h2><p class="muted">Download every sermon and verse as a JSON file you can keep safe.</p>
      <a class="btn" href="/api/export" download>Download backup</a></div>`);
}

function viewLogin() {
  document.body.className = 'gate';
  app.innerHTML = `<main class="login"><div class="login-card"><img src="/static/logo.png" alt="Church logo">
    <h1>${esc(CHURCH)}</h1><p class="sub">${setupNeeded ? 'Welcome. Create the first administrator account to begin.' : 'Sermon topics and Bible verses'}</p>
    <form data-form="${setupNeeded ? 'setup' : 'login'}"><div id="err"></div>
      ${setupNeeded ? '<div class="field"><label for="fn">Your full name</label><input id="fn" required maxlength="100" autocomplete="name"></div>' : `
      <div class="autofill-section" style="margin-bottom:1.25rem;padding:.85rem;border-radius:10px;background:rgba(242,181,27,.09);border:1.5px dashed var(--gold);text-align:left">
        <div style="font-size:.85rem;font-weight:700;color:var(--gold-soft);margin-bottom:.55rem;display:flex;align-items:center;gap:.4rem">
          ⚡ <span>Choose Role to Autofill Username & Password:</span>
        </div>
        <div class="grid2" style="gap:.5rem">
          <button type="button" class="btn small" data-act="autofill-login" data-role="admin" style="width:100%;font-size:.86rem;padding:.35rem .5rem">
            👑 Autofill Admin
          </button>
          <button type="button" class="btn ghost small" data-act="autofill-login" data-role="viewer" style="width:100%;font-size:.86rem;padding:.35rem .5rem">
            📖 Autofill Viewer
          </button>
        </div>
        <div style="display:flex;justify-content:space-between;gap:.5rem;margin-top:.5rem;font-size:.78rem;color:var(--muted);flex-wrap:wrap">
          <span>👑 Admin: <b>KevinZabal</b> / <b>admin123</b></span>
          <span>📖 Viewer: <b>member</b> / <b>password123</b></span>
        </div>
      </div>`}
      <div class="field"><label for="un">Username</label><input id="un" required autocapitalize="off" autocomplete="username"></div>
      <div class="field"><label for="pw">Password ${setupNeeded ? '<span class="hint">(at least 8 characters)</span>' : ''}</label><input id="pw" type="password" required ${setupNeeded ? 'minlength="8"' : ''} autocomplete="${setupNeeded ? 'new-password' : 'current-password'}"></div>
      ${setupNeeded ? '' : `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.1rem;font-size:.86rem">
        <label style="display:flex;align-items:center;gap:.45rem;margin:0;font-weight:400;cursor:pointer;color:var(--muted)">
          <input type="checkbox" id="remember-cred" checked style="width:auto;min-height:auto"> Remember credentials
        </label>
        <span id="autofill-hint" class="muted" style="font-size:.82rem"></span>
      </div>`}
      <button class="btn" type="submit">${setupNeeded ? 'Create administrator account' : 'Sign in'}</button></form></div></main>`;
  $('#un')?.focus();
}

/* ---------- Router ---------- */
function parseRoute() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', id] = path.split('/');
  const known = ['', 'archive', 'sermon', 'new', 'edit', 'members', 'bible'];
  return { name: known.includes(name) ? name : '', id, q: new URLSearchParams(qs || '').get('q') || '' };
}

async function render() {
  if (!me) return viewLogin();
  route = parseRoute();
  document.body.className = isAdmin() ? 'admin' : 'viewer';
  if (!isAdmin() && ['new', 'edit', 'members'].includes(route.name)) { location.hash = '#/'; return; }
  const views = { '': viewDashboard, archive: viewArchive, sermon: viewSermon, new: viewForm, edit: viewForm, members: viewMembers, bible: viewBible };
  try {
    app.innerHTML = await views[route.name]();
    window.scrollTo(0, 0);
  } catch (e) {
    app.innerHTML = shell(`<div class="card empty"><h2>This page could not be shown</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to home</a></div>`);
  }
}
window.addEventListener('hashchange', () => { closeModal(); render(); });

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
  'autofill-login'(el) {
    const role = el.dataset.role;
    const unEl = $('#un');
    const pwEl = $('#pw');
    const hintEl = $('#autofill-hint');
    if (!unEl || !pwEl) return;

    if (role === 'admin') {
      const adminName = serverInfo?.admin_username || localStorage.getItem('last_admin_user') || 'KevinZabal';
      const adminPw = localStorage.getItem('saved_admin_pw') || 'admin123';
      unEl.value = adminName;
      pwEl.value = adminPw;
      if (hintEl) hintEl.textContent = 'Admin credentials ready';
      toast(`Autofilled Admin account (${adminName}) with password`);
      $('#pw')?.focus();
    } else {
      const viewerName = serverInfo?.viewer_username || 'member';
      const viewerPw = localStorage.getItem('saved_viewer_pw') || 'password123';
      unEl.value = viewerName;
      pwEl.value = viewerPw;
      if (hintEl) hintEl.textContent = 'Viewer credentials ready';
      toast(`Autofilled Viewer account (${viewerName}) with password`);
      $('#pw')?.focus();
    }
  },
  async logout() { try { await api('/logout', 'POST'); } catch { } me = null; location.hash = ''; render(); },
  account() {
    openModal(`<div class="dialog-head"><h2>Your account</h2><button class="btn ghost small" data-act="close">✕ Close</button></div>
      <p><b>${esc(me.full_name)}</b><br><span class="muted">Username: ${esc(me.username)}</span></p>
      <form data-form="password"><div id="err"></div><h3>Change password</h3>
      <div class="field"><label for="cur">Current password</label><input id="cur" type="password" required autocomplete="current-password"></div>
      <div class="field"><label for="new">New password <span class="hint">(at least 8 characters)</span></label><input id="new" type="password" required minlength="8" autocomplete="new-password"></div>
      <button class="btn" type="submit">Save new password</button></form>`);
  },
  async 'del-sermon'() {
    if (!await confirmBox('Delete this sermon?', `"${current.title}" and its ${current.verses.length} scripture passage(s) will be permanently removed.`, 'Delete sermon')) return;
    try { await api('/sermons/' + current.id, 'DELETE'); toast('Sermon deleted'); location.hash = '#/archive'; } catch (e) { toast(e.message, true); }
  },
  async 'del-verse'(el) {
    const v = current.verses.find(x => x.id == el.dataset.id);
    if (!await confirmBox('Delete this scripture?', `${v.ref} will be removed from this sermon.`, 'Delete scripture')) return;
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
        toast(`${passages.length} scripture passage(s) added to sermon`);
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
  'reset-pw'(el) {
    openModal(`<div class="dialog-head"><h2>Reset password</h2><button class="btn ghost small" data-act="close">✕ Close</button></div>
      <form data-form="reset" data-id="${el.dataset.id}"><div id="err"></div><p>Choose a new temporary password for <b>${esc(el.dataset.name)}</b>.</p>
      <div class="field"><label for="np">New password</label><input id="np" type="text" required minlength="8" autocomplete="off"></div>
      <button class="btn" type="submit">Reset password</button></form>`);
  },
  async 'toggle-user'(el) {
    try { await api('/users/' + el.dataset.id, 'PUT', { active: el.dataset.active === '1' }); render(); } catch (e) { toast(e.message, true); }
  },
  async 'del-user'(el) {
    if (!await confirmBox('Delete this member?', `${el.dataset.name} will lose access permanently.`, 'Delete member')) return;
    try { await api('/users/' + el.dataset.id, 'DELETE'); toast('Member deleted'); render(); } catch (e) { toast(e.message, true); }
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
        toast(`${allToSave.length} passage(s) saved directly to sermon notes`);
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
        toast(`${modalState.staged.length} passage(s) saved to sermon notes!`);
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
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) {
    e.preventDefault();
    ACTIONS[a.dataset.act](a);
    return;
  }
  if (e.target.id === 'modal') closeModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal')?.hidden) closeModal();
});

/* ---------- Forms ---------- */
const FORMS = {
  async login() {
    const username = val('un');
    const password = $('#pw').value;
    const remember = $('#remember-cred')?.checked;

    await api('/login', 'POST', { username, password });

    if (remember) {
      if (username.toLowerCase() === (serverInfo?.admin_username || 'kevinzabal').toLowerCase()) {
        localStorage.setItem('saved_admin_pw', password);
        localStorage.setItem('last_admin_user', username);
      } else {
        localStorage.setItem('saved_viewer_pw', password);
        localStorage.setItem('last_viewer_user', username);
      }
    }
    await boot();
  },
  async setup() {
    await api('/setup', 'POST', { full_name: val('fn'), username: val('un'), password: $('#pw').value });
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
    toast('Sermon created with ' + newSermonStagedVerses.length + ' scripture passage(s)');
    location.hash = '#/sermon/' + s.id;
  },
  async user() {
    await api('/users', 'POST', { full_name: val('fn'), username: val('un'), password: val('pw'), role: $('#role').value });
    toast('Member added');
    render();
  },
  async reset(f) {
    await api('/users/' + f.dataset.id, 'PUT', { password: $('#np').value });
    closeModal();
    toast('Password reset');
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

let searchDebounce;
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
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    const q = e.target.value.trim();
    try {
      const list = await api('/sermons?q=' + encodeURIComponent(q));
      $('#results').innerHTML = archiveList(list, q);
      $('#count').textContent = `${list.length} sermon${list.length === 1 ? '' : 's'}`;
      history.replaceState(null, '', '#/archive' + (q ? '?q=' + encodeURIComponent(q) : ''));
    } catch (err) {
      toast(err.message, true);
    }
  }, 250);
});

/* ---------- Initialization ---------- */
async function boot() {
  try {
    const m = await api('/me');
    serverInfo = m;
    me = m.user;
    setupNeeded = m.setup_needed;
    if (me) {
      books = await api('/bible/books');
      bibleTranslations = await api('/bible/translations');
    }
  } catch (e) {
    app.innerHTML = `<main class="login"><div class="login-card"><h1>${esc(e.message)}</h1></div></main>`;
    return;
  }
  render();
}
boot();
