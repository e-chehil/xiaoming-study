# 王码离线查询工具

这是早期独立查询页的页面源码、原始查询解析器和校验工具，可用于检查根图映射，也可在有离线原料时恢复独立页面。潇明习字主站已集成七套编码对照。

在练习页的设置中选择一种王码即可查看对照。资料的源头是[王码官网七类编码逐字查询](http://www.wangma.net.cn/search.aspx?sm=7)。历史采样取得 15,432 个字符、108,024 项编码，对应 866 张独立根图。数字码按字符串保存，以保留前导零。

## 恢复带根图的独立页

完整个人资料包 `wangma_offline_query.zip` 可以直接解压后打开 `index.html`。如需重建页面数据，把该包内的 `wangma_roots.json`、`image_manifest.json` 和 `assets/` 放在本目录，运行 `python build_offline_page.py`，然后双击 `index.html`。生成器会逐字、逐种编码核对压缩表示与原始 JSON。

`validate.py` 会使用保存在本地的 `results.sqlite3` 原始查询响应、导出的资料和核查报告重验编码、图片和覆盖范围。`offline_assets.py` 与 `refresh_legacy_assets.py` 记录了图片定位及重名图片的校验方法。官方教材与图片保存在个人离线包。网页主站使用按需加载的编码表。
