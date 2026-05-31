#!/usr/bin/env python3

import json
import os
import sys
from pathlib import Path


REGISTRY_RELATIVE_PATH = Path(
    "harness-manager-治理管理/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json"
)


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / REGISTRY_RELATIVE_PATH).exists():
            return candidate
    raise FileNotFoundError("project governance registry not found")


def load_registry(repo_root: Path) -> dict:
    return json.loads((repo_root / REGISTRY_RELATIVE_PATH).read_text(encoding="utf-8"))


def relative_target(from_path: Path, to_path: Path) -> str:
    return os.path.relpath(to_path, start=from_path.parent)


def ensure_symlink(repo_root: Path, link_rel: str, target_rel: str) -> str:
    link_path = repo_root / link_rel
    target_path = repo_root / target_rel

    if not target_path.exists():
        return f"missing target: {target_rel}"

    link_path.parent.mkdir(parents=True, exist_ok=True)

    if link_path.is_symlink():
        current = os.readlink(link_path)
        expected = relative_target(link_path, target_path)
        if current == expected:
            return f"ok: {link_rel}"
        link_path.unlink()
    elif link_path.exists():
        if link_path.resolve() == target_path.resolve():
            return f"ok: {link_rel}"
        return f"conflict: {link_rel} exists and is not a symlink"

    link_path.symlink_to(relative_target(link_path, target_path))
    return f"linked: {link_rel} -> {target_rel}"


def validate_required_documents(repo_root: Path, registry: dict) -> list[str]:
    results = []
    for entry in registry.get("documents", []):
        if not entry.get("required"):
            continue
        target = repo_root / entry["path"]
        status = "ok" if target.exists() else "missing"
        results.append(f"{status}: {entry['id']} -> {entry['path']}")
    return results


def main() -> int:
    repo_root = find_repo_root(Path(__file__).resolve().parent)
    registry = load_registry(repo_root)

    print("== Governance Sync ==")
    print(f"repo_root: {repo_root}")

    sync_results = []
    for item in registry.get("runtime", {}).get("compatibility_links", []):
        sync_results.append(
            ensure_symlink(repo_root, item["link"], item["target"])
        )

    validation_results = validate_required_documents(repo_root, registry)

    print("-- compatibility --")
    for result in sync_results:
        print(result)

    print("-- required documents --")
    for result in validation_results:
        print(result)

    if any(result.startswith("missing") for result in validation_results):
        return 1
    if any(result.startswith("conflict") for result in sync_results):
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
