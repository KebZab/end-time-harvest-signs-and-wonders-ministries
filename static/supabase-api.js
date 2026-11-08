(() => {
const { createClient } = window.supabase;
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = window.ChurchConfig;
const { bibleApi } = window.ChurchBible;

const ADMIN_PAGE = /\/admin(?:\.html)?\/?$/.test(location.pathname);
// Public pages never load the administrator's session, even in the same browser.
const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: ADMIN_PAGE, autoRefreshToken: ADMIN_PAGE, detectSessionInUrl: false,
    storageKey: ADMIN_PAGE ? 'eth-admin-auth' : 'eth-public-auth' }
});
const result = async query => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};
const reference = v => `${v.book} ${v.chapter}${v.verse_list ? ':' + v.verse_list : v.verse_start ? ':' + v.verse_start + (v.verse_end ? '-' + v.verse_end : '') : ''}`;
function sermon(s) {
  const verses = (s.verses || []).sort((a,b) => a.position - b.position || a.id - b.id)
    .map(v => ({ ...v, highlights: Array.isArray(v.highlights) ? v.highlights : [], ref: reference(v) }));
  return { ...s, verses, refs: verses.map(v => v.ref) };
}
async function currentAdmin() {
  if (!ADMIN_PAGE) return null;
  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) { await client.auth.signOut({ scope: 'local' }); return null; }
  const profile = await result(client.from('profiles').select('*').eq('id', user.id).maybeSingle());
  if (!profile?.active || profile.role !== 'ADMIN') {
    await client.auth.signOut({ scope: 'local' });
    return null;
  }
  return { ...profile, username: user.email, email: user.email };
}
function subscribeAuth(callback) {
  return client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') setTimeout(callback, 0);
  });
}
function cleanSermon(body) {
  const title = String(body.title || '').trim(), pastor = String(body.pastor || '').trim();
  if (!title || title.length > 200) throw new Error('Enter a sermon title of up to 200 characters.');
  if (!pastor || pastor.length > 120) throw new Error('Enter a pastor name of up to 120 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.sermon_date)) throw new Error('Enter a sermon date.');
  return { title, pastor, sermon_date: body.sermon_date, description: String(body.description || '').slice(0,5000) };
}
function cleanVerse(v, position) {
  return { book: v.book, chapter: Number(v.chapter), verse_start: v.verse_start ? Number(v.verse_start) : null,
    verse_end: v.verse_end ? Number(v.verse_end) : null, verse_list: String(v.verse_list || ''),
    translation: v.translation || 'KJV', verse_text: String(v.verse_text || ''),
    highlights: Array.isArray(v.highlights) ? v.highlights : [], note: String(v.note || '').slice(0,5000), position };
}
async function api(path, method = 'GET', body = {}) {
  const url = new URL(path, 'https://app.local');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'bible') return bibleApi(parts[1], url.searchParams);
  if (path === '/me') return { user: await currentAdmin() };
  if (path === '/login') {
    const { error } = await client.auth.signInWithPassword({ email: body.username, password: body.password });
    if (error) throw new Error(error.message);
    const user = await currentAdmin();
    if (!user) throw new Error('This account does not have active administrator access.');
    return { user };
  }
  if (path === '/logout') { const { error } = await client.auth.signOut(); if (error) throw error; return {}; }
  if (method !== 'GET' && !await currentAdmin()) throw new Error('Administrator sign-in is required.');
  if (path === '/account/password') {
    const admin = await currentAdmin();
    const { error } = await client.auth.signInWithPassword({ email: admin.email, password: body.current });
    if (error) throw new Error('The current password is incorrect.');
    if (body.new.length < 12) throw new Error('Use at least 12 characters for your new password.');
    return result(client.auth.updateUser({ password: body.new }));
  }
  if (parts[0] === 'stats' || (parts[0] === 'sermons' && parts.length === 1 && method === 'GET') || path === '/export') {
    const all = [];
    // Paginate rather than silently truncating the archive at Supabase's row limit.
    for (let offset = 0; ; offset += 500) {
      const rows = await result(client.from('sermons').select('*,verses(*)')
        .order('sermon_date', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 499));
      all.push(...rows.map(sermon));
      if (rows.length < 500) break;
    }
    if (parts[0] === 'stats') return { latest: all[0] || null, recent: all.slice(0,6), total_sermons: all.length,
      total_verses: all.reduce((sum,s) => sum + s.verses.length,0) };
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    return q ? all.filter(s => [s.title,s.pastor,s.sermon_date,s.description,...s.verses.flatMap(v => [v.ref,v.note,v.verse_text])]
      .some(v => String(v || '').toLowerCase().includes(q))) : all;
  }
  if (parts[0] === 'sermons') {
    const id = Number(parts[1]);
    if (method === 'GET') return sermon(await result(client.from('sermons').select('*,verses(*)').eq('id',id).single()));
    if (parts[2] === 'reorder-verses') {
      return result(client.rpc('reorder_sermon_verses', { p_sermon_id: id, p_order: body.order }));
    }
    if (parts[2] === 'verses') {
      const last = await result(client.from('verses').select('position').eq('sermon_id',id).order('position',{ascending:false}).limit(1));
      const start = (last[0]?.position ?? -1) + 1;
      return result(client.from('verses').insert(body.verses.map((v,i) => ({ ...cleanVerse(v,start+i),sermon_id:id }))).select());
    }
    if (method === 'POST') {
      const id = await result(client.rpc('create_sermon_record', { p_sermon: cleanSermon(body),
        p_verses: (body.verses || []).map(cleanVerse) }));
      return { id };
    }
    if (method === 'PUT') return result(client.from('sermons').update(cleanSermon(body)).eq('id',id).select().single());
    if (method === 'DELETE') return result(client.from('sermons').delete().eq('id',id).select().single());
  }
  if (parts[0] === 'verses') {
    const id = Number(parts[1]);
    if (method === 'DELETE') return result(client.from('verses').delete().eq('id',id).select().single());
    if (method === 'PUT') {
      const clean = cleanVerse(body,0); delete clean.position;
      return result(client.from('verses').update(clean).eq('id',id).select().single());
    }
  }
  throw new Error('This action is not available.');
}

window.ChurchAPI = { api, subscribeAuth };
})();
