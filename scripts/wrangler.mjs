import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const cli=join(dirname(require.resolve('wrangler/package.json')),'bin','wrangler.js');
const config=existsSync(join(root,'wrangler.local.toml'))?'wrangler.local.toml':'wrangler.toml';
const [command='dev',...args]=process.argv.slice(2);
const result=spawnSync(process.execPath,[cli,command,'--config',config,...args],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error){console.error(result.error.message);process.exit(1)}
process.exit(result.status??1);
