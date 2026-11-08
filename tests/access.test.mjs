import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../static/app.js',import.meta.url),'utf8');
const books = JSON.parse(await readFile(new URL('../static/books.json',import.meta.url),'utf8'));
const admin = { id:'admin-id',full_name:'Administrator',email:'admin@example.test',username:'admin@example.test',role:'ADMIN',active:true };
const sermon = { id:1,title:'A message of hope',pastor:'Pastor',sermon_date:'2026-11-08',description:'Welcome',refs:['John 3:16'],
  verses:[{ id:1,book:'John',chapter:3,verse_start:16,verse_list:'16',translation:'KJV',verse_text:'[16] For God so loved the world',
    highlights:[{text:'God',color:'yellow'}],note:'A note',ref:'John 3:16' }] };
async function page(path,{ user=null,fail=false }={}) {
  const dom = new JSDOM('<div id="app"></div><div id="modal" hidden></div><div id="toast"></div>',{
    url:'http://localhost:8000' + path,runScripts:'outside-only'
  });
  dom.window.scrollTo=()=>{};
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  const calls=[];
  let callback;
  dom.window.ChurchAPI={
    subscribeAuth(fn){callback=fn;},
    async api(path,method,body){
      calls.push({path,method,body});
      if (fail) throw Error('Network unavailable');
      if(path==='/me')return {user};
      if(path==='/login'){user=admin;return {user};}
      if(path==='/logout'){user=null;return {};}
      if(path==='/bible/books')return books;
      if(path==='/bible/translations')return [{id:'KJV',name:'King James Version'}];
      if(path.startsWith('/bible/chapter'))return {verses:[{verse:1,text:'In the beginning was the Word'}]};
      if(path==='/stats')return {latest:sermon,recent:[sermon],total_sermons:1,total_verses:1};
      if(path==='/sermons/1')return sermon;
      if(path.startsWith('/sermons?'))return [sermon];
      throw Error('Unexpected request: '+path);
    }
  };
  dom.window.localStorage.setItem('saved_admin_pw','old-insecure-password');
  dom.window.eval(source);
  await new Promise(resolve=>setTimeout(resolve,20));
  return {dom,document:dom.window.document,calls,signOut:()=>callback?.()};
}
test('public entry points show sermons without an account or login form',async()=>{
  for(const path of ['/','/viewer.html','/index.html']){
    const {dom,document,calls}=await page(path);
    assert.match(document.body.textContent,/A message of hope/);
    assert.equal(document.querySelector('[data-form="login"]'),null);
    assert.equal(document.querySelector('[data-act="logout"]'),null);
    assert.equal(document.querySelector('a[href="#/new"]'),null);
    assert.ok(document.querySelector('a[href="admin.html"]'));
    assert.equal(dom.window.localStorage.getItem('saved_admin_pw'),null);
    assert.ok(!calls.some(c=>c.path==='/login'));
    dom.window.close();
  }
});
test('public sermon displays highlights and notes without edit controls',async()=>{
  const {dom,document}=await page('/viewer.html#/sermon/1');
  assert.equal(document.querySelector('mark.hl-yellow')?.textContent,'God');
  assert.match(document.body.textContent,/A note/);
  assert.equal(document.querySelector('[data-act="del-sermon"]'),null);
  assert.equal(document.querySelector('[data-act="edit-passage"]'),null);
  dom.window.close();
});
test('public page stays read only even if an admin profile is returned',async()=>{
  const {dom,document}=await page('/viewer.html#/sermon/1',{user:admin});
  assert.equal(document.querySelector('[data-act="del-sermon"]'),null);
  assert.equal(document.querySelector('.adminbar'),null);
  dom.window.close();
});
test('admin page requires email and password and contains no demo credentials',async()=>{
  const {dom,document}=await page('/admin.html');
  assert.ok(document.querySelector('[data-form="login"]'));
  assert.equal(document.querySelector('#un').type,'email');
  assert.equal(document.querySelector('#pw').type,'password');
  assert.ok(!/admin123|password123|Autofill Viewer/.test(document.body.textContent));
  assert.ok(document.querySelector('a[href="viewer.html"]'));
  dom.window.close();
});
test('admin sign-in form opens management and sign-out clears it',async()=>{
  const {dom,document,signOut}=await page('/admin.html');
  document.querySelector('#un').value='admin@example.test';
  document.querySelector('#pw').value='test-password';
  document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(document.querySelector('.adminbar'));
  assert.ok(document.querySelector('a[href="#/new"]'));
  signOut();
  assert.ok(document.querySelector('[data-form="login"]'));
  assert.equal(document.querySelector('.adminbar'),null);
  dom.window.close();
});
test('signed-in admin can access scripture editing',async()=>{
  const {dom,document}=await page('/admin.html#/sermon/1',{user:admin});
  assert.ok(document.querySelector('[data-act="edit-passage"]'));
  assert.ok(document.querySelector('[data-act="del-sermon"]'));
  dom.window.close();
});
test('public Bible reader works without a user',async()=>{
  const {dom,document}=await page('/viewer.html#/bible');
  assert.match(document.body.textContent,/In the beginning was the Word/);
  assert.equal(document.querySelector('[data-form="login"]'),null);
  dom.window.close();
});
test('connection failure offers retry without crashing',async()=>{
  const {dom,document}=await page('/viewer.html',{fail:true});
  assert.match(document.body.textContent,/Could not connect/);
  assert.match(document.body.textContent,/Try again/);
  dom.window.close();
});

test('plain HTML loads the actual classic scripts and local Bible without a build',async()=>{
  for (const name of ['index.html','viewer.html','admin.html']) {
    const html = await readFile(new URL('../'+name,import.meta.url),'utf8');
    assert.ok(!html.includes('type="module"'));
    const scripts = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(scripts.length,7);
    const dom = new JSDOM(html,{url:'http://localhost/'+name,runScripts:'outside-only'});
    dom.window.scrollTo=()=>{};
    dom.window.fetch=async()=>new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
    for (const path of scripts) {
      const code=await readFile(new URL('../'+path,import.meta.url),'utf8');
      dom.window.eval(code);
    }
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(dom.window.BibleBooks.length,66);
    const chapter=await dom.window.ChurchAPI.api('/bible/chapter?book=John&chapter=3&translation=KJV');
    assert.match(chapter.verses.find(v=>v.verse===16).text,/For God so loved the world/);
    if(name==='admin.html') assert.ok(dom.window.document.querySelector('[data-form="login"]'));
    else assert.match(dom.window.document.body.textContent,/No sermons recorded yet/);
    dom.window.close();
  }
});
