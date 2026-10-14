"use strict";
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const articleSlug = location.pathname.startsWith("/wiki/") ? location.pathname.slice(6) : null;
let currentArticle = null;
const conversations = {article: [], global: []};
function put(parent, tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}
function wikiLink(title) {
  return "/wiki/" + title.split("/").map(encodeURIComponent).join("/");
}
function searchLink(q, offset = 0, go = false) {
  return "/search?q=" + encodeURIComponent(q) + (offset ? "&offset=" + offset : "") + (go ? "&go=1" : "");
}
async function requestJson(response) {
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Request failed. Please try again.");
  return data;
}
async function showSearch(q, offset, go) {
  const list = $("search-list");
  list.replaceChildren();
  $("search-summary").textContent = "Searching Wikipedia for “" + q + "”…";
  $("header-query").value = q;
  $("ask-results").href = "/ask?question=" + encodeURIComponent(q.length < 3 ? "Tell me about " + q : q);
  $("prev-page").classList.add("hidden");
  $("next-page").classList.add("hidden");
  try {
    const data = await requestJson(await fetch("/api/search?q=" + encodeURIComponent(q) + "&offset=" + offset));
    const exact = data.pages[0] && data.pages[0].title.replaceAll("_"," ").toLowerCase() === q.replaceAll("_"," ").trim().toLowerCase();
    if (go && !offset && exact) {
      location.replace(wikiLink(data.pages[0].key));
      return;
    }
    document.title = "Search: " + q + " — Querypedia";
    $("search-summary").textContent = data.pages.length ?
      "Showing " + (offset + 1) + "–" + (offset + data.pages.length) + " of " + data.total.toLocaleString() + " Wikipedia results for “" + q + "”." :
      "No results found for “" + q + "”.";
    for (const page of data.pages) {
      const entry = put(list, "article", "", "search-result");
      const link = put(put(entry, "h2"), "a", page.title);
      link.href = wikiLink(page.key);
      if (page.description) put(entry, "p", page.description, "result-description");
      const meta = put(entry, "div", "", "result-meta");
      put(meta, "span", "Wikipedia article");
      if (typeof page.wordcount === "number") put(meta, "span", page.wordcount.toLocaleString() + " words");
      put(entry, "a", "Read article →", "read-link").href = wikiLink(page.key);
    }
    if (!data.pages.length) put(list, "p", "Try a different spelling or a broader search.", "search-empty");
    if (offset) {
      $("prev-page").classList.remove("hidden");
      $("prev-page").onclick = () => location.assign(searchLink(q, Math.max(0, offset - 20)));
    }
    if (data.next_offset !== null && data.next_offset !== undefined) {
      $("next-page").classList.remove("hidden");
      $("next-page").onclick = () => location.assign(searchLink(q, data.next_offset));
    }
  } catch (error) {
    $("search-summary").textContent = "Wikipedia search is currently unavailable.";
    put(list, "p", error.message, "error");
  }
}
function makeToc(root) {
  const toc = $("toc");
  toc.replaceChildren();
  let number = 0;
  for (const heading of root.querySelectorAll("h2,h3")) {
    const title = heading.textContent.trim();
    if (!title || title.toLowerCase() === "contents") continue;
    if (!heading.id) heading.id = "section-" + (++number);
    const link = put(toc, "a", title.slice(0,75));
    link.href = "#" + encodeURIComponent(heading.id);
    if (heading.tagName === "H3") link.className = "subheading";
    if (toc.children.length >= 70) break;
  }
}
async function showArticle(slug) {
  const title = decodeURIComponent(slug).replaceAll("_"," ");
  $("crumb").textContent = title;
  try {
    const page = await requestJson(await fetch("/api/page/" + slug));
    currentArticle = page;
    $("header-query").value = page.title;
    $("article-title").textContent = page.title;
    $("crumb").textContent = page.title;
    document.title = page.title + " — Querypedia";
    $("original").href = page.url;
    $("updated").textContent = page.updated ? "Wikipedia revision · " + new Date(page.updated).toLocaleDateString() : "From Wikipedia";
    // The API sanitises HTML and rewrites article links to local /wiki routes.
    $("article-html").innerHTML = page.html;
    makeToc($("article-html"));
    const footer = $("attribution");
    footer.replaceChildren();
    put(footer, "p", "Source: Wikipedia contributors. Article content is presented in a different interface.");
    const history = put(footer, "a", "View original article and contributor history ↗");
    history.href = "https://en.wikipedia.org/w/index.php?title=" + encodeURIComponent(page.key) + "&action=history";
    history.target = "_blank";
    history.rel = "noopener noreferrer";
    if (page.license && typeof page.license.url === "string") {
      const licence = page.license.url.startsWith("//") ? "https:" + page.license.url : page.license.url;
      if (licence.startsWith("https://creativecommons.org/")) {
        const link = put(footer, "a", " · " + (page.license.title || "Content licence") + " ↗");
        link.href = licence; link.target = "_blank"; link.rel = "noopener noreferrer";
      }
    }
    put(footer, "p", "Images and other media may have separate licences.");
    $("page-state").classList.add("hidden");
    $("page-ready").classList.remove("hidden");
    // The article is the new page, not content appended below the homepage.
    // Anchor links should still jump to their Wikipedia section once it exists.
    requestAnimationFrame(() => {
      let fragment = "";
      try { fragment = decodeURIComponent(location.hash.slice(1)); } catch (_) {}
      const destination = fragment && document.getElementById(fragment);
      if (destination) destination.scrollIntoView({block: "start"});
      else window.scrollTo({top: 0, behavior: "auto"});
    });
  } catch (error) {
    $("page-state").textContent = error.message + " Try searching for the article instead.";
  }
}
function inline(parent, text, sources) {
  const tokens = /(\[\d+\]|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let index = 0, match;
  while ((match = tokens.exec(text)) !== null) {
    if (match.index > index) parent.append(document.createTextNode(text.slice(index, match.index)));
    const part = match[0];
    if (/^\[\d+\]$/.test(part)) {
      const source = sources.find(s => String(s.id) === part.slice(1,-1));
      if (source) {
        const link = put(parent,"a",part,"cite");
        link.href = wikiLink(source.key);
        link.title = source.title;
      } else parent.append(document.createTextNode(part));
    } else if (part.startsWith("**")) put(parent,"strong",part.slice(2,-2));
    else put(parent,"em",part.slice(1,-1));
    index = tokens.lastIndex;
  }
  if (index < text.length) parent.append(document.createTextNode(text.slice(index)));
}
function renderAnswer(parent, answer, sources) {
  const container = put(parent, "div", "", "answer");
  const lines = answer.replace(/<br\s*\/?>/gi,"\n").split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (/^\|.+\|$/.test(line) && i+1 < lines.length && /^\|[\s:|\-]+\|$/.test(lines[i+1].trim())) {
      const table = put(container,"table","","answer-table");
      const head = put(put(table,"thead"),"tr");
      for(const cell of line.replace(/^\||\|$/g,"").split("|")) inline(put(head,"th"),cell.trim(),sources);
      const body = put(table,"tbody"); i += 2;
      while(i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        const tr = put(body,"tr");
        for(const cell of lines[i].trim().replace(/^\||\|$/g,"").split("|")) inline(put(tr,"td"),cell.trim(),sources);
        i++;
      }
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      inline(put(container,heading[1].length < 3?"h3":"h4"),heading[2],sources); i++; continue;
    }
    const item = line.match(/^([-*]|\d+\.)\s+(.+)$/);
    if (item) {
      const ordered = /^\d/.test(item[1]);
      const list = put(container,ordered?"ol":"ul");
      while(i < lines.length) {
        const next = lines[i].trim().match(/^([-*]|\d+\.)\s+(.+)$/);
        if (!next || /^\d/.test(next[1]) !== ordered) break;
        inline(put(list,"li"),next[2],sources); i++;
      }
      continue;
    }
    const paragraph = [];
    while(i < lines.length && lines[i].trim() && !/^(#{1,4}\s+|[-*]\s+|\d+\.\s+|\|)/.test(lines[i].trim())) {
      paragraph.push(lines[i].trim()); i++;
    }
    if (!paragraph.length) { paragraph.push(line); i++; }
    inline(put(container,"p"),paragraph.join(" "),sources);
  }
}
function showSources(sources) {
  const box = $("sources"); box.replaceChildren();
  for (const source of sources) {
    const link = put(box, "a", "", "source-card");
    link.href = wikiLink(source.key);
    put(link, "span", "WIKIPEDIA · SOURCE " + source.id, "eyebrow");
    put(link, "strong", source.title);
    if (source.sections) put(link, "small", source.sections.slice(0,2).join(" · "));
  }
}
async function ask(question, mode) {
  const isArticle = mode === "article";
  const thread = $(isArticle ? "article-chat" : "chat");
  const form = $(isArticle ? "article-form" : "ask-form");
  const button = form.querySelector("button[type=submit]");
  const history = conversations[isArticle ? "article" : "global"];
  put(thread,"div",question,"question-bubble");
  const pending = put(thread,"div","Consulting Wikipedia…","loading-bubble");
  button.disabled = true;
  try {
    const data = await requestJson(await fetch("/api/query",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({question,article:isArticle&&currentArticle?currentArticle.key:null,history:history.slice(-4)})
    }));
    pending.remove();
    renderAnswer(thread,data.answer,data.sources);
    if (!isArticle) showSources(data.sources);
    history.push({role:"user",content:question},{role:"assistant",content:data.answer.slice(0,800)});
    if (history.length > 8) history.splice(0,history.length-8);
  } catch (error) {
    pending.remove();
    put(thread,"p",error.message,"error");
  } finally {
    button.disabled = false;
    if (isArticle) thread.scrollTop = thread.scrollHeight;
  }
}
for (const id of ["home-search","header-search"]) {
  $(id).addEventListener("submit", event => {
    event.preventDefault();
    const q = $(id === "home-search" ? "home-query" : "header-query").value.trim();
    if (q) location.assign(searchLink(q,0,true));
  });
}
$("article-form").addEventListener("submit",event => {
  event.preventDefault();
  const field = $("article-question"), q = field.value.trim();
  if (q.length >= 3 && currentArticle) { field.value = ""; ask(q,"article"); }
});
$("ask-form").addEventListener("submit",event => {
  event.preventDefault();
  const field = $("ask-question"), q = field.value.trim();
  if (q.length >= 3) { field.value = ""; ask(q,"global"); }
});
for (const field of document.querySelectorAll("textarea")) {
  field.addEventListener("keydown",event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); field.form.requestSubmit();
    }
  });
}
// Render exactly one page at a time: previously the visible homepage stayed above
// the article, leaving people scrolled to the hero after opening a search hit.
for (const id of ["home-view", "search-view", "article-view", "ask-view"]) {
  $(id).classList.add("hidden");
}

function setMobileQuestionPanel(open, restoreFocus = true) {
  const sidebar = $("ask-sidebar");
  const backdrop = $("mobile-ask-backdrop");
  const trigger = $("mobile-ask-trigger");
  sidebar.classList.toggle("mobile-open", open);
  document.body.classList.toggle("mobile-ask-open", open);
  backdrop.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  if (open) {
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    $("article-question").focus();
  } else {
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
    if (restoreFocus && articleSlug) trigger.focus();
  }
}
$("mobile-ask-trigger").addEventListener("click", () => setMobileQuestionPanel(true));
$("mobile-ask-close").addEventListener("click", () => setMobileQuestionPanel(false));
$("mobile-ask-backdrop").addEventListener("click", () => setMobileQuestionPanel(false));
document.addEventListener("keydown", (event) => {
  if (!$("ask-sidebar").classList.contains("mobile-open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    setMobileQuestionPanel(false);
  } else if (event.key === "Tab") {
    const focusable = [...$("ask-sidebar").querySelectorAll("button:not([disabled]), textarea:not([disabled]), a[href]")];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
});
window.matchMedia("(min-width: 1151px)").addEventListener("change", (event) => {
  if (event.matches && $("ask-sidebar").classList.contains("mobile-open")) setMobileQuestionPanel(false, false);
});

if (articleSlug) {
  $("article-view").classList.remove("hidden");
  showArticle(articleSlug);
} else if (location.pathname === "/search") {
  $("search-view").classList.remove("hidden");
  const q = (params.get("q") || "").trim();
  const offset = Math.max(0,Math.min(5000,Number(params.get("offset")) || 0));
  if (q) showSearch(q,offset,params.get("go") === "1");
  else $("search-summary").textContent = "Use the search box above to find an article.";
} else if (location.pathname === "/ask") {
  $("ask-view").classList.remove("hidden");
  const q = params.get("question");
  if (q && q.length >= 3 && q.length <= 500) ask(q,"global");
} else $("home-view").classList.remove("hidden");
