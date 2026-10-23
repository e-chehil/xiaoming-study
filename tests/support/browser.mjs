import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
export function launchBrowser(options={}) {
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const executablePath=process.env.EDGE_PATH||(process.platform==='win32'&&existsSync(edge)?edge:undefined);
  return chromium.launch({headless:true,...(executablePath?{executablePath}:{}),...options});
}
