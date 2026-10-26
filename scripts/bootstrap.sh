#!/usr/bin/env bash
# Installs the pinned command-line tools Workers Builds does not ship into ./.tools/bin,
# verifying each download against its pinned sha256. Locally, mise provides the same tools.
# Usage: ./scripts/bootstrap.sh && .tools/bin/just <recipe>
# With arguments it also installs the named CI tools (Linux x86_64 only), for example
# `./scripts/bootstrap.sh gitleaks lychee`. The justfile recipes that need them call this.
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

# download <url> <sha256> <file>
download() {
  curl --fail --silent --show-error --location --retry 3 --output "$3" "$1"
  if ! echo "$2  $3" | sha256sum --check --status; then
    echo "bootstrap: checksum mismatch for $1" >&2
    exit 1
  fi
}

# just: https://github.com/casey/just/releases (SHA256SUMS of the release)
# renovate: datasource=github-releases depName=casey/just
just_version="1.59.0"
declare -A just_sha256=(
  ["x86_64-unknown-linux-musl"]="409044617b6f06517c1035e55ca38c8c856ff8b650e41bc2aa1ef82d5903a23e"
  ["aarch64-unknown-linux-musl"]="23871b1702bfd550fb5f901778fd4290ecf2ee034a45a889fbe96d89b188086d"
)
if [[ "$("${bin}/just" --version 2>/dev/null || true)" != "just ${just_version}" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp}"' EXIT
  archive="${tmp}/just.tar.gz"
  download \
    "https://github.com/casey/just/releases/download/${just_version}/just-${just_version}-${target}.tar.gz" \
    "${just_sha256[${target}]}" "${archive}"
  tar --extract --gzip --file "${archive}" --directory "${tmp}" just
  install -m 0755 "${tmp}/just" "${bin}/just"
fi

# typst: added with the resume build.

# CI tools. Each entry: version, release asset URL, sha256 of the asset, path of the binary
# inside the archive ("-" when the asset is the binary itself). The sha256 is the one GitHub
# records for the release asset, and matches the project's own checksum file where it has one.
declare -A tool_version tool_url tool_sha256 tool_path
# renovate: datasource=github-releases depName=gitleaks/gitleaks
tool_version["gitleaks"]="8.30.1"
tool_url["gitleaks"]="https://github.com/gitleaks/gitleaks/releases/download/v{v}/gitleaks_{v}_linux_x64.tar.gz"
tool_sha256["gitleaks"]="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
tool_path["gitleaks"]="gitleaks"
# renovate: datasource=github-releases depName=google/osv-scanner
tool_version["osv-scanner"]="2.7.0"
tool_url["osv-scanner"]="https://github.com/google/osv-scanner/releases/download/v{v}/osv-scanner_linux_amd64"
tool_sha256["osv-scanner"]="160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b"
tool_path["osv-scanner"]="-"
# renovate: datasource=github-releases depName=lycheeverse/lychee extractVersion=^lychee-v(?<version>.+)$
tool_version["lychee"]="0.24.2"
tool_url["lychee"]="https://github.com/lycheeverse/lychee/releases/download/lychee-v{v}/lychee-x86_64-unknown-linux-musl.tar.gz"
tool_sha256["lychee"]="73657a111819a30c47c08352896796f23d64e4eb2b3ed39b6d32149241566fc5"
tool_path["lychee"]="lychee-x86_64-unknown-linux-musl/lychee"
# renovate: datasource=github-releases depName=rhysd/actionlint
tool_version["actionlint"]="1.7.12"
tool_url["actionlint"]="https://github.com/rhysd/actionlint/releases/download/v{v}/actionlint_{v}_linux_amd64.tar.gz"
tool_sha256["actionlint"]="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
tool_path["actionlint"]="actionlint"
# renovate: datasource=github-releases depName=zizmorcore/zizmor
tool_version["zizmor"]="1.31.1"
tool_url["zizmor"]="https://github.com/zizmorcore/zizmor/releases/download/v{v}/zizmor-x86_64-unknown-linux-gnu.tar.gz"
tool_sha256["zizmor"]="d185f726bdaf92df78273217dfdd24ebcd6b0ef48cf3ce776ff5762b6e138c99"
tool_path["zizmor"]="zizmor"
# renovate: datasource=github-releases depName=koalaman/shellcheck
tool_version["shellcheck"]="0.11.0"
tool_url["shellcheck"]="https://github.com/koalaman/shellcheck/releases/download/v{v}/shellcheck-v{v}.linux.x86_64.tar.xz"
tool_sha256["shellcheck"]="8c3be12b05d5c177a04c29e3c78ce89ac86f1595681cab149b65b97c4e227198"
tool_path["shellcheck"]="shellcheck-v{v}/shellcheck"
# renovate: datasource=github-releases depName=mvdan/sh
tool_version["shfmt"]="3.14.1"
tool_url["shfmt"]="https://github.com/mvdan/sh/releases/download/v{v}/shfmt_v{v}_linux_amd64"
tool_sha256["shfmt"]="76e77641faa025814b77f153b29796b8e6fa2fca03e0c76a691608b86c7ea7bf"
tool_path["shfmt"]="-"

for name in "$@"; do
  if [[ -z "${tool_version[${name}]:-}" ]]; then
    echo "bootstrap: unknown tool ${name} (known: ${!tool_version[*]})" >&2
    exit 1
  fi
  if [[ "${target}" != "x86_64-unknown-linux-musl" ]]; then
    echo "bootstrap: ${name} is pinned for Linux x86_64 only" >&2
    exit 1
  fi
  version="${tool_version[${name}]}"
  # A stamp per version, so a changed pin installs again.
  stamp="${bin}/.${name}-${version}"
  [[ -x "${bin}/${name}" && -f "${stamp}" ]] && continue
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp}"' EXIT
  url="${tool_url[${name}]//\{v\}/${version}}"
  path="${tool_path[${name}]//\{v\}/${version}}"
  asset="${tmp}/$(basename "${url}")"
  download "${url}" "${tool_sha256[${name}]}" "${asset}"
  if [[ "${path}" == "-" ]]; then
    install -m 0755 "${asset}" "${bin}/${name}"
  else
    tar --extract --file "${asset}" --directory "${tmp}" "${path}"
    install -m 0755 "${tmp}/${path}" "${bin}/${name}"
  fi
  rm -f "${bin}/.${name}-"*
  touch "${stamp}"
  rm -rf "${tmp}"
  echo "bootstrap: ${name} ${version} in .tools/bin"
done

echo "bootstrap: $("${bin}/just" --version) in .tools/bin"
