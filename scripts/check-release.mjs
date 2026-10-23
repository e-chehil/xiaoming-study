import {readFile,readdir,lstat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const ignored=new Set(['.git','node_modules','dist','artifacts','.cache','.local','__pycache__']);
export async function sourceFiles(directory=root){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(ignored.has(entry.name)||entry.name.endsWith('.pyc'))continue;
    const path=resolve(directory,entry.name),info=await lstat(path);
    assert.ok(!info.isSymbolicLink(),'Release source cannot contain symlinks: '+relative(root,path));
    if(info.isDirectory())files.push(...await sourceFiles(path));else files.push(relative(root,path).split(sep).join('/'));
  }
  return files.sort();
}
export async function checkRelease(){
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const manifest=JSON.parse(await readFile(new URL('../release-files.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,pkg.version);assert.equal(new Set(manifest.files.map(f=>f.path)).size,manifest.files.length);
  assert.deepEqual(await sourceFiles(),[...manifest.files.map(f=>f.path),'release-files.json'].sort(),'Unexpected or missing source files');
  if(existsSync(resolve(root,'.git'))){
    const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();
    if(tracked.length)assert.deepEqual(tracked,[...manifest.files.map(f=>f.path),'release-files.json'].sort(),'Git index differs from the explicit release list');
  }
  let size=0;
  for(const record of manifest.files){
    assert.ok(!record.path.startsWith('/')&&!record.path.split('/').includes('..'));
    const path=resolve(root,record.path);assert.ok(path.startsWith(resolve(root)+sep));const bytes=await readFile(path);size+=bytes.length;
    assert.ok(bytes.length<50*1024*1024,'Oversized release file: '+record.path);
    assert.equal(bytes.length,record.bytes,record.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,record.path);
    if(/\.(?:mjs|js|json|md|txt|html|css|py|ya?ml)$/.test(record.path)){
      const text=bytes.toString('utf8');
      for(const [name,pattern]of [['personal workstation path',/[A-Za-z]:[\\/](?:Users|Desktop|桌面)[\\/]/],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['GitHub credential',/gh[pousr]_[A-Za-z0-9]{30,}/],['AWS key',/AKIA[A-Z0-9]{16}/]])assert.ok(!pattern.test(text),name+' in '+record.path);
    }
  }
  assert.ok(size<80*1024*1024,'Review release size before publishing');
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.match(html,/Content-Security-Policy/);assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html),'Use an external script for CSP');
  console.log('Release source verified: '+manifest.files.length+' files, '+(size/1024/1024).toFixed(2)+' MiB');return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await checkRelease();
