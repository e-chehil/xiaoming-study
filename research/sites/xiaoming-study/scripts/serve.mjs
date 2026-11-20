import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../dist/', import.meta.url)).replace(/[\\/]$/, '');
const identityPath = '/__xiaoming_local__';
const identity = { app: 'xiaoming-study-local', root, version: 4 };
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'application/javascript', '.js': 'application/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.tsv': 'text/tab-separated-values; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === identityPath) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(identity));
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(pathname));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const file = (await stat(path)).isDirectory() ? resolve(path, 'index.html') : path;
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const port = Number(process.env.XIAOMING_PORT || 47831);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('XIAOMING_PORT must be between 1 and 65535');
const url = `http://127.0.0.1:${port}`;
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
      const response = await fetch(url + identityPath, { signal: AbortSignal.timeout(2000) });
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
