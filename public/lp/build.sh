#!/bin/bash
# Build script: copy only public files to dist/
# Prevents .env, SQL, shell scripts, docs, config from being published

set -e

DIST="dist"

# Clean previous build
rm -rf "$DIST"
mkdir -p "$DIST"

# Copy HTML files (root level only)
cp -f *.html "$DIST/" 2>/dev/null || true

# Copy public asset directories
for dir in css js assets images sounds includes img dl; do
  if [ -d "$dir" ]; then
    cp -r "$dir" "$DIST/"
  fi
done

# Copy Netlify-specific files
cp -f _headers "$DIST/" 2>/dev/null || true
cp -f _redirects "$DIST/" 2>/dev/null || true
cp -f favicon.ico "$DIST/" 2>/dev/null || true
cp -f favicon.svg "$DIST/" 2>/dev/null || true
cp -f robots.txt "$DIST/" 2>/dev/null || true
cp -f sitemap.xml "$DIST/" 2>/dev/null || true

echo "Build complete: public files copied to $DIST/"
