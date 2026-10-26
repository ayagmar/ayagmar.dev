#!/usr/bin/env bash
# Applies the repository's merge settings and the `main` branch ruleset (ADR 0018). Safe to run
# again: it updates the ruleset named "main" when it exists. Needs `gh` logged in as a repo admin.
# Usage: ./scripts/repo-ruleset.sh [ref]   (ref: a commit whose CI ran `gate`; default main)
#
# The ruleset: changes reach main only through a pull request (0 approvals: a solo repo, the
# owner cannot approve their own PRs), the `gate` check reported by the GitHub Actions app must
# pass (branches need not be up to date first), no force pushes, no deletion, merge commits
# only. Nobody bypasses it. The repo allows auto-merge, so Renovate can queue patch and minor
# updates that merge once `gate` is green. Workflows on a pull request from any outside
# contributor wait for the owner's approval before they run.
set -euo pipefail

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
ref="${1:-main}"

# Bind `gate` to the app that really reports it, so a status from any other source (another
# app, or a commit status anyone with write access can set) cannot satisfy the rule.
read -r app_slug app_id < <(
  gh api "repos/${repo}/commits/${ref}/check-runs?check_name=gate" \
    --jq '.check_runs[0] | "\(.app.slug // "") \(.app.id // "")"'
) || true
if [[ "${app_slug:-}" != "github-actions" || -z "${app_id:-}" ]]; then
  echo "repo-ruleset: no gate check run from GitHub Actions on ${ref}; run CI there first" >&2
  exit 1
fi

gh api --method PATCH "repos/${repo}" \
  -F allow_merge_commit=true -F allow_auto_merge=true >/dev/null

# Fork pull requests run no workflow until the owner approves the run, first-time or not. The
# body goes as JSON: `-f approval_policy=...` is accepted and changes nothing.
approval="repos/${repo}/actions/permissions/fork-pr-contributor-approval"
gh api --method PUT "${approval}" --input - <<<'{"approval_policy":"all_external_contributors"}'
policy="$(gh api "${approval}" --jq .approval_policy)"
if [[ "${policy}" != "all_external_contributors" ]]; then
  echo "repo-ruleset: fork pull request approval is ${policy}, not all_external_contributors" >&2
  exit 1
fi

ruleset="$(
  cat <<EOF
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "gate", "integration_id": ${app_id} }]
      }
    }
  ]
}
EOF
)"

id="$(gh api "repos/${repo}/rulesets" --jq '.[] | select(.name == "main") | .id')"
if [[ -n "${id}" ]]; then
  gh api --method PUT "repos/${repo}/rulesets/${id}" --input - <<<"${ruleset}" >/dev/null
  echo "repo-ruleset: updated ruleset ${id} on ${repo} (gate from app ${app_id})"
else
  id="$(gh api --method POST "repos/${repo}/rulesets" --input - --jq .id <<<"${ruleset}")"
  echo "repo-ruleset: created ruleset ${id} on ${repo} (gate from app ${app_id})"
fi
