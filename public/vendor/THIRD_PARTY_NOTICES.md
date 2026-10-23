# 第三方资料与许可

应用原创代码尚未单独授予开源许可。`package.json` 的 `UNLICENSED` 只表示不授权通过 npm 分发，不覆盖下列第三方资料。公开 GitHub 仓库也不意味着其中全部内容可按 MIT 重用。

| 内容 | 来源 | 条件与随附声明 |
| --- | --- | --- |
| FSRS 实现 | ts-fsrs 5.4.2 | MIT，`./FSRS-LICENSE.txt` |
| 固定版本的潇明上游算法与码表 | [Dieken/code_genie](https://github.com/Dieken/code_genie/tree/55e783c3973b125d3f56baac534b796c76df87a5) | 上游仓库 MIT，`./CodeGenie-MIT.txt`；不据此为其他来源数据重新授权 |
| 字根字体 Yuniversus | [宇浩网站](https://shurufa.app/ime/xiaoming)及[网站仓库](https://github.com/forfudan/yu) | 原字体未修改；网站标示 CC BY-NC-ND 4.0，保留来源及 `./Yuhao-CC-BY-NC-ND-4.0.txt` |
| 台湾字形字体 | [Noto Serif TC](https://github.com/google/fonts/tree/main/ofl/notoseriftc) | SIL OFL 1.1，离线子集及摘要见 `../fonts/taiwan-font.json`；完整许可见 `./NotoSerifTC-OFL.txt` |
| 简繁界面转换映射 | OpenCC | Apache 2.0，`./OpenCC-LICENSE.txt` |
| 中英词典 | [CC-CEDICT / MDBG](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | CC BY-SA 4.0；来源、日期、改动及原始摘要见 `../data/cedict/NOTICE.txt` 和 `metadata.json`，派生 JSON 仍按该许可分发 |
| 繁中词表和词频 | [国教院华语文语料库](https://coct.naer.edu.tw/page.jsp?ID=41) | 保留机构署名；公开再分发范围待确认，不能因为可下载便认定为 MIT |
| 部分繁中读音 | [教育部国语辞典公众授权网](https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/index.html) | 标示 CC 姓名標示－禁止改作 3.0 臺灣；本项目提取读音并合并至课程，公开再分发该整理结果的适用范围待确认 |
| 简中原始词表与词频 | 用户提供资料 | 原始研究文件未随仓库复制；课程摘要保留来源校验值，公开分发权限由资料提供方确认 |

## 改动说明

本网站重新组织学习顺序、共享重复拆分、补充读音和教学字段，提供简码和台湾字形的独立训练。CC-CEDICT 仅转换存储格式，义项保留，运行时摘要和引用展开属于派生展示。Yuniversus 字体未改动；Noto Serif TC 使用子集字体并明确标示缺字回退。

## 公开发布前待确认

私有仓库可作为个人版本准备。公开仓库或网站前，须核实国教院词表、教育部读音整理及用户原词表的再分发依据；本次检查没有把这些尚未确认的资料标成“已完成授权”。如已有许可，应在此记录适用范围及许可文件；如需替代数据，应重新构建并复核课程及备份兼容性。
