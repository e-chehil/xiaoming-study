import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('../release-files.json',import.meta.url),'utf8'));
const ignored=new Set(['offline-shell.mjs','.nojekyll','data/learning-runtime.json','data/traditional/learning-runtime.json','data/cedict/dictionary.json']);
const files=[];
for(const item of manifest.files.filter(f=>f.path.startsWith('public/')).sort((a,b)=>a.path.localeCompare(b.path))){
  const path=item.path.slice(7);if(ignored.has(path))continue;
  const bytes=await readFile(new URL('../'+item.path,import.meta.url));files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const version=createHash('sha256').update(JSON.stringify(files)).digest('hex');
const content='export const SHELL_VERSION='+JSON.stringify(version)+';\nexport const SHELL_FILES='+JSON.stringify(files,null,2)+';\n';
const target=new URL('../public/offline-shell.mjs',import.meta.url);
if(process.argv.includes('--check')){if(await readFile(target,'utf8')!==content)throw new Error('Offline shell manifest is stale; run node scripts/update-offline.mjs');}
else await writeFile(target,content);
