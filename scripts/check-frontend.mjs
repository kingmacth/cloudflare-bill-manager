import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
for(const file of ['src/page.html','src/login.html','src/recurring-ui.html']) {
 const html=readFileSync(file,'utf8');
 for(const match of html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g))new Script(match[1],{filename:file});
 console.log(file,'inline JavaScript syntax valid');
}
