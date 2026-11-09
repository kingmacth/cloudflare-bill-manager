const encoder=new TextEncoder();
export async function same(a,b) {
 const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s)));
 const [x,y]=await Promise.all([hash(a),hash(b)]); let d=0; for(let i=0;i<x.length;i++) d|=x[i]^y[i]; return d===0;
}
async function sign(value,secret) { const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']); return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export async function session(env) { const value=String(Date.now()+12*3600000); return value+'.'+await sign(value,env.AUTH_TOKEN); }
export async function authorized(request,env) {
 if(!env.AUTH_TOKEN) return false;
 const auth=request.headers.get('Authorization'); if(auth?.startsWith('Bearer ') && await same(auth.slice(7),env.AUTH_TOKEN)) return true;
 const value=request.headers.get('Cookie')?.match(/(?:^|;\s*)bills_session=([^;]+)/)?.[1];
 if(!value) return false; const [expires,signature]=value.split('.');
 return /^\d{13}$/.test(expires) && +expires>Date.now() && +expires<Date.now()+13*3600000 && !!signature && await same(signature,await sign(expires,env.AUTH_TOKEN));
}
export function cookie(value,age=43200) { return `bills_session=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`; }
export function sameOrigin(request) { const origin=request.headers.get('Origin'); return (!origin||origin===new URL(request.url).origin) && request.headers.get('Sec-Fetch-Site')!=='cross-site'; }
export async function login(request,env) {
 if(!env.AUTH_TOKEN) return Response.json({error:'服务尚未配置登录密钥'},{status:503});
 if(!sameOrigin(request)) return new Response(null,{status:403});
 const ip=request.headers.get('CF-Connecting-IP')||'local';
 const bucket=await sign(ip,env.AUTH_TOKEN)+':'+Math.floor(Date.now()/900000);
 const row=await env.DB.prepare('INSERT INTO login_attempts(bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,new Date(Date.now()+900000).toISOString()).first();
 if(row.attempts>10) return Response.json({error:'尝试过于频繁，请 15 分钟后再试'},{status:429});
 let body; try {body=await request.json();} catch{return Response.json({error:'请求格式错误'},{status:400});}
 if(typeof body.password!=='string'||body.password.length>512||!await same(body.password,env.LOGIN_PASSWORD||env.AUTH_TOKEN)) return Response.json({error:'密码错误'},{status:401});
 return Response.json({ok:true},{headers:{'Set-Cookie':cookie(await session(env))}});
}
