#!/usr/bin/env bash
#
# Patches agent.py and MCP config in existing user rootfs images without
# rebuilding from scratch. User data (home directory, installed packages,
# conversations, etc.) is preserved.
#
# What gets updated:
#   - /opt/agent.py                              (agent daemon)
#   - /etc/systemd/system/agent.service          (agent service unit)
#   - /etc/systemd/system/mcp-proxy.service      (MCP proxy, if --mcp-base-url set)
#   - Claude CLI (/home/ubuntu/.local/bin/claude) (if --update-cli set)
#
# Usage:
#   sudo ./scripts/patch_rootfs.sh [options]
#
# Options:
#   --rootfs <path>         Patch a single rootfs image
#   --chroot-base <path>    Patch all user rootfs images under the chroot base
#                           (default: /srv/jailer)
#   --mcp-base-url <url>    Configure MCP proxy (e.g. https://34.49.122.135)
#   --update-cli            Also update the Claude CLI
#   --dry-run               Show what would be patched without making changes
#
# Examples:
#   sudo ./scripts/patch_rootfs.sh --chroot-base /srv/jailer
#   sudo ./scripts/patch_rootfs.sh --rootfs /srv/jailer/firecracker/<user-id>/root/rootfs.ext4
#   sudo ./scripts/patch_rootfs.sh --chroot-base /srv/jailer --mcp-base-url https://34.49.122.135
#   sudo ./scripts/patch_rootfs.sh --chroot-base /srv/jailer --update-cli

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_PY="$REPO_ROOT/rootfs/agent.py"
AGENT_SERVICE="$REPO_ROOT/rootfs/agent.service"
CLAUDE_UPDATE_SERVICE="$REPO_ROOT/rootfs/claude-update.service"

CHROOT_BASE="/srv/jailer"
SINGLE_ROOTFS=""
MCP_BASE_URL=""
UPDATE_CLI=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --rootfs)       SINGLE_ROOTFS="$2"; shift 2 ;;
        --chroot-base)  CHROOT_BASE="$2"; shift 2 ;;
        --mcp-base-url) MCP_BASE_URL="$2"; shift 2 ;;
        --update-cli)   UPDATE_CLI=true; shift ;;
        --dry-run)      DRY_RUN=true; shift ;;
        -h|--help)
            sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ ! -f "$AGENT_PY" ]; then
    echo "ERROR: agent.py not found at $AGENT_PY"
    exit 1
fi
if [ ! -f "$AGENT_SERVICE" ]; then
    echo "ERROR: agent.service not found at $AGENT_SERVICE"
    exit 1
fi

# Build the patched agent.py content (with MCP_SERVERS if needed)
build_patched_agent() {
    local content
    content="$(cat "$AGENT_PY")"
    if [ -n "$MCP_BASE_URL" ]; then
        local mcp_servers_value
        mcp_servers_value='{\n    "gemini-websearch": {\n        "type": "http",\n        "url": f"http://localhost:{MCP_PROXY_PORT}/mcp",\n    },\n}'
        content="${content/MCP_SERVERS: dict = \{\}/MCP_SERVERS: dict = $mcp_servers_value}"
    fi
    echo "$content"
}

# Build the MCP proxy service unit
build_mcp_proxy_service() {
    local url="$1"
    local host port upstream scheme
    # Parse URL components
    scheme="${url%%://*}"
    local hostport="${url#*://}"
    hostport="${hostport%%/*}"
    if [[ "$hostport" == *:* ]]; then
        host="${hostport%%:*}"
        port="${hostport##*:}"
    else
        host="$hostport"
        if [ "$scheme" = "https" ]; then
            port=443
        else
            port=80
        fi
    fi

    if [ "$scheme" = "https" ]; then
        upstream="OPENSSL:${host}:${port},verify=0"
    else
        upstream="TCP:${host}:${port}"
    fi

    cat <<EOF
[Unit]
Description=MCP reverse proxy (socat)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/socat TCP-LISTEN:8443,fork,reuseaddr,bind=127.0.0.1 ${upstream}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
}

# Patch a single rootfs ext4 image
patch_one() {
    local rootfs_path="$1"
    local mountpoint
    mountpoint="$(mktemp -d)"

    echo "PATCH $rootfs_path"

    if [ "$DRY_RUN" = true ]; then
        echo "  [dry-run] would mount, patch agent.py + agent.service, unmount"
        [ -n "$MCP_BASE_URL" ] && echo "  [dry-run] would patch mcp-proxy.service"
        [ "$UPDATE_CLI" = true ] && echo "  [dry-run] would update Claude CLI"
        rmdir "$mountpoint"
        return
    fi

    mount "$rootfs_path" "$mountpoint"
    trap "umount '$mountpoint' 2>/dev/null; rmdir '$mountpoint' 2>/dev/null" EXIT

    # Patch agent.py
    local agent_dest="$mountpoint/opt/agent.py"
    mkdir -p "$mountpoint/opt"
    build_patched_agent > "$agent_dest"
    chown 1000:1000 "$agent_dest"
    echo "  updated /opt/agent.py"

    # Patch agent.service
    local service_dest="$mountpoint/etc/systemd/system/agent.service"
    mkdir -p "$mountpoint/etc/systemd/system/multi-user.target.wants"
    cp "$AGENT_SERVICE" "$service_dest"
    local service_link="$mountpoint/etc/systemd/system/multi-user.target.wants/agent.service"
    if [ ! -L "$service_link" ]; then
        ln -s "../agent.service" "$service_link"
    fi
    echo "  updated /etc/systemd/system/agent.service"

    # Patch claude-update.service
    local update_dest="$mountpoint/etc/systemd/system/claude-update.service"
    cp "$CLAUDE_UPDATE_SERVICE" "$update_dest"
    local update_link="$mountpoint/etc/systemd/system/multi-user.target.wants/claude-update.service"
    if [ ! -L "$update_link" ]; then
        ln -s "../claude-update.service" "$update_link"
    fi
    echo "  updated /etc/systemd/system/claude-update.service"

    # Patch MCP proxy service
    if [ -n "$MCP_BASE_URL" ]; then
        local proxy_dest="$mountpoint/etc/systemd/system/mcp-proxy.service"
        build_mcp_proxy_service "$MCP_BASE_URL" > "$proxy_dest"
        local proxy_link="$mountpoint/etc/systemd/system/multi-user.target.wants/mcp-proxy.service"
        if [ ! -L "$proxy_link" ]; then
            ln -s "../mcp-proxy.service" "$proxy_link"
        fi
        echo "  updated /etc/systemd/system/mcp-proxy.service"
    fi

    # Update Claude CLI
    if [ "$UPDATE_CLI" = true ]; then
        # Mount necessary filesystems for chroot
        mount --bind /proc "$mountpoint/proc"
        mount --bind /sys "$mountpoint/sys"
        mount --bind /dev "$mountpoint/dev"
        mount --bind /etc/resolv.conf "$mountpoint/etc/resolv.conf"

        chroot "$mountpoint" su - ubuntu -c \
            'bash -lc "curl -fsSL https://claude.ai/install.sh | bash"' || \
            echo "  WARNING: Claude CLI update failed (non-fatal)"

        umount "$mountpoint/etc/resolv.conf" 2>/dev/null || true
        umount "$mountpoint/dev" 2>/dev/null || true
        umount "$mountpoint/sys" 2>/dev/null || true
        umount "$mountpoint/proc" 2>/dev/null || true
        echo "  updated Claude CLI"
    fi

    umount "$mountpoint"
    rmdir "$mountpoint"
    trap - EXIT
    echo "  done"
}

# Main
patched=0

if [ -n "$SINGLE_ROOTFS" ]; then
    if [ ! -f "$SINGLE_ROOTFS" ]; then
        echo "ERROR: rootfs not found: $SINGLE_ROOTFS"
        exit 1
    fi
    patch_one "$SINGLE_ROOTFS"
    patched=1
else
    if [ ! -d "$CHROOT_BASE/firecracker" ]; then
        echo "No user chroots found under $CHROOT_BASE/firecracker"
        exit 0
    fi
    for rootfs in "$CHROOT_BASE"/firecracker/*/root/rootfs.ext4; do
        [ -f "$rootfs" ] || continue
        patch_one "$rootfs"
        patched=$((patched + 1))
    done
fi

echo ""
echo "Patched $patched rootfs image(s)."
