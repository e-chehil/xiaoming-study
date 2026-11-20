import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {LESSON_TYPES,READING_SOURCES,STUDY_FILES,traditionalLabel} from '../dist/learning-schema.mjs';
import {displayCode} from '../dist/encoding.mjs';

const root=new URL('../',import.meta.url);
const hash=value=>createHash('sha256').update(value).digest('hex');
const traditionalMap=JSON.parse(await readFile(new URL('dist/vendor/ui-traditional-map.json',root),'utf8'));
const vocabulary=new Set(['char','word']);
const localized=(text,course)=>course==='traditional'?traditionalLabel(text,traditionalMap):text;
const cell=value=>{const text=String(value??'');return /[\t\r\n"]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
const tsv=(fields,rows)=>'\uFEFF'+[fields,...rows].map(row=>row.map(cell).join('\t')).join('\r\n')+'\r\n';

function decomposition(item){
  if(!vocabulary.has(item.type))return '';
  return item.parts.map(part=>(item.type==='word'?part.char+'：':'')+part.division.join('·')).join('；');
}
function note(item){
  const notes=[];
  if(item.type==='initial')notes.push('小码取声母');
  if(item.type==='stroke')notes.push('补码取首笔');
  if(item.type==='root'&&item.mapping?.smallSource==='stroke')notes.push('无音字根；小码取补码');
  if(item.extension)notes.push('扩展字根');
  if(item.practiceAlias)notes.push('与同形同码字根共用练习');
  if(item.readingSource==='inferred')notes.push('读音待核对');
  if(!item.code)notes.push(item.unsupportedReason||'暂不可练');
  return notes.join('；');
}
function guide(data,course,files){
  const prefix=course==='traditional'?'繁中':'简中';
  const text=`# ${prefix}下载说明

本目录对应网站当前课程。表格均为 UTF-8（带 BOM）的 TSV，可用 Excel、WPS 或文本编辑器打开。

| 文件 | 内容 | 排序 |
| --- | --- | --- |
| ${files.path} | 基础、字根、汉字和词语，共 ${data.stats.total} 项 | 与网站学习路径一致 |
| ${files.words} | 当前课程的 ${data.stats.characters} 个汉字、${data.stats.words} 个词语 | 沿用学习路径中的字词顺序 |
| ${files.roots} | ${data.stats.roots} 个字根的大码、小码和补码 | 按完整字根编码排列 |

学习路径的类型统一为：声母、首笔、字根、汉字、词语。单字词合并在“汉字”中；“扩展字根”是备注，不再另列为类型。

学习序号是网站完整路径中的位置；字词序号只统计汉字和词语；字根序号是码表排列序号。前置学习序号引用同一份学习路径，空白表示没有直接前置项目。

练习编码与网站输入要求一致。字根练习完整三位 ASB；大码大写，小码和补码小写。同形同码的汉字与字根共用练习，原学习序号保留。字根表把三种码分别列出。

“字根拆分”按字形的完整拆分列出，词语逐字标记；词语取码只使用其中部分字根，编码规则以网站练习和详情为准。少数字根使用潇明专用字形，可在网站字根页对照。

“词频序号”来自各自原词表，不是本网站学习顺序，也不能直接横向比较简繁两种语料。注音、拼音、读音来源一并保留；“自动推读”尚未经人工核对。空白编码表示原条目暂不可练，原因见备注。

${course==='traditional'?`繁中选词：保留可直接练习的分级词；其他词须有教育部或 CC-CEDICT 的精确繁体词头，且原平均每百万词频不少于 0.2。随后补齐组成汉字。0.2 是本项目的教学阈值，不是官方词汇界线。当前为 ${data.stats.characters+data.stats.words} 个字词单位；未入选的原始观察值保留为历史资料，不在本表中。

繁中旧文件“完整繁中字詞學習表.tsv”是筛选前的历史清单，包含未入选项目，不能作为当前课程顺序使用。`: `简中保留原学习表的字词身份，词频更新为本地 GitHub 复核源表；映射、字根、汉字和词语共同参与统一依赖图优化。原身份清单保留原样，不代表当前学习顺序。`}

来源：[潇明输入法](https://shurufa.app/ime/xiaoming)、${course==='traditional'?'[国教院词表](https://coct.naer.edu.tw/page.jsp?ID=41)、教育部《重編國語辭典修訂本》。':'用户提供的《现代汉语常用词表》学习表。'}英文词典可在网站“中英词典”中单独查询和下载。

另有“${files.transfer}”，包含 ${data.transferStats?.short||0} 项简码及 ${data.transferStats?.variant||0} 项台湾兼容字形。它们是独立迁移训练，前置学习序号引用主学习路径。␣ 表示必须按空格上屏；一键固定简码及二、三码按满即上屏。简码按固定官方码表精确匹配，不由简繁转换推测；字形课对照官方默认与台湾兼容拆分。\n\n这些表格用于学习和查阅。浏览器学习进度请在“设置”中另行导出 JSON 备份。
`;
  // This guide contains labels and references, not lesson glyph records.
  return localized(text,course);
}

export async function exportStudy(course){
  const directory=new URL(course==='traditional'?'dist/data/traditional/':'dist/data/',root);
  const runtime=await readFile(new URL('learning.json',directory));
  const data=JSON.parse(runtime),files=STUDY_FILES[course],output=new URL('exports/',directory);
  await mkdir(output,{recursive:true});
  const tr=value=>localized(value,course),type=item=>tr(LESSON_TYPES[item.type]);
  const content=item=>['initial','stroke'].includes(item.type)?tr(item.text):item.text;
  const pronunciation=item=>item.type==='initial'?item.aliases.join(' / '):item.displayPinyin||item.pinyin||'';
  const zhuyin=item=>item.type==='initial'&&item.initial!=='0'?item.text:item.zhuyin||'';
  const reading=item=>tr(READING_SOURCES[item.readingSource]||'');
  const orderById=new Map(data.items.map(item=>[item.id,item.order]));
  const heads={
    path:['学习序号','类型','内容','注音','拼音','练习编码','字根全码','字根拆分','前置学习序号','读音来源','备注'],
    words:['字词序号','学习序号','类型','字词','注音','拼音','编码','字根拆分','词频序号','读音来源','备注'],
    roots:['字根序号','字根','注音','拼音','大码','小码','补码','首笔','学习序号','备注'],
  };
  const rows={
    path:data.items.map(item=>[item.order,type(item),content(item),zhuyin(item),pronunciation(item),displayCode(item),item.fullCode?displayCode(item,item.fullCode,true):'',decomposition(item),item.dependencies.map(id=>orderById.get(id)).join(' '),reading(item),tr(note(item))]),
    words:data.items.filter(item=>vocabulary.has(item.type)).map((item,index)=>[index+1,item.order,type(item),item.text,item.zhuyin||'',item.displayPinyin||item.pinyin||'',displayCode(item),decomposition(item),item.frequency||'',reading(item),tr(note(item))]),
    roots:data.items.filter(item=>item.type==='root').sort((a,b)=>a.fullCode.localeCompare(b.fullCode)||a.id-b.id).map((item,index)=>[index+1,item.text,item.zhuyin||'',item.pinyin||'',item.fullCode[0].toUpperCase(),item.fullCode[1],item.fullCode[2],tr(item.mapping?.stroke||''),item.order,tr(note(item))]),
  };
  heads.transfer=['训练序号','类型','字词','练习编码','完整取码','上屏方式','前置学习序号','注音','拼音'];
  const baseIndex=new Map(data.items.map(item=>[item.id,item]));
  rows.transfer=(data.transferItems||[]).map((item,i)=>[i+1,type(item),item.text,displayCode(item),displayCode(baseIndex.get(item.baseId)),tr(item.type==='variant'?'台湾兼容全码':item.commit==='space'?'字母后加空格':'按键即上屏'),item.dependencies.map(id=>orderById.get(id)).join(' '),item.zhuyin||'',item.pinyin||'']);
  const manifest={version:1,course,curriculumVersion:data.curriculumVersion,sourceSha256:data.source.sha256,runtimeSha256:hash(runtime),types:Object.fromEntries(Object.entries(LESSON_TYPES).map(([key,value])=>[key,tr(value)])),files:{}};
  for(const key of ['path','words','roots','transfer']){
    const content=tsv(heads[key].map(tr),rows[key]);await writeFile(new URL(files[key],output),content,'utf8');
    manifest.files[key]={name:files[key],rows:rows[key].length,columns:heads[key].map(tr),sha256:hash(content)};
  }
  const text=guide(data,course,files);await writeFile(new URL(files.guide,output),text,'utf8');
  manifest.files.guide={name:files.guide,sha256:hash(text)};
  await writeFile(new URL('manifest.json',output),JSON.stringify(manifest,null,2)+'\n','utf8');
  console.log(`${course}: learning path ${rows.path.length}; words ${rows.words.length}; roots ${rows.roots.length}; ${fileURLToPath(output)}`);
  return manifest;
}

if(process.argv[1]===fileURLToPath(import.meta.url))for(const course of ['simplified','traditional'])await exportStudy(course);
