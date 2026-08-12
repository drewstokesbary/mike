# Mike downstream maintenance

This checkout is the canonical editable Mike fork. It tracks
`Open-Legal-Products/mike` through the `upstream` Git remote and intentionally
retains the differences documented in `docs/downstream-customizations.md`.

## Upstream reconciliation is semantic, not merely textual

Whenever fetching, merging, or otherwise adopting upstream Mike changes, read
`docs/downstream-customizations.md` before resolving or validating the update.
For every documented customization, compare its intended behavior and
architecture with the new upstream code, including upstream changes that do not
produce a Git conflict.

Classify each customization as one of the following:

- **Retire**: upstream now supplies the same behavior. Remove the downstream
  implementation and its redundant tests; use and validate upstream's version.
- **Reshape**: upstream supplies part of the behavior or introduces a new
  architecture/extension point. Keep only the unmet downstream requirement and
  reimplement it around upstream's patterns, types, services, routes, UI, and
  tests. Prefer consistency with upstream over preserving downstream code
  structure or Git history.
- **Retain**: upstream still supplies no equivalent behavior or suitable
  extension point. Preserve the smallest isolated implementation that maintains
  the documented invariant.

Do not treat a clean automatic merge, absence of overlapping lines, or passing
tests as proof that a customization remains appropriate. Review upstream commit
messages and diffs by feature area, search for functional overlap, and examine
adjacent upstream architecture before deciding.

Before pushing an upstream reconciliation:

1. Record the Retire/Reshape/Retain decision and reasoning for every active
   customization in the ledger's latest-reconciliation section.
2. Remove obsolete downstream code rather than leaving parallel implementations.
3. Update each affected ledger entry, file list, invariant, upstream interaction,
   and validation guidance.
4. Compare `upstream/main..main` and justify every remaining intentional code
   difference.
5. Run the validation appropriate to both the upstream changes and every
   retained or reshaped customization.

When adding a new customization, add it to the ledger in the same commit and
describe its behavioral invariant, reason, integration surfaces, expected
upstream adoption/retirement trigger, and validation.
