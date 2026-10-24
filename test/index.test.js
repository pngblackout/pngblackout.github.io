import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateReport } from '../src/index.js';

test('validates structured outage locations', () => {
  assert.equal(validateReport({ city: 'Port Moresby', suburb: 'Gerehu', locality: 'Stage 3', latitude: -9.47, longitude: 147.16, description: 'Street is dark' }).value.description, 'Street is dark');
  assert.equal(validateReport({ city: 'Other', latitude: -5.85, longitude: 144.30 }).value.suburb, null);
  assert.match(validateReport({ city: 'Other', suburb: 'Boroko' }).error, /must be empty/);
  assert.match(validateReport({ city: 'Port Moresby', suburb: 'Boroko', locality: 'Stage 3' }).error, /valid locality/);
  assert.match(validateReport({ city: 'Port Moresby', suburb: 'Not a suburb' }).error, /valid Port Moresby suburb/);
  assert.match(validateReport({ city: 'Port Moresby' }).error, /valid Port Moresby suburb/);
  assert.match(validateReport({ city: 'Other', latitude: -9.47, longitude: 147.16, description: 'x'.repeat(501) }).error, /500/);
});

test('location migration preserves legacy columns and allows empty new fields', async () => {
  const migration = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../migrations/0002_location_fields.sql', import.meta.url), 'utf8'));
  assert.match(migration, /INSERT OR IGNORE INTO outages_v2/);
  assert.match(migration, /SELECT id, latitude, longitude, description, started_at, restored_at, created_at, report_count, source FROM outages/);
  assert.match(migration, /city TEXT/);
  assert.match(migration, /suburb TEXT/);
  assert.match(migration, /locality TEXT/);
});

function dbMock() {
  let rows = []; let id = 0;
  return { prepare(sql) { return { bind(...args) { return { async run() { if(sql.startsWith('INSERT')) { const [latitude,longitude,city,suburb,locality,description,started_at,created_at]=args; rows.push({id:++id,latitude,longitude,city,suburb,locality,description,started_at,created_at,restored_at:null,report_count:1,source:'community'}); return {meta:{last_row_id:id,changes:1}}; } if(sql.startsWith('UPDATE')) { const row=rows.find(r=>r.id===args[1]&&!r.restored_at); if(row){row.restored_at=args[0];return {meta:{changes:1}}} return {meta:{changes:0}}; } }, async first(){ return rows.find(r=>r.id===args[0]) || null; } }; }, async all(){return {results:rows.filter(r=>sql.includes('restored_at IS NULL')?!r.restored_at:true)}} }; } };
}
const env = () => ({DB:dbMock(),ASSETS:{fetch(){return new Response('asset')}}});
const cfRequest = (url, init, country) => { const request = new Request(url, init); Object.defineProperty(request, 'cf', { value: { country } }); return request; };

test('creates and restores an outage through the API', async () => {
  const e=env();
  let response=await worker.fetch(cfRequest('https://test/api/outages',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'test-1'},body:JSON.stringify({city:'Port Moresby',suburb:'Gerehu',locality:'Stage 3',description:'Transformer issue'})},'PG'),e);
  assert.equal(response.status,201); const created=await response.json(); assert.equal(created.outage.active,true);
  response=await worker.fetch(cfRequest(`https://test/api/outages/${created.outage.id}/restore`,{method:'POST'},'PG'),e);
  assert.equal(response.status,200); const restored=await response.json(); assert.equal(restored.outage.active,false); assert.ok(restored.outage.restored_at);
});

test('limits a client to one report every ten minutes', async () => {
  const e=env(); const request=()=>worker.fetch(cfRequest('https://test/api/outages',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'rate-limit-test'},body:JSON.stringify({city:'Other'})},'PG'),e);
  assert.equal((await request()).status,201);
  assert.equal((await request()).status,429);
});

test('limits a client to one restoration every ten minutes', async () => {
  const e=env();
  const create=await worker.fetch(cfRequest('https://test/api/outages',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'restore-create'},body:JSON.stringify({city:'Other'})},'PG'),e);
  const created=await create.json();
  const request=()=>worker.fetch(cfRequest(`https://test/api/outages/${created.outage.id}/restore`,{method:'POST',headers:{'cf-connecting-ip':'restore-test'}},'PG'),e);
  assert.equal((await request()).status,200);
  assert.equal((await request()).status,429);
});

test('keeps report limits independent by client IP', async () => {
  const e=env();
  const request=(ip)=>worker.fetch(cfRequest('https://test/api/outages',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify({city:'Other'})},'PG'),e);
  assert.equal((await request('198.51.100.10')).status,201);
  assert.equal((await request('198.51.100.10')).status,429);
  assert.equal((await request('198.51.100.11')).status,201);
});

test('blocks report submissions outside Papua New Guinea', async () => {
  const response = await worker.fetch(cfRequest('https://test/api/outages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({latitude:-9.47,longitude:147.16})},'US'),env());
  assert.equal(response.status,403);
});
