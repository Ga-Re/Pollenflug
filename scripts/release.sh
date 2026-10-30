#!/usr/bin/env bash
# Neues Release erstellen: ./scripts/release.sh 1.2.0
#
# Vorher in CHANGELOG.md einen Abschnitt "## [1.2.0] - JJJJ-MM-TT" schreiben und committen.
# Das Skript setzt die Version in pollenflug-card.js, committet, taggt und pusht.
# Den Rest (GitHub-Release mit pollenflug-card.js als Anhang) erledigt .github/workflows/release.yml.
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "Aufruf: $0 <version>   z. B. $0 1.2.0 oder $0 1.2.0-beta.1" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Es gibt nicht committete Änderungen. Bitte erst committen." >&2
  exit 1
fi
if ! grep -qF "## [$VERSION]" CHANGELOG.md; then
  echo "CHANGELOG.md hat keinen Abschnitt \"## [$VERSION]\"." >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  echo "Tag v$VERSION existiert bereits." >&2
  exit 1
fi

sed -i.bak "s/^const VERSION = \".*\";$/const VERSION = \"$VERSION\";/" pollenflug-card.js
rm -f pollenflug-card.js.bak
if ! git diff --quiet; then
  git commit -am "Release v$VERSION"
fi

git tag -a "v$VERSION" -m "v$VERSION"
git push origin HEAD "v$VERSION"
echo "Tag v$VERSION gepusht – das Release wird jetzt auf GitHub erstellt."
