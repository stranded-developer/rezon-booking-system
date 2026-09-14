# Step 1a — Monorepo scaffold ✅

**Date:** 2026-09-14

**Done**
- Root: `package.json` (turbo scripts), `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.gitignore`.
- `packages/config`: strict shared `tsconfig.base.json`, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Not yet created:** `apps/*`, `packages/db`, `packages/ui`, `packages/types`. Each is added in its own phase so nothing ships untested.

**Verified**
- `pnpm install` resolves cleanly with a lockfile.
- `pnpm typecheck` and `pnpm build` run through Turborepo and succeed.

**Toolchain notes**
- The global `pnpm` on this machine (under Node 20) is a newer major that needs Node ≥ 22.13, so it fails under Node 20.
- The project is pinned to Node 22 + pnpm 9.15.9 through corepack. Run commands as `corepack pnpm …`, or run `nvm use 22 && corepack enable` once.
- Vitest 4 needs Node ≥ 22.12, which is another reason for Node 22.
