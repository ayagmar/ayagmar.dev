# 0001. Record decisions as ADRs

Status: accepted, 2026-10-26

## Context

The site is built by several agents and pull requests over time. Without a written record, a later change can undo a choice whose reason nobody remembers.

## Decision

Every decision that shapes the code, the tooling or the deploy gets a short ADR in `docs/adr/`, numbered `NNNN-title.md`, with three sections: context, decision, consequences. A superseded ADR stays and links to the one that replaces it.

## Consequences

Reviewers can ask "which ADR covers this?" A change that contradicts an ADR updates or supersedes it in the same pull request.
