import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, '../outputs/learning_order_20261021');
const data = JSON.parse(await fs.readFile(path.join(output, 'workbook_data.json'), 'utf8'));
const report = JSON.parse(await fs.readFile(path.join(output, '校验与评估.json'), 'utf8'));
const workbook = Workbook.create();
console.log('Workbook initialized');
const ink = '#20364D', accent = '#7F4D2C', pale = '#F3EDE3';
const font = 'Arial';

function base(name, title, note, context) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRange('A1:H6').format.font = {name: font, size: 11, color: ink};
  sheet.getRange('A2').values = [[title]];
  sheet.getRange('A2').format.font = {name: font, size: 16, bold: true, color: ink};
  sheet.getRange('A2:H2').format.rowHeight = 29;
  sheet.getRange('A3:H3').format.borders = {bottom: {style: 'thin', color: '#C7CFD7'}};
  sheet.getRange('A3').values = [[note]];
  sheet.getRange('A4').values = [[context]];
  sheet.getRange('A3:H5').format.rowHeight = 23;
  sheet.getRange('A3:H5').format.font = {name: font, size: 10, color: '#536579'};
  return sheet;
}

function populate(sheet, records, name, widths, numeric, row=7) {
  console.log(`Populate ${sheet.name}: ${records.length} rows`);
  const columns = Object.keys(records[0]);
  const end = row + records.length;
  const last = String.fromCharCode(64 + columns.length);
  sheet.getRange(`A${row}:${last}${row}`).values = [columns];
  // Bounded block writes keep the output and numeric types reproducible.
  for (let start = 0; start < records.length; start += 20000) {
    const chunk = records.slice(start, start + 20000).map(r => columns.map(c => r[c] === '' ? null : r[c]));
    sheet.getRange(`A${row + 1 + start}:${last}${row + start + chunk.length}`).values = chunk;
    console.log(`${sheet.name}: wrote ${Math.min(start+20000,records.length)}`);
  }
  const all = sheet.getRange(`A${row}:${last}${Math.min(end,row+25)}`);
  all.format.font = {name: font, size: 11, color: ink};
  all.format.verticalAlignment = 'center';
  all.format.rowHeight = 22;
  all.format.wrapText = false;
  widths.forEach((w, i) => sheet.getRange(`${String.fromCharCode(65+i)}${row}`).format.columnWidth = w);
  for (const c of numeric) {
    sheet.getRange(`${c}${row+1}:${c}${Math.min(end,row+25)}`).setNumberFormat('0');
    sheet.getRange(`${c}${row+1}:${c}${Math.min(end,row+25)}`).format.horizontalAlignment = 'right';
  }
  const table = sheet.tables.add(`A${row}:${last}${end}`, true, name);
  table.showFilterButton = true;
  console.log(`Table ${name} created`);
  sheet.getRange(`A${row}:${last}${row}`).format = {
    fill: ink, font: {name: font, size: 11, bold: true, color: '#FFFFFF'},
    horizontalAlignment: 'center', verticalAlignment: 'center', rowHeight: 28,
  };
  return end;
}

const main = base('完整学习表', '汉语字词学习顺序',
  `来源：现代汉语常用词表.tsv ｜ ${report['原词条数'].toLocaleString('en-US')} 个原词条 · ${report['不同汉字数'].toLocaleString('en-US')} 个汉字`,
  '每个汉字项、每个词语项各计一步；按学习序号向下学习，词语所需汉字一定先出现。');
main.getRange('A5').values = [['高频词优先，低频词即使已具备汉字条件也可延后。单字词与多音词均按原记录单列。']];
main.tabColor = ink;
const end = populate(main, data.main, 'LearningOrder', [12, 9, 31, 48, 16, 16, 30, 47], ['A', 'E', 'F']);
main.getRange(`A8:H${end}`).conditionalFormats.addCustom('$B8="汉字"', {fill: pale, font: {bold: true, color: accent}});
main.freezePanes.freezeRows(7);
main.freezePanes.freezeColumns(3);
main.getRange(`B8:B${end}`).format.horizontalAlignment = 'center';

const chars = base('汉字顺序', '按汉字安排学习进度',
  '完整表学习序号指明新汉字在字词混合序列中的位置；示例按其实际学习先后排列。',
  '单字词原音仅取自源表中的单字词；空白表示没有独立单字词读音，请结合完整表里的词语拼音学习。');
populate(chars, data.chars, 'CharacterOrder', [12, 23, 10, 25, 25, 68], ['A', 'B', 'E']);
chars.freezePanes.freezeRows(7);
chars.freezePanes.freezeColumns(2);
chars.getRange(`C8:C${7+data.chars.length}`).format.horizontalAlignment = 'center';

const coverage = base('覆盖与算法', '高频词覆盖与算法比较',
  '每个汉字、每个词语各计一步；词权重 = 1 / 原词频序号。覆盖表示词条已在完整列表中出现。',
  '所选顺序是本次候选中目标值最好的结果，未证明全局最优；每项成本相同，不细分词义和笔画难度。');
coverage.getRange('A5').values = [[`选中：${report['选中算法']} ｜ 所有 56,790 词条均通过汉字前置和原文一致性校验。`]];
const progress = report['最终方案']['进度'];
const compact = progress.map(r => ({
  '学习总步数': r['学习总步数'], '已学汉字数': r['已学汉字数'], '已学词条数': r['已学词条数'],
  '前100词已学': r['前100词已学数'], '前1000词已学': r['前1000词已学数'],
  '前3000词已学': r['前3000词已学数'], '前10000词已学': r['前10000词已学数'],
  '加权覆盖率': r['频序倒数权重覆盖率'],
}));
populate(coverage, compact, 'CoverageStages', [16, 21, 21, 23, 23, 23, 25, 22], ['A','B','C','D','E','F','G']);
coverage.getRange(`H8:H${7+compact.length}`).setNumberFormat('0.0%');
const compareStart = 12 + compact.length;
coverage.getRange(`A${compareStart-2}`).values = [['候选算法比较：加权平均词语出现步数越小，高频词在完整学习列表中越靠前。']];
coverage.getRange(`A${compareStart-2}`).format.font = {name: font, size: 11, bold: true, color: ink};
const compare = report['算法对比'].map(r => ({
  '方案': r['方案'], '平均步数': r['加权平均词语出现步数'],
  '500步': r['进度'].find(p=>p['学习总步数']===500)['前1000词已学数'],
  '1000步': r['进度'].find(p=>p['学习总步数']===1000)['前1000词已学数'],
  '3000步': r['进度'].find(p=>p['学习总步数']===3000)['前3000词已学数'],
}));
// Place comparison below the progression table with the same column geometry.
// Long algorithm labels are written across the two otherwise unused columns F:H.
const comparisonRows = compare.map((r,i)=> ({
  '方案编号': i+1, '平均出现步数': r['平均步数'],
  '500步/前1000词': r['500步'],
  '1000步/前1000词': r['1000步'],
  '3000步/前3000词': r['3000步'],
}));
populate(coverage, comparisonRows, 'AlgorithmComparison', [16,21,21,23,23], ['A','C','D','E'], compareStart);
coverage.getRange(`B${compareStart+1}:B${compareStart+compare.length}`).setNumberFormat('0.000');
coverage.getRange(`E${compareStart+1}:E${compareStart+compare.length}`).format.horizontalAlignment = 'center';
coverage.getRange(`F${compareStart}`).values = [['算法名称']];
coverage.getRange(`F${compareStart}`).format.font = {name: font, size: 11, bold: true, color: ink};
compare.forEach((r,i)=> {coverage.getRange(`F${compareStart+1+i}`).values = [[r['方案']]];});
coverage.getRange(`F${compareStart+1}:H${compareStart+compare.length}`).format.font = {name: font, size: 11, color: ink};
const notesStart = compareStart + compare.length + 3;
const notes = [
  '完整表收录全部原词条；同形词的不同读音不合并。字母与标点保留，但不计作汉字前置。',
  '算法：7 种收益密度贪心 + 按词频补字基线；最好的 3 种再进行 4 轮、8 项字词窗口精确优化。',
  '覆盖率按词条计数，不等于自然文本覆盖率；频序倒数只是明确的优化权重，不是实际词频。',
  '本表是固定计算结果。更新源词表后，请重新运行生成脚本；在 Excel 内改动数据不会重排学习顺序。',
];
notes.forEach((note,i)=>{coverage.getRange(`A${notesStart+i}`).values=[[note]];});
coverage.getRange(`A${notesStart}:H${notesStart+notes.length}`).format.font={name:font,size:10,color:'#536579'};
coverage.getRange(`A${notesStart}:H${notesStart+notes.length}`).format.rowHeight=23;

workbook.recalculate();
for (const sheet of [main, chars, coverage]) {
  console.log((await workbook.inspect({kind:'table', range:`'${sheet.name}'!A7:H11`, include:'values,formulas', tableMaxRows:5,tableMaxCols:8,maxChars:2500})).ndjson);
}
console.log((await workbook.inspect({kind:'match', searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},maxChars:1500})).ndjson);
for (const [sheet, range, name] of [[main,'A1:H20','学习表预览'],[chars,'A1:H20','汉字顺序预览'],[coverage,`A1:H${notesStart+notes.length}`,'覆盖与算法预览']]) {
  const preview = await workbook.render({sheetName:sheet.name,range,scale:1.5,format:'png'});
  await fs.writeFile(path.join(output,`${name}.png`),new Uint8Array(await preview.arrayBuffer()));
  console.log(`Rendered ${sheet.name}`);
}
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(path.join(output,'汉语字词学习表.xlsx'));
console.log('Exported 汉语字词学习表.xlsx');
