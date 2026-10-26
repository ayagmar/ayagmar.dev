#!/usr/bin/env bash
# Installs the pinned command-line tools Workers Builds does not ship into ./.tools/bin,
# verifying each download against its pinned sha256. Locally, mise provides the same tools.
# Usage: ./scripts/bootstrap.sh && .tools/bin/just <recipe>
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="${root}/.tools/bin"
mkdir -p "${bin}"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) target="x86_64-unknown-linux-musl" ;;
  Linux-aarch64 | Linux-arm64) target="aarch64-unknown-linux-musl" ;;
  *)
    echo "bootstrap: unsupported platform $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

# download <url> <sha256> <file>
download() {
  curl --fail --silent --show-error --location --retry 3 --output "$3" "$1"
  if ! echo "$2  $3" | sha256sum --check --status; then
    echo "bootstrap: checksum mismatch for $1" >&2
    exit 1
  fi
}

# just: https://github.com/casey/just/releases (SHA256SUMS of the release)
just_version="1.59.0"
declare -A just_sha256=(
  [x86_64-unknown-linux-musl]="409044617b6f06517c1035e55ca38c8c856ff8b650e41bc2aa1ef82d5903a23e"
  [aarch64-unknown-linux-musl]="23871b1702bfd550fb5f901778fd4290ecf2ee034a45a889fbe96d89b188086d"
)
if [[ "$("${bin}/just" --version 2>/dev/null || true)" != "just ${just_version}" ]]; then
  archive="${tmp}/just.tar.gz"
  download \
    "https://github.com/casey/just/releases/download/${just_version}/just-${just_version}-${target}.tar.gz" \
    "${just_sha256[${target}]}" "${archive}"
  tar --extract --gzip --file "${archive}" --directory "${tmp}" just
  install -m 0755 "${tmp}/just" "${bin}/just"
fi

# typst: https://github.com/typst/typst/releases (sha256 digests of the release assets)
typst_version="0.15.1"
declare -A typst_sha256=(
  [x86_64-unknown-linux-musl]="a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c"
  [aarch64-unknown-linux-musl]="5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee"
)
if [[ "$("${bin}/typst" --version 2>/dev/null || true)" != "typst ${typst_version} "* ]]; then
  archive="${tmp}/typst.tar.xz"
  download \
    "https://github.com/typst/typst/releases/download/v${typst_version}/typst-${target}.tar.xz" \
    "${typst_sha256[${target}]}" "${archive}"
  tar --extract --xz --file "${archive}" --directory "${tmp}" --strip-components 1 "typst-${target}/typst"
  install -m 0755 "${tmp}/typst" "${bin}/typst"
fi

echo "bootstrap: $("${bin}/just" --version), $("${bin}/typst" --version) in .tools/bin"
