# Beyond the Blueprints — Chat API

Node.js HTTP server that provides retrieval-augmented generation over the 47-story Beyond the Blueprints corpus using IBM watsonx.ai.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness + config check. Returns `git_commit`, model, story count, corpus chunk count. |
| `GET` | `/debug-retrieval?q=` | Returns raw hybrid retrieval scores for a query (no LLM call). |
| `POST` | `/v1/chat` | Main chat endpoint. Body: `{ "query": "...", "top_k": 3 }` |

`/debug-auth` is intentionally removed from production (returns 404).

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
| `GIT_COMMIT` | `unknown` | Injected at deploy time — surfaced in `/health` |

## Deployment (Render)

Auto-deploys from `main` branch on push. Set `GIT_COMMIT` to `$RENDER_GIT_COMMIT` in the Render environment variables dashboard so `/health` reports the running commit SHA.

## Corpus

`corpus.json` (172 chunks, 47 stories) is committed to the repository so Render can deploy without a separate build step.

To regenerate after adding or changing stories:
```bash
WATSONX_API_KEY=<key> WATSONX_PROJECT_ID=<id> node build-corpus.js
```

Then commit the updated `corpus.json` and `corpus_meta.json`.

## Abuse controls

- **Rate limit:** 30 requests / IP / minute (in-process)
- **Body limit:** 8 KB max request body
- **Query limit:** 500 characters max
- **Timeout:** 30 s upstream watsonx timeout

For production scale, place a gateway (Render's or a CDN) in front for external rate limiting.

## Retrieval algorithm

1. **Vector leg** — embed query with `ibm/slate-125m-english-rtrvr-v2`, cosine-score all 172 corpus chunks, take best chunk score per story, normalise 0→1.
2. **Keyword leg** — TF-IDF overlap with synonym expansion, normalise 0→1.
3. **Combined** — 0.6 × vector + 0.4 × keyword.
4. **Domain boost** — region / industry match → ×1.3.
5. **Relative threshold** — keep stories ≥ 70% of top score (self-calibrating).
6. **hasVideo post-filter** — applied when query mentions video/watch/film/clip.

## Citation integrity

The response `sources[]` array is ordered to match `[S1]`, `[S2]` … in the answer text. `sources[0]` is always the story cited as `[S1]`. The frontend converts `[Sn]` → `sources[n-1]`, so citation links point to the correct company.
