export const NETLIFY_HOST_COMMENT="<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n     like this one for free: https://netlify.new/?utm_campaign=loops&utm_source=ai-legible&utm_medium=owned&utm_content=comment&utm_id=8d00ddff-c6fd-4ae9-93a2-84ef4025e2fa\n     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->\n";
export async function verifyShellBytes(input,file){
  let bytes=input;
  if(file.path==='index.html'){
    const text=new TextDecoder('utf-8',{fatal:true}).decode(input);
    if(text.includes(NETLIFY_HOST_COMMENT))bytes=new TextEncoder().encode(text.replace(NETLIFY_HOST_COMMENT,''));
  }
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==file.bytes||sha!==file.sha256)throw new Error('离线页面校验失败');
  return bytes;
}
