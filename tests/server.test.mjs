import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const entry=fileURLToPath(new URL('../scripts/serve.mjs',import.meta.url));
const root=fileURLToPath(new URL('../public/',import.meta.url)).replace(/[\\/]$/,'');

async function listen(server){
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return server.address().port;
}
async function close(server){
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
function launch(port){
  const child=spawn(process.execPath,[entry],{
    cwd:tmpdir(),
    env:{...process.env,PORT:'1',XIAOMING_PORT:String(port)},
    stdio:['ignore','pipe','pipe'],windowsHide:true,
  });
  let output='';
  child.stdout.on('data',chunk=>output+=chunk.toString());
  child.stderr.on('data',chunk=>output+=chunk.toString());
  return {child,output:()=>output,done:once(child,'exit')};
}
async function waitForOutput(run,text){
  const deadline=Date.now()+5000;
  while(!run.output().includes(text)){
    if(run.child.exitCode!==null||Date.now()>deadline)throw new Error(run.output()||'Server did not start');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}

test('local launcher identifies its own project, serves the right files from any working directory, and safely reuses its port',{timeout:15000},async()=>{
  const probe=http.createServer(),port=await listen(probe);await close(probe);
  const run=launch(port);
  try{
    await waitForOutput(run,'Local:');
    const url=`http://127.0.0.1:${port}`;
    const identity=await fetch(url+'/__xiaoming_local__').then(response=>response.json());
    assert.equal(identity.app,'xiaoming-study-local');assert.equal(identity.root,root);
    assert.match(await fetch(url).then(response=>response.text()),/<title>潇明习字<\/title>/);
    const duplicate=launch(port),[code]=await duplicate.done;
    assert.equal(code,0,duplicate.output());
    assert.match(duplicate.output(),/已经运行/);
  }finally{run.child.kill();await run.done;}
});

test('an occupied port belonging to another project is refused, even if it claims the same app name',{timeout:10000},async()=>{
  const foreign=http.createServer((req,res)=>{
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({app:'xiaoming-study-local',root:'another-project',version:4}));
  });
  const port=await listen(foreign);
  try{
    const run=launch(port),[code]=await run.done;
    assert.equal(code,1);assert.match(run.output(),/被其他程序占用，未打开页面/);
    assert.doesNotMatch(run.output(),/Local:/);
  }finally{await close(foreign);}
});
