#!/usr/bin/env bash
# Installs the freshly built AppImage into ~/.local so the app is launchable as
# `treeline` and from the desktop app menu. Idempotent — re-run after any
# `npm run dist` to upgrade in place.
set -euo pipefail
cd "$(dirname "$0")/.."

APPIMAGE=$(ls -t dist/*.AppImage 2>/dev/null | head -1) || true
if [ -z "$APPIMAGE" ]; then
  echo "error: no AppImage in dist/ — run 'npm run dist' first" >&2
  exit 1
fi

LIB="$HOME/.local/lib/treeline"
BIN="$HOME/.local/bin"
ICONS="$HOME/.local/share/icons"
APPS="$HOME/.local/share/applications"
mkdir -p "$LIB" "$BIN" "$ICONS" "$APPS"

install -m 644 build/icon.png "$ICONS/treeline.png"

# The AppImage is unpacked once, here, instead of on every launch.
#
# Without libfuse.so.2 the AppImage cannot self-mount and has to be extracted
# to be run at all. Doing that per launch (--appimage-extract-and-run) puts
# every launch of a given build in ONE content-hash-named temp directory that
# the AppImage runtime deletes when its process exits. A second launch therefore deletes the tree the first instance
# is still running from, and since electron-builder unpacks web/dist for
# express.static to read at request time, the running app quietly loses the
# ability to serve its own frontend. The single-instance lock makes this a
# certainty, since the second process exits immediately.
#
# Each deploy extracts to its own app-<stamp> directory and flips a `current`
# symlink, so a running instance keeps the tree it started from and a redeploy
# can never pull files out from under it.
STAMP=$(date +%Y%m%d%H%M%S)
NEW="$LIB/app-$STAMP"

# --appimage-extract always writes ./squashfs-root, so run it somewhere
# disposable rather than in the repo.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
APPIMAGE_ABS=$(readlink -f "$APPIMAGE")
(cd "$WORK" && "$APPIMAGE_ABS" --appimage-extract > /dev/null)
mv "$WORK/squashfs-root" "$NEW"
chmod 755 "$NEW"

# rename() over the old symlink, so no launch can catch `current` missing.
ln -sfn "$NEW" "$LIB/.current.new"
mv -T "$LIB/.current.new" "$LIB/current"

# Nothing runs the AppImage itself any more; reclaim its ~128MB.
rm -f "$LIB/treeline.AppImage"

# Prune superseded trees, but never one a running instance is executing from.
for old in "$LIB"/app-*; do
  [ -d "$old" ] && [ "$old" != "$NEW" ] || continue
  if pgrep -f "^$old/" > /dev/null 2>&1; then
    echo "note: keeping $old — an instance is still running from it"
  else
    rm -rf "$old"
  fi
done

# Launch flags live here only.
#
# The wrapper goes through the extracted tree's own AppRun rather than the
# treeline binary beside it. AppRun exports the LD_LIBRARY_PATH,
# XDG_DATA_DIRS and GSETTINGS_SCHEMA_DIR the bundled libraries expect, and it
# probes `unshare -Ur` to decide whether to add --no-sandbox — needed where
# kernel.apparmor_restrict_unprivileged_userns=1 (the default on Ubuntu
# 24.04+), but wrong to hardcode on a host whose sandbox works. AppRun handles
# being run outside an AppImage; it only execs the binary.
cat > "$BIN/treeline" <<'WRAPPER'
#!/usr/bin/env bash
exec "$HOME/.local/lib/treeline/current/AppRun" ${ELECTRON_FLAGS:-} "$@"
WRAPPER
chmod 755 "$BIN/treeline"

cat > "$APPS/treeline.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Treeline
Comment=A local desktop git client modeled on SourceTree
Exec=$HOME/.local/bin/treeline
Icon=treeline
Categories=Development;RevisionControl;
Terminal=false
StartupWMClass=Treeline
EOF

update-desktop-database "$APPS" 2>/dev/null || true

echo "installed: $BIN/treeline"
echo "           $APPS/treeline.desktop"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "note: $BIN is not on PATH — log out and back in, or add it manually." ;;
esac
