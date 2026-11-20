# 现代汉语常用词表的 OCR 比较与校对

本研究分别从频序正文及音序索引提取词形、编号、注音和页内坐标。四种 OCR 输出先独立恢复，再按同一编号做横向比较。频序正文的编号与索引有出入时，保留两边的记录并回查原页。研究对象为 56,790 条的《现代汉语常用词表》。

[四模型比较报告](review/四模型对比报告.md)记录了本书实验的参数与抽样局限。[原书编号异文](review/原书编号异文对照.tsv)记录编号顺序的判定；[编辑勘误](review/原书编辑勘误记录.tsv)与[五项复查](review/五项独立复查记录.tsv)记录原书与后续编辑口径。报告中出现的原图凭据文件名是私人工作底稿的定位信息。

## 复算四模型比较

使用 Python 3.10 或更高版本，在本目录运行以下命令。请在 `Paddle/` 放置 PP-StructureV3 与 PaddleOCR-VL 两份 JSON（文件名分别包含 `Struct` 和 `Paddle`）。在 `MinerU/正文`、`MinerU/音序索`、`MinerU VLM/正文`、`MinerU VLM/音序索` 放入对应的分页 JSON，沿用原始导出文件名及排序。这些脚本按本书的页序和表格结构工作。生成的中间文件会写到对应的模型目录。

```shell
python pp_vocab/build_lexicon.py
python pp_vocab/reconcile.py
python vl_vocab/extract_vl.py
python vl_vocab/reconcile_vl.py
python vl_vocab/validate_vl.py
python ocr_comparison/process_mineru.py
python ocr_comparison/reconcile_mineru.py
python ocr_comparison/validate_mineru.py
python ocr_comparison/compare_four.py
```

`ocr_comparison/four_model_audit/统一比较统计.json` 包含四套结果的差异统计。`review/` 中保存了原试验部分经过人工核实的结论。复查 GitHub 参考版本可运行 `python ocr_comparison/github_reproof_20261023.py`，需要自备三列的 `现代汉语常用词表.tsv`。脚本按固定提交与 blob 指纹取外部参考表，`--images`、`--supplement` 与 `--finalize` 是旧工作区的后续步骤，另需 PDF、Poppler、Pillow、裁剪记录与当时的复核底稿。
