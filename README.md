# Querypedia

**Wikipedia, with an interrogative layer.**

Querypedia preserves normal Wikipedia search, article reading, internal links, and source attribution. It adds an optional AI question-and-answer layer to the material readers choose. **Searching is not asking an AI.**

## Experience

1. Search from the homepage or header. Querypedia uses the native English Wikipedia MediaWiki search API and ranking, with matching titles, result snippets, and pagination. An exact title search navigates directly to that article.
2. Read the article normally, following internal Wikipedia links inside Querypedia.
3. If you have a question, use the optional article-side "Ask this article" panel to ask about what you are reading.
4. For broad multi-article questions, open the dedicated Ask AI page. This never happens automatically after typing a search.

Search and article browsing do not require the DragonZpyder model gateway.

## Routes

- / — search homepage
- /search?q=Albert+Einstein — Wikipedia-native ranked results
- /wiki/Albert_Einstein — Wikipedia article with optional interrogation
- /ask — explicitly invoked AI Q&A
- GET /api/search?q=...&offset=0 — ranked search results with snippets and pagination
- GET /api/page/Albert_Einstein — sanitised article HTML, revision and attribution
- POST /api/query — source-grounded AI questions (optional)
- GET /healthz — health check

## Local development

Use Python 3.12 or newer. Set up a virtual environment, install the dependencies from requirements.txt, and start the FastAPI application with uvicorn app.main:app --reload. Reading and searching work without AI credentials. AI answers require a dedicated Querypedia app token from the central DragonZpyder inference gateway, configured as described in .env.example. The gateway owns the OpenRouter credential, accounts for model usage and returns request/trace IDs with each answer.

## Railway

The Querypedia service deploys AaryanK/querypedia from main with root directory /, with Dockerfile and /healthz as the healthcheck. Attach querypedia.dragonzpyder.xyz to the service. The AI gateway is connected with the server-only DRAGONZPYDER_QUERYPEDIA_TOKEN and DRAGONZPYDER_API_URL. The new token must match the querypedia entry in the API gateway's DRAGONZPYDER_APP_KEYS_JSON. DRAGONZPYDER_RUNTIME_TOKEN is a temporary fallback for rolling deployments. Answers return inference_trace (trace_id, request_id, audit) so failures can be correlated with gateway records. Do not place the token in JavaScript.

## Source handling

Article HTML is fetched on demand using Wikimedia REST API, sanitised, and cached for a short period. Searches use Wikimedia MediaWiki search API (action=query, list=search) rather than an LLM and retain its result ordering. Search snippets are displayed as plain text. Every article retains its original Wikipedia link, contributor history, and licence information. Media files may have separate licences.

AI-generated answers may be inaccurate; follow citations to original articles to verify. Public AI usage needs account-scoped credits, distributed rate limits and abuse monitoring before scaling. Querypedia is not affiliated with the Wikimedia Foundation.

## Tests

Install requirements.txt and pytest, then run: python -m pytest -q.
