import {chinaDay,parseDate} from './parser.js';
export function dueInMonth(year,month,day) {
 const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 return `${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;
}
export function nextDue(date,interval,day) {const d=new Date(date+'T00:00:00Z');const month=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+interval,1));return dueInMonth(month.getUTCFullYear(),month.getUTCMonth(),day);}
export function validateSchedule(input) {
 if(!input||typeof input!=='object')throw new Error('无效周期账单');
 const string=(key,max,required=false)=>{const s=String(input[key]??'').trim();if(s.length>max||(required&&!s))throw new Error('请填写有效的账单名称和机构信息');return s;};
 const amount=input.amount, interval_months=input.interval_months??1,due_day=input.due_day;
 if(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>1e10)throw new Error('每期金额无效');
 if(!Number.isInteger(interval_months)||interval_months<1||interval_months>120||!Number.isInteger(due_day)||due_day<1||due_day>31)throw new Error('周期或扣款日无效');
 const start_date=input.start_date,end_date=input.end_date||null;
 if(typeof start_date!=='string'||parseDate(start_date)!==start_date||(end_date&&(typeof end_date!=='string'||parseDate(end_date)!==end_date||end_date<start_date)))throw new Error('起止日期无效');
 const card_last4=string('card_last4',32);if(card_last4&&!/^\d{4}(?:,\d{4})*$/.test(card_last4))throw new Error('请只输入银行卡后四位，多张卡用英文逗号分隔');
 const category=input.category||'mortgage';if(!['mortgage','recurring'].includes(category))throw new Error('账单类型无效');
 const d=new Date(start_date+'T00:00:00Z');let next_due_date=dueInMonth(d.getUTCFullYear(),d.getUTCMonth(),due_day);if(next_due_date<start_date)next_due_date=nextDue(next_due_date,interval_months,due_day);
 if(end_date&&next_due_date>end_date)throw new Error('起止日期之间没有符合扣款日的账单');
 return {name:string('name',80,true),institution:string('institution',80),customer_name:string('customer_name',60),card_last4,category,amount:Math.round(amount*100)/100,interval_months,due_day,start_date,end_date,next_due_date};
}
export async function materializeRecurring(env,now=new Date()) {
 const horizon=new Date(Date.parse(chinaDay(now)+'T00:00:00Z')+35*86400000).toISOString().slice(0,10);
 const {results}=await env.DB.prepare('SELECT * FROM recurring_schedules WHERE is_active=1 AND next_due_date<=? ORDER BY id').bind(horizon).all();
 let generated=0;
 for(const schedule of results) {
  let cursor=schedule.next_due_date;let count=0;
  while(cursor<=horizon&&(!schedule.end_date||cursor<=schedule.end_date)&&count<600) {
   const next=nextDue(cursor,schedule.interval_months,schedule.due_day);
   const result=await env.DB.batch([
    env.DB.prepare("INSERT INTO bills(bank,amount,due_date,statement_date,card_last4,customer_name,category,display_name,schedule_id) SELECT ?,amount,?,NULL,card_last4,customer_name,category,name||CASE WHEN institution<>'' THEN ' · '||institution ELSE '' END,id FROM recurring_schedules WHERE id=? AND is_active=1 AND next_due_date=? ON CONFLICT(bank,due_date) DO NOTHING").bind(`__recurring_${schedule.id}`,cursor,schedule.id,cursor),
    env.DB.prepare('UPDATE recurring_schedules SET next_due_date=? WHERE id=? AND is_active=1 AND next_due_date=?').bind(next,schedule.id,cursor)
   ]);
   generated+=result[0].meta.changes||0;cursor=next;count++;
  }
 }
 return {generated};
}
export async function recurringAPI(request,env,url) {
 if(url.pathname==='/api/recurring'&&request.method==='GET') {await materializeRecurring(env);const {results}=await env.DB.prepare('SELECT * FROM recurring_schedules ORDER BY is_active DESC,id DESC').all();return Response.json({schedules:results});}
 if(url.pathname==='/api/recurring'&&request.method==='POST') {
  let input;try{input=await request.json();}catch{return Response.json({error:'无效 JSON'},{status:400});}
  let s;try{s=validateSchedule(input);}catch(e){return Response.json({error:e.message},{status:400});}
  const result=await env.DB.prepare('INSERT INTO recurring_schedules(name,institution,customer_name,card_last4,category,amount,interval_months,due_day,start_date,end_date,next_due_date) VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING *').bind(s.name,s.institution,s.customer_name,s.card_last4,s.category,s.amount,s.interval_months,s.due_day,s.start_date,s.end_date,s.next_due_date).first();
  await materializeRecurring(env);return Response.json({schedule:result},{status:201});
 }
 const match=url.pathname.match(/^\/api\/recurring\/(\d+)$/);
 if(match&&request.method==='PATCH') {
  let body;try{body=await request.json();}catch{return Response.json({error:'无效 JSON'},{status:400});}
  const row=await env.DB.prepare('SELECT * FROM recurring_schedules WHERE id=?').bind(Number(match[1])).first();if(!row)return Response.json({error:'周期账单不存在'},{status:404});
  if(body.is_active!==undefined&&![0,1].includes(body.is_active))return Response.json({error:'无效状态'},{status:400});
  if(body.amount!==undefined&&(typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<0||body.amount>1e10))return Response.json({error:'无效金额'},{status:400});
  if(body.is_active!==undefined) {
   if(![0,1].includes(body.is_active))return Response.json({error:'无效状态'},{status:400});
   await env.DB.prepare('UPDATE recurring_schedules SET is_active=? WHERE id=?').bind(body.is_active,row.id).run();
  }
  if(body.amount!==undefined) {
   if(typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<0||body.amount>1e10)return Response.json({error:'无效金额'},{status:400});
   const amount=Math.round(body.amount*100)/100;
   await env.DB.batch([env.DB.prepare('UPDATE recurring_schedules SET amount=? WHERE id=?').bind(amount,row.id),env.DB.prepare('UPDATE bills SET amount=? WHERE schedule_id=? AND is_paid=0 AND due_date>=?').bind(amount,row.id,chinaDay())]);
  }
  await materializeRecurring(env);return Response.json({ok:true});
 }
 return null;
}
