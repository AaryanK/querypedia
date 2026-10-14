# Querypedia

**Don't just read. Ask to understand.**

Querypedia is an independent, question-first Wikipedia exploration interface. Ask a question, get a concise answer with linked Wikipedia sources, and continue into a specific article to read or ask follow-ups. Built to integrate with DragonZpyder, without living in its monorepo.

## Routes
- `/` – ask Wikipedia questions
- `/wiki/Alan_Turing` – read and query an article
- `GET /api/search?q=...` – Wikipedia search
- `GET /api/page/Alan_Turing` – article HTML and attribution
- `POST /api/query` – multi-article source-grounded Q&A (`{"question":"Why does the Moon always show the same face to Earth?"}`)
- `GET /healthz` – deployment health

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

See `.env.example` for configuration. Reading and search work without an AI key. Answer generation requires a server-side DragonZpyder model gateway token; never expose secrets in browser code.

## Railway

Deploy this standalone repository using `/` as its service root. The Dockerfile listens on Railway's `PORT`; the `/healthz` endpoint is available for health checks. Configure a private `DRAGONZPYDER_RUNTIME_TOKEN` reference to the existing DragonZpyder API service, add `querypedia.dragonzpyder.xyz` as the custom domain, and set the DNS records Railway provides.

## Retrieval & attribution

Questions search Wikimedia's REST API for relevant page candidates, retrieve selected pages on demand, score useful passages, and call the private DragonZpyder API to generate answers. Results include source titles, revision IDs and links. This MVP uses keyword-based retrieval, not a full local Wikipedia mirror or vector index. Article HTML is sanitised and source licences/attribution are preserved. AI answers can be wrong: verify with the linked sources.

## Production considerations

Public AI usage should be guarded by account-scoped credits and distributed quotas before scaling beyond an MVP. Wikimedia requires responsible API usage, identifiable User-Agent, caching and licence compliance; media assets may have separate licences. Querypedia is independent of and not affiliated with Wikimedia or Wikipedia.

## Tests

```bash
python -m pytest -q
```
