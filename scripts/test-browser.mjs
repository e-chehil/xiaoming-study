import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const suites=['browser-local.mjs','design-local.mjs','lesson-ui.mjs','integrity-browser.mjs','courses-browser.mjs','filtered-practice-browser.mjs','cedict-browser.mjs','teaching-browser.mjs','frontend-layout.mjs','release-browser.mjs','offline-browser.mjs'];
const selected=process.argv.slice(2);if(selected.some(name=>!suites.includes(name)))throw new Error('Unknown browser suite');
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,XIAOMING_PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
try{
  const deadline=Date.now()+15000;while(!output.includes('Local:')){if(server.exitCode!==null||Date.now()>deadline)throw new Error('Preview server failed: '+output);await new Promise(resolve=>setTimeout(resolve,25));}
  for(const suite of selected.length?selected:suites){
    console.log('\nBrowser: '+suite);
    const child=spawn(process.execPath,['tests/'+suite],{cwd:root,env:{...process.env,TEST_URL:'http://127.0.0.1:'+port},stdio:'inherit',windowsHide:true});
    const [code]=await once(child,'exit');if(code!==0)throw new Error(suite+' failed with exit '+code);
  }
}finally{if(server.exitCode===null){server.kill();await once(server,'exit');}}
