import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateReport } from '../src/index.js';

test('validates approximate Port Moresby report locations', () => {
  assert.equal(validateReport({ latitude: -9.47, longitude: 147.16, description: 'Street is dark' }).value.description, 'Street is dark');
  assert.match(validateReport({ latitude: 0, longitude: 147 }).error, /Port Moresby/);
  assert.match(validateReport({ latitude: -9.47, longitude: 147.16, description: 'x'.repeat(501) }).error, /500/);
});

function dbMock() {
  let rows = []; let id = 0;
  return { prepare(sql) { return { bind(...args) { return { async run() { if(sql.startsWith('INSERT')) { const [latitude,longitude,description,started_at,created_at]=args; rows.push({id:++id,latitude,longitude,description,started_at,created_at,restored_at:null,report_count:1,source:'community'}); return {meta:{last_row_id:id,changes:1}}; } if(sql.startsWith('UPDATE')) { const row=rows.find(r=>r.id===args[1]&&!r.restored_at); if(row){row.restored_at=args[0];return {meta:{changes:1}}} return {meta:{changes:0}}; } }, async first(){ return rows.find(r=>r.id===args[0]) || null; } }; }, async all(){return {results:rows.filter(r=>sql.includes('restored_at IS NULL')?!r.restored_at:true)}} }; } };
}
const env = () => ({DB:dbMock(),ASSETS:{fetch(){return new Response('asset')}}});

test('creates and restores an outage through the API', async () => {
  const e=env();
  let response=await worker.fetch(new Request('https://test/api/outages',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'test-1'},body:JSON.stringify({latitude:-9.47,longitude:147.16,description:'Transformer issue'})}),e);
  assert.equal(response.status,201); const created=await response.json(); assert.equal(created.outage.active,true);
  response=await worker.fetch(new Request(`https://test/api/outages/${created.outage.id}/restore`,{method:'POST'}),e);
  assert.equal(response.status,200); const restored=await response.json(); assert.equal(restored.outage.active,false); assert.ok(restored.outage.restored_at);
});

test('limits a client to one report every ten minutes', async () => {
  const e=env(); const request=()=>worker.fetch(new Request('https://test/api/outages',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'rate-limit-test'},body:JSON.stringify({latitude:-9.47,longitude:147.16})}),e);
  assert.equal((await request()).status,201);
  assert.equal((await request()).status,429);
});

test('limits a client to one restoration every ten minutes', async () => {
  const e=env();
  const create=await worker.fetch(new Request('https://test/api/outages',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'restore-create'},body:JSON.stringify({latitude:-9.47,longitude:147.16})}),e);
  const created=await create.json();
  const request=()=>worker.fetch(new Request(`https://test/api/outages/${created.outage.id}/restore`,{method:'POST',headers:{'cf-connecting-ip':'restore-test'}}),e);
  assert.equal((await request()).status,200);
  assert.equal((await request()).status,429);
});
