# Beyond the Blueprints — Chat API

Node.js HTTP server that provides retrieval-augmented generation over the 47-story Beyond the Blueprints corpus using IBM watsonx.ai.

## Repository architecture

This project uses **two separate repositories**:

| Repository | Host | Purpose |
|---|---|---|
| `github.com/sampreeth-k/btb-chat-api` | Public GitHub | **This repo.** Production chatbot backend. Built and deployed on IBM Cloud Code Engine. |
| `github.ibm.com/Sampreeth-Kumar/beyondtheblueprints` | IBM GitHub Enterprise | Frontend (`index.html`), story data, and application assets. |

The backend runs on IBM Cloud Code Engine, built from this **public** repository (see Deployment).  
The IBM Enterprise repository holds the frontend and is served via IBM GitHub Pages.

> **Before making any part of this project more widely accessible**: confirm that publishing the corpus (`corpus.json`, `stories.json`) and backend source on public GitHub is intentional and approved per IBM open-source and data-sharing policy.

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness + config check. Returns `git_commit`, model, story count, corpus chunk count. |
| `GET` | `/debug-retrieval?q=` | Returns raw hybrid retrieval scores for a query (no LLM call). **Gated** — requires `X-Debug-Key: <value>` header; `?key=` query-string fallback removed (URLs appear in proxy logs). Returns 404 when `DEBUG_RETRIEVAL_KEY` env var is unset (production default). |
| `POST` | `/v1/chat` | Main chat endpoint. Body: `{ "query": "...", "top_k": 3 }` |

`/debug-auth` returns 404 in all environments.

---

## Required environment variables

| Variable | Description |
|---|---|
| `WATSONX_API_KEY` | IBM Cloud IAM API key |
| `WATSONX_PROJECT_ID` | watsonx.ai project ID |

## Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `WATSONX_URL` | `https://us-south.ml.cloud.ibm.com` | watsonx.ai region endpoint |
| `WATSONX_MODEL` | `meta-llama/llama-3-3-70b-instruct` | Inference model ID |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `GIT_COMMIT` | `unknown` | Optional override — surfaced in `/health`. Set it on the Code Engine app to show the deployed commit. |
| `DEBUG_RETRIEVAL_KEY` | *(unset)* | If set, enables `/debug-retrieval` when supplied via `X-Debug-Key: <value>` header. Query-string fallback removed — never pass secrets in URLs. |

---

## Deployment (IBM Cloud Code Engine)

Project `btb-beyond-the-blueprints` (us-south), app `btb-chat-api-prod`. The image is built by the Code Engine build `btb-chat-api-test-build-l2xzr` from this repository, pinned to a commit.

```bash
ibmcloud ce build update -n btb-chat-api-test-build-l2xzr --commit <sha>
ibmcloud ce buildrun submit --build btb-chat-api-test-build-l2xzr --name <new-run-name> --wait
ibmcloud ce app update -n btb-chat-api-prod --image private.us.icr.io/btb-beyond-the-blueprints/btb-chat-api-test:latest --wait
```

Set `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` on the app (preferably as a Code Engine secret).
There is no auto-deploy: pushing to `main` does not update the live service until you run the build and app update above.


---

## CI — citation integrity tests

GitHub Actions runs `npm test` on every push and pull request to `main`.  
This is a **zero-tolerance gate**: citation test failures block the merge.

To make the gate enforceable, enable branch protection on `main`:  
Settings → Branches → Branch protection rules → Require status checks → select **"Citation integrity tests"**.

Without branch protection enabled, the CI check runs but cannot block direct pushes to `main`.

---

## Running tests

```bash
npm test
# → node test/citations.test.js
# → 34 passed, 0 failed
```

For syntax-only validation (no server startup):
```bash
node --check server.js
```

---

## Corpus

`corpus.json` (172 article chunks + transcript chunks from 14 customer video interviews) is committed to the repository so the Code Engine build needs no separate build step.

The corpus has two chunk sources:
- **Article chunks** — scraped from `articleUrl` fields in `stories.json` via `build-corpus.js`
- **Transcript chunks** — extracted from `.docx` interview recordings via `build-transcripts.js`

Each context block sent to the LLM is labelled `Source: customer video interview` or `Source: IBM blog post` so the model understands which source it's drawing from.

To add transcript chunks for new or missing transcripts:
```bash
WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> \
WATSONX_URL=https://us-south.ml.cloud.ibm.com \
TRANSCRIPTS_DIR=/path/to/Video_Transcripts_Roses \
node build-transcripts.js
```

To regenerate all article chunks after adding or changing stories:
```bash
WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> node build-corpus.js
```

To embed only the null-embedding chunks without re-crawling everything (faster):
```bash
WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> node patch_embed_null_chunks.js
# or: npm run embed-nulls
```
The script finds every `"embedding": null` entry in `corpus.json`, embeds only those, and writes the file back in-place. Safe to re-run; already-embedded chunks are untouched.

Then commit the updated `corpus.json`.

---

## Abuse controls

| Control | Value | Notes |
|---|---|---|
| Body size limit | 8 KB | Hard cap in `readBody()` |
| Query length | 500 chars | Checked before retrieval |
| IAM timeout | 30 s | `req.setTimeout` on token exchange |
| Embedding timeout | 30 s | `req.setTimeout` on every RAG embed |
| Chat timeout | 30 s | `req.setTimeout` on watsonx call |
| Rate limit | 30 req/IP/min | Fixed window, in-process — see comment in `server.js` for known limitations |

For production scale, use API gateway rate-limiting or a CDN WAF rule in front of this service.

---

## Citation integrity

Citation tokens are keyed on the **immutable story `.id`** (e.g. `CIT:story-25`), not the company name. This prevents collisions between stories that share a company name.

The `sources[]` array in every response is ordered to match `[S1]`, `[S2]` … in the answer text. `sources[0]` is always the story cited as `[S1]`.

See [`lib/citations.js`](lib/citations.js) for the implementation and [`test/citations.test.js`](test/citations.test.js) for the regression tests.

---

## Retrieval algorithm

1. **Vector leg** — embed query with `ibm/slate-125m-english-rtrvr-v2`, cosine-score all 172 corpus chunks, take best chunk score per story, normalise 0→1.
2. **Keyword leg** — TF-IDF overlap with synonym expansion, normalise 0→1.
3. **Combined** — 0.6 × vector + 0.4 × keyword.
4. **Domain boost** — region / industry / brand match → ×1.3.
5. **Relative threshold** — keep stories ≥ 70% of top score (self-calibrating).
6. **hasVideo post-filter** — applied when query mentions video/watch/film/clip.

---

## Open items

| # | Item | Status | Blocking for |
|---|---|---|---|
| 1 | ~~Set `GIT_COMMIT` for `/health`~~ — optional; set `GIT_COMMIT` on the Code Engine app to show the commit | **Optional** | Production auditability |
| 2 | ~~Embed null Blue Pearl story-59 chunks~~ — done in `3fce30c` | **Resolved** | Vector retrieval for story-59 |
| 3 | Confirm historical API key is revoked in IBM Cloud IAM | Open | Security |
| 4 | Enable branch protection on `main` requiring CI status check | Open | Enforceable merge gate |
| 5 | Privacy review: Formspree, Microsoft Clarity, consent notice | Open | External promotion |
| 6 | Layer 2 mocked integration tests + Layer 3 live eval suite | Open | Test coverage |
| 7 | Frontend XSS (innerHTML), accessibility (aria-modal, focus trap) | Open | Broader rollout |
