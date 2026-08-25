# Beyond the Blueprints — Chat API

Node.js HTTP server that provides retrieval-augmented generation over the 47-story Beyond the Blueprints corpus using IBM watsonx.ai.

## Repository architecture

This project uses **two separate repositories**:

| Repository | Host | Purpose |
|---|---|---|
| `github.com/sampreeth-k/btb-chat-api` | Public GitHub | **This repo.** Production chatbot backend. Render deploys from `main` here. |
| `github.ibm.com/Sampreeth-Kumar/beyondtheblueprints` | IBM GitHub Enterprise | Frontend (`index.html`), story data, and application assets. |

Render auto-deploys the backend from every push to `main` on the **public** repository.  
The IBM Enterprise repository holds the frontend and is served via IBM GitHub Pages.

> **Before making any part of this project more widely accessible**: confirm that publishing the corpus (`corpus.json`, `stories.json`) and backend source on public GitHub is intentional and approved per IBM open-source and data-sharing policy.

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness + config check. Returns `git_commit`, model, story count, corpus chunk count. |
| `GET` | `/debug-retrieval` | Returns raw hybrid retrieval scores for a query (no LLM call). **Gated** — requires `X-Debug-Key: <DEBUG_RETRIEVAL_KEY>` header; returns 404 when env var is unset (production default). |
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
| `GIT_COMMIT` | `unknown` | Injected at deploy time — surfaced in `/health`. **Set to `$RENDER_GIT_COMMIT` in the Render dashboard.** |
| `DEBUG_RETRIEVAL_KEY` | *(unset)* | If set, enables `/debug-retrieval` when supplied via `X-Debug-Key` header. Never use `?key=` — URLs appear in proxy logs. |

---

## Deployment (Render)

Auto-deploys from `main` on **`github.com/sampreeth-k/btb-chat-api`** (the public repository).

**Required Render dashboard steps:**
1. Add `GIT_COMMIT = $RENDER_GIT_COMMIT` → enables `/health` to report the deployed commit SHA, making production-repository alignment verifiable.
2. Add `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` as secret environment variables.

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

`corpus.json` (172 chunks, 47 stories) is committed to the repository so Render can deploy without a separate build step.

To regenerate after adding or changing stories:
```bash
WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> node build-corpus.js
```

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

For production scale, use Render's gateway rate-limiting or a CDN WAF rule in front of this service.

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

| # | Item | Blocking for |
|---|---|---|
| 1 | Set `GIT_COMMIT=$RENDER_GIT_COMMIT` in Render dashboard | Production auditability |
| 2 | Confirm historical API key is revoked in IBM Cloud IAM | Security |
| 3 | Enable branch protection on `main` requiring CI status check | Enforceable merge gate |
| 4 | Privacy review: Formspree, Microsoft Clarity, consent notice | External promotion |
| 5 | Layer 2 mocked integration tests + Layer 3 live eval suite | Test coverage |
| 6 | Frontend XSS (innerHTML), accessibility (aria-modal, focus trap) | Broader rollout |
