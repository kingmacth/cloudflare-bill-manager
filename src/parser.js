import {htmlToText,extractTableRows} from './html-tables.js';
export {htmlToText} from './html-tables.js';
﻿export function chinaDay(now = new Date()) { return new Date(+now + 8 * 3600000).toISOString().slice(0, 10); }
export function dayDiff(a,b) { return Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000); }
export function parseDate(value, reference = chinaDay()) {
 const m = String(value || '').match(/(?:(20\d{2})\s*[年/.-]\s*)?(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/);
 if(!m) return null;
 let year = m[1] ? +m[1] : +reference.slice(0,4);
 let result = `${year}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
 if(!m[1] && dayDiff(result,reference)<-180) result = `${++year}${result.slice(4)}`;
 if(!m[1] && dayDiff(result,reference)>180) result = `${--year}${result.slice(4)}`;
 const d = new Date(result+'T00:00:00Z');
 return !Number.isNaN(+d) && d.toISOString().slice(0,10)===result ? result : null;
}

const banks = [ ['招商银行',/招商银行|招行|cmbchina|cmb\.china/i], ['中信银行',/中信银行|中信信用卡|citicbank|creditcard\.citic/i], ['广发银行',/广发银行|广发信用卡|cgbchina|gdb\.com/i], ['建设银行',/建设银行|建行|ccb\.com/i], ['工商银行',/工商银行|工行|icbc\.com/i], ['平安银行',/平安银行|平安信用卡|pingan\.com/i], ['交通银行',/交通银行|交行|bankcomm/i], ['中国银行',/中国银行|boc\.cn/i], ['农业银行',/农业银行|农行|abchina/i], ['兴业银行',/兴业银行|cib\.com/i], ['浦发银行',/浦发银行|浦发信用卡|spdb/i], ['民生银行',/民生银行|cmbc\.com/i], ['光大银行',/光大银行|cebbank/i] ];
const money = '(?:人民币|RMB|CNY|[¥￥])?\\s*([+-]?\\d[\\d,，]*(?:\\.\\d{1,2})?)';
export function parseAmount(v) { const n = Number(String(v).replace(/[,，\s]/g,'')); return Number.isFinite(n) && n>=0 && n<=1e10 ? Math.round(n*100)/100 : null; }
function amountAfter(text, labels) {
 for(const label of labels) {
  const re=new RegExp('(?:'+label+')','ig');let m;
  while((m=re.exec(text))) {
   let tail=text.slice(re.lastIndex,re.lastIndex+300);
   const prefix=/^(?:[\s:：|()（）]+|人民币|RMB|CNY|元|金额|总额|全额|New\s*Balance|Total\s*Payment(?:\s*Due)?|Min\.?\s*Payment|Minimum\s*Payment(?:\s*Due)?|欠款为[-－]?)/i;
   for(let i=0;i<80;i++){const skip=tail.match(prefix);if(!skip)break;tail=tail.slice(skip[0].length);}
   const value=tail.match(/^[¥￥]?\s*([+-]?\d[\d,，]*(?:\.\d{1,2})?)(?![\d.*Xx•·●/-])/);
   if(value) {const n=parseAmount(value[1]);if(n!==null)return n;}
  }
 }
 return null;
}
function dateAfter(text,label,reference) { const m=text.match(new RegExp('(?:'+label+')(?:[\\s:：|()（）]|Payment\\s*Due\\s*Date|Statement\\s*(?:Closing\\s*)?Date){0,100}((?:20\\d{2}\\s*[年/.-]\\s*)?\\d{1,2}\\s*[月/.-]\\s*\\d{1,2}\\s*日?)','i')); return m ? parseDate(m[1],reference) : null; }
export function extractIdentity(body='') {
 const tails=new Set();
 for(const m of body.matchAll(/(?:尾号|末四位|末4位|后四位|后4位)\s*(?:为|是)?[\s:：|（(]*([0-9]{4})(?![0-9])/g)) tails.add(m[1]);
 for(const m of body.matchAll(/(?:信用卡卡号|信用卡号|卡号|Card\s*(?:No\.?|Number))[\s:：|]*((?:[0-9*Xx•·●-][\t ]*){4,35})/gi)) {
  const value=m[1].replace(/[\s-]/g,'');const tail=value.match(/([0-9]{4})$/)?.[1];
  if(tail && (/[*Xx•·●]/.test(value)||/^\d{4}$|^\d{13,19}$/.test(value))) tails.add(tail);
 }
 for(const m of body.matchAll(/\d{4}[- ]*[\d*Xx•·●-]*[*Xx•·●][\d*Xx•·● -]*\d{4}/g)){const tail=m[0].match(/(\d{4})$/)?.[1];if(tail)tails.add(tail);}
 const explicit=body.match(/(?:^|[\n|])\s*(?:客户姓名|持卡人姓名|持卡人|客户名称)\s*[:：|]\s*([\p{L}*＊·.\t ]{2,40})(?=$|[\n|:：])/u)?.[1]?.trim();
 const salutation=body.match(/尊敬的\s*([\p{L}*＊·.\t ]{1,40}?)\s*(?:先生|女士|小姐|：|:|，|,)/u)?.[1]?.trim();
 const candidate=(salutation||explicit||'').replace(/\s*(先生|女士|小姐)\s*$/,'').slice(0,60);
 const customer_name=/^(?:客户|用户|客户您好|用户您好|持卡人)$/.test(candidate)?'':candidate;
 return {card_last4:[...tails].join(','),customer_name};
}
export function extractBill({sender='',subject='',text='',html=''},reference=chinaDay()) {
 const body = htmlToText(html)+'\n'+text;
 const bank = banks.find(([,re])=>re.test(sender+' '+subject+' '+body))?.[0] || null;
 let amount=amountAfter(body,['本期应还款(?:总)?(?:金额|额)','本期账单(?:总额|金额)','本期应还(?:金额|款额)?','应还款总额','本期还款总额','本期全部应还款额','人民币应还款额','账单总金额','全额应还款(?:额)?','Total Payment Due']);
 let minimum_amount=amountAfter(body,['本期最低应还金额','本期最低还款金额','最低还款额','本期最低还款(?:额)?','Minimum Payment Due']);
 const due_date=dateAfter(body,'到期还款日|最后还款日|还款截止日|本期还款日|Payment Due Date',reference);
 let statement_date=dateAfter(body,'本期账单日|账单日期|账单日|对账单生成日|Statement Date',reference);
 if(!statement_date){const cycle=body.match(/账单周期[\s\S]{0,60}?((?:20\d{2}[年/.-])\d{1,2}[月/.-]\d{1,2}日?)\s*[-—至~～]\s*((?:20\d{2}[年/.-])\d{1,2}[月/.-]\d{1,2}日?)/);if(cycle)statement_date=parseDate(cycle[2],reference);}
 const lines=body.split('\n').map(x=>x.trim()).filter(Boolean);
 const annual_fee_info=[...new Set(lines.filter(x=>/年费|annual\s*fee/i.test(x)).map(x=>x.replace(/^\s*\|\s*/,'').replace(/\s*\|\s*$/,'').slice(0,600)))].slice(0,20).join('\n');
 const details=[];
 for(const line of lines) {
  const m=line.match(/^((?:20\d{2}[年/.-])?\d{1,2}[月/.-]\d{1,2}日?)\s*\|?\s*(.+?)\s+[| ]\s*([+-]?[\d,，]+\.\d{2})(?:\s*(?:元|CNY|RMB))?\s*\|?$/);
  if(m) { const date=parseDate(m[1],statement_date||reference); const value=Number(m[3].replace(/[,，]/g,'')); if(date && Number.isFinite(value)) details.push({date,description:m[2].replace(/\s*\|\s*/g,' ').slice(0,300),amount:value}); }
 }
 const identity=extractIdentity(body),rows=extractTableRows(html);
 const tableResult=extractBankTables(bank,rows,body,statement_date||due_date||reference);
 if(tableResult.amount!==null)amount=tableResult.amount;
 if(tableResult.minimum_amount!==null)minimum_amount=tableResult.minimum_amount;
 if(amount!==null&&minimum_amount!==null&&minimum_amount>amount)minimum_amount=null;
 identity.card_last4=[...new Set([...identity.card_last4.split(','),...tableResult.tails].filter(Boolean))].join(',');
 return {bank,amount,minimum_amount,due_date,statement_date,annual_fee_info,...identity,details:(tableResult.details.length?tableResult.details:details).slice(0,1000)};
}

function transactionDate(value,reference) {
 const s=value.trim();if(/^\d{6}$/.test(s))return parseDate(`20${s.slice(0,2)}-${s.slice(2,4)}-${s.slice(4,6)}`,reference);
 if(/^\d{4}$/.test(s))return parseDate(`${s.slice(0,2)}/${s.slice(2,4)}`,reference);
 return parseDate(s,reference);
}
function signedMoney(value) {
 if(/USD|美元|FCY|\$/i.test(value)&&!/^\s*[¥￥]/.test(value))return null;
 const m=value.replace(/[,，]/g,'').match(/(?:[¥￥]|CNY|RMB)?\s*([+-]?\d+\.\d{2})(?!\d)/i);return m?Number(m[1]):null;
}
function extractBankTables(bank,rows,body,reference) {
 const details=[],tails=new Set();let amount=null,minimum_amount=null;
 for(let i=0;i<rows.length;i++) {
  const cells=rows[i].cells.map(s=>s.replace(/\s+/g,' ').trim());
  if(bank==='建设银行'&&cells.length===4&&/账户币种/.test(cells[0])&&/本期全部应还款额/.test(cells[1])&&/最低还款额/.test(cells[2])) {
   for(let j=i+1;j<rows.length&&rows[j].table===rows[i].table;j++) {
    const c=rows[j].cells;if(c.length!==4||!/人民币|CNY/.test(c[0]))continue;
    const value=signedMoney(c[1]),minimum=signedMoney(c[2]);if(value!==null){amount=Math.max(0,value);minimum_amount=minimum;break;}
   }
  }
  if(bank==='工商银行' && cells.some(c=>/^应还款额$/.test(c)) && cells.some(c=>/^最低还款额$/.test(c))) {
   const a=cells.findIndex(c=>c==='应还款额'),m=cells.findIndex(c=>c==='最低还款额');let sum=0,min=0,found=false;
   for(let j=i+1;j<rows.length && rows[j].table===rows[i].table;j++) {
    const c=rows[j].cells;if(!/人民币|RMB|CNY/.test(c.join(' ')))continue;
    const value=signedMoney(c[a]||''),minimum=signedMoney(c[m]||'');if(value===null)continue;
    if(c[0]?.trim()==='合计'){amount=Math.max(0,value);minimum_amount=minimum;found=false;break;}
    if(/^\d{4}/.test(c[0]||'')){tails.add(c[0].slice(0,4));sum+=value;min+=minimum||0;found=true;}
   }
   if(found){amount=Math.max(0,Math.round(sum*100)/100);minimum_amount=Math.round(min*100)/100;}
  }
  let date,posting_date,description,value,tail;
  if(bank==='工商银行'&&cells.length===7&&/^\d{4}$/.test(cells[0])&&/^20\d{2}-\d{2}-\d{2}$/.test(cells[1])) {
   [tail,date,posting_date]=cells;description=cells[3]+' · '+cells[4];value=signedMoney(cells[6]);if(value!==null&&/存入/.test(cells[6]))value=-Math.abs(value);
  } else if(bank==='农业银行'&&cells.length===6&&/^\d{6}$/.test(cells[0])&&/^\d{6}$/.test(cells[1])&&/^\d{4}$/.test(cells[2])) {
   date=transactionDate(cells[0],reference);posting_date=transactionDate(cells[1],reference);tail=cells[2];description=cells[3];const settled=signedMoney(cells[5]);value=settled===null?null:-settled;
  } else if(bank==='建设银行'&&cells.length===8&&/^20\d{2}-\d{2}-\d{2}$/.test(cells[0])&&/^\d{4}$/.test(cells[2])&&/^CNY$/.test(cells[6])) {
   date=cells[0];posting_date=cells[1];tail=cells[2];description=cells[3];value=signedMoney(cells[7]);
  } else if(bank==='招商银行'&&cells.length===8&&/^\d{4}$/.test(cells[2])&&/^\d{4}$/.test(cells[5])&&/^[¥￥]/.test(cells[4])) {
   date=transactionDate(cells[1]||cells[2],reference);posting_date=transactionDate(cells[2],reference);description=cells[3];value=signedMoney(cells[4]);tail=cells[5];
  }
  if(date&&value!==null&&value!==undefined) {date=transactionDate(date,reference);if(date){details.push({date,posting_date:transactionDate(posting_date||date,reference),description:description.slice(0,300),amount:value,card_last4:tail});if(tail)tails.add(tail);}}
 }
 if(bank==='民生银行') {
  const flat=body.replace(/\|/g,' ').replace(/\s+/g,' ');
  const re=/(\d{1,2}\/\d{1,2})\s+(\d{1,2}\/\d{1,2})\s+([^\d|]{2,160}?)\s+([+-]?\d[\d,]*\.\d{2})\s+(\d{4})(?!\d)/g;let m;
  while((m=re.exec(flat))){const date=transactionDate(m[1],reference);if(date){details.push({date,posting_date:transactionDate(m[2],reference),description:m[3].trim(),amount:Number(m[4].replace(/,/g,'')),card_last4:m[5]});tails.add(m[5]);}}
 }
 const seen=new Set();return {amount,minimum_amount,tails:[...tails],details:details.filter(d=>{const key=JSON.stringify(d);if(seen.has(key))return false;seen.add(key);return true;})};
}
