# 潇明习字 1.1.1 可靠性改造交付检查

日期：2026-10-24（Asia/Shanghai）。

- 主站：https://xiaoming-study.netlify.app/
- 备用：https://e-chehil.github.io/xiaoming-study/
- 源码：https://github.com/e-chehil/xiaoming-study
- 正式发布：https://github.com/e-chehil/xiaoming-study/releases/tag/v1.1.1
- 提交：31ac42f10bed620fe01c8a2780cbbe8e3d53a540
- 云端检查与部署：https://github.com/e-chehil/xiaoming-study/actions/runs/40083969683 （success）
- Netlify Git 部署：6adc80f0152e543918267e44 （ready）

## 最终行为

完整简繁课程和词典不拆分。有效本地副本优先读取，不等待联网检查；首次缺少时顺序尝试固定提交的 JSDMirror .com、本站、jsDelivr 官方、GitHub Pages 和 Netlify，去重并合并同资源并发下载。缓存键包含预期 SHA-256，只有大小、SHA-256、JSON 和结构全部验证后保存。字体与程序继续同站提供，不引入第三方程序执行。

基础页面使用 Service Worker 完整缓存和版本一致性校验。坏更新不能接管；正常更新等待旧标签页关闭，不打断当前练习。Netlify 会插入固定 HTML 托管注释；只移除这一精确注释后核对原始页面字节，其他注释、脚本或 HTML 改写仍被拒绝。保存的是干净原始页面。

首次仅下载当前课程；词典在需要释义、英文课程检索或查词时下载并缓存。下载有实际进度，错误可重试。设置显示真实离线准备结果。筛选、页码和课程可由网址恢复，导航使用保留原生操作的链接。既有视觉布局保留。

课程缓存使用独立 Cache Storage，原 FSRS IndexedDB、卡片、日志、订正、用户设置和备份 v3 未改。课程数据、教学顺序、编码、优序和复习算法的原文件字节未改。缓存不主动过期；浏览器或系统仍可能清理或回收站点数据。

## 数据源检查

三份数据固定到提交 52fdfea8754904c0054e417472cf34ba70cc7a76；资源大小约 12.9MB、12.4MB、11.1MB，低于 jsDelivr GitHub 单文件 20MB 的公开默认限制。完整下载中核对了 HTTPS、JSON Content-Type、CORS、压缩与本地 SHA-256。JSDMirror .com 有偶发首次超时，后续真实浏览器已从同一固定链接完整取得三份文件并通过校验；保留多源回退。JSDMirror .cn 因既有 429 和浏览器等待故障未默认启用，来源可配置。

大陆远程 HTTP 抽样如下。各服务、文件、运营商仅少量探针，城市和接入网络不完全相同；API 只返回前 10KB 正文，此表只用于连通性观察，不代表完整下载或全国长期可靠性。

| 来源 | 文件 | 电信 | 联通 | 移动 |
|---|---|---|---|---|
| cdn.jsdelivr.net | data/learning-runtime.json | 200 | 200 | 连接失败 |
| cdn.jsdmirror.com | data/learning-runtime.json | 200 | 200 | 200 |
| cdn.jsdelivr.net | data/traditional/learning-runtime.json | 连接失败 | 200 | 200 |
| cdn.jsdmirror.com | data/traditional/learning-runtime.json | 200 | 200 | 200 |
| cdn.jsdelivr.net | data/cedict/dictionary.json | 连接失败 | 200 | 连接失败 |
| cdn.jsdmirror.com | data/cedict/dictionary.json | 200 | 200 | 200 |

源端说明：https://github.com/jsdelivr/jsdelivr#restrictions 、https://github.com/jsdmirror/JSDMirror 。首访仍需至少一个网页入口及一个数据来源可达。

## 实际通过的测试

- 最新提交云端：70 项单元测试；11 组完整浏览器套件，全部通过。
- 既有交互、并发进度保护、简繁与备份隔离、跨分页筛选练习、取码说明、词典、主题与键盘回归通过。
- 1,080 个学习布局、82 节代表课程、20 个对话框、56 个工具页布局、4 个主题快捷键检查通过。
- 真实 Chromium Service Worker 测试：首次只下载当前课程、词典按需、断网新页重开、离线简繁和词典、缓存损坏修复、CORS 失败回退、坏版本拒绝、正常升级及 FSRS 记录持久性通过；根目录和 GitHub 子目录均覆盖。
- 存储配额失败、假 JSON 错误页、哈希损坏、头部超时、正文停滞、同资源并发合并及成功新旧版本共存通过。
- 精确平台注释归一化，以及未知/重复注释、注入脚本、修改正文和非 HTML 文件被拒绝的测试通过。

## 真实线上验收

- https://xiaoming-study.netlify.app/：发布清单一致，45 个运行资源校验通过；首次课程、按需词典、两套实际 FSRS 记录、断网新页重开、离线切换、离线查词、备份 v3 和手机布局通过；屏蔽首选镜像后自动回退成功；浏览器脚本错误为 0。
- https://e-chehil.github.io/xiaoming-study/：发布清单一致，45 个运行资源校验通过；首次课程、按需词典、两套实际 FSRS 记录、断网新页重开、离线切换、离线查词、备份 v3 和手机布局通过；屏蔽首选镜像后自动回退成功；浏览器脚本错误为 0。

线上验收来自当前执行网络，断网由隔离浏览器模拟；没有将其称为大陆用户设备上的离线实地测试。

## 发布范围

- Git 跟踪 94 个明确列出的网站项目文件，静态部署 47 个文件。没有上传父工作区研究资料、个人备份、截图、依赖、本地工具或 Netlify 登录信息。
- Git 索引的每个源码文件字节与 release-files.json 一致；GitHub Actions 在独立 Linux 环境重复验证成功。
- 源码 ZIP、网站 ZIP 及 SHA256SUMS 位于本文件同目录，已逐文件核对与校验 ZIP 完整性；未作为网页发布。
- 未引入付费服务、后台 API、账号或用户手动安装课程包的操作。

实现、配置与维护说明：仓库 docs/offline.md。
