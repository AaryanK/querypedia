"""Wikipedia-only retrieval and defensive HTML sanitisation for Querypedia."""
from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from urllib.parse import quote, unquote, urlsplit

import bleach
from bs4 import BeautifulSoup
from fastapi import HTTPException
import httpx

API = "https://en.wikipedia.org/w/rest.php/v1"
CACHE: OrderedDict[str, tuple[float, dict]] = OrderedDict()
CACHE_TTL = 600
CACHE_MAX = 32
STOP = set("what who where when why how which can could would should is are was were did does do the and or to a an of by with in for from on this that me about tell explain compare between please wikipedia history describe summary main important facts".split())
TAGS = {"p", "b", "i", "strong", "em", "u", "s", "blockquote", "hr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "div", "span", "section", "figure", "figcaption", "small", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "a", "sup", "sub", "code", "pre", "img"}
ATTRS = {"*": ["id", "class", "title"], "a": ["href", "title", "id", "class", "rel"], "img": ["src", "alt", "width", "height", "loading"], "td": ["colspan", "rowspan"], "th": ["colspan", "rowspan"]}


def normalized_title(title: str) -> str:
    try:
        title = unquote(title).replace("_", " ").strip()
    except ValueError:
        raise HTTPException(400, "Invalid Wikipedia article title")
    if not title or len(title) > 220 or re.search(r'[\x00-\x1f\x7f#?<>\[\]{}|]', title):
        raise HTTPException(400, "Invalid Wikipedia article title")
    return title


def wiki_href(title: str) -> str:
    return "/wiki/" + quote(title.replace(" ", "_"), safe="/():")


def safe_href(value: str, image: bool = False) -> str | None:
    if not value:
        return None
    value = value.strip()
    if value.startswith("//"):
        value = "https:" + value
    elif value.startswith("./"):
        value = "https://en.wikipedia.org/wiki/" + value[2:]
    elif value.startswith("/wiki/") or value.startswith("/w/"):
        value = "https://en.wikipedia.org" + value
    elif value.startswith("/"):
        value = "https://en.wikipedia.org" + value
    if value.startswith("#") and not image:
        return value
    url = urlsplit(value)
    if url.scheme != "https":
        return None
    if image:
        return value if url.hostname in {"upload.wikimedia.org", "commons.wikimedia.org", "en.wikipedia.org"} else None
    if url.hostname == "en.wikipedia.org" and url.path.startswith("/wiki/"):
        title = unquote(url.path[len("/wiki/"):])
        if title.startswith(("Special:", "File:", "Help:", "Wikipedia:", "Category:", "Template:")):
            return value
        return wiki_href(title) + ("#" + url.fragment if url.fragment else "")
    return value


def clean_article(html: str) -> tuple[str, list[dict]]:
    soup = BeautifulSoup(html, "html.parser")
    for node in soup(["script", "style", "iframe", "form", "object", "embed", "svg", "math", "noscript", "template", "meta", "link"]):
        node.decompose()
    body = soup.body or soup
    for link in body.find_all("a", href=True):
        href = safe_href(str(link.get("href", "")))
        if href:
            link["href"] = href
            if href.startswith("https://"):
                link["rel"] = "noopener noreferrer"
                link["target"] = "_blank"
        else:
            link.attrs.pop("href", None)
    for img in body.find_all("img"):
        src = safe_href(str(img.get("src", "")), image=True)
        if src:
            img["src"] = src
            img["loading"] = "lazy"
            img.attrs.pop("srcset", None)
        else:
            img.decompose()
    chunks = []
    heading = "Introduction"
    for node in body.find_all(["h2", "h3", "p", "li", "blockquote"]):
        if node.name in ("h2", "h3"):
            heading = node.get_text(" ", strip=True)[:140] or heading
            continue
        passage = node.get_text(" ", strip=True)
        if len(passage) >= 35:
            chunks.append({"heading": heading, "text": passage[:1800]})
        if len(chunks) >= 1200:
            break
    safe_html = bleach.clean(str(body), tags=TAGS, attributes=ATTRS, protocols=["https", "http"], strip=True)
    return safe_html, chunks


def tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{3,}", value.lower())) - STOP


def passage_score(chunk: dict, terms: set[str]) -> int:
    text = chunk["text"].lower()
    head = chunk["heading"].lower()
    return sum(4 for word in terms if word in head) + sum(1 for word in terms if word in text)


def passages(article: dict, question: str, limit: int = 5) -> list[dict]:
    terms = tokens(question)
    ranked = sorted(enumerate(article["_chunks"]), key=lambda x: (-passage_score(x[1], terms), x[0]))
    top = dict.fromkeys([i for i in range(min(2, len(article["_chunks"])))]+[i for i, _ in ranked[:limit]])
    return [article["_chunks"][i] for i in top][:limit + 2]


async def article(client: httpx.AsyncClient, title: str) -> dict:
    title = normalized_title(title)
    cached = CACHE.get(title)
    now = time.monotonic()
    if cached and now < cached[0]:
        CACHE.move_to_end(title)
        return cached[1]
    endpoint = API + "/page/" + quote(title.replace(" ", "_"), safe="") + "/with_html"
    try:
        resp = await client.get(endpoint)
    except httpx.HTTPError:
        raise HTTPException(502, "Wikipedia is temporarily unavailable")
    if resp.status_code == 404:
        raise HTTPException(404, "Wikipedia article not found")
    if resp.status_code != 200:
        raise HTTPException(502, "Could not load this Wikipedia article")
    if len(resp.content) > 5_000_000:
        raise HTTPException(413, "Wikipedia article is too large")
    try:
        data = resp.json()
        markup, chunks = clean_article(data["html"])
        key = str(data.get("key") or title.replace(" ", "_"))
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, "Unexpected response from Wikipedia")
    record = {"title": data.get("title") or title, "key": key,
              "revision": data.get("latest", {}).get("id"),
              "updated": data.get("latest", {}).get("timestamp"),
              "license": data.get("license", {}),
              "url": "https://en.wikipedia.org/wiki/" + quote(key, safe="/():"),
              "html": markup, "_chunks": chunks}
    CACHE[title] = (now + CACHE_TTL, record)
    CACHE.move_to_end(title)
    while len(CACHE) > CACHE_MAX:
        CACHE.popitem(last=False)
    return record


async def search(client: httpx.AsyncClient, query: str, limit: int = 7) -> list[dict]:
    query = query.strip()
    if len(query) < 2 or len(query) > 160:
        raise HTTPException(400, "Search query must contain 2–160 characters")
    try:
        response = await client.get(API + "/search/page", params={"q": query, "limit": min(max(limit, 1), 12)})
    except httpx.HTTPError:
        raise HTTPException(502, "Wikipedia search is unavailable")
    if response.status_code != 200:
        raise HTTPException(502, "Wikipedia search is unavailable")
    try:
        return [{"key": x["key"], "title": x.get("title") or x["key"],
                 "description": x.get("description") or ""}
                for x in response.json().get("pages", []) if x.get("key")]
    except (ValueError, TypeError):
        raise HTTPException(502, "Unexpected response from Wikipedia search")


async def find_sources(client: httpx.AsyncClient, question: str) -> list[dict]:
    keyphrase = " ".join(w for w in re.findall(r"[\w-]+", question) if w.lower() not in STOP)[:150]
    terms = [keyphrase or question, question[:150]]
    found = await asyncio.gather(*(search(client, q, 6) for q in dict.fromkeys(terms)), return_exceptions=True)
    candidates: list[str] = []
    for result in found:
        if isinstance(result, Exception):
            continue
        for page in result:
            if page["key"] not in candidates:
                candidates.append(page["key"])
    if not candidates:
        raise HTTPException(404, "No matching Wikipedia articles found. Try naming a topic or person.")
    fetched = await asyncio.gather(*(article(client, name) for name in candidates[:5]), return_exceptions=True)
    return [item for item in fetched if isinstance(item, dict)][:4]
