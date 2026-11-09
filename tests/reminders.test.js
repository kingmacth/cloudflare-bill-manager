import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {runReminders,reminderSummary} from '../src/reminders.js';
test('不足3天边界、单条通知汇总、并发每日去重及次日继续提醒',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-11-09',d1Databases:{DB:'daily-reminders'}}));const saved=globalThis.fetch;
 try {
  const env={DB:await mf.getD1Database('DB'),NOTIFY_PROVIDER:'webhook',NOTIFY_WEBHOOK_URL:'https://notify.example.com/webhook',APP_URL:'https://example.com'};
  for(const sql of readFileSync('schema.sql','utf8').replace(/^\uFEFF/,'').split(';').map(x=>x.trim()).filter(Boolean))await env.DB.prepare(sql).run();
  const fixtures=[['逾期账单','2026-11-08',0,100],['今日账单','2026-11-09',0,100],['明日账单','2026-11-10',0,100],['后天账单','2026-11-11',0,100],['三天后账单','2026-11-12',0,100],['已还账单','2026-11-09',1,100],['零元账单','2026-11-09',0,0]];
  for(const [bank,date,paid,amount] of fixtures)await env.DB.prepare('INSERT INTO bills(bank,due_date,is_paid,amount) VALUES(?,?,?,?)').bind(bank,date,paid,amount).run();
  const sent=[];globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body).body);return new Response('ok')};
  const results=await Promise.all([runReminders(env,new Date('2026-11-09T01:00Z')),runReminders(env,new Date('2026-11-09T01:00Z'))]);
  assert.equal(results.reduce((sum,r)=>sum+r.sent,0),1);assert.equal(sent.length,1);assert.match(sent[0],/4 笔未还账单/);for(const bank of ['逾期账单','今日账单','明日账单','后天账单'])assert.ok(sent[0].includes(bank));for(const bank of ['三天后账单','已还账单','零元账单'])assert.ok(!sent[0].includes(bank));
  await env.DB.prepare("INSERT INTO bills(bank,due_date,amount) VALUES('当天新增','2026-11-09',100)").run();
  assert.equal((await runReminders(env,new Date('2026-11-09T02:00Z'))).sent,0);assert.equal(sent.length,1);
  const next=await runReminders(env,new Date('2026-11-10T01:00Z'));assert.equal(next.sent,1);assert.equal(sent.length,2);assert.match(sent[1],/三天后账单/);
  await env.DB.prepare('UPDATE bills SET is_paid=1').run();assert.equal((await runReminders(env,new Date('2026-11-11T01:00Z'))).sent,0);assert.equal(sent.length,2);
 } finally {globalThis.fetch=saved;await mf.dispose()}
});
test('大量账单仍控制为一条通知，包含总额与看板提示',()=>{const bills=Array.from({length:100},(_,i)=>({bank:'测试银行'.repeat(15)+i,amount:100,due_date:'2026-11-10',annual_fee_info:'年费信息'}));const s=reminderSummary(bills,'2026-11-09');assert.match(s.body,/100 笔未还账单/);assert.match(s.body,/10000.00/);assert.match(s.body,/查看全部账单/);assert.ok(new TextEncoder().encode(s.title+'\n'+s.body+'\nhttps://bills.example.com').length<1800)});
