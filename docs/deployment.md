# 部署

这是纯静态网站。仅部署 `npm run build` 生成的 `dist/`，不部署仓库根目录。Node.js 服务用于本地预览。

## GitHub Pages

正式仓库：`e-chehil/xiaoming-study`。网站地址：https://e-chehil.github.io/xiaoming-study/ 。

1. 把此独立仓库上传到新建的 GitHub 仓库。不要复制原工作区或原 `.git`。
2. 在仓库 Settings → Pages 中选择 GitHub Actions 作为来源。
3. 在 Settings → Secrets and variables → Actions → Variables 设置 `PAGES_ENABLED` 为 `true`。
4. 手动运行 `Check and deploy` 工作流，或推送到 `main`。

工作流在固定的 Ubuntu 24.04 环境校验文件白名单、数据和测试，再生成纯静态产物。只有 `main` 且启用 `PAGES_ENABLED` 才部署；PR 仅运行检查。未配置 Pages 时不会自动公开网站。默认项目子路径 `/仓库名/` 已纳入浏览器验证。

GitHub Free 的 Pages 适用于公开仓库；私有仓库是否可用取决于账户计划。公开仓库或网站前须完成第三方资料的再分发许可核对，见第三方声明中的待确认项。

## 其他静态托管

构建后将 `dist/` 作为发布目录，启用 HTTPS。保持目录结构和 UTF-8 文件完整；不需要服务端 API、数据库、环境密钥或 SPA 回退。

部署后检查：页面可输入、简繁切换正常、取码说明和词典可打开、台湾字形字体加载、进度导出与导入正常。更换域名会改变浏览器进度的存储位置，迁移前先导出备份。

## 发布操作

```sh
npm ci --ignore-scripts
npm run check
npm run test:browser
```

浏览器测试命令会构建并检查实际静态产物。正式版本用 `v1.0.0` 标签标识；仓库只提交 `release-files.json` 列出的源码与资源。`node_modules/`、构建产物、截图、缓存、个人进度备份和本机配置均不提交。
