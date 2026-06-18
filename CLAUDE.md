# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working with this repository.

## Commands

- `npm start` — compile + start dev server on port 8080
- `npm run build` — production build
- `npm run pack` — build + zip for upload to Feishu open platform
- `npx tsc --noEmit` — typecheck only

**`npm run dev` is NOT the dev server** — it runs `block-basekit-cli dev:field` which expects `test/index.ts`. Use `npm start` instead.

## Architecture

Single-entry **Feishu bitable field shortcut** (字段捷径) that calls the Seedance 2.0 video generation API. Entry point: `src/index.ts` → exports `basekit`.

**Execution flow**: `index.ts` defines the form config → `execute()` reads row data → `api/createTask.ts` validates params, builds multimodal content array + request body → calls Seedance async API (with retry, up to 3 attempts) → `utils/poll.ts` polls until terminal status → returns video URL as text. Download failures are tracked as warnings and surfaced to the user.

**Source layout**:

- `src/index.ts` — form definition, i18n (zh-CN + en-US), `execute()` orchestrator, module-level `normalizeSelect()` for SingleSelect value normalization. Params are cloned (not mutated) before normalization.
- `src/constants.ts` — API URLs, model IDs, all dropdown option arrays, domain whitelist, `DEFAULT_MODEL`/`DEFAULT_RESOLUTION`/`DEFAULT_RATIO`/`DEFAULT_DURATION`/`DEFAULT_SERVICE_TIER`
- `src/types.ts` — `Attachment` interface (tmp_url, name, type, mimeType), `FormItemParams`, API request/response types, `TaskResult` (includes `warnings[]`)
- `src/api/createTask.ts` — `validateParams()` (checks model/resolution/ratio/serviceTier/duration/prompt length/media counts), `buildContent()` (auto-assigns image roles: 1st→first_frame, 2nd→last_frame, rest→reference; tracks download failures as warnings), `buildRequestBody()`, `createVideoTask()` with retry logic (uses shared `sleep` from poll.ts)
- `src/utils/fetch.ts` — wraps `context.fetch`, exports `SafeFetchFn` type and `FetchError` interface, redacts API keys from logs via `sanitizeForOutput()`, handles non-JSON responses
- `src/utils/media.ts` — image→base64 (≤10MB), video/audio→upload to litterbox.catbox.moe for public URL (≤100MB), shared `downloadAttachment()` helper. Uses `Attachment` type, 3 extract functions delegate to shared `extractByType()`, top-level `https` import. No ffmpeg (Feishu FaaS sandbox has no ffmpeg).
- `src/utils/poll.ts` — exports `sleep()` (shared by createTask.ts for retry delays). Polls Seedance query endpoint with progressive backoff (10s→15s→20s, max 120 iterations), 5 consecutive failures triggers early abort, 10 consecutive unrecognized statuses triggers abort
- `src/utils/logger.ts` — structured debug logging via `console.log`

## Critical Gotchas

- **`context.fetch` is non-standard** — response lacks standard `Response` methods. Use 3-level fallback in `downloadAttachment()`: `.buffer()` → `.arrayBuffer()` → `.text('binary')`. Never rely on `response.ok` alone; check `response.status` too.
- **SingleSelect values are inconsistent** — can be `string "value"` or `{value: "value", label: "Label"}`. Always normalize with `normalizeSelect()` in `execute()`.
- **Domain whitelist is mandatory** — all external request domains must be declared via `basekit.addDomainList()`. Missing domains = silently blocked requests. Whitelist: `ark.cn-beijing.volces.com`, `internal-api-drive-stream.feishu.cn`, `litterbox.catbox.moe`.
- **Feishu attachment URLs are internal-only** — `tmp_url` is only accessible within Feishu auth context. Images → download+base64; Video/Audio → download+upload to litterbox.catbox.moe for public URL.
- **Seedance `video_url` field doesn't support base64** — only public HTTP/HTTPS URLs. That's why videos/audio go through litterbox upload.
- **No ffmpeg available** — Feishu FaaS sandbox has no ffmpeg/ffprobe. Videos exceeding size limits are rejected with a user-facing error.
- **API parameters are top-level** — `duration`, `ratio`, `watermark`, `generate_audio` etc. go in the request body root, NOT inside `content` or prompt text.
- **SafeFetchFn is the shared fetch type** — defined once in `utils/fetch.ts`, imported by `api/createTask.ts` and `utils/poll.ts`. Do not redefine locally.

## SDK Dependencies

Both packages are NOT on public npm search but ARE installable:

- `@lark-opdev/block-basekit-server-api@1.0.6` — runtime API (basekit, FieldType, FieldComponent, FieldCode)
- `@lark-opdev/block-basekit-cli@1.0.5` — build/pack CLI

## Seedance 2.0 API Quick Reference

- Base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Create task: `POST /contents/generations/tasks`
- Query task: `GET /contents/generations/tasks/{task_id}`
- Auth: `Authorization: Bearer {ARK_API_KEY}`
- Models: `doubao-seedance-2-0-260128` (standard), `doubao-seedance-2-0-fast-260128` (fast)
- Video URL expires in 24 hours — download immediately
- Task records retained for 7 days

## Deployment

1. `npm run pack` → generates `output/output_*.zip`
2. Upload zip to Feishu open platform → 多维表格字段捷径

## Behavioral Guidelines

Guidelines to reduce common LLM coding mistakes. Bias toward caution over speed.

### Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### Surgical Changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

Every changed line should trace directly to the user's request.

### Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```
