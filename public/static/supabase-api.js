(() => {
'use strict';
const { createClient } = window.supabase;
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = window.ChurchConfig;
const { bibleApi } = window.ChurchBible;
const ADMIN_PAGE = /\/admin(?:\.html)?\/?$/.test(location.pathname);
const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: ADMIN_PAGE, autoRefreshToken: ADMIN_PAGE, detectSessionInUrl: false,
    storageKey: ADMIN_PAGE ? 'eth-admin-auth' : 'eth-public-auth' }
});
const FIELDS = 'id,title,pastor,sermon_date,updated_at';
const CACHE_KEY = 'eth-library-cache-v2';
const TTL = 5 * 60 * 1000;
const PAGE_SIZE = 25;
const cache = new Map(), pending = new Map(), listeners = new Set();
let cacheEpoch = 0, revision = null, saveTimer;
let adminProfile = null, adminChecked = 0, adminRequest = null;
const result = async query => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};
const reference = v => `${v.book} ${v.chapter}${v.verse_list ? ':' + v.verse_list : v.verse_start ? ':' + v.verse_start + (v.verse_end ? '-' + v.verse_end : '') : ''}`;
function sermon(s) {
  const verses = [...(s.verses || [])].sort((a,b) => a.position-b.position || a.id-b.id)
    .map(v => ({ ...v,highlights:Array.isArray(v.highlights) ? v.highlights : [],ref:reference(v) }));
  return { ...s,verses,refs:verses.map(v=>v.ref) };
}
try {
  const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (saved?.project === SUPABASE_URL && Array.isArray(saved.entries)) {
    revision = saved.revision;
    for (const [key,entry] of saved.entries.slice(-30)) {
      if (entry && typeof entry.time === 'number' && Date.now()-entry.time<TTL) cache.set(key,entry);
    }
  }
} catch { /* Storage is optional; memory caching still works. */ }
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const entries = [...cache].slice(-30);
      let text = JSON.stringify({project:SUPABASE_URL,revision,entries});
      while (text.length > 1000000 && entries.length) {
        entries.shift();text = JSON.stringify({project:SUPABASE_URL,revision,entries});
      }
      localStorage.setItem(CACHE_KEY,text);
    } catch { /* A full/disabled storage must not stop the library. */ }
  },150);
}
function put(key,data) {
  cache.delete(key);cache.set(key,{data,time:Date.now(),stale:false});
  while(cache.size>30) cache.delete(cache.keys().next().value);
  persist();return data;
}
function stale(test) {
  cacheEpoch++;
  for (const [key,entry] of cache) if(test(key)) entry.stale=true;
  persist();
}
async function cached(key,loader) {
  const entry=cache.get(key);
  if(entry && !entry.stale && Date.now()-entry.time<TTL) return entry.data;
  if(pending.has(key)) return pending.get(key);
  const epoch=cacheEpoch;
  const promise=(async()=>{
    const data=await loader();
    if(epoch!==cacheEpoch){pending.delete(key);return cached(key,loader);}
    return put(key,data);
  })();
  pending.set(key,promise);
  try{return await promise;}finally{if(pending.get(key)===promise)pending.delete(key);}
}
function emit(change){for(const fn of listeners)fn(change);}
function watchLibrary(fn){listeners.add(fn);return ()=>listeners.delete(fn);}

// Only the tiny change-notice row is replicated. Verse bodies stay on demand.
let channel=null, connectionId=0, connectionReady=null, wanted=false, activeSermon=null, connectedBefore=false;
let closing=Promise.resolve();
let noticeTimer, notices=[], work=Promise.resolve();
async function applyNotices(batch) {
  const fresh=batch.filter(n=>Number(n.revision)>Number(revision ?? -1)).sort((a,b)=>Number(a.revision)-Number(b.revision));
  if(!fresh.length)return;
  let expected=revision===null ? null : Number(revision)+1;
  let reset=false;
  for(const n of fresh){if(expected!==null&&Number(n.revision)!==expected)reset=true;expected=Number(n.revision)+1;}
  revision=Number(fresh.at(-1).revision);
  const metadata=fresh.some(n=>n.entity==='sermons');
  const affected=new Set(fresh.flatMap(n=>n.sermon_ids || []).map(Number));
  if(fresh.some(n=>!n.ids?.length||!n.sermon_ids?.length))reset=true;
  const targetId=activeSermon;
  const detailKey='detail:'+targetId;
  const existing=cache.get(detailKey)?.data;
  stale(key=>reset || (key==='home'&&metadata) || (key.startsWith('list:')&&(metadata||!key.startsWith('list::')))
    || (key.startsWith('detail:')&&affected.has(Number(key.slice(7)))));
  if(!reset && targetId && affected.has(Number(targetId)) && existing) {
    const epoch=cacheEpoch;
    const removed=fresh.some(n=>n.entity==='sermons'&&n.operation==='DELETE'&&(n.ids||[]).map(Number).includes(Number(targetId)));
    if(removed)put(detailKey,null);
    else {
      let updated={...existing,verses:[...existing.verses]};
      if(metadata) {
        const header=await result(client.from('sermons').select(FIELDS+',description').eq('id',targetId).maybeSingle());
        if(!header)updated=null;else updated={...updated,...header};
      }
      const verseEvents=fresh.filter(n=>n.entity==='verses'&&(n.sermon_ids||[]).map(Number).includes(Number(targetId)));
      if(updated && verseEvents.length) {
        const ids=[...new Set(verseEvents.flatMap(n=>n.ids).map(Number))];
        const positionsOnly=verseEvents.every(n=>n.operation==='UPDATE'&&n.position_only);
        const rows=await result(client.from('verses').select(positionsOnly?'id,position':'*').eq('sermon_id',targetId).in('id',ids));
        const byId=new Map(updated.verses.map(v=>[v.id,v]));
        if(!positionsOnly)for(const id of ids)byId.delete(id);
        for(const row of rows)byId.set(row.id,{...byId.get(row.id),...row});
        updated=sermon({...updated,verses:[...byId.values()]});
      }
      if(epoch===cacheEpoch)put(detailKey,updated);
    }
  }
  persist();emit({reset,metadata,sermonIds:[...affected]});
}
function queueNotice(row) {
  if(!row || !Number.isFinite(Number(row.revision)))return;
  notices.push(row);clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>{
    const batch=notices;notices=[];
    work=work.then(()=>applyNotices(batch)).catch(()=>{stale(()=>true);emit({reset:true});});
  },200);
}
async function synchronize(notify) {
  const state=await result(client.from('library_state').select('revision').eq('id',1).single());
  const changed=revision===null || Number(state.revision)!==Number(revision);
  if(changed) {
    stale(()=>true);revision=Number(state.revision);persist();
  }
  if(notify && (changed || [...cache.values()].some(entry=>entry.stale)))emit({reset:true});
}
function disconnect() {
  connectionId++;connectionReady=null;
  if(channel){
    const old=channel;channel=null;
    closing=closing.then(()=>client.removeChannel(old)).catch(()=>{}).finally(()=>{if(!channel)client.realtime.disconnect();});
  }
  return closing;
}
async function setLive(enabled,sermonId=null) {
  wanted=enabled;activeSermon=sermonId ? Number(sermonId):null;
  if(!enabled || document.hidden){await disconnect();return;}
  if(channel)return connectionReady;
  await closing;
  if(!wanted || document.hidden)return;
  if(channel)return connectionReady;
  const id=++connectionId;
  let done,settled=false,syncing=null;
  connectionReady=new Promise(resolve=>{done=()=>{if(!settled){settled=true;resolve();}};});
  const sync=()=>{
    if(syncing)return syncing;
    syncing=synchronize(connectedBefore).catch(()=>{}).finally(()=>{syncing=null;connectedBefore=true;done();});
    return syncing;
  };
  const timer=setTimeout(()=>{if(id===connectionId)void sync();else done();},3500);
  channel=client.channel('library-notices').on('postgres_changes',{
    event:'UPDATE',schema:'public',table:'library_state',filter:'id=eq.1'
  },payload=>{if(id===connectionId)queueNotice(payload.new);}).subscribe(status=>{
    if(id!==connectionId){done();return;}
    if(status==='SUBSCRIBED'){clearTimeout(timer);void sync();}
  });
  await connectionReady;
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)disconnect();else if(wanted)void setLive(true,activeSermon);
});
window.addEventListener('online',()=>{if(wanted&&!document.hidden){disconnect();void setLive(true,activeSermon);}});
window.addEventListener('pagehide',disconnect);
window.addEventListener('pageshow',()=>{if(wanted&&!document.hidden)void setLive(true,activeSermon);});

async function currentAdmin(force=false) {
  if(!ADMIN_PAGE)return null;
  if(!force && adminProfile && Date.now()-adminChecked<30000)return adminProfile;
  if(adminRequest)return adminRequest;
  adminRequest=(async()=>{
    const {data:{session}}=await client.auth.getSession();
    if(!session)return null;
    const {data:{user},error}=await client.auth.getUser();
    if(error||!user){await client.auth.signOut({scope:'local'});return null;}
    const profile=await result(client.from('profiles').select('id,full_name,role,active').eq('id',user.id).maybeSingle());
    if(!profile?.active||profile.role!=='ADMIN'){await client.auth.signOut({scope:'local'});return null;}
    adminChecked=Date.now();return adminProfile={...profile,username:user.email,email:user.email};
  })();
  try{return await adminRequest;}finally{adminRequest=null;}
}
function subscribeAuth(callback) {
  return client.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT'){adminProfile=null;adminChecked=0;setTimeout(callback,0);}
  });
}
function cleanSermon(body) {
  const title=String(body.title||'').trim(),pastor=String(body.pastor||'').trim();
  if(!title||title.length>200)throw new Error('Enter a topic title of up to 200 characters.');
  if(!pastor||pastor.length>120)throw new Error('Enter a pastor name of up to 120 characters.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.sermon_date))throw new Error('Enter a topic date.');
  return {title,pastor,sermon_date:body.sermon_date,description:String(body.description||'').slice(0,5000)};
}
function cleanVerse(v,position) {
  return {book:v.book,chapter:Number(v.chapter),verse_start:v.verse_start?Number(v.verse_start):null,
    verse_end:v.verse_end?Number(v.verse_end):null,verse_list:String(v.verse_list||''),translation:v.translation||'KJV',
    verse_text:String(v.verse_text||''),highlights:Array.isArray(v.highlights)?v.highlights:[],note:String(v.note||'').slice(0,5000),position};
}
function localVerses(sermonId,rows,deletedIds=[]) {
  stale(key=>key.startsWith('list:')&&!key.startsWith('list::'));
  const key='detail:'+sermonId,old=cache.get(key)?.data;
  if(old){const map=new Map(old.verses.map(v=>[v.id,v]));for(const id of deletedIds)map.delete(id);for(const row of rows)map.set(row.id,row);
    put(key,sermon({...old,verses:[...map.values()]}));}
}
async function api(path,method='GET',body={}) {
  const url=new URL(path,'https://app.local'),parts=url.pathname.split('/').filter(Boolean);
  if(parts[0]==='bible')return bibleApi(parts[1],url.searchParams);
  if(path==='/me')return {user:await currentAdmin()};
  if(path==='/login') {
    const {error}=await client.auth.signInWithPassword({email:body.username,password:body.password});
    if(error)throw new Error(error.message);
    const user=await currentAdmin(true);if(!user)throw new Error('This account does not have active administrator access.');return {user};
  }
  if(path==='/logout'){const {error}=await client.auth.signOut();if(error)throw error;adminProfile=null;return {};}
  // Database RLS remains authoritative even while this UI profile is cached.
  if(method!=='GET'&&!await currentAdmin())throw new Error('Administrator sign-in is required.');
  if(path==='/account/password') {
    const admin=await currentAdmin(),{error}=await client.auth.signInWithPassword({email:admin.email,password:body.current});
    if(error)throw new Error('The current password is incorrect.');
    if(body.new.length<12)throw new Error('Use at least 12 characters for your new password.');
    return result(client.auth.updateUser({password:body.new}));
  }
  if(path==='/stats')return cached('home',async()=>{
    const recent=await result(client.from('sermons').select(FIELDS).order('sermon_date',{ascending:false}).order('id',{ascending:false}).limit(6));
    return {latest:recent[0]||null,recent};
  });
  if(parts[0]==='sermons'&&parts.length===1&&method==='GET') {
    const q=(url.searchParams.get('q')||'').trim().slice(0,200),page=Math.max(0,Math.floor(Number(url.searchParams.get('page'))||0));
    return cached('list:'+encodeURIComponent(q.toLowerCase())+':'+page,async()=>{
      const rows=await result(client.rpc('search_sermon_library',{p_query:q,p_offset:page*PAGE_SIZE,p_limit:PAGE_SIZE+1}));
      return {items:rows.slice(0,PAGE_SIZE),has_more:rows.length>PAGE_SIZE,page,page_size:PAGE_SIZE};
    });
  }
  if(path==='/export') {
    const all=[];
    for(let offset=0;;offset+=100){const rows=await result(client.from('sermons').select('*,verses(*)').order('id').range(offset,offset+99));
      all.push(...rows.map(sermon));if(rows.length<100)break;}
    return all;
  }
  if(parts[0]==='sermons') {
    const id=Number(parts[1]),key='detail:'+id;
    if(method==='GET') {
      const data=await cached(key,async()=>{const row=await result(client.from('sermons').select(FIELDS+',description,verses(*)').eq('id',id).maybeSingle());return row?sermon(row):null;});
      if(!data)throw new Error('This topic is no longer available.');return data;
    }
    if(parts[2]==='reorder-verses') {
      await result(client.rpc('reorder_sermon_verses',{p_sermon_id:id,p_order:body.order}));
      const old=cache.get(key)?.data;
      if(old){const order=new Map(body.order.map((vid,i)=>[vid,i]));put(key,sermon({...old,verses:old.verses.map(v=>({...v,position:order.get(v.id)}))}));}
      return {};
    }
    if(parts[2]==='verses') {
      const rows=await result(client.rpc('append_sermon_verses',{p_sermon_id:id,p_verses:body.verses.map(cleanVerse)}));
      localVerses(id,rows);return rows;
    }
    if(method==='POST') {
      const sid=await result(client.rpc('create_sermon_record',{p_sermon:cleanSermon(body),p_verses:(body.verses||[]).map(cleanVerse)}));
      stale(k=>k==='home'||k.startsWith('list:'));return {id:sid};
    }
    if(method==='PUT') {
      const row=await result(client.from('sermons').update(cleanSermon(body)).eq('id',id).select(FIELDS+',description').single());
      stale(k=>k==='home'||k.startsWith('list:'));const old=cache.get(key)?.data;if(old)put(key,{...old,...row});return row;
    }
    if(method==='DELETE') {
      await result(client.from('sermons').delete().eq('id',id));stale(k=>k==='home'||k.startsWith('list:'));put(key,null);return {};
    }
  }
  if(parts[0]==='verses') {
    const id=Number(parts[1]);
    if(method==='DELETE') {
      const row=await result(client.from('verses').delete().eq('id',id).select('id,sermon_id').single());localVerses(row.sermon_id,[],[id]);return row;
    }
    if(method==='PUT') {
      const clean=cleanVerse(body,0);delete clean.position;
      const row=await result(client.from('verses').update(clean).eq('id',id).select().single());localVerses(row.sermon_id,[row]);return row;
    }
  }
  throw new Error('This action is not available.');
}
window.ChurchAPI={api,subscribeAuth,watchLibrary,setLive};
})();
