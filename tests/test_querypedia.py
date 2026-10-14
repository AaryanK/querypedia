import os

os.environ["DRAGONZPYDER_RUNTIME_TOKEN"] = "x" * 40
os.environ["DRAGONZPYDER_API_URL"] = "https://dragonzpyder-test.invalid"

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import main, wiki


HTML = """<html><body><h2 id="History">History</h2>
<p>Albert Einstein was a theoretical physicist. His development of relativity changed physical science.</p>
<p>Albert Einstein developed the theory of relativity and contributed to quantum theory.</p>
<a href="./Albert_Einstein">Albert Einstein</a>
<img src="javascript:alert(1)">
<script>alert('dangerous')</script></body></html>"""


def handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/w/api.php"):
        assert request.url.params["action"] == "query"
        assert request.url.params["list"] == "search"
        return httpx.Response(200, json={
            "query": {"searchinfo": {"totalhits": 24},
                "search": [
                    {"title": "Albert Einstein", "snippet": "A <span class='searchmatch'>theoretical</span> physicist", "wordcount": 1500},
                    {"title": "Theory of relativity", "snippet": "Einstein's theory", "wordcount": 2800}
                ]},
            "continue": {"sroffset": 20, "continue": "-||"}
        })
    if path.endswith("/with_html"):
        return httpx.Response(200, json={"title": "Albert Einstein", "key": "Albert_Einstein",
                                         "latest": {"id": 1234, "timestamp": "2026-01-01T00:00:00Z"},
                                         "license": {"url": "//creativecommons.org/licenses/by-sa/4.0/", "title": "CC BY-SA"},
                                         "html": HTML})
    if path.endswith("/v1/chat/completions"):
        assert request.headers["authorization"] == "Bearer " + "x" * 40
        return httpx.Response(200, json={"choices": [{"message": {"content": "Einstein developed relativity [1]."}}]})
    return httpx.Response(404)


@pytest.fixture
def client():
    wiki.CACHE.clear()
    main.RATE.clear()
    with TestClient(main.app) as c:
        c.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        yield c


def test_wikipedia_title_links_and_unsafe_titles():
    assert wiki.wiki_href("Alan Turing") == "/wiki/Alan_Turing"
    assert wiki.safe_href("./Nepal") == "/wiki/Nepal"
    assert wiki.safe_href("https://en.wikipedia.org/wiki/Nepal#History") == "/wiki/Nepal#History"
    assert wiki.safe_href("javascript:alert(1)") is None
    with pytest.raises(HTTPException):
        wiki.normalized_title("bad<script>")


def test_cleans_scripts_and_disallowed_images():
    markup, passages = wiki.clean_article(HTML)
    assert "<script" not in markup
    assert "dangerous" not in markup
    assert "javascript:" not in markup
    assert 'href="/wiki/Albert_Einstein"' in markup
    assert len(passages) == 2
    assert passages[0]["heading"] == "History"


def test_health_and_index(client):
    assert client.get("/healthz").json()["status"] == "ready"
    assert client.get("/").status_code == 200
    assert "The encyclopedia you know." in client.get("/").text
    assert '<main id="home-view" class="home">' in client.get("/").text
    assert client.get("/search?q=Einstein").status_code == 200
    assert client.get("/ask").status_code == 200
    assert client.get("/wiki/Albert_Einstein").status_code == 200
    assert client.get("/assets/app.js").status_code == 200


def test_article_returns_sanitised_html_and_attribution(client):
    result = client.get("/api/page/Albert_Einstein")
    assert result.status_code == 200
    body = result.json()
    assert "html" in body and "_chunks" not in body
    assert "dangerous" not in body["html"]
    assert body["revision"] == 1234
    assert body["url"] == "https://en.wikipedia.org/wiki/Albert_Einstein"
    assert "license" in body


def test_search_and_wikipedia_grounded_query(client):
    found = client.get("/api/search", params={"q": "Einstein"})
    assert found.status_code == 200
    assert found.json()["pages"][0]["key"] == "Albert_Einstein"
    assert found.json()["pages"][0]["description"] == "A theoretical physicist"
    assert found.json()["total"] == 24
    assert found.json()["next_offset"] == 20
    response = client.post("/api/query", json={"question": "Who was Albert Einstein?"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert "relativity [1]" in data["answer"]
    assert data["sources"][0]["title"] == "Albert Einstein"
    assert data["scope"] == "wikipedia"


def test_article_scoped_query(client):
    response = client.post("/api/query", json={"question": "What did he develop?", "article": "Albert_Einstein"})
    assert response.status_code == 200, response.text
    assert response.json()["scope"] == "article"
    assert len(response.json()["sources"]) == 1


def test_public_rate_limit(client):
    for _ in range(4):
        assert client.post("/api/query", json={"question": "Tell me about relativity"}).status_code == 200
    assert client.post("/api/query", json={"question": "Tell me about relativity"}).status_code == 429


def test_invalid_request(client):
    assert client.post("/api/query", json={"question": "hi"}).status_code == 422
    assert client.get("/api/search", params={"q": " "}).status_code == 400


def test_search_never_invokes_ai(client):
    response = client.get("/api/search", params={"q": "Albert Einstein", "offset": 20})
    assert response.status_code == 200
    data = response.json()
    assert data["offset"] == 20
    assert data["pages"][0]["title"] == "Albert Einstein"
    assert "<span" not in data["pages"][0]["description"]
    assert client.get("/search", params={"q": "Albert Einstein"}).status_code == 200


def test_search_uses_wikipedia_ranking_and_query(client):
    import asyncio
    seen = []
    async def fake_handler(request):
        seen.append(str(request.url))
        return handler(request)
    client.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(fake_handler))
    result = client.get("/api/search", params={"q": "Aryan Khan"})
    assert result.status_code == 200
    assert any("srsearch=Aryan+Khan" in url or "srsearch=Aryan%20Khan" in url for url in seen)
    assert not any("/v1/chat/completions" in url for url in seen)


def test_article_replaces_home_and_shows_meta_tags(client):
    article = client.get("/wiki/Lionel_Messi")
    assert article.status_code == 200
    html = article.text
    assert '<main id="home-view" class="home hidden">' in html
    assert '<main id="article-view" class="article-layout">' in html
    assert '<title>Lionel Messi — Querypedia</title>' in html
    assert '<link rel="canonical" href="https://querypedia.dragonzpyder.xyz/wiki/Lionel_Messi">' in html
    assert '<meta property="og:type" content="article">' in html
    assert '<meta name="twitter:card" content="summary">' in html
    assert '<meta name="description"' in html
    assert '<link rel="icon" href="/assets/favicon.svg"' in html


def test_search_meta_and_escaped_user_input(client):
    result = client.get("/search", params={"q": 'Lionel Messi"><script>alert(1)</script>'})
    assert result.status_code == 200
    assert "noindex,follow" in result.text
    assert "&quot;&gt;&lt;script&gt;" in result.text
    assert '<script>alert(1)</script>' not in result.text
    assert 'og:description' in result.text
    assert '<link rel="canonical" href="https://querypedia.dragonzpyder.xyz/search">' in result.text


def test_mobile_ask_drawer_and_top_of_article_are_available(client):
    html = client.get("/wiki/Lionel_Messi").text
    assert 'id="mobile-ask-trigger"' in html
    assert 'id="mobile-ask-backdrop"' in html
    assert 'id="mobile-ask-close"' in html
    script = client.get("/assets/app.js").text
    assert 'for (const id of ["home-view", "search-view", "article-view", "ask-view"])' in script
    assert 'window.scrollTo({top: 0, behavior: "auto"})' in script
    assert "setMobileQuestionPanel" in script
    assert 'id="article-html"' in html
    styles = client.get("/assets/style.css").text
    assert "max-width:760px" in styles and "ask-sidebar.mobile-open" in styles
