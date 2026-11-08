(() => {
const books = window.BibleBooks;
const translations = [
  { id: 'KJV', name: 'King James Version' }, { id: 'NKJV', name: 'New King James Version' },
  { id: 'NIV', name: 'New International Version' }, { id: 'ESV', name: 'English Standard Version' },
  { id: 'NASB', name: 'New American Standard Bible' }, { id: 'AMP', name: 'Amplified Bible' },
  { id: 'NLT', name: 'New Living Translation' }, { id: 'WEB', name: 'World English Bible' },
  { id: 'BBE', name: 'Bible in Basic English' }
];
const cache = new Map();
const escapeHtml = s => String(s).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(tr) {
  if (!translations.some(t => t.id === tr)) throw new Error('Unknown Bible translation.');
  if (tr === 'KJV') return window.KJVBible;
  if (!cache.has(tr)) {
    const pending = (async () => {
      const source = `https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_${tr.toLowerCase()}.json`;
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Could not load ${tr}. Check your internet connection and try again.`);
      const data = JSON.parse((await response.text()).replace(/^\uFEFF/,''));
      if (!Array.isArray(data) || data.length !== 66) throw new Error('The Bible source returned unexpected data.');
      return data;
    })();
    cache.set(tr,pending);
    pending.catch(() => cache.delete(tr));
  }
  return cache.get(tr);
}
async function bibleApi(action,params) {
  if (action === 'books') return books;
  if (action === 'translations') return translations;
  const translation = params.get('translation') || 'KJV';
  const data = await load(translation);
  const book = params.get('book'), chapter = Number(params.get('chapter'));
  const index = books.findIndex(b => b.name === book);
  if (action === 'chapter' || action === 'verses') {
    const text = data[index]?.chapters[chapter-1];
    if (!text) throw new Error('This Bible chapter is not available.');
    let verses = text.map((text,i) => ({ verse:i+1,text:text.trim() }));
    if (action === 'verses') {
      const numbers = new Set();
      for (const part of (params.get('verses') || '').split(',')) {
        const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
        if (!match) continue;
        for (let n=Number(match[1]); n<=Math.min(Number(match[2] || match[1]),176); n++) numbers.add(n);
      }
      verses = verses.filter(v => numbers.has(v.verse));
    }
    return { translation,book,chapter,verses,text:verses.map(v => `[${v.verse}] ${v.text}`).join(' ') };
  }
  if (action === 'search') {
    const query = (params.get('q') || '').trim();
    if (!query) return [];
    const reference = query.match(/^(.+?)\s+(\d+)(?::(\d+)(?:[-–](\d+))?)?$/);
    const bookName = reference?.[1].toLowerCase().replace(/\.$/,'');
    const bookIndex = reference ? books.findIndex(b => b.name.toLowerCase() === bookName || b.abbr.toLowerCase() === bookName || (bookName === 'psalm' && b.name === 'Psalms')) : -1;
    const terms = query.toLowerCase().split(/\s+/);
    const results = [];
    for (let bi=0; bi<data.length; bi++) {
      if (bookIndex >= 0 && bi !== bookIndex) continue;
      for (let ci=0; ci<data[bi].chapters.length; ci++) {
        if (bookIndex >= 0 && ci+1 !== Number(reference[2])) continue;
        for (let vi=0; vi<data[bi].chapters[ci].length; vi++) {
          const text = data[bi].chapters[ci][vi].trim();
          if (bookIndex >= 0) {
            if (reference[3] && (vi+1 < Number(reference[3]) || vi+1 > Number(reference[4] || reference[3]))) continue;
          } else if (!terms.every(term => text.toLowerCase().includes(term))) continue;
          results.push({ book:books[bi].name,chapter:ci+1,verse:vi+1,text,
            reference:`${books[bi].name} ${ci+1}:${vi+1}`,snippet:escapeHtml(text) });
          if (results.length >= 50) return results;
        }
      }
    }
    return results;
  }
  throw new Error('Unknown Bible action.');
}

window.ChurchBible = { bibleApi };
})();
