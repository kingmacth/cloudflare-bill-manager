import {chinaDay,dayDiff} from './parser.js';
import {materializeRecurring} from './recurring.js';
import {notify} from './notify.js';
const bytes=s=>new TextEncoder().encode(s).length;
export function reminderSummary(bills,day) {
 const total=bills.reduce((sum,b)=>sum+Math.round(b.amount*100),0)/100;
 let body=`${bills.length} 笔未还账单，合计 ¥${total.toFixed(2)}\n`;
 let shown=0;
 for(const bill of bills) {
  const days=dayDiff(bill.due_date,day);
  const state=days<0?'【逾期警告】':days===0?'【今日到期】':'【还款提醒】';
  const remaining=days<0?`逾期 ${-days} 天`:days===0?'今天到期':`剩余 ${days} 天`;
  const name=String(bill.display_name||bill.bank).slice(0,40).replace(/[\r\n]/g,' ');
  const line=`\n${state}${name}\n¥${bill.amount.toFixed(2)} · ${bill.due_date} · ${remaining}${bill.annual_fee_info?'\n⚠ 含年费相关信息，请查看账单':''}\n`;
  if(bytes(body+line)>1300)break;
  body+=line;shown++;
 }
 if(shown<bills.length)body+=`\n另有 ${bills.length-shown} 笔，请打开看板查看全部账单。`;
 return {title:'【每日账单还款提醒】',body};
}
export async function runReminders(env,now=new Date()) {
 await materializeRecurring(env,now);
 const day=chinaDay(now),channel=env.NOTIFY_PROVIDER||'none';
 await env.DB.prepare('DELETE FROM login_attempts WHERE expires_at<?').bind(now.toISOString()).run();
 if(channel==='none')return {sent:0,bill_count:0,disabled:true};
 const eligible=()=>env.DB.prepare("SELECT * FROM bills WHERE is_paid=0 AND amount>0 AND due_date<date(?, '+3 day') ORDER BY due_date,id").bind(day).all();
 if(!(await eligible()).results.length)return {sent:0,bill_count:0};
 const lease=new Date(Date.now()+300000).toISOString();
 const claim=await env.DB.prepare("INSERT INTO reminder_runs(day,channel,status,lease_until) VALUES (?,?,'sending',?) ON CONFLICT(day,channel) DO UPDATE SET status='sending',lease_until=excluded.lease_until,attempts=attempts+1 WHERE reminder_runs.status='failed' OR (reminder_runs.status='sending' AND reminder_runs.lease_until<?) RETURNING day").bind(day,channel,lease,new Date().toISOString()).first();
 if(!claim)return {sent:0,bill_count:0};
 const {results:bills}=await eligible();
 if(!bills.length){await env.DB.prepare("DELETE FROM reminder_runs WHERE day=? AND channel=? AND status='sending' AND lease_until=?").bind(day,channel,lease).run();return {sent:0,bill_count:0};}
 const summary=reminderSummary(bills,day);
 try {await notify(env,summary.title,summary.body);}
 catch(error) {
  await env.DB.prepare("UPDATE reminder_runs SET status='failed',bill_count=? WHERE day=? AND channel=? AND lease_until=?").bind(bills.length,day,channel,lease).run();
  console.error('daily_notification_failed',{day,channel,message:error.message});throw error;
 }
 const sentAt=new Date().toISOString();
 await env.DB.batch([
  env.DB.prepare("UPDATE reminder_runs SET status='sent',sent_at=?,bill_count=? WHERE day=? AND channel=? AND lease_until=?").bind(sentAt,bills.length,day,channel,lease),
  ...bills.map(bill=>env.DB.prepare("INSERT INTO notification_deliveries(bill_id,day,channel,status,lease_until,sent_at) VALUES (?,?,?,'sent',?,?) ON CONFLICT(bill_id,day,channel) DO UPDATE SET status='sent',lease_until=excluded.lease_until,sent_at=excluded.sent_at").bind(bill.id,day,channel,lease,sentAt))
 ]);
 return {sent:1,bill_count:bills.length};
}
