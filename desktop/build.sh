#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:-/tmp/Track.app}
mkdir -p "$output/Contents/MacOS" "$output/Contents/Resources"
xcrun swiftc "$source_dir/TrackSticky.swift" -o "$output/Contents/MacOS/TrackSticky" -framework AppKit -framework WebKit -module-cache-path "${TMPDIR:-/tmp}/track-sticky-module-cache"
cp "$source_dir/Info.plist" "$output/Contents/Info.plist"
cp "$source_dir/Track.icns" "$output/Contents/Resources/Track.icns"
codesign --force --sign - "$output"
printf '%s\n' "$output"
