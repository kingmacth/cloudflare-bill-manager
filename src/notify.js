import {notificationProviders} from './notifications/index.js';
export async function notify(env,title,body) {
 const provider=env.NOTIFY_PROVIDER||'none';
 if(provider==='none')throw new Error('Notifications are disabled. Configure NOTIFY_PROVIDER first.');
 const send=Object.hasOwn(notificationProviders,provider)?notificationProviders[provider]:null;
 if(typeof send!=='function')throw new Error('Unknown notification provider: '+provider);
 await send({env,title,body,appUrl:env.APP_URL||''});
}
