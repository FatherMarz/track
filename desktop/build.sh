#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:-/tmp/Track Sticky.app}
mkdir -p "$output/Contents/MacOS" "$output/Contents/Resources"
xcrun swiftc "$source_dir/TrackSticky.swift" -o "$output/Contents/MacOS/TrackSticky" -framework AppKit -framework WebKit -module-cache-path "${TMPDIR:-/tmp}/track-sticky-module-cache"
cp "$source_dir/Info.plist" "$output/Contents/Info.plist"
codesign --force --sign - "$output"
printf '%s\n' "$output"
