# 安卓小企鹅上的潇明

此配置适用于小企鹅输入法 5 的 Rime 插件。它使用按原始排序的 124,233 条潇明码表、触屏手动选字和五项候选。小企鹅插件与同文的配置包各自独立。

运行 `python build.py` 可从[官方评测码表](https://zhuyuhao.com/yuhao-assess-data/tables/xiaoming.txt)取得原料并生成导入包。已有原始 TSV 或历史 `xiaoming.dict.yaml` 时，执行 `python build.py --table 路径 --output import.zip` 即可离线重建。构建会核对正文 SHA-256，归档时已验证公开源与锁定指纹相同。解压后按[安装说明](安装说明.txt)部署。已有自定义配置时，应合并方案列表。
