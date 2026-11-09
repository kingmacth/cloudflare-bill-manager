import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),files=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isDirectory()){if(!['.git','node_modules','.wrangler','.local-config','.npm-cache'].includes(entry.name))walk(join(dir,entry.name));}else files.push(join(dir,entry.name));}}
const listed=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',windowsHide:true});
if(listed.status===0){for(const name of new Set(listed.stdout.split('\0').filter(Boolean)))files.push(join(root,name));}
else {for(const name of ['src','tests','scripts','.github'])walk(join(root,name));for(const name of ['README.md','LICENSE','package.json','package-lock.json','schema.sql','wrangler.toml','.gitignore','.dev.vars.example'])files.push(join(root,name));}
const errors=[];
for(const path of files){
 const name=relative(root,path).replaceAll('\\','/');
 if(/(?:^|\/)(?:ACCESS[^/]*|\.dev\.vars|\.env(?:\.[^/]+)?|\.secrets[^/]*|secrets[^/]*\.json)$/.test(name)&&!name.endsWith('.example'))errors.push(name+': private configuration filename');
 if(/\.(?:eml|pdf|db|sqlite[\w-]*|pem|key|zip)$/i.test(name))errors.push(name+': private data or archive file');
 const text=readFileSync(path,'utf8');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))errors.push(name+': private key');
 if(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/.test(text))errors.push(name+': GitHub credential');
 if(/\bAKIA[A-Z0-9]{16}\b/.test(text))errors.push(name+': cloud access key');
 if(/(?:C:\\Users\\|\/Users\/|\/home\/)[A-Za-z0-9_.-]+/.test(text))errors.push(name+': personal home path');
}
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Public source check passed: ${files.length} files; no private data files or common credential patterns.`);
