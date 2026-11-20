export const DATA_COMMIT='318f95d15388562f5dc0fe2b1361d569fc6032d4';
export const RESOURCES=Object.freeze({
  "simplified": {
    "id": "simplified",
    "path": "data/learning-runtime.json",
    "bytes": 12864783,
    "sha256": "2a7f65acbe815b29528941b988414904ccc84694f32044b3b5ae06c2e0e1c8ee"
  },
  "traditional": {
    "id": "traditional",
    "path": "data/traditional/learning-runtime.json",
    "bytes": 12442409,
    "sha256": "3698ac5ca22e63756e48aeb6ce7f1c6ad268f2067079df3b00f2a76345aeea59"
  },
  "wangma": {
    "id": "wangma",
    "path": "data/wangma.json",
    "bytes": 952082,
    "sha256": "0d751af05fb28d6f0140ace5234ed58f97898136c1c39836015da2b0f2f16916"
  },
  "dictionary": {
    "id": "dictionary",
    "path": "data/cedict/dictionary.json",
    "bytes": 11145457,
    "sha256": "19ff0ca3d6131b02557d27b11775b90e1b443da5c272a6970e3c7034bdfbfc98"
  }
});
export const SOURCE_POLICY=Object.freeze({mirrors:['https://cdn.jsdmirror.com'],official:'https://cdn.jsdelivr.net',thirdParty:true});
export function resourceSources(record,base=new URL('./',import.meta.url),policy=SOURCE_POLICY){
  const own=new URL(record.path,base).href;
  if(['localhost','127.0.0.1','[::1]'].includes(base.hostname))return [own,own];
  const fixed='/gh/e-chehil/xiaoming-study@'+DATA_COMMIT+'/public/'+record.path;
  const urls=[...(policy.thirdParty?policy.mirrors.map(origin=>origin+fixed):[]),own,...(policy.thirdParty?[policy.official+fixed]:[]),'https://e-chehil.github.io/xiaoming-study/'+record.path,'https://xiaoming-study.netlify.app/'+record.path];
  return [...new Set(urls)];
}
