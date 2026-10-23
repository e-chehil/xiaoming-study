import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL(process.argv.includes('--built')?'../dist/':'../public/', import.meta.url)).replace(/[\\/]$/, '');
const basePath=process.env.XIAOMING_BASE_PATH||'/';
if(!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath))throw new Error('Invalid XIAOMING_BASE_PATH');
const identityPath=basePath+'__xiaoming_local__';
const identity = { app: 'xiaoming-study-local', root, version: 4 };
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'application/javascript', '.js': 'application/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.txt':'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    const requestPath=new URL(req.url,'http://localhost').pathname;
    if(basePath!=='/'&&requestPath==='/'){res.writeHead(302,{'Location':basePath});res.end();return;}
    if(!requestPath.startsWith(basePath)){res.writeHead(404);res.end();return;}
    const pathname='/'+decodeURIComponent(requestPath.slice(basePath.length));
    if(pathname.split('/').some(part=>part.startsWith('.'))){res.writeHead(403);res.end();return;}
    if (requestPath === identityPath) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(identity));
      return;
    }
    const path = resolve(root, '.' + pathname);
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const file = (await stat(path)).isDirectory() ? resolve(path, 'index.html') : path;
    const actual=await realpath(file);
    if(!actual.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    const info=await stat(file);
    if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});res.end();return;}
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch(error) { const status=error instanceof URIError?400:['ENOENT','ENOTDIR'].includes(error.code)?404:500;res.writeHead(status);res.end(status===404?'Not found':'Request failed'); }
});
const port = Number(process.env.XIAOMING_PORT || 47831);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('XIAOMING_PORT must be between 1 and 65535');
const origin=`http://127.0.0.1:${port}`;
const url=origin+basePath;
function openBrowser() {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/d', '/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Open ${url} in your browser.`));
  child.unref();
}
server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(origin + identityPath, { signal: AbortSignal.timeout(2000) });
      const running = response.ok ? await response.json() : null;
      if (running?.app === identity.app && running.root === root && running.version === identity.version) {
        console.log(`潇明习字已经运行。\nLocal: ${url}`);
        if (process.argv.includes('--open')) openBrowser();
        return;
      }
    } catch {}
    console.error(`端口 ${port} 被其他程序占用，未打开页面。请设置 XIAOMING_PORT 使用另一个固定端口。`);
  } else console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`\n  潇明习字\n  Local: ${url}\n  Ctrl+C to stop.\n`);
  if (process.argv.includes('--open')) openBrowser();
});
