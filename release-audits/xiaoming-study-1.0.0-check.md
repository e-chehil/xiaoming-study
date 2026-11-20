# 潇明习字 1.0.0 发布前检查

结论：1.0.0 已上传到公开 GitHub 仓库并部署到 GitHub Pages。云端完整检查与实际线上验收均通过。资料的再分发状态仍按第三方声明记录，本次发布未将待核实资料改标为已授权。

- 网站：https://e-chehil.github.io/xiaoming-study/
- 公开仓库：https://github.com/e-chehil/xiaoming-study
- 正式版本：https://github.com/e-chehil/xiaoming-study/releases/tag/v1.0.0
- 通过的部署检查：https://github.com/e-chehil/xiaoming-study/actions/runs/40070534438

## 整理结果

- 正式源码目录：`xiaoming-study/`，新建独立 Git 历史，当前共两个与首版发布有关的提交，正式标签 `v1.0.0` 指向 `e742700bbc5db6508428ed94de086b0276132280`。
- Git 实际跟踪 77 个文件，约 37.29 MiB，精确匹配发布白名单。当前工作树干净，origin 指向上述公开仓库。
- 部署产物为 `dist/`，只含 38 个网站文件；不含脚本、测试、原始研究材料、历史词库、重复完整课表、导出表、截图、依赖或个人浏览器进度。
- 原网站目录、原 Git 历史及其他工作内容保留在原处，均未带入。
- Git 源码归档已逐文件核对 SHA-256，源码归档与静态网站归档均通过 ZIP 完整性检查。校验值见同目录的 SHA256SUMS 文件。

## 检查结果

- 锁定依赖安装成功，npm audit：0 个已知漏洞。
- 47 项独立单元测试通过，包含 FSRS、先修依赖、字根完整码、简码、字形、备份隔离、并发保护与服务启动。
- 十组浏览器检查通过：连续练习、设计、声母首笔、进度完整性、双课程、筛选结果练习、中英词典、取码教学、全布局及实际构建产物。
- 新增筛选结果练习检查：简繁课程各 65 项的搜索、类型和已学状态组合结果，两种模式均完整跨页遍历；验证错码、看答案、订正、回溯、整组重练、原筛选及页码恢复、简繁暂停与恢复、空结果与暂不可练项、一码简字空格提交。正式卡片、日志、每日统计、原题部分输入和待订正记录保持不变。六种视口检查批量入口、进度和完成页布局。
- 布局专项包含 82 个代表课项、1,080 组学习布局、56 组工具页、20 组弹窗和四组主题保存快捷键。
- 视觉整合：批量操作与结果数量同排，使用同级文字按钮；去掉独立说明块和冗余分隔，单页结果隐藏分页，返回与完成页统一样式。主题切换取消按钮颜色渐变，避免短暂低对比度。
- 额外完成简繁 34 种页面／状态 × 深浅主题 × 320、768、1024、1440px 的 272 组审计：axe 4.14.0 未发现 WCAG 2.1 A/AA 或 best-practice 违规，页面无脚本错误；键盘操作顺序通过。界面字体及学习字体经浏览器实际字体面板核对。测试工具仅位于忽略目录，没有新增正式依赖或部署资源。
- 文案复核：简繁操作说明重写为练习方法、常用按键、课程与自测、进度与备份四部分；学习页面和释义弹窗不含资源介绍或许可链接。统一未练过／已练过、台湾字形和参考读音提示，移除原表序号及覆盖统计。错误提示不显示浏览器异常和原始 JSON；导入前明确会替换当前简繁课程的进度。
- 修复课程加载失败后重试按钮被内容安全策略阻止的问题，实际构建中模拟加载失败再重新加载通过；错误备份内容不会泄露到提示中。闲置的说明表和下载配置已移出正式版。
- 实际构建产物在 `/xiaoming-study/` 子路径可加载；简繁课程、CSP、来源文件、HEAD、异常方法和静态资源边界检查通过。
- 两套共享拆分课程、词典和两种字体与原已验收资源逐字节一致；全部依赖及取码、优序目标、137 个 PUA 字根、579 个区域字形的字体覆盖和 69 个回退说明已核对。
- 本机 Windows Edge 与云端 Ubuntu 24.04 / Chromium 验证均通过。首次云端运行发现 ubuntu-latest 升级至 26.04 后与锁定的浏览器版本不兼容，已固定为受支持的 Ubuntu 24.04，完整检查和部署随后通过。

## 资料范围待核实项

详见 `xiaoming-study/public/vendor/THIRD_PARTY_NOTICES.md`。

1. 国教院词表与词频的公开再分发范围：已查阅[官方来源](https://coct.naer.edu.tw/page.jsp?ID=41)与操作说明，未据“可下载”推定为 MIT。
2. 教育部读音整理结果：官方[公众授权页](https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/index.html)标示禁止改作许可；需核实本项目提取、整理、合并读音的适用范围。
3. 用户原简中词表的公开分发依据：未复制原始研究文件，课程仍保留来源摘要，权限范围由资料提供方确认。

应用原创代码未擅自选择开源许可；各第三方分别保留原许可。Pages 默认关闭，上传私有仓库也不会自动公开网站。

## 实际线上验收

- 36 个运行资源逐字节匹配正式版 SHA-256，asset-manifest 与本地一致；`.nojekyll` 为构建标记，不计入运行资源。
- 生产网址的简繁课程、真实复习写入与撤销、筛选结果完整自测、取码说明、中英释义、台湾字形字体及进度导出／导入通过。
- 手机与桌面布局检查通过，学习帮助无资源或许可入口，未出现脚本错误或资源请求失败。
- 网站不能访问 package.json、scripts/serve.mjs、.env 或 .git/config；仓库远端 77 个文件的路径及 Git blob 摘要与本地正式版完全一致。
- 浏览器使用隔离上下文，验收进度不属于用户个人浏览器；线上验收机器记录位于忽略目录 `xiaoming-study/artifacts/deployment-1.0.0/`。

## 交付文件

- `xiaoming-study-1.0.0-source.zip`：77 个受控源码与资源文件，不含 `.git`。
- `xiaoming-study-1.0.0-site.zip`：仅网站静态部署文件。
- `xiaoming-study-1.0.0-SHA256SUMS.txt`：两个归档的 SHA-256。

## 本次界面预览

- [操作说明](xiaoming-study/artifacts/copy-finish/audit/simplified-help-light-1440.png)
- [桌面课程页](xiaoming-study/artifacts/copy-finish/audit/simplified-library-light-1440.png)
- [手机课程页](xiaoming-study/artifacts/copy-finish/audit/simplified-library-light-320.png)
- [繁中筛选页](xiaoming-study/artifacts/copy-finish/audit/traditional-filtered-light-320.png)

截图和 axe 机器报告位于忽略的 `artifacts/copy-finish/`，不包含在源码包和部署包中。上述验证使用 Windows Edge 的隔离上下文与不同视口，没有读取个人学习进度，也未进行其他系统的真机屏幕阅读器测试。
