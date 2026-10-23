import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const path=new URL('../release-files.json',import.meta.url),manifest=JSON.parse(await readFile(path,'utf8'));
for(const record of manifest.files){const bytes=await readFile(new URL('../'+record.path,import.meta.url));record.bytes=bytes.length;record.sha256=createHash('sha256').update(bytes).digest('hex');}
await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
console.log('Updated hashes for the existing explicit release file list.');
