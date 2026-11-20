// User-facing names shared by the course browser and downloadable study tables.
export const LESSON_TYPES=Object.freeze({initial:'声母',stroke:'首笔',root:'字根',char:'汉字',word:'词语',short:'简码',variant:'台湾字形'});
export const READING_SOURCES=Object.freeze({naer:'国教院词语表',moe:'教育部国语辞典',inferred:'自动推读',scheme:'潇明方案','source-pinyin':'原词表'});
export const TRADITIONAL_TERMS=Object.freeze({'设置':'設定','记录':'紀錄','导出':'匯出','导入':'匯入','数据':'資料','信息':'資訊','文件':'檔案','当前':'目前','点击':'點選','加载':'載入','备份':'備份','备注':'備註','合并':'合併','词汇':'詞彙'});
export function traditionalLabel(value,map){
  let text=String(value);
  for(const [from,to]of Object.entries(TRADITIONAL_TERMS))text=text.replaceAll(from,to);
  return [...text].map(char=>map[char]||char).join('');
}
export const STUDY_FILES=Object.freeze({
  simplified:{path:'简中_学习路径.tsv',words:'简中_字词表.tsv',roots:'简中_字根表.tsv',guide:'简中_下载说明.md',transfer:'简中_简码与字形训练.tsv'},
  traditional:{path:'繁中_學習路徑.tsv',words:'繁中_字詞表.tsv',roots:'繁中_字根表.tsv',guide:'繁中_下載說明.md',transfer:'繁中_簡碼與字形訓練.tsv'},
});
