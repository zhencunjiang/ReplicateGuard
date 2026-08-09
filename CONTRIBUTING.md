# Contributing to ReplicateGuard

ReplicateGuard welcomes reproducible bug reports, focused feature proposals,
documentation improvements and validated code contributions for non-commercial
research use.

## Before contributing

- Do not submit identifiable human data, protected health information,
  credentials or data that you are not permitted to redistribute.
- Open an issue before a large algorithmic change so that scope, validation and
  reporting requirements can be agreed in advance.
- Keep method claims proportional to the supplied benchmark evidence.
- Preserve deterministic behavior unless the proposed change documents and
  tests its randomness.

## Development checks

Run the Python suite from the repository root:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Run interface checks with Node.js 24 and pnpm 11:

```bash
cd desktop && pnpm install --frozen-lockfile && pnpm check
cd ../web && pnpm install --frozen-lockfile && pnpm check
```

For changes to cell calling, doublet scoring or design diagnostics, include a
small deterministic regression test and explain the expected scientific
effect. For public-data benchmarks, record source URLs, checksums, parameters,
software versions and comparison limitations.

## Pull requests

Use a focused branch and describe the purpose, affected interfaces, tests and
reproducibility commands. By contributing, you agree that your contribution is
distributed under the repository's PolyForm Noncommercial License 1.0.0.
