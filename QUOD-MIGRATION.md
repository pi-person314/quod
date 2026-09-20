# Quod rename

Quod is the new project name. The web UI, workspace packages (`@quod/*`),
Python package (`quod_worker`), worker command (`quod-worker`), and active
setup instructions use the new name.

## Existing installations

Uploaded documents and the API spending ledger stay in the existing database.
The rename is not a database migration. Existing database credentials, Docker
storage, Elasticsearch index names, budget keys, and SQL function names retain
their original identifiers for compatibility. Do not delete volumes or reset
the budget to apply the rename.

`QUOD_*` environment settings are preferred; existing `CAIRN_*` settings remain
supported. Your private `.env` does not need to be shared or rewritten.
The legacy `cairn-worker` entry point remains compatible. Newly installed
workers provide `quod-worker`.

The reader reads saved progress from `quod.reader.v1`, falling back to
`cairn.reader.v1`, and saves subsequent changes under the new key. This includes
reading positions, known results, and available pinned cards.

The repository's on-disk directory and Git remote are not renamed. Historical
evidence paths and the original specification PDF retain their real filenames.
Those references identify existing artifacts rather than current branding.

## Verification and startup

Run `pnpm install --frozen-lockfile` after updating the renamed workspace
packages. Refresh the worker installation using your virtual environment's
Python: `python -m pip install -e "apps/worker[dev]"` from the project root.

Build without opening any environment files:

```sh
node apps/web/scripts/isolated-verification.mjs build
```

The existing launcher reloads a successful build automatically. For a new
terminal, the user starts it with:

```sh
node --env-file=.env apps/web/scripts/start-local.mjs
```

## Design source

The user supplied `Quod - UI mockups.html` after the Claude link was blocked. Its seven artboards are the reference for the implemented pages. See [the current design brief](apps/web/DESIGN.md). The upstream Firebase Google OAuth and Firestore ownership changes were merged before final verification.
