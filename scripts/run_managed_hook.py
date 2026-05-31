#!/usr/bin/env python3

import json
import os
import subprocess
import sys
from pathlib import Path


REGISTRY_RELATIVE_PATH = Path(
    "harness-manager-治理管理/runtime-config-AI运行配置/config-配置文件/project-governance-项目治理注册表.json"
)


def find_workspace_root(start: Path) -> Path:
    current = start.resolve()
    for candidate in [current, *current.parents]:
        if (candidate / REGISTRY_RELATIVE_PATH).exists():
            return candidate
    raise FileNotFoundError("project governance registry not found")


def load_registry(workspace_root: Path) -> dict:
    return json.loads((workspace_root / REGISTRY_RELATIVE_PATH).read_text(encoding="utf-8"))


def find_execution_root(workspace_root: Path) -> Path:
    override = (
        os.environ.get("PRICE_V3_EXECUTION_ROOT")
        or os.environ.get("PRICE_V2_EXECUTION_ROOT")
    )
    if override:
        return Path(override).resolve()

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=Path.cwd(),
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        result = None

    if result and result.returncode == 0:
        return Path(result.stdout.strip()).resolve()

    return workspace_root


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: run_managed_hook.py <hook-id> [args...]", file=sys.stderr)
        return 1

    hook_id = sys.argv[1]
    passthrough = sys.argv[2:]
    workspace_root = find_workspace_root(Path(__file__).resolve().parent)
    execution_root = find_execution_root(workspace_root)
    registry = load_registry(workspace_root)
    commands = (
        registry.get("runtime", {})
        .get("harness", {})
        .get("hook_commands", {})
    )
    config = commands.get(hook_id)

    if not config:
        print(f"Unknown managed hook: {hook_id}", file=sys.stderr)
        return 1

    command = config["command"]
    target = workspace_root / config["path"]

    if not target.exists():
        print(f"Managed hook target not found: {target}", file=sys.stderr)
        return 1

    env = os.environ.copy()
    env["PRICE_V3_WORKSPACE_ROOT"] = str(workspace_root)
    env["PRICE_V3_REPO_ROOT"] = str(execution_root)
    env["PRICE_V3_GOVERNANCE_REGISTRY"] = str(workspace_root / REGISTRY_RELATIVE_PATH)
    # Backward compatibility for scripts that still read the old names.
    env["PRICE_V2_WORKSPACE_ROOT"] = env["PRICE_V3_WORKSPACE_ROOT"]
    env["PRICE_V2_REPO_ROOT"] = env["PRICE_V3_REPO_ROOT"]
    env["PRICE_V2_GOVERNANCE_REGISTRY"] = env["PRICE_V3_GOVERNANCE_REGISTRY"]

    result = subprocess.run(
        [command, str(target), *passthrough],
        cwd=execution_root,
        env=env,
        check=False
    )
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
