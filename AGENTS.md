# AGENTS.md

## Commands

- `npm start` — compile + start dev server on port 8080 (NOT `npm run dev`, which runs unit tests and expects `test/index.ts`)
- `npm run build` — production build
- `npm run pack` — build + zip for upload to Feishu open platform
- `npx tsc --noEmit` — typecheck only

## Architecture

Single-entry Feishu bitable field shortcut (字段捷径). Entry point: `src/index.ts` → exports `basekit`.

**Execution flow**: `index.ts` defines form → `execute()` reads table row data → `api/createTask.ts` builds content array + request body → calls Seedance 2.0 async API → `utils/poll.ts` polls until terminal status → returns video URL as text.

**Key files**:
- `src/constants.ts` — API URLs, model IDs, all dropdown option arrays, domain whitelist
- `src/api/createTask.ts` — `buildContent()` (auto-assigns image roles: 1st→first_frame, 2nd→last_frame, rest→reference) + `buildRequestBody()` + retry logic
- `src/utils/media.ts` — image→base64, video/audio→upload to litterbox.catbox.moe for public URL
- `src/utils/fetch.ts` — wraps `context.fetch` with JSON parse (Feishu FaaS response is NOT standard Response)

## Critical Gotchas

- **`npm run dev` is NOT the dev server** — it runs `block-basekit-cli dev:field` which looks for `test/index.ts`. Use `npm start` instead.
- **`context.fetch` is non-standard** — response lacks standard methods. Use 3-level fallback: `.buffer()` → `.arrayBuffer()` → `.text()`. Never rely on `response.ok` alone; check `response.status` too.
- **SingleSelect values are inconsistent** — can be string `"value"` or object `{value: "value", label: "Label"}`. Always normalize with `normalizeSelect()`.
- **Domain whitelist is mandatory** — all external request domains must be declared via `basekit.addDomainList()`. Missing domains = silently blocked requests.
- **Feishu attachment URLs are internal-only** — `tmp_url` from attachment fields is only accessible within Feishu auth context. Images → download+base64 data URI; Video/Audio → download+upload to litterbox.catbox.moe for public URL.
- **Seedance API video_url doesn't support base64** — only public HTTP/HTTPS URLs. That's why videos/audio go through litterbox upload.
- **Video pixel limit** — r2v mode requires width×height ≤ 927,408. `compressVideoIfNeeded()` in media.ts handles this via ffmpeg.
- **API parameters are top-level** — `duration`, `ratio`, `watermark`, `generate_audio` etc. go in the request body root, NOT inside the `content` array or prompt text.
- **`FieldType.Object` for resultType is unreliable** — if switching from `FieldType.Text`, test thoroughly. Text output with `\n`-separated fields is the safe fallback.
- **Polling timeout** — max 120 iterations with progressive backoff (10s→15s→20s). Consecutive 5 fetch failures triggers early abort.

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
