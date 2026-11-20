"""Restore shared course inputs from the pinned public release without a network connection."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
REVISION = "4d1737daa34655b778bc38765b9f7a7a5dfa8aa3"


def restore(source_repo, workspace):
    tracked = json.loads((ROOT / "shared-site-assets.json").read_text(encoding="utf-8"))
    study = workspace / "sites/xiaoming-study/dist"
    collision = workspace / "outputs/code_collision_audit_20261114"
    for name, expected in tracked.items():
        src = source_repo / "public" / name
        data = src.read_bytes() if src.is_file() else b""
        if hashlib.sha256(data).hexdigest() != expected:
            data = subprocess.check_output(
                ["git", "-C", str(source_repo), "show", f"{REVISION}:public/{name}"]
            )
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"Pinned public input differs: {name}")
        targets = [study / name]
        if name in {"data/learning-runtime.json", "data/manifest.json"}:
            targets.append(collision / Path(name).name)
        for dest in targets:
            if dest.is_file():
                if dest.read_bytes() != data:
                    raise FileExistsError(f"Existing input differs: {dest}")
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
    print(f"Verified {len(tracked)} public inputs at {REVISION[:12]}.")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--repo", type=Path, default=ROOT.parent,
                     help="existing full clone of e-chehil/xiaoming-study")
    cli.add_argument("--workspace", type=Path, default=ROOT,
                     help="destination research directory (defaults to this directory)")
    args = cli.parse_args()
    restore(args.repo.resolve(), args.workspace.resolve())
