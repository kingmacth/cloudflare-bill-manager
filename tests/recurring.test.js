import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {dueInMonth,nextDue,validateSchedule,materializeRecurring,recurringAPI} from '../src/recurring.js';
import {extractIdentity} from '../src/parser.js';
test('姓名和多张卡尾号提取，完整卡号只保留后四位',()=>{assert.deepEqual(extractIdentity('尊敬的测试用户先生：\n卡号：6222 **** **** 1234\n信用卡号：6222333344445678\n尾号为1234'),{customer_name:'测试用户',card_last4:'1234,5678'});assert.deepEqual(extractIdentity('本期应还款额 1234.56'),{customer_name:'',card_last4:''})});
test('月末、闰年与季度日期不漂移',()=>{assert.equal(dueInMonth(2028,1,31),'2028-02-29');assert.equal(nextDue('2028-02-29',1,31),'2028-03-31');assert.equal(nextDue('2026-11-30',3,31),'2027-02-28')});
test('周期参数拒绝无效金额、完整卡号与无效日期',()=>{const s={name:'测试房贷',amount:3500,interval_months:1,due_day:31,start_date:'2090-02-01'};assert.equal(validateSchedule(s).next_due_date,'2090-02-28');assert.throws(()=>validateSchedule({...s,card_last4:'6222333344445555'}));assert.throws(()=>validateSchedule({...s,amount:-1}));assert.throws(()=>validateSchedule({...s,end_date:'2090-01-01'}))});
test('周期账单 D1 集成：并发幂等、月末、暂停、金额更新和还款记录保留',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-11-09',d1Databases:{DB:'schedules'}}));
 try{
  const env={DB:await mf.getD1Database('DB')};
  for(const sql of readFileSync('schema.sql','utf8').replace(/^\uFEFF/,'').split(';').map(x=>x.trim()).filter(Boolean))await env.DB.prepare(sql).run();
  const url=new URL('https://test/api/recurring');
  const response=await recurringAPI(new Request(url,{method:'POST',body:JSON.stringify({name:'测试房贷',institution:'测试银行',customer_name:'测试客户',card_last4:'1234',amount:3500,due_day:31,interval_months:1,start_date:'2090-01-01',end_date:'2090-03-31'})}),env,url);
  assert.equal(response.status,201);const {schedule}=await response.json();
  await Promise.all([materializeRecurring(env,new Date('2090-01-01T01:00Z')),materializeRecurring(env,new Date('2090-01-01T01:00Z'))]);
  let {results}=await env.DB.prepare('SELECT * FROM bills ORDER BY due_date').all();assert.equal(results.length,1);assert.equal(results[0].due_date,'2090-01-31');assert.equal(results[0].card_last4,'1234');
  await materializeRecurring(env,new Date('2090-02-01T01:00Z'));({results}=await env.DB.prepare('SELECT * FROM bills ORDER BY due_date').all());assert.equal(results.length,2);assert.equal(results[1].due_date,'2090-02-28');
  await env.DB.prepare('UPDATE bills SET is_paid=1,paid_at=? WHERE id=?').bind('2090-01-31T01:00:00Z',results[0].id).run();
  const patch=new URL('https://test/api/recurring/'+schedule.id), update=body=>recurringAPI(new Request(patch,{method:'PATCH',body:JSON.stringify(body)}),env,patch);
  assert.equal((await update({amount:3600})).status,200);
  ({results}=await env.DB.prepare('SELECT * FROM bills ORDER BY due_date').all());assert.equal(results[0].amount,3500);assert.equal(results[1].amount,3600);assert.equal(results[0].is_paid,1);
  await update({is_active:0});await materializeRecurring(env,new Date('2090-03-01T01:00Z'));assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM bills').first()).n,2);
  await update({is_active:1});await materializeRecurring(env,new Date('2090-03-01T01:00Z'));assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM bills').first()).n,3);
  await materializeRecurring(env,new Date('2090-06-01T01:00Z'));assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM bills').first()).n,3);
  assert.equal((await update({is_active:0,amount:-5})).status,400);assert.equal((await env.DB.prepare('SELECT is_active FROM recurring_schedules').first()).is_active,1);
 }finally{await mf.dispose()}
});
