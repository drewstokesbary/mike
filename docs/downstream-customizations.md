# Downstream customizations

This fork tracks Mike OSS at `Open-Legal-Products/mike` while retaining a small
set of deployment-specific behavior. Keep this file current whenever the fork
intentionally differs from `upstream/main`.

## Current intentional differences

### Render network binding

- File: `backend/src/index.ts`
- Invariant: read Render's runtime `PORT`, convert it to a number, and listen on
  `HOST` with a default of `0.0.0.0`.
- Reason: Render must be able to reach the backend process on its assigned port
  and a non-loopback interface.
- Upstream interaction: retain upstream startup checks (including manifest-key
  validation) around this binding rather than replacing the complete entrypoint.
- Validation: `npm run build --prefix backend`, backend tests, and a backend
  Docker image build.

### Anthropic prompt caching

- File: `backend/src/lib/llm/claude.ts`
- Invariant: streaming conversations use Anthropic's one-hour ephemeral cache;
  short, non-streaming completions use the default ephemeral cache.
- Reason: reduce repeated-input cost during long document-assisted chats while
  avoiding an unnecessarily long cache for lightweight requests.
- Upstream interaction: keep cache configuration inside the Claude adapter. Do
  not add provider-specific cache fields to shared LLM types or other adapters.
- Validation: backend TypeScript build and test suite. When changing the
  Anthropic SDK, also verify that both `messages.stream` and `messages.create`
  still accept the configured `cache_control` values.

### Move chats between General Assistant and projects

- Backend files: `backend/src/lib/chatMovement.ts` and the dedicated
  `PATCH /chat/:chatId/project` registration in `backend/src/routes/chat.ts`.
- Frontend files: `frontend/src/app/components/assistant/MoveChatDialog.tsx`,
  with narrow calls from the sidebar, API client, and chat-history context.
- Invariant: only the chat creator can move it; a destination project must be
  accessible to that creator; `project_id: null` moves it to General Assistant.
- Visibility rule: the UI warns before moving a chat into a project that has
  shared members, because those members gain access to the chat.
- Upstream interaction: do not fold movement into the title-renaming endpoint
  or duplicate project-access rules in the UI. Keep the service and dialog as
  the feature's primary integration surfaces.
- Validation: focused service/route/API tests plus both complete test suites and
  production builds.

### Anthropic native web research

- Files: `backend/src/lib/llm/anthropicServerTools.ts`,
  `backend/src/lib/llm/webResearchPolicy.ts`, narrow hooks in the Claude adapter
  and stream types, and the existing frontend event/citation components.
- Invariant: Claude models receive Anthropic's native basic web search and web
  fetch tools; fetched-source citations are enabled; legal research prioritizes
  primary government/court sources and CourtListener, while secondary sources
  remain available as fallback.
- Cache invariant: server-tool definitions must not introduce their own
  default five-minute cache markers after Mike has selected the conversation's
  one-hour cache policy; Anthropic rejects mixed TTLs in that order.
- Upstream interaction: provider protocol and research policy stay in new
  provider-specific modules. Shared adapter changes remain a callback plus an
  optional result field. Web sources extend Mike's citation UI rather than
  creating a parallel citation system.
- Validation: SDK protocol unit tests, web-citation UI tests, TypeScript builds,
  and backend/frontend suites. Re-check tool versions when upgrading the SDK.

### Provider-neutral S3 storage configuration

- Files: `backend/src/lib/storage.ts`, `backend/.env.example`, and
  `backend/scripts/migrate-s3-storage.ts`.
- Invariant: `STORAGE_*` config selects any S3-compatible provider with an
  explicit region; legacy `R2_*` variables remain a complete fallback. Object
  keys and all application storage operations are unchanged.
- Reason: permit a staged, reversible move from Cloudflare R2 to the private
  `mike` bucket in the CABW Supabase project without provider logic spreading
  through document code.
- Upstream interaction: keep all provider selection behind `storage.ts` and
  preserve its public upload/download/list/delete/signed-URL API.
- Validation: config unit tests; live temporary-object upload, download, list,
  signed-URL, and delete checks; source/destination count, size, and SHA-256
  verification before Render cutover.

#### Storage rollout record (2026-08-11)

- CABW project `orzoqismohtjgdjhuypy` has a private `mike` bucket with 227
  objects totaling 145,696,740 bytes.
- All 219 distinct `storage_path` / `pdf_storage_path` values referenced by
  `document_versions` exist in that bucket; 8 objects are currently
  unreferenced and were intentionally left untouched.
- A temporary-object test passed upload, byte-identical download, prefix list,
  signed URL (HTTP 200), and deletion against the Supabase S3 endpoint.
- The local backend already targets that endpoint through legacy `R2_*` names.
- Do not delete the R2 bucket or declare source/destination hash parity until
  old R2 credentials are made available to `storage:migrate` for comparison.

## Explicitly deferred work

These are ideas, not current customizations. Do not treat them as implemented:

- final production storage cutover (until source/destination verification is
  recorded and Render has been switched).

If implemented later, isolate provider-specific behavior in its provider
adapter, storage behavior behind `backend/src/lib/storage.ts`, and chat-project
changes behind dedicated service/route functions. Add migrations rather than
editing historical migrations.

## Upstream synchronization procedure

Run from the canonical checkout at `/Users/drew/Developer/mike`:

1. Require a clean working tree and fetch both remotes.
2. Create a dated safety branch from `main`.
3. Review `git log --oneline main..upstream/main` and the upstream diff.
4. Merge `upstream/main` into `main`; do not rebase the published `main` branch.
5. Resolve conflicts by preserving the invariants above while adopting upstream
   implementations everywhere else.
6. Confirm the effective downstream delta with:

   ```bash
   git diff --stat upstream/main..main
   git diff upstream/main..main -- \
     backend/src/index.ts \
     backend/src/lib/llm/claude.ts
   ```

7. Review newly added database migrations and apply unapplied migrations in
   filename order before deploying code that depends on them.
8. Run backend and frontend builds and tests, validate Compose configuration,
   and build the backend Docker image when Docker is available.
9. Commit the merge, push `main`, and monitor Render deployment and health.
10. Update this ledger if the intentional downstream delta changed.

## Git practices

- `origin` is the personal fork; `upstream` is the OSS repository.
- Use focused commits for downstream behavior so Git history explains why each
  divergence exists.
- Enable `rerere` in this checkout so Git can reuse recorded resolutions when a
  future upstream merge repeats the same conflict.
- Never commit secrets, local `.env` files, or production database exports.
- Do not blindly preserve an old patch when upstream now provides equivalent
  behavior; preserve the invariant and adopt the upstream implementation.

## Last reconciliation

- Upstream baseline: `204d2d5` (2026-08-11)
- Downstream merge: `9bcd0d3`
- Feature integration commits: `5b71d25` (chat movement), `a27f111` (Anthropic
  web research), and `2a9e407` (provider-neutral storage).
- Effective code delta after reconciliation: Render binding, Anthropic caching
  and native web research, creator-controlled chat movement, and the
  provider-neutral storage adapter/migration utility described above.
