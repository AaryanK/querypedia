"use strict";
const byId = (id) => document.getElementById(id);
const articleSlug = location.pathname.startsWith("/wiki/") ? location.pathname.substring(6) : null;
let currentArticle = null;
let history = [];
let articleHistory = [];

function textNode(parent, tag, value, className) {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  parent.appendChild(el);
  return el;
}
async function jsonResponse(res) {
  let data = {};
  try { data = await res.json(); } catch (_) { /* HTTP failures can have empty bodies */ }
  if (!res.ok) throw new Error(data.detail || "That request couldn't be completed.");
  return data;
}
function wikiLink(key) {
  return "/wiki/" + key.split("/").map(encodeURIComponent).join("/");
}
function addAnswer(parent, answer, sources, className = "message response") {
  const node = document.createElement("div");
  node.className = className;
  const pieces = answer.split(/\[(\d+)\]/g);
  for (let i = 0; i < pieces.length; i++) {
    if (i % 2 === 0) node.append(document.createTextNode(pieces[i]));
    else {
      const source = sources.find((s) => String(s.id) === pieces[i]);
      if (!source) node.append(document.createTextNode("[" + pieces[i] + "]"));
      else {
        const link = textNode(node, "a", "[" + pieces[i] + "]", "cite-link");
        link.href = wikiLink(source.key);
        link.title = "Read " + source.title;
      }
    }
  }
  parent.appendChild(node);
  parent.scrollTop = parent.scrollHeight;
  return node;
}
function showSources(sources) {
  const container = byId("sources");
  container.replaceChildren();
  if (!sources.length) return textNode(container, "p", "No supporting article was found.");
  for (const source of sources) {
    const link = document.createElement("a");
    link.className = "source-card";
    link.href = wikiLink(source.key);
    textNode(link, "span", "SOURCE " + String(source.id).padStart(2, "0") + " / WIKIPEDIA", "number");
    textNode(link, "strong", source.title);
    textNode(link, "small", (source.sections || []).slice(0, 2).join(" · ") || "Read the full article");
    container.appendChild(link);
  }
}
async function ask(question, scope) {
  const isArticle = scope === "article";
  const list = byId(isArticle ? "article-chat" : "chat");
  const form = byId(isArticle ? "article-form" : "followup-form");
  const button = form.querySelector("button[type=submit]");
  const log = isArticle ? articleHistory : history;
  if (!isArticle) {
    byId("home").classList.add("hidden");
    byId("workspace").classList.remove("hidden");
    window.scrollTo(0, 0);
  }
  textNode(list, "div", question, isArticle ? "article-bubble question" : "message question");
  button.disabled = true;
  const wait = textNode(list, "div", "Consulting Wikipedia articles…", isArticle ? "article-bubble response" : "message pending");
  try {
    const data = await jsonResponse(await fetch("/api/query", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({question, article: isArticle && currentArticle ? currentArticle.key : null, history: log.slice(-4)})
    }));
    wait.remove();
    addAnswer(list, data.answer, data.sources, isArticle ? "article-bubble response" : "message response");
    if (!isArticle) showSources(data.sources);
    log.push({role: "user", content: question}, {role: "assistant", content: data.answer.slice(0, 800)});
    if (log.length > 10) log.splice(0, log.length - 10);
  } catch (e) {
    wait.remove();
    textNode(list, "div", e.message, isArticle ? "article-bubble error" : "message error");
  } finally {
    button.disabled = false;
    list.scrollTop = list.scrollHeight;
  }
}
function toc(body) {
  const nav = byId("toc");
  nav.replaceChildren();
  let seq = 0;
  for (const head of body.querySelectorAll("h2, h3")) {
    const title = head.textContent.trim();
    if (!title || title.toLowerCase() === "contents") continue;
    if (!head.id) head.id = "section-" + (++seq);
    const link = textNode(nav, "a", title.slice(0, 70));
    link.href = "#" + encodeURIComponent(head.id);
    if (head.tagName === "H3") link.style.paddingLeft = "20px";
    if (nav.children.length >= 60) break;
  }
}
async function loadArticle() {
  byId("home").classList.add("hidden");
  byId("article").classList.remove("hidden");
  const title = decodeURIComponent(articleSlug).replaceAll("_", " ");
  byId("crumb").textContent = title;
  try {
    const data = await jsonResponse(await fetch("/api/page/" + articleSlug));
    currentArticle = data;
    document.title = data.title + " — Querypedia";
    byId("article-title").textContent = data.title;
    byId("crumb").textContent = data.title;
    byId("updated").textContent = data.updated ? "Revision: " + new Date(data.updated).toLocaleDateString() : "From Wikipedia";
    byId("original").href = data.url;
    byId("article-html").innerHTML = data.html;
    toc(byId("article-html"));
    const footer = byId("attribution");
    footer.replaceChildren();
    textNode(footer, "span", "Source: Wikipedia contributors. The article has been reformatted by Querypedia. ");
    const historyLink = textNode(footer, "a", "Contributors and revision history ↗");
    historyLink.href = "https://en.wikipedia.org/w/index.php?title=" + encodeURIComponent(data.key) + "&action=history";
    historyLink.target = "_blank"; historyLink.rel = "noopener noreferrer";
    const license = data.license || {};
    if (license.url) {
      textNode(footer, "span", " · Text licence: ");
      const licenceUrl = license.url.startsWith("//") ? "https:" + license.url : license.url;
      if (licenceUrl.startsWith("https://creativecommons.org/")) {
        const a = textNode(footer, "a", license.title || "Creative Commons");
        a.href = licenceUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
      }
    }
    textNode(footer, "p", "Media may have separate licences. Querypedia is independent of Wikimedia.");
    byId("page-state").classList.add("hidden");
    byId("page-ready").classList.remove("hidden");
  } catch (error) { byId("page-state").textContent = error.message; }
}
async function lookup(text) {
  const list = byId("lookup-results");
  list.replaceChildren();
  textNode(list, "p", "Searching…");
  try {
    const data = await jsonResponse(await fetch("/api/search?q=" + encodeURIComponent(text)));
    list.replaceChildren();
    if (!data.pages.length) textNode(list, "p", "No matching articles.");
    for (const item of data.pages) {
      const link = document.createElement("a");
      link.className = "lookup-result"; link.href = wikiLink(item.key);
      textNode(link, "strong", item.title);
      textNode(link, "small", item.description || "Wikipedia article");
      list.append(link);
    }
  } catch (e) { list.replaceChildren(); textNode(list, "p", e.message); }
}
byId("home-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = byId("home-question").value.trim();
  if (question.length >= 3) ask(question, "global");
});
for (const sample of document.querySelectorAll(".suggestions button")) {
  sample.addEventListener("click", () => ask(sample.dataset.question, "global"));
}
byId("followup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = byId("followup-question"), question = input.value.trim();
  if (question.length >= 3) { input.value = ""; ask(question, "global"); }
});
byId("article-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = byId("article-question"), question = input.value.trim();
  if (question.length >= 3) { input.value = ""; ask(question, "article"); }
});
byId("lookup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = byId("lookup").value.trim();
  if (value.length >= 2) lookup(value);
});
byId("reset-chat").addEventListener("click", () => {
  history = [];
  byId("chat").replaceChildren();
  byId("workspace").classList.add("hidden");
  byId("home").classList.remove("hidden");
  byId("home-question").focus();
});
for (const entry of document.querySelectorAll("textarea")) {
  entry.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      entry.closest("form").requestSubmit();
    }
  });
}
if (articleSlug) loadArticle();
