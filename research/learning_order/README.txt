汉语字词学习顺序生成工具

结果目录：../outputs/learning_order_20261021/
请先阅读结果目录中的“算法与使用说明.md”。

build_step_order.py：最终算法入口，每个汉字项和每个词语项各计一步。
build_learning_order.py：共享的数据读取函数与前期按汉字数计成本的探索算法。
test_step_order.py：验证完整字词序列、精确局部优化、低频词延后和确定性。
test_learning_order.py：验证共享汉字识别及前期探索算法。
export_workbook.mjs：用已安装的 Artifact Tool 导出 Excel 并渲染预览。
verify_outputs.py：从磁盘独立读取 TSV / Excel 并逐项核对原词表。

从项目根目录运行：
python learning_order/build_step_order.py
python -m unittest discover -s learning_order -p "test_*.py" -v
node learning_order/export_workbook.mjs
python learning_order/verify_outputs.py
