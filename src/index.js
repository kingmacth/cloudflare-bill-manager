import {runReminders} from './reminders.js';
export {runReminders} from './reminders.js';
﻿import PostalMime from 'postal-mime';
import {extractBill,chinaDay,dayDiff,parseDate} from './parser.js';
import {notify} from './notify.js';
import {authorized,login,cookie,sameOrigin} from './auth.js';
import dashboard from './page.html';
import loginPage from './login.html';
import {materializeRecurring,recurringAPI} from './recurring.js';
import recurringUI from './recurring-ui.html';

const json=(data,status=200)=>Response.json(data,{status});
const MAX_MAIL=20*1024*1024;
async function limitedRead(stream,limit) { const reader=stream.getReader(); const chunks=[]; let size=0; try { for(;;) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>limit) { await reader.cancel(); throw new Error('邮件超过 20MB 限制'); } chunks.push(value); } } finally {reader.releaseLock();} const bytes=new Uint8Array(size); let offset=0; for(const c of chunks) {bytes.set(c,offset);offset+=c.byteLength;} return bytes; }
async function sha256(data) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export async function extractPdfText(attachment,env) {
 if(!env.PDF_EXTRACTOR) return null;
 const response=await env.PDF_EXTRACTOR.fetch('https://pdf-extractor.internal/extract',{method:'POST',headers:{'Content-Type':'application/pdf',...(env.PDF_PASSWORD?{'X-PDF-Password':env.PDF_PASSWORD}:{})},body:attachment.content,signal:AbortSignal.timeout(20000)});
 if(!response.ok) throw new Error(`PDF extractor HTTP ${response.status}`);
 const data=await response.json(); if(typeof data.text!=='string'||data.text.length>2000000) throw new Error('Invalid PDF extractor response'); return data.text;
}
export async function receiveEmail(message,env,{reprocess=false}={}) {
 if(env.EMAIL_RECIPIENT && message.to.toLowerCase()!==env.EMAIL_RECIPIENT.toLowerCase()) { message.setReject('Unknown recipient'); return; }
 if(message.rawSize>MAX_MAIL) {message.setReject('Message too large');return;}
 const raw=await limitedRead(message.raw,MAX_MAIL); const id=await sha256(raw);
 await env.BUCKET.put(`emails/${id}.eml`,raw,{httpMetadata:{contentType:'message/rfc822'}});
 const existing=await env.DB.prepare('SELECT status FROM incoming_emails WHERE id=?').bind(id).first();
 if(existing && existing.status==='parsed' && !reprocess) return;
 const parsed=await PostalMime.parse(raw,{maxNestingDepth:30,maxHeadersSize:256000});
 const sender=parsed.from?.address||message.from||''; const subject=(parsed.subject||'无主题').slice(0,500);
 await env.DB.prepare("INSERT OR IGNORE INTO incoming_emails(id,sender,subject,status) VALUES (?,?,?,'processing')").bind(id,sender,subject).run();
 const reference=parsed.date&&Number.isFinite(Date.parse(parsed.date))?chinaDay(new Date(parsed.date)):chinaDay();
 let bill=extractBill({sender,subject,text:parsed.text||'',html:parsed.html||''},reference);
 const attachments=(parsed.attachments||[]).filter(a=>a.mimeType==='application/pdf'||/\.pdf$/i.test(a.filename||''));
 for(let i=0;i<attachments.length;i++) {
  const a=attachments[i]; const bytes=new Uint8Array(a.content);
  if(new TextDecoder().decode(bytes.slice(0,1024)).indexOf('%PDF-')<0) continue;
  const hash=await sha256(bytes);
  const filename=(a.filename||`statement-${i+1}.pdf`).replace(/[^\p{L}\p{N}._-]/gu,'_').slice(-120);
  const created=await env.DB.prepare('SELECT created_at FROM incoming_emails WHERE id=?').bind(id).first();
  const ym=chinaDay(new Date(created.created_at)).slice(0,7).replace('-','');
  const key=`bills/${ym}/${Date.parse(created.created_at)}_${id.slice(0,12)}_${i}_${filename}`;
  const saved=await env.DB.prepare('SELECT id FROM attachments WHERE object_key=?').bind(key).first();
  if(!saved) {
   await env.BUCKET.put(key,a.content,{httpMetadata:{contentType:'application/pdf'},customMetadata:{emailId:id}});
   await env.DB.prepare('INSERT OR IGNORE INTO attachments(email_id,object_key,filename,size,sha256) VALUES (?,?,?,?,?)').bind(id,key,filename,bytes.length,hash).run();
  }
  await env.DB.prepare('UPDATE attachments SET sha256=? WHERE object_key=? AND sha256 IS NULL').bind(hash,key).run();
  if(bill.amount===null||!bill.due_date) {
   const trusted=await env.DB.prepare('SELECT b.* FROM attachments a JOIN bills b ON b.id=a.bill_id WHERE a.sha256=? AND b.bank=? ORDER BY a.id LIMIT 1').bind(hash,bill.bank||'').first();
   if(trusted)bill={...bill,amount:bill.amount??trusted.amount,minimum_amount:bill.minimum_amount??trusted.minimum_amount,due_date:bill.due_date||trusted.due_date,statement_date:bill.statement_date||trusted.statement_date,card_last4:bill.card_last4||trusted.card_last4,customer_name:bill.customer_name||trusted.customer_name,annual_fee_info:bill.annual_fee_info||trusted.annual_fee_info,details:bill.details.length?bill.details:JSON.parse(trusted.details_json)};
  }
  if(bill.amount===null||!bill.due_date) {
   try { const text=await extractPdfText(a,env); if(text) {const pdf=extractBill({sender,subject,text},reference); bill={...bill,bank:bill.bank||pdf.bank,amount:bill.amount??pdf.amount,due_date:bill.due_date||pdf.due_date,statement_date:bill.statement_date||pdf.statement_date,minimum_amount:bill.minimum_amount??pdf.minimum_amount,annual_fee_info:[bill.annual_fee_info,pdf.annual_fee_info].filter(Boolean).join('\n'),details:bill.details.length?bill.details:pdf.details};} } catch { console.error('pdf_extraction_failed',{emailId:id}); }
  }
 }
 await env.DB.prepare('UPDATE incoming_emails SET extracted_json=? WHERE id=?').bind(JSON.stringify(bill),id).run();
 const previous=bill.bank&&bill.due_date?await env.DB.prepare('SELECT amount FROM bills WHERE bank=? AND due_date=?').bind(bill.bank,bill.due_date).first():null;
 if(previous && previous.amount!==bill.amount) {
  await env.DB.prepare("UPDATE incoming_emails SET bank=?,status='review',reason='同银行同还款日已有不同金额账单，请核对是否多卡或更正账单' WHERE id=?").bind(bill.bank,id).run();
 } else if(bill.bank && bill.amount!==null && bill.due_date) {
  await env.DB.batch([
   env.DB.prepare("INSERT INTO bills(bank,amount,due_date,statement_date,minimum_amount,annual_fee_info,details_json,subject,sender) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(bank,due_date) DO UPDATE SET statement_date=COALESCE(bills.statement_date,excluded.statement_date),minimum_amount=COALESCE(bills.minimum_amount,excluded.minimum_amount),annual_fee_info=CASE WHEN bills.annual_fee_info='' THEN excluded.annual_fee_info WHEN excluded.annual_fee_info<>'' AND instr(bills.annual_fee_info,excluded.annual_fee_info)=0 THEN bills.annual_fee_info||char(10)||excluded.annual_fee_info ELSE bills.annual_fee_info END,details_json=CASE WHEN bills.details_json='[]' THEN excluded.details_json ELSE bills.details_json END WHERE bills.amount=excluded.amount").bind(bill.bank,bill.amount,bill.due_date,bill.statement_date,bill.minimum_amount,bill.annual_fee_info,JSON.stringify(bill.details),subject,sender),
   env.DB.prepare("UPDATE incoming_emails SET bank=?,status=CASE WHEN EXISTS(SELECT 1 FROM bills WHERE bank=? AND due_date=? AND amount=?) THEN 'parsed' ELSE 'review' END,bill_id=(SELECT id FROM bills WHERE bank=? AND due_date=? AND amount=?),reason=CASE WHEN EXISTS(SELECT 1 FROM bills WHERE bank=? AND due_date=? AND amount=?) THEN NULL ELSE '同银行同还款日已有不同金额账单，请核对是否多卡或更正账单' END WHERE id=?").bind(bill.bank,bill.bank,bill.due_date,bill.amount,bill.bank,bill.due_date,bill.amount,bill.bank,bill.due_date,bill.amount,id),
   env.DB.prepare('UPDATE attachments SET bill_id=(SELECT bill_id FROM incoming_emails WHERE id=?) WHERE email_id=?').bind(id,id)
  ]);
 } else {
  const reason=[!bill.bank?'银行未识别':null,bill.amount===null?'全额应还未识别':null,!bill.due_date?'还款日期未识别':null,attachments.length&&!env.PDF_EXTRACTOR?'PDF 已保存，需人工核对或配置解密服务':null].filter(Boolean).join('；');
  await env.DB.prepare("UPDATE incoming_emails SET bank=?,status='review',reason=? WHERE id=?").bind(bill.bank,reason,id).run();
 }
 await env.DB.prepare("UPDATE bills SET card_last4=CASE WHEN ?<>'' THEN ? ELSE card_last4 END,customer_name=CASE WHEN ?<>'' THEN ? ELSE customer_name END WHERE id=(SELECT bill_id FROM incoming_emails WHERE id=? AND status='parsed')").bind(bill.card_last4||'',bill.card_last4||'',bill.customer_name||'',bill.customer_name||'',id).run();
}

async function api(request,env,url) {
 if(url.pathname==='/api/emails/import'&&request.method==='POST') {
  if(!request.body)return json({error:'请选择原始 .eml 邮件文件'},400);
  const type=(request.headers.get('Content-Type')||'').split(';')[0];
  if(!['message/rfc822','application/octet-stream'].includes(type))return json({error:'请上传 .eml 原始邮件，不是截图或 PDF'},415);
  let raw;try{raw=await limitedRead(request.body,MAX_MAIL);}catch{return json({error:'邮件超过 20MB 限制'},413);}
  const header=new TextDecoder().decode(raw.slice(0,256000));
  if(!/\r?\n\r?\n/.test(header)||! /^(?:From|Subject|Content-Type):/im.test(header))return json({error:'文件不是有效的 MIME 邮件，请从邮箱下载原始邮件（.eml）'},400);
  const id=await sha256(raw);
  await receiveEmail({to:env.EMAIL_RECIPIENT,from:'manual-import',raw:new Blob([raw]).stream(),rawSize:raw.byteLength,setReject(reason){throw new Error(reason);}},env,{reprocess:true});
  return emailOutcome(env,id);
 }
 if(url.pathname.startsWith('/api/recurring')) {const result=await recurringAPI(request,env,url);if(result)return result;}
 const replay=url.pathname.match(/^\/api\/emails\/([a-f0-9]{64})\/reprocess$/);
 if(replay && request.method==='POST') {
  const row=await env.DB.prepare('SELECT sender FROM incoming_emails WHERE id=?').bind(replay[1]).first();
  if(!row) return json({error:'邮件不存在'},404);
  const original=await env.BUCKET.get(`emails/${replay[1]}.eml`);
  if(!original) return json({error:'这条旧收件记录没有邮件原文，无法重新解析。请使用“导入 .eml 邮件”补充原文，或手动补录账单。',code:'SOURCE_MISSING',email_id:replay[1]},409);
  await receiveEmail({to:env.EMAIL_RECIPIENT,from:row.sender,raw:original.body,rawSize:original.size,setReject(reason){throw new Error(reason);}},env,{reprocess:true});
  return emailOutcome(env,replay[1]);
 }
 if(url.pathname==='/api/bills' && request.method==='GET') {
  await materializeRecurring(env);
  const filter=url.searchParams.get('status')||'all'; if(!['all','unpaid','paid'].includes(filter)) return json({error:'无效状态'},400);
  const {results}=await env.DB.prepare(`SELECT *, (SELECT COUNT(*) FROM attachments WHERE bill_id=bills.id) AS pdf_count FROM bills ${filter==='all'?'':'WHERE is_paid=?'} ORDER BY due_date,id`).bind(...(filter==='all'?[]:[filter==='paid'?1:0])).all();
  return json({bills:results.map(({details_json,...b})=>({...b,bank:b.display_name||b.bank,details:JSON.parse(details_json)})),today:chinaDay()});
 }
 if(url.pathname==='/api/review' && request.method==='GET') {
  const {results}=await env.DB.prepare("SELECT e.*,a.id AS attachment_id,a.filename FROM incoming_emails e LEFT JOIN attachments a ON e.id=a.email_id WHERE e.status IN ('review','processing') ORDER BY e.created_at DESC LIMIT 200").all(); return json({emails:results});
 }
 const review=url.pathname.match(/^\/api\/review\/([a-f0-9]{64})\/resolve$/);
 if(review && request.method==='POST') {
  let b; try{b=await request.json();}catch{return json({error:'无效 JSON'},400);}
  if(typeof b.bank!=='string'||!b.bank.trim()||b.bank.length>50||typeof b.amount!=='number'||!Number.isFinite(b.amount)||b.amount<0||b.amount>1e10||parseDate(b.due_date)!==b.due_date||(b.statement_date&&parseDate(b.statement_date)!==b.statement_date)) return json({error:'请填写有效的银行、总额和日期'},400);
  const email=await env.DB.prepare('SELECT * FROM incoming_emails WHERE id=?').bind(review[1]).first(); if(!email) return json({error:'邮件不存在'},404);
  const extracted=JSON.parse(email.extracted_json||'{}');
  const card_last4=String(b.card_last4??extracted.card_last4??'').trim(),customer_name=String(b.customer_name??extracted.customer_name??'').trim();
  if((card_last4&&!/^\d{4}(?:,\d{4})*$/.test(card_last4))||card_last4.length>64||customer_name.length>60)return json({error:'卡尾号须为四位数字，姓名最多 60 字'},400);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO bills(bank,amount,due_date,statement_date,minimum_amount,annual_fee_info,details_json,subject,sender) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(bank,due_date) DO UPDATE SET amount=excluded.amount,statement_date=COALESCE(excluded.statement_date,bills.statement_date),annual_fee_info=excluded.annual_fee_info,minimum_amount=COALESCE(excluded.minimum_amount,bills.minimum_amount),details_json=CASE WHEN excluded.details_json<>'[]' THEN excluded.details_json ELSE bills.details_json END").bind(b.bank.trim(),Math.round(b.amount*100)/100,b.due_date,b.statement_date||null,extracted.minimum_amount??null,String(b.annual_fee_info??extracted.annual_fee_info??'').slice(0,12000),JSON.stringify(extracted.details||[]),email.subject,email.sender),
   env.DB.prepare("UPDATE incoming_emails SET status='parsed',reason=NULL,bank=?,bill_id=(SELECT id FROM bills WHERE bank=? AND due_date=?) WHERE id=?").bind(b.bank.trim(),b.bank.trim(),b.due_date,review[1]),
   env.DB.prepare('UPDATE attachments SET bill_id=(SELECT id FROM bills WHERE bank=? AND due_date=?) WHERE email_id=?').bind(b.bank.trim(),b.due_date,review[1]),
   env.DB.prepare('UPDATE bills SET card_last4=?,customer_name=? WHERE bank=? AND due_date=?').bind(card_last4,customer_name,b.bank.trim(),b.due_date)
  ]); return json({ok:true});
 }
 const match=url.pathname.match(/^\/api\/bills\/(\d+)\/(pay|unpay|pdf|logs)$/);
 if(match) {
  const id=Number(match[1]), action=match[2]; if(!Number.isSafeInteger(id)||id<1) return json({error:'无效账单 ID'},400);
  if(['pay','unpay'].includes(action) && request.method==='POST') {
   const paid=action==='pay'?1:0;
   const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO payment_logs(bill_id,action) SELECT id,? FROM bills WHERE id=? AND is_paid<>?").bind(action,id,paid),
    env.DB.prepare('UPDATE bills SET is_paid=?,paid_at=? WHERE id=? RETURNING id,is_paid,paid_at').bind(paid,paid?new Date().toISOString():null,id)
   ]); return result[1].results.length?json(result[1].results[0]):json({error:'账单不存在'},404);
  }
  if(action==='logs' && request.method==='GET') {const {results}=await env.DB.prepare('SELECT * FROM payment_logs WHERE bill_id=? ORDER BY id DESC LIMIT 100').bind(id).all();return json({logs:results});}
  if(action==='pdf' && request.method==='GET') { const {results}=await env.DB.prepare('SELECT id,filename FROM attachments WHERE bill_id=? ORDER BY id').bind(id).all(); const requested=url.searchParams.get('attachment'); const a=requested?results.find(a=>String(a.id)===requested):results[0]; return a?proxyPdf(a.id,env):json({error:'没有 PDF 附件'},404); }
 }
 const attachment=url.pathname.match(/^\/api\/attachments\/(\d+)$/); if(attachment && request.method==='GET') return proxyPdf(Number(attachment[1]),env);
 if(url.pathname==='/api/reminders/run'&&request.method==='POST') return json(await runReminders(env));
 if(url.pathname==='/api/notifications/test'&&request.method==='POST') {
  if(!env.NOTIFY_PROVIDER||env.NOTIFY_PROVIDER==='none')return json({error:'通知默认关闭，请先配置 NOTIFY_PROVIDER 和自己的通知服务'},503);
  try {await notify(env,'账单管家部署验证','这是一条测试通知，不代表有账单欠款。每天北京时间 09:00 检查临期及逾期账单。');return json({ok:true});}
  catch(error){console.error('notification_test_failed',{message:error.message});return json({error:'通知发送失败，请检查推送凭据和服务状态',detail:String(error.message).slice(0,240)},502);}
 }
 return json({error:'接口不存在'},404);
}
async function emailOutcome(env,id) {
 const row=await env.DB.prepare('SELECT e.status,e.reason,e.bank,e.bill_id,b.due_date,b.statement_date,b.amount FROM incoming_emails e LEFT JOIN bills b ON b.id=e.bill_id WHERE e.id=?').bind(id).first();
 if(!row)return json({error:'邮件处理后未找到收件记录，请稍后重试'},500);
 const parsed=row.status==='parsed';
 if(parsed)await env.DB.prepare("UPDATE incoming_emails SET status='ignored',bill_id=?,reason=? WHERE id<>? AND status='review' AND bank=? AND json_extract(extracted_json,'$.due_date')=? AND (json_extract(extracted_json,'$.statement_date') IS NULL OR json_extract(extracted_json,'$.statement_date')=?) AND (json_extract(extracted_json,'$.amount') IS NULL OR json_extract(extracted_json,'$.amount')=?)").bind(row.bill_id,'已由补充原文的同银行同还款日账单替代，保留旧收件记录；新收件记录：'+id,id,row.bank,row.due_date,row.statement_date,row.amount).run();
 return json({ok:parsed,status:row.status,email_id:id,bill_id:row.bill_id,bank:row.bank,reason:row.reason,message:parsed?'解析成功，账单已入库；重复账单不会叠加金额。':'解析已执行，仍需人工确认：'+(row.reason||'字段不完整')});
}
async function proxyPdf(id,env) {
 const row=await env.DB.prepare('SELECT object_key,filename FROM attachments WHERE id=?').bind(id).first(); if(!row) return json({error:'附件不存在'},404);
 const object=await env.BUCKET.get(row.object_key); if(!object) return json({error:'文件不存在'},404);
 return new Response(object.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="statement.pdf"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,'Content-Security-Policy':"sandbox; default-src 'none'"}});
}
async function handle(request,env) {
 const url=new URL(request.url);
 if(request.method==='POST' && !sameOrigin(request)) return json({error:'禁止跨站请求'},403);
 if(request.method==='POST' && Number(request.headers.get('Content-Length'))>(url.pathname==='/api/emails/import'?MAX_MAIL:32768)) return json({error:'请求过大'},413);
 if(url.pathname==='/api/login' && request.method==='POST') return login(request,env);
 if(url.pathname==='/api/logout' && request.method==='POST') return Response.json({ok:true},{headers:{'Set-Cookie':cookie('',0)}});
 const auth=await authorized(request,env);
 if(url.pathname==='/' && request.method==='GET') return new Response(auth?dashboard.replace('<!--RECURRING-->',recurringUI):loginPage,{headers:{'Content-Type':'text/html; charset=utf-8'}});
 if(!auth) return json({error:'请先登录'},401);
 return api(request,env,url);
}
export default {
 async fetch(request,env) {
  let result;try {result=await handle(request,env);}catch(error){console.error('request_failed',{name:error.name});result=json({error:'服务暂时不可用，请稍后重试'},500);}
  const headers=new Headers(result.headers);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Referrer-Policy','no-referrer');
  if(!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cdn.tailwindcss.com; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  return new Response(result.body,{status:result.status,headers});
 },
 async email(message,env) {try{await receiveEmail(message,env);}catch(error){console.error('email_failed',{name:error.name});throw error;}},
 async scheduled(controller,env,ctx) {ctx.waitUntil(runReminders(env,new Date(controller.scheduledTime)));}
};
