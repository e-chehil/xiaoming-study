"""Build the Fcitx5 Android Rime import package from the pinned upstream table."""
import argparse
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent
URL = "https://zhuyuhao.com/yuhao-assess-data/tables/xiaoming.txt"
TABLE_SHA256 = "087b52c46cda87e86498d6cf4b5a1940e8f8db3e52c75dfdf9bec0d6900f01b3"
HEADER = (f"# qq3qq 潇明 v2.0 — {URL}\n---\nname: xiaoming\n"
          'version: "2.0-upstream.1"\nsort: original\nuse_preset_vocabulary: false\n...\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table", type=Path, help="local upstream TSV or original Rime dictionary")
    parser.add_argument("--output", type=Path, default=Path("潇明-安卓小企鹅导入包.zip"))
    args = parser.parse_args()
    if args.table:
        source = args.table.read_bytes()
    else:
        with urlopen(URL, timeout=60) as response:
            source = response.read()
    text = source.decode("utf-8-sig").replace("\r\n", "\n")
    body = text.split("\n...\n", 1)[-1].encode("utf-8")
    if hashlib.sha256(body).hexdigest() != TABLE_SHA256:
        raise ValueError("词典正文与已验收的 124,233 条版本不匹配。请用 --table 指定历史原料。")

    files = {"导入文件/xiaoming.dict.yaml": HEADER.encode("utf-8") + body}
    for file in [ROOT/"config/default.custom.yaml", ROOT/"config/xiaoming_mobile.schema.yaml", ROOT/"安装说明.txt"]:
        name = ("导入文件/" if file.suffix == ".yaml" else "") + file.name
        files[name] = file.read_text(encoding="utf-8").replace("\n", "\r\n").encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=args.output.parent) as stage:
        pending = Path(stage)/"package.zip"
        with ZipFile(pending, "w") as archive:
            for name, data in sorted(files.items()):
                member = ZipInfo(name)
                member.compress_type = ZIP_DEFLATED
                archive.writestr(member, data)
        pending.replace(args.output)


if __name__ == "__main__":
    main()
