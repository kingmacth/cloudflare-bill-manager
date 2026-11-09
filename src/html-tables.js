export function htmlToText(html='') {
 return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(?:td|th)>/gi,' | ').replace(/<(?:br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160);/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n<=0x10ffff ? +n : 32)).replace(/[\t \r]+/g,' ');
}
export function extractTableRows(html='') {
 const rows=[],rowStack=[],cellStack=[],tables=[];let serial=0;
 for(const part of html.match(/<[^>]*>|[^<]+/g)||[]) {
  if(/^<table\b/i.test(part)){tables.push(++serial);continue;}
  if(/^<\/table\b/i.test(part)){tables.pop();continue;}
  if(/^<tr\b/i.test(part)){rowStack.push({table:tables.at(-1)||0,cells:[]});continue;}
  if(/^<\/tr\b/i.test(part)){const row=rowStack.pop();if(row?.cells.length)rows.push(row);continue;}
  if(/^<t[dh]\b/i.test(part)){cellStack.push({row:rowStack.at(-1),parts:[]});continue;}
  if(/^<\/t[dh]\b/i.test(part)){const cell=cellStack.pop();if(cell?.row)cell.row.cells.push(htmlToText(cell.parts.join('')).trim());continue;}
  if(cellStack.length)cellStack.at(-1).parts.push(part);
 }
 return rows;
}
