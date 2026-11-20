# Netlify 部署验收（v1.0.1）

- 网站：https://xiaoming-study.netlify.app/
- 管理：https://app.netlify.com/projects/xiaoming-study
- 备用：https://e-chehil.github.io/xiaoming-study/
- 源码：https://github.com/e-chehil/xiaoming-study
- 发布提交：52fdfea8754904c0054e417472cf34ba70cc7a76
- Git 构建部署：6adc5f6bab3aeba5d9eebde8，ready
- 构建日志：https://app.netlify.com/projects/xiaoming-study/deploys/6adc5f6bab3aeba5d9eebde8
- 账户团队：e-chehil，Free；未升级方案、购买域名或修改 DNS。

## 发布范围与自动构建

已从干净的网站仓库发布。Node.js 22，构建 npm run build，输出 dist。
Netlify 只读取 e-chehil/xiaoming-study 的 main 分支，通过仓库只读部署密钥拉取源码，并通过仅含 push 事件的仓库通知接收更新；通知响应为 204 OK。首次 Git 远程构建已完成且发布提交与本地正式版完全一致。
GitHub Pages 仍保留，未修改既有标签、版本、源码和发布 ZIP。
Netlify CLI、账户本机状态、部署脚本、截图和验收记录均未提交到 GitHub，也未作为网页发布。

## 线上验证

- HTTPS 成功，HTTP 301 跳转 HTTPS。
- 发布 manifest 与本地构建完全一致。38 个运行资源核验通过；37 个资源字节与 SHA256 完全一致；index.html 在移除平台插入的唯一、精确匹配的不可见托管注释后与原文件字节完全一致。
- 平台默认的 Powered by Netlify 角标已关闭，工具条已关闭；线上不存在对应注入脚本。没有在学习版面添加托管、许可或资源链接。
- 网站源码、scripts/serve.mjs、.env、.git/config 均无法通过网站地址访问（404）。
- 简繁课程、实际学习记录写入及撤销、完整筛选结果自测、取码说明、词典、台湾字形字体和对照、进度导出/导入、桌面及 320px 手机布局全部通过线上浏览器验证。
- 浏览器验收中无 JavaScript 错误，无失败的运行资源请求；资源全部来自 Netlify 同一站点。
- 课程、词典和字形所需 JSON 成功响应，较大文件使用 Brotli 压缩。
- 本地正式仓库 git status 干净；发布源码白名单及哈希检查再次通过。

## 使用注意

当前验收不代表中国大陆电信、联通、移动的实地线路测试。请用原先发生加载失败的网络测试新网址，确认首次加载及后续使用体验。
网站进度保存在浏览器，GitHub Pages 和 Netlify 属于不同来源。需要保留旧进度时，先在旧地址导出备份，再到新地址导入。
暂不购买域名；后续若选择自有域名，应先确定实际使用的托管平台再绑定。
