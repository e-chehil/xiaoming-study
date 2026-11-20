# 潇明习字 · 研究资料归档

[进入在线练习](https://e-chehil.github.io/xiaoming-study/) · [当前应用源码](https://github.com/e-chehil/xiaoming-study/tree/main)

此分支保存潇明习字制课、词表校勘、王码查询和桌面输入法移植的研究资料。日常网页开发和发布使用 `main`。

| 资料 | 可以用来做什么 |
| --- | --- |
| [课程编制、字根手册与重码报告](research/README.md) | 从课程输入复核学习顺序和重码指标，查阅或打印字根手册，生成 A4 与 Obsidian 版本 |
| [潇明码表快照](research/潇明码表/README.md) | 按固定上游版本查拆分、字根、全码和台湾字形 |
| [王码独立查询工具](research/王码离线查询/README.md) | 根据既有原始查询资料重建七种编码和字根图片的离线页 |
| [OCR 比较与人工校勘](ocr/README.md) | 以原书与四种 OCR 导出为输入，复验正文和音序索引的差异、勘误与待核项目 |
| [Windows 小狼毫源码与补丁](windows-weasel/README.md) | 查阅候选绘制、字体回退、顶字和面板实现，重建对应版本 |
| [安卓小企鹅 Rime 方案](android-fcitx5/README.md) | 从锁定的官方码表生成可导入的潇明方案 |
| [历史发布验收](release-audits/) | 查阅 1.0 到 1.1 系列的验收证据，配合仓库 Releases 中相应版本的交付包 |

每个目录各有来源、使用方法和原料说明。原书、个人保留的字体、独立官方教材和完整研究词表由持有者自行提供。每份公开归档文件的 SHA-256 见[归档文件校验清单](ARCHIVE-SHA256SUMS.txt)。在此分支根目录可执行 `sha256sum -c ARCHIVE-SHA256SUMS.txt` 校验。
