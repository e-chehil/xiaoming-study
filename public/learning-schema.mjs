export const LESSON_TYPES=Object.freeze({initial:'声母',stroke:'首笔',root:'字根',char:'汉字',word:'词语',short:'简码',variant:'台湾字形'});
export const TRADITIONAL_TERMS=Object.freeze({'设置':'設定','记录':'紀錄','导出':'匯出','导入':'匯入','数据':'資料','信息':'資訊','文件':'檔案','当前':'目前','点击':'點選','加载':'載入','备份':'備份','备注':'備註','合并':'合併','词汇':'詞彙'});
export function traditionalLabel(value,map){
  let text=String(value);
  for(const [from,to]of Object.entries(TRADITIONAL_TERMS))text=text.replaceAll(from,to);
  return [...text].map(char=>map[char]||char).join('');
}
