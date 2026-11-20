# 潇明输入法码表与拆分数据

来源页面：https://shurufa.app/ime/xiaoming
下载日期：2026-10-22（Asia/Shanghai）
原始方案：官网链接指定的 output-20261011-061440/thread-06。
固定提交：55e783c3973b125d3f56baac534b796c76df87a5
仓库目录：https://github.com/Dieken/code_genie/tree/55e783c3973b125d3f56baac534b796c76df87a5/moling/xiaoming-output/output-20261011-061440/thread-06

## 建议从这里开始

- 汉字拆分编码.tsv：102,998 个单字符汉字，含 CJK 扩展及兼容汉字。列为汉字、Unicode、字根拆分、逐根编码、单字全码、字符区域及台湾字形对应字段。UTF-8，制表符分列，有表头；输入码统一为小写。
- 字根编码.tsv：397 个字根，对应字根编码、大码 A、小码 S、补码 B、拼音和 Unicode。
- chaifen.json：官网当前完整拆分数据，共 154,017 条，包括汉字、30,637 条汉字异体字序列及其他文字/符号。字段 d 是拆分，dt 是可选台湾字形拆分，r 是字符区域。逐个 Unicode 字符读取拆分串即可得到字根顺序；不要把异体字序列键误当作单字符汉字。
- zigen-xiaoming.csv：官网原始字根映射，font=字根，ma=字根三位编码，pinyin=拼音。

## 原始方案文件（upstream）

- output-encode.txt：原始单字全码，11,177 行，汉字、全码、频率；不含表头。
- output-combined.txt：原始组合码表（含简码）；下划线是原文件标记，已原样保留。
- output-simple-codes.txt：原始简码分配。
- output-keymap.txt：原始字根键位映射；开头为 # 注释行。
- chaifen-all.txt / chaifen_tw-all.txt：该方案快照配套的完整拆分，列为字符、空格分隔字根、频率。
- config-xiaoming.toml：该快照编码配置。
- generate-xiaoming-words-dict.pl：上游词组编码脚本，仅下载，未执行。脚本默认路径指向更早的方案；使用时须显式传入 --chaifen、--roots，并传入 --trailing 才采用官网所述的末根词编码规则。需要 Perl 5.36 或更新版本。
- chaifen.json.gz：官网返回的原始 gzip 数据。顶层 chaifen.json 已解压为普通 JSON。
- website-share.js：下载时官网实际使用的单字编码实现，供核对算法。
- COMMENT.txt / LICENSE：上游原始说明及仓库许可证。

## 单字编码规则

字根三位码记为 ASB。一个字拆成 R1...Rn：
- 1 根：A1 S1 B1。
- 2 根：A1 S1 A2 S2。
- 3 根：A1 S1 A2 A3 S3。
- 4 根及以上：A1 S1 A2 A3 An。

例如：好 → 女 子 → cke gid → ckgi；做 → 亻 古 攵（字根显示可能为专用字形）→ wjj nfk qjj → wjnqj。
保留全部字根和逐根编码后，才能按词组规则取首根、末根；不要只凭截断后的单字全码反推拆分。
词组规则详见来源页面；本次未给目录中的现有词表生成词码。

## 字体与版本核对

部分字根使用 Unicode 私用区。Yuniversus.woff 为官网字根字体，可供网页或其他支持 WOFF 的显示环境引用；显示成方框不影响原始字符及编码，Unicode 列可用于区分字根。

原始全码的四个核心文件已通过 Git blob SHA-1 校验。逐条对照官网当前拆分生成的全码，11,176 条一致，1 条不同，详见 版本差异.tsv。
当前差异：丼，原始方案 xktf；官网当前拆分为「二  丶」，计算得到 xdmlf。两个来源均原样保留；汉字拆分编码.tsv 使用本次下载的官网数据。

manifest.json 记录来源、下载时间、字数统计及文件 SHA-256。
网站页脚标示 CC BY-NC-ND 4.0；upstream/LICENSE 为代码仓库 MIT 许可证原文。此处保留各自来源声明。

## 随附的第三方声明

固定的 code_genie 项目保留上游 MIT 声明，见 `upstream/LICENSE`。官网字根原始字体、网站资料及其他数据沿用各自来源的声明。原版 WOFF 已保留，随附宇浩网站 CC BY-NC-ND 4.0 文本。[网站第三方声明](../../public/vendor/THIRD_PARTY_NOTICES.md)
