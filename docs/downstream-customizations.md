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

### Claude incomplete tool-turn and response recovery

- Files: `backend/src/lib/llm/claude.ts`, a matching core prompt rule, and
  focused adapter detection tests.
- Invariant: Mike automatically continues the provider conversation once when
  Claude (a) ends normally with a short, high-confidence promise to
  read/search/use an available tool but emits no `tool_use`, (b) reaches
  `max_tokens`, or (c) returns an empty `end_turn` after tools ran. If Claude
  repeats an incomplete outcome, Mike emits a visible error instead of silently
  persisting an incomplete answer.
- Reason: production project-chat turns twice ended after “Let me read the PDF
  in full” with no tool event; after initial recovery, a 52-page review then
  read the document but ended after adaptive thinking with no final prose.
- Observability: recovery emits a privacy-safe Render warning containing only
  model, iteration, stop/recovery reason, and completed-tool count—not prompts
  or document contents.
- Upstream interaction: retire this recovery if upstream or Anthropic provides
  equivalent stalled-tool handling. Reshape it around any upstream provider
  continuation/retry abstraction; do not broaden the heuristic to generic short
  answers or ordinary offers of future assistance.
- Validation: focused phrase-boundary and stop-reason tests, Claude adapter
  tests when provider mocks are available, backend suite/build, and a
  production project-chat test that requires reading an attached document
  before answering.

### CourtListener case-law search registration

- File: `backend/src/lib/chat/tools/courtlistenerTools.ts`.
- Invariant: every CourtListener operation implemented by the dispatcher is
  included in the tool list presented to the model. In particular,
  `courtlistener_search_case_law` supports keyword, party-name, case-name,
  court, and filing-date discovery before a cluster is fetched and read.
- Reason: upstream implemented the search operation and dispatcher branch but
  omitted its function schema, so models could verify known citations but
  could not initiate general case-law discovery.
- Upstream interaction: remove this downstream entry if upstream registers an
  equivalent search schema; preserve upstream naming and argument shapes to
  minimize future merge conflicts.
- Validation: the focused CourtListener registration test, backend TypeScript
  build, and backend test suite.

### Memory-bounded document uploads and Office conversion

- Frontend files: `frontend/src/app/lib/sequentialUploads.ts` and narrow uses
  at every multi-file document-upload surface.
- Backend files: `backend/src/lib/upload.ts`, `backend/src/lib/convert.ts`, and
  upload handlers that consume the shared disk-backed upload helper.
- Invariant: a browser uploads a selected batch one file at a time; incoming
  multipart bodies are staged in the operating system's temporary directory
  and removed when the response completes; and each backend process permits at
  most one LibreOffice conversion at a time.
- Reason: concurrent in-memory uploads and concurrent LibreOffice processes can
  exceed the 512 MiB memory allowance of the Render Starter deployment even
  when the selected files themselves are small.
- Operational boundary: the conversion lock is process-local. If the service
  is scaled to multiple instances, each instance may run one conversion. Raw
  storage upload and document conversion still read one staged file into a
  buffer because the existing storage and conversion adapters require bytes;
  disk-backed multipart staging removes the additional request-body buffer but
  is not an end-to-end streaming pipeline.
- Upstream interaction: retire the frontend helper if upstream serializes or
  bounds batch uploads. Reshape around any upstream upload job/worker,
  streaming-storage, or conversion-queue abstraction rather than retaining a
  parallel queue. Preserve the behavioral concurrency limits unless deployment
  capacity is explicitly made configurable.
- Validation: sequential-helper tests, LibreOffice lock tests, upload route
  tests, full frontend/backend suites and builds, plus a multi-DOCX upload on a
  512 MiB deployment while monitoring memory and restart events.

### Library attachments in Project Assistant

- Frontend files: the existing shared `ChatInput` and `AddDocumentsModal`, with
  the Project Assistant no longer hiding the add-document control.
- Backend file: a narrow context merge in `backend/src/routes/projectChat.ts`
  using the existing General Assistant `buildDocContext` authorization path.
- Invariant: Project Assistant users can explicitly attach accessible Library
  Files and Templates using the same Files/Templates/Projects picker as General
  Assistant. A Library selection remains in the Library and is chat context; it
  is not moved into the project. New files uploaded from a Project Assistant
  picker are project documents. Project documents remain ambient context.
- Reason: Library Templates are reusable references and should not need to be
  duplicated into, or removed from the Library for, every matter.
- Authorization boundary: non-project attachments are admitted through
  `buildDocContext`, which currently exposes ready documents owned by the user.
  Do not broaden this in the UI or bypass backend document authorization.
- Upstream interaction: retire this delta if upstream Project Assistant gains
  equivalent non-destructive Library attachment support. If upstream adds a
  unified context/attachment service, reshape the context merge and picker
  around it rather than maintaining separate project-specific behavior.
- Validation: Project Chat route tests must show that an attached Library
  template enters `docIndex`/`docStore` without a project-assignment mutation;
  run frontend/backend suites and builds and manually draft from a Template in
  a Project Assistant chat.

## Deployment configuration note: Supabase Storage

- CABW project `orzoqismohtjgdjhuypy` has a private `mike` bucket with 227
  objects totaling 145,696,740 bytes.
- All 219 distinct `storage_path` / `pdf_storage_path` values referenced by
  `document_versions` exist in that bucket; 8 objects are currently
  unreferenced and were intentionally left untouched.
- A temporary-object test passed upload, byte-identical download, prefix list,
  signed URL (HTTP 200), and deletion against the Supabase S3 endpoint.
- Bucket and object timestamps show this deployment has used Supabase Storage
  since its initial setup; there is no evidence of a separate Cloudflare R2
  bucket or an object migration.
- Mike's unchanged upstream storage adapter uses generic S3 operations but
  legacy `R2_*` environment-variable names. In this deployment those variables
  contain Supabase S3 endpoint and credential values. Do not infer the provider
  from the variable names.
- This is deployment configuration, not an intentional code difference. Keep
  the upstream storage adapter and existing Render variables unchanged unless
  upstream itself adopts a different configuration contract.

## Explicitly deferred work

There is no deferred storage migration or cutover: Supabase Storage is already
the active object store for this deployment.

If implemented later, isolate provider-specific behavior in its provider
adapter, storage behavior behind `backend/src/lib/storage.ts`, and chat-project
changes behind dedicated service/route functions. Add migrations rather than
editing historical migrations.

## Upstream synchronization procedure

Run from the canonical checkout at `/Users/drew/Developer/mike`:

1. Require a clean working tree and fetch both remotes.
2. Create a dated safety branch from `main`.
3. Read this ledger, then review `git log --oneline main..upstream/main` and the
   upstream diff by feature area. Search for behavioral overlap with every
   customization even when Git reports no conflicting lines.
4. For every active customization, make an explicit preliminary decision:
   **Retire**, **Reshape**, or **Retain**, using the semantic reconciliation
   rules below.
5. Merge `upstream/main` into `main`; do not rebase the published `main` branch.
6. Resolve conflicts and non-conflicting architectural overlap according to
   those decisions. Adopt upstream implementations and extension points rather
   than preserving downstream code structure for its own sake.
7. Confirm the effective downstream delta with:

   ```bash
   git diff --stat upstream/main..main
   git diff upstream/main..main -- \
     backend/src/index.ts \
     backend/src/lib/llm/claude.ts
   ```

8. Account for every remaining code difference. Remove redundant implementations
   and tests instead of keeping downstream and upstream versions in parallel.
9. Review newly added database migrations and apply unapplied migrations in
   filename order before deploying code that depends on them.
10. Run backend and frontend builds and tests, validate Compose configuration,
    and build the backend Docker image when Docker is available.
11. Update every affected ledger entry and add a reconciliation record using the
    template below before committing.
12. Commit the merge, push `main`, and monitor Render deployment and health.

## Semantic reconciliation rules

Git conflict resolution is only one part of an upstream update. Apply these
rules even when the merge is automatic and tests pass:

- **Retire** a customization when upstream now fulfills its behavioral
  invariant. Delete the downstream implementation and redundant tests, use
  upstream's implementation, and remove or archive the active ledger entry.
- **Reshape** a customization when upstream fulfills part of its invariant or
  introduces a new pattern that should own the behavior. Keep only the unmet
  requirement and rebuild it around upstream's architecture. For example, if a
  downstream feature implements A+B and upstream adds A differently, delete the
  downstream A and reconsider B using upstream A's services, types, UI patterns,
  extension points, and tests.
- **Retain** a customization only when upstream has no equivalent behavior or
  suitable extension point. Keep the smallest isolated delta that preserves the
  invariant.

Judge equivalence by observable behavior, authorization and visibility rules,
data model, provider protocol, UX, and operational requirements—not function
names or line-by-line similarity. A clean merge is not evidence that two
implementations should coexist.

For each upstream merge, append a compact record under **Last reconciliation**:

```text
- <customization>: Retire | Reshape | Retain — <reason and resulting action>.
```

The record must cover every active customization, not only files that had merge
conflicts. Update or remove the corresponding active entry whenever its files,
invariant, integration strategy, or validation changes.

## Git practices

- `origin` is the personal fork; `upstream` is the OSS repository.
- Use focused commits for downstream behavior so Git history explains why each
  divergence exists.
- Enable `rerere` in this checkout so Git can reuse recorded resolutions when a
  future upstream merge repeats the same conflict.
- Never commit secrets, local `.env` files, or production database exports.
- Treat downstream code as disposable and its documented behavior as the thing
  worth preserving. When upstream provides equivalent behavior, remove the old
  patch; when it provides a partial equivalent or a better integration pattern,
  reshape the remaining customization around upstream.

## Last reconciliation

- Upstream baseline: `204d2d5` (2026-08-11)
- Downstream merge: `9bcd0d3`
- Feature integration commits: `5b71d25` (chat movement) and `a27f111`
  (Anthropic web research).
- Effective code delta after reconciliation: Render binding, Anthropic caching
  and native web research, creator-controlled chat movement, CourtListener tool
  registration, memory-bounded uploads/conversion, and non-destructive Library
  attachments in Project Assistant. Storage-provider code matches upstream;
  Supabase is selected solely through deployment values in the
  upstream-compatible `R2_*` variables.
