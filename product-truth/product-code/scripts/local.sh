#!/bin/sh
# REQ: WP10 本机迁移恢复。只选择当前进程的 Node，不改变系统配置。
set -eu
if [ -x /opt/homebrew/opt/node@24/bin/node ]; then
  PATH="/opt/homebrew/opt/node@24/bin:$PATH"
elif [ -x /usr/local/opt/node@24/bin/node ]; then
  PATH="/usr/local/opt/node@24/bin:$PATH"
fi
export PATH
if [ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]; then
  echo '本项目本地运行需要 Node 24；请先安装或切换到 Node 24。' >&2
  exit 1
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$script_dir/local.mjs" "$@"
