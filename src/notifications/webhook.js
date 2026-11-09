function jsonSetting(value,label) {
 try {return JSON.parse(value);}catch {throw new Error(label+' must be valid JSON');}
}
function render(value,variables) {
 if(typeof value==='string')return value.replace(/\{\{(title|body|message|appUrl)\}\}/g,(_,key)=>variables[key]);
 if(Array.isArray(value))return value.map(item=>render(item,variables));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,render(item,variables)]));
 return value;
}
export async function sendWebhook({env,title,body,appUrl}) {
 if(!env.NOTIFY_WEBHOOK_URL)throw new Error('NOTIFY_WEBHOOK_URL is required');
 const url=new URL(env.NOTIFY_WEBHOOK_URL);
 if(url.protocol!=='https:'||url.username||url.password)throw new Error('Webhook URL must use HTTPS without embedded user credentials');
 const headers=new Headers({'Content-Type':'application/json'});
 if(env.NOTIFY_WEBHOOK_HEADERS) {
  const custom=jsonSetting(env.NOTIFY_WEBHOOK_HEADERS,'NOTIFY_WEBHOOK_HEADERS');
  if(!custom||Array.isArray(custom)||typeof custom!=='object')throw new Error('Webhook headers must be a JSON object');
  for(const [name,value] of Object.entries(custom)){if(typeof value!=='string')throw new Error('Webhook header values must be strings');headers.set(name,value);}
 }
 if(env.NOTIFY_WEBHOOK_TOKEN)headers.set('Authorization','Bearer '+env.NOTIFY_WEBHOOK_TOKEN);
 const variables={title,body,appUrl,message:[title,body,appUrl].filter(Boolean).join('\n')};
 const payload=env.NOTIFY_WEBHOOK_TEMPLATE?render(jsonSetting(env.NOTIFY_WEBHOOK_TEMPLATE,'NOTIFY_WEBHOOK_TEMPLATE'),variables):{title,body,url:appUrl};
 const response=await fetch(url,{method:'POST',redirect:'manual',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Webhook delivery failed (HTTP '+response.status+')');
}
