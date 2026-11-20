# 潇明习字研究与学习资料

这里保存独立字词排序工具、课程编制源码、重码审计、可打印的字根手册和 Obsidian 字根表。开发记录以 2026 年 10 月至 11 月的简繁课程为准。[在线练习](https://e-chehil.github.io/xiaoming-study/) · [归档所对照的公开源码](https://github.com/e-chehil/xiaoming-study/tree/4d1737daa34655b778bc38765b9f7a7a5dfa8aa3)

## 打印及离线阅读

- [简明手册配色版](常用字字根/潇明字根大码简明手册（配色版）.pdf)与[大码口诀自测](常用字字根/潇明字根大码口诀手册（背诵与自测）.pdf)适合学习键位。该目录的两份 Typst 源稿对应普通和配色简明手册。其余 PDF 各有独立版面或功能，包含学习例字、紧凑组字索引和 1031 版编排。组字统计按一级字表的 3,500 字统计。
- [A4 打印表](output/pdf/潇明字根总表-A4打印.pdf)、[单页矢量总表](output/pdf/潇明字根总表-矢量.pdf)和[高清图](output/pdf/潇明字根总表-高清.png)分组列出 397 个字根。排版源码存于 `tools/root-print/render.mjs`，读取正式应用的两份课程及原始字根字体。仓库根目录执行 `npm ci` 后，在安装了 Edge 的设备运行 `node research/tools/root-print/render.mjs`。用环境变量 `XIAOMING_STUDY_REPO` 可指定另一个含 `public/` 和 npm 依赖的检出；`EDGE_PATH` 可指定兼容 Chromium 浏览器。产出放在 `research/output/pdf/`，测量和预览放在 `research/tmp/pdfs/xiaoming-roots/`。
- [Obsidian 字根表](output/obsidian/潇明字根总表.md)配合该目录的 CSS 使用。样式内嵌原始 Yuniversus WOFF，SHA-256 为 `977bcb7365973089dcf5e74546a3daa313135ef894b1b73f449a29e13ed74e6d`。原字根和字体出自[潇明方案](https://shurufa.app/ime/xiaoming)与[宇浩项目](https://github.com/forfudan/yu)，详见[原始声明](https://github.com/e-chehil/xiaoming-study/blob/4d1737daa34655b778bc38765b9f7a7a5dfa8aa3/public/vendor/Yuniversus-SOURCE.txt)。Typst 源稿以 Noto Serif SC、Noto Sans SC 和 Yuniversus 排版，有本地字体时用 `typst compile --font-path fonts 文件名.typ`。字体需另外准备，现成 PDF 可直接使用。

## 字词排序与课程编制

以下命令从 `research/` 运行。Python 的排序测试只需要标准库，使用小型合成样例，核对依赖图、精确窗口与学习次序的确定性。

```sh
python -m unittest discover -s learning_order -p "test_*.py" -v
python prepare_workspace.py
```

`prepare_workspace.py` 从本仓库已发布的 `public/` 或 Git 固定提交恢复已有的共用数据、前端模块、字体和声明，逐一检查 SHA-256。只下载归档内容时，可以通过 `--repo` 指向一份含上方固定提交的本地克隆。该工具保留已存在且内容不同的文件并提示冲突。

`learning_order/build_step_order.py` 从自备的三列 `现代汉语常用词表.tsv` 生成按依赖排序的学习序列。[算法、适用范围及步骤](outputs/learning_order_20261021/算法与使用说明.md)解释“每字和每词各计一步”的目标和字词成本。`export_workbook.mjs` 的 Excel 导出另需可用的 `@oai/artifact-tool` 环境。独立频序算法、候选模型的比较和最终统计均保留。繁中词源、筛选和原始教学步骤的统计位于 `outputs/traditional_learning_order_20261023/`。

`sites/xiaoming-study/scripts/` 保留发布前的完整课程处理工具，覆盖原始文字拆分、简繁学习次序、台湾音形、例字、导出与完整性验证。目录层级与旧脚本一致。重跑全量处理需要自备 `现代汉语常用词表.tsv`、`潇明码表/`、`詞語表、通用詞頻表/` 及教育部字典来源。旧审计另读取研究版的完整 `learning.json`、归档词条或 `.local/` 的指定派生输入。输入可按原目录补齐；正式版课程可直接在 `public/data/` 使用。归档下 `sites/xiaoming-study/tests/` 保留正式版缺少的专项历史测试；`docs/` 与 `design-system/` 保存了设计及数据决策。

## 重码口径复核

[重码核对报告](outputs/code_collision_audit_20261114/重码核对报告.md)比较课程里的同码词和字词同码。[官方数字复核](outputs/code_collision_audit_20261114/官网词重口径核对.md)区分按词条计数的静态比例和按词频计权的动态比例。静态分别为课程 11.32%、官网测评表 12.82%，后者的动态比例为 4.108%。

1. 运行 `python prepare_workspace.py` 恢复本次评测的简中课程和 manifest。
2. 按 `潇明码表/README.md` 所记的固定上游版本备齐 `潇明码表/upstream/`。在 `outputs/code_collision_audit_20261114/` 放入官网采用的 [kc6000.txt](https://github.com/hertz-hwang/CHS/blob/main/data/kc6000.txt)，下载值应匹配 `official_comparison.json` 记录的 SHA-256。
3. 依次执行 `python outputs/code_collision_audit_20261114/audit.py` 和 `python outputs/code_collision_audit_20261114/compare_official.py`，可从输入独立重建报告及逐词 TSV。

此归档在独立临时目录恢复 25 份公共输入，校验了两份重码汇总与原件逐字段相同。排序工具的六项测试通过。重新渲染的打印表共五页，397 根均完整，逐格测量没有溢出。Obsidian 的 397 行与专用字体均通过浏览器检查。

历史正式站有完整的[测试与发行资源](https://github.com/e-chehil/xiaoming-study/releases)。公开仓库中的运行课程、CC-CEDICT、OpenCC、Noto 与原字根映射各有来源及许可，详见[第三方说明](https://github.com/e-chehil/xiaoming-study/blob/4d1737daa34655b778bc38765b9f7a7a5dfa8aa3/public/vendor/THIRD_PARTY_NOTICES.md)。

## 相关归档

[七种王码离线工具](王码离线查询/README.md) · [小狼毫 Windows 源码](../windows-weasel/README.md) · [小企鹅移植](../android-fcitx5/README.md) · [OCR 与校勘](../ocr/README.md) · [历史发布核验](../release-audits/)
