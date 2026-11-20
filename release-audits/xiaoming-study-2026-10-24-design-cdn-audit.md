# 前端设计原则与课程 CDN 可行性核查

日期：2026-10-24（Asia/Shanghai）。正式版 v1.0.1；提交 52fdfea8754904c0054e417472cf34ba70cc7a76。

## 前端原则

已有设计系统与实现依据：统一的色彩、字体、间距和 44px 控件；课程数量与批量操作共用一行；可见焦点、控件标签、弹窗焦点管理、减少动态效果、简繁内容保护和小屏布局。既有 artifacts/ui-finish/audit/report.json 记录 axe 4.14.0、272 个页面状态、0 个自动发现的违规及键盘流程。此记录是既有验收证据，本轮没有重跑该完整检查，也不等于完整的人工无障碍认证。

本轮缺口：

- public/practice.mjs:854 / :924：整套课程 JSON 完成下载、解析和校验前不能开始练习；弱网下首屏可用性不足。
- public/request.mjs:5：单次总时限 90 秒，持续慢速传输仍可能超时并从头重试；缺少多源回退和版本化离线课程缓存。
- public/practice.mjs:928：失败只给出通用重新加载提示，下载、解析与本地进度读取的阶段未区分。
- public/practice.mjs:182 / :563：导航使用按钮，搜索、类型、状态及分页未同步到 URL，不能通过链接保留当前课程列表状态。
- 数据获取、状态与大部分视图仍集中在 practice.mjs，尚未充分做到数据与展示分离。

结论：此前遵循了视觉一致性、可访问性和响应式原则；性能、网络故障恢复、导航状态及代码职责分离没有全面落实。之前的功能和布局验收不足以代表大陆弱网的正式使用体验。

## 直接下载及完整性

对 cdn.jsdelivr.net、cdn.jsdmirror.com、cdn.jsdmirror.cn 请求固定版本 v1.0.1 的简中课程、繁中课程、词典与 Yuniversus 字体：

- jsDelivr：4 个文件均 200，SHA256 与正式版源文件完全一致；JSON Brotli 压缩、跨域允许来源为 *。
- JSDMirror .cn：直接下载的 4 个文件均 200，SHA256 一致，JSON Brotli、跨域允许来源为 *。
- JSDMirror .com：首轮简中课程和词典各一次超过 35 秒；复核均 200 且 SHA256 一致；繁中课程和字体首轮已经通过。
- 当前课程单文件约 12–13MB，未超过 jsDelivr GitHub 单文件 20MB 的公开默认限制。无需先拆分课程即可验证这条分发路径。

上述完整下载来自当前执行网络，不能当作大陆三网的完整下载测速。

## 大陆远程 HTTP 抽样

使用 Globalping，各服务抽样电信 AS4134、联通 AS4837、移动 AS9808 各一个大陆探针，路径为同一正式版简中课程。探针城市与接入类型不完全相同，含家庭及数据中心网络。这里只判断请求连通性；API 仅提供前 10KB 正文，不能用这些结果校验完整文件或断言完整课程的下载耗时。

| 服务 | 电信样本 | 联通样本 | 移动样本 |
|---|---|---|---|
| cdn.jsdelivr.net | 连接失败 | 200 | 连接失败 |
| cdn.jsdmirror.com | 200 | 200 | 200 |
| cdn.jsdmirror.cn | 200 | 429 | 200 |
| xiaoming-study.netlify.app | 200 | 200 | 200 |

单时段、少量样本不构成全国或长期可用性的保证。Netlify 本轮样本均返回 200，不推翻用户本地遇到的加载失败。

公开测量原始接口（有保存期限，本地已保留原始 JSON）：

- cdn.jsdelivr.net: https://api.globalping.io/v1/measurements/2sc880fhnkMaAk5oH00021NHc
- cdn.jsdmirror.com: https://api.globalping.io/v1/measurements/26PwqUVwXDsPGxMZ100021NHc
- cdn.jsdmirror.cn: https://api.globalping.io/v1/measurements/2N3I6w02hEVfWDB7600021NHc
- xiaoming-study.netlify.app: https://api.globalping.io/v1/measurements/2p5zP21YmN8sCphda00021NHc

## 隔离浏览器试接

仅在无个人进度的本地浏览器上下文中拦截 Netlify 返回的 HTML CSP、courses.mjs 与 cedict.mjs，临时让数据读取 JSDMirror。没有修改线上站点或正式版源码。

- .com：简中、繁中及词典 3 个实际跨域请求均 200，输入区可用，词典就绪，切换繁中成功，没有浏览器脚本错误或失败资源请求。
- .cn：首次未在 45 秒内出现可用输入；复核能开始简中练习，但词典就绪等待超过 45 秒。因此未完成与 .com 相同的完整试接验收。
- 两轮 .cn 均能观察到 200 响应，说明仅检测 HTTP 状态不足以判定完整资源已准备好。

## 可行的接入方式

先保留完整 JSON 和现有页面布局：为课程与词典配置 JSDMirror 候选源及原站回退；使用固定版本或提交，与主站内固化的预期 SHA256 核对；为精确的资源域名配置 CSP connect-src（若迁移字体，再配置 font-src）；尽快切换故障源，避免每个来源依次等待 90 秒；缓存验证通过的同版本资源，下一次优先读本地。主程序继续同站提供，页面不增加镜像选择器或托管说明。

建议优先试接 JSDMirror .com，.cn 作为候选，保留 Netlify 原站回退。jsDelivr 可以提供相同资源，但本轮有大陆连接失败，不能作为大陆访问的唯一依赖。JSDMirror 的公开协议未承诺服务可用性，因此同样不宜成为唯一来源。

jsDelivr 公开条款推荐明确的可再使用许可；当前项目 license 为 UNLICENSED，属于长期采用前要核对的软性适配点，不能仅为 CDN 而擅自将第三方资料改许可。该推荐不是本轮请求的硬性阻断。学习页面不需要展示这些工程说明。

## 来源

- Frontend UI Engineering：https://github.com/addyosmani/agent-skills/blob/main/skills/frontend-ui-engineering/SKILL.md
- Vercel Web Interface Guidelines：https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md
- jsDelivr 文档与限制：https://github.com/jsdelivr/jsdelivr#restrictions
- jsDelivr 网络：https://www.jsdelivr.com/network
- jsDelivr 条款：https://github.com/jsdelivr/jsdelivr/blob/master/Terms%20of%20Use.md
- JSDMirror 官方项目：https://github.com/jsdmirror/JSDMirror
- JSDMirror 服务协议：https://github.com/jsdmirror/JSDMirror/blob/main/SLA.md

正式仓库 git status 干净；本次为可行性核查，线上仍使用原资源地址。
