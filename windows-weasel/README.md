# 潇明与 Windows 小狼毫

本目录收录基于小狼毫 0.17.4 的潇明输入实验。Lua 负责自分割、顶字、续码、字根注解和整句候选，Python 负责设置、字根详情和选字面板。Weasel 原生补丁调整了候选窗口的 DirectWrite 字体回退、独立编码行、数字下标和高亮。原机以独立测试会话测得优化后单字按键 P95 为 14.99 ms，原始计时记录在 `reference/`。这些是 2026 年 11 月 5 日的 Windows 历史记录。

## 运行源码

- `src/xm_*.lua` 对应 Rime 用户目录的 `lua/`。`src/` 的其余文件对应 `xm_yume/`，其中 `功能与按键.txt` 记录操作。设置程序使用环境变量 `WEASEL_INSTALL` 定位已安装的 `WeaselDeployer.exe`。
- `example/` 保存方案声明及界面配置样例。部署需要原版潇明 Rime 正文、`rime_ice` 和原机生成的字根、读音、字集、整句及频率数据。请参照 `src/xm_yume.lua` 的加载路径，将自己的数据放在用户目录的 `xm_yume/` 下。读取 `lang.ywtb`、`lang.ygram`、`lane_sets.tsv` 等文件的功能依赖对应原料。字典正文、商业字体和个人输入记录由使用者自行提供。
- 稀疏索引由 `python build_packed_tables.py RIME用户目录 输出目录` 从既有词典与元数据生成。脚本核对官方 124,233 条正文的数据指纹。

## 原生前端

基线源码为 [Weasel 0.17.4](https://github.com/rime/weasel/tree/0.17.4)。补丁为 `native/weasel-0.17.4-yume-ui.patch`，相关 GPL 条款见 `native/Weasel-LICENSE.txt`。

1. 在已安装 v143 的 Visual Studio 开发者环境中，设置 `WEASEL_INSTALL` 指向小狼毫 0.17.4，设置 `VS_CATALOG` 指向所用 Build Tools 的 `catalog.json`。旧版工具链用到 ATL 14.43.17.13 与 Windows SDK 10.0.22621.0。
2. 在 `native` 下运行 `python stage_build.py` 取得源码、Boost 与 ATL。在 `build/weasel-0.17.4` 应用完整补丁，例如 `git apply --ignore-space-change ../../weasel-0.17.4-yume-ui.patch`，再将 `native/weasel.props` 复制到该源码根目录。
3. 回到 `native`，执行 `python prepare_resources.py` 与 `python import_rime.py`。导入库由已安装的 x64 `rime.dll` 生成。使用 `build_frontend.ps1` 分别构建 x64 的 WeaselServer 以及 x64、Win32 的 WeaselTSF。x64 开发者环境中再运行 `build_panel_text.ps1` 构建 `xm_native_text.dll`。
4. `verify_com.cpp` 与 `verify_render.cpp` 供检查 COM 路径和 DirectWrite 字体、尺寸、候选排版。历史构建摘要见 `native/build-manifest.json`。

本次归档整理的是开发源码与配置。现有 Windows 安装继续从它原有的安装目录和 Rime 用户目录运行。
