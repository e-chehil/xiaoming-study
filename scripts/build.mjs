import {copyFile,mkdir,rm,writeFile} from 'node:fs/promises';
import {resolve,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkRelease} from './check-release.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(root,'dist');
if(output!==resolve(root,'dist')||!output.startsWith(resolve(root)+sep))throw new Error('Invalid build directory');
const manifest=await checkRelease();
await rm(output,{recursive:true,force:true});await mkdir(output);
const assets=manifest.files.filter(f=>f.path.startsWith('public/')).map(f=>({...f,path:f.path.slice(7)}));
for(const asset of assets){const path=resolve(output,asset.path);if(!path.startsWith(output+sep))throw new Error('Invalid asset path');await mkdir(dirname(path),{recursive:true});await copyFile(new URL('../public/'+asset.path,import.meta.url),path);}
await writeFile(resolve(output,'asset-manifest.json'),JSON.stringify({version:manifest.version,files:assets},null,2)+'\n');
console.log('Static site built: '+output+' ('+assets.length+' assets)');
