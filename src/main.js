import "./style.css";

const RSS_URL = "https://ventusuta.com/rss.xml";
const CONTENT_NS = "http://purl.org/rss/1.0/modules/content/";
const BLOCKS = "p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,br,hr";

const form = document.querySelector("form");
const queryInput = document.querySelector("#q");
const results = document.querySelector("#results");
const dateParts = [...form.querySelectorAll("[data-part]")];
const partLen = new WeakMap();

let posts = [];
let ready = false;
let editingPart = false;

function htmlText(html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  doc.querySelectorAll("rt, rp, rtc, script, style").forEach((el) => el.remove());
  [...doc.querySelectorAll("ruby")].reverse().forEach((el) => {
    el.replaceWith(el.textContent.replace(/\s+/g, ""));
  });
  doc.querySelectorAll(BLOCKS).forEach((el) => {
    el.after("\n");
  });
  return doc.body.textContent;
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function textOf(parent, tag) {
  const el = parent.getElementsByTagName(tag)[0];
  return el ? el.textContent : "";
}

function httpUrl(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

function utcYmd(date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function validYmd(year, month, day) {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return "";
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
  return `${year}-${month}-${day}`;
}

function parseRss(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("rss");
  return [...doc.querySelectorAll("channel > item")].map((item) => {
    const encoded = item.getElementsByTagNameNS(CONTENT_NS, "encoded")[0];
    const published = new Date(textOf(item, "pubDate"));
    const time = published.getTime();
    return {
      title: normalize(htmlText(textOf(item, "title"))),
      summary: normalize(htmlText(textOf(item, "description"))),
      content: normalize(htmlText(encoded ? encoded.textContent : "")),
      link: httpUrl(textOf(item, "link")),
      language: textOf(item, "language").trim(),
      time: Number.isNaN(time) ? 0 : time,
      ymd: Number.isNaN(time) ? "" : utcYmd(published),
    };
  });
}

function checked(name) {
  return form.querySelector(`input[name="${name}"]:checked`).value;
}

function dateConstraint() {
  if (checked("date") !== "range") return { kind: "any" };
  const parts = dateParts.map((el) => el.value);
  const width = [4, 2, 2, 4, 2, 2];
  if (parts.some((value, index) => value.length < width[index])) return { kind: "any" };
  const start = validYmd(parts[0], parts[1], parts[2]);
  const end = validYmd(parts[3], parts[4], parts[5]);
  if (!start || !end) return { kind: "none" };
  return start <= end ? { kind: "range", start, end } : { kind: "range", start: end, end: start };
}

function fieldsFor(post, scope) {
  if (scope === "title") return [post.title];
  if (scope === "content") return [post.summary, post.content];
  return [post.title, post.summary, post.content];
}

function includesFold(text, fold) {
  return text.toLowerCase().includes(fold);
}

function clip(text, fold) {
  const at = text.toLowerCase().indexOf(fold);
  if (at < 0) return "";
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, at + fold.length + 40);
  let out = text.slice(start, end);
  if (start > 0) out = `…${out}`;
  if (end < text.length) out = `${out}…`;
  return out;
}

function passage(post, scope, fold) {
  if (!fold || scope === "title") return "";
  if (includesFold(post.content, fold)) return clip(post.content, fold);
  if (includesFold(post.summary, fold)) return clip(post.summary, fold);
  return "";
}

function appendHighlighted(parent, text, fold) {
  if (!fold) {
    parent.append(text);
    return;
  }
  const lower = text.toLowerCase();
  let index = 0;
  while (index < text.length) {
    const at = lower.indexOf(fold, index);
    if (at < 0) {
      parent.append(text.slice(index));
      return;
    }
    if (at > index) parent.append(text.slice(index, at));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + fold.length);
    parent.append(mark);
    index = at + fold.length;
  }
}

function render() {
  if (!ready) return;
  const fold = normalize(queryInput.value).toLowerCase();
  const scope = checked("scope");
  const lang = checked("lang");
  const order = checked("order");
  const dates = dateConstraint();
  const visible = posts.filter((post) => {
    if (lang && post.language !== lang) return false;
    if (dates.kind === "none") return false;
    if (dates.kind === "range" && (!post.ymd || post.ymd < dates.start || post.ymd > dates.end)) return false;
    if (!fold) return true;
    return fieldsFor(post, scope).some((text) => includesFold(text, fold));
  });
  visible.sort((a, b) => (order === "old" ? a.time - b.time : b.time - a.time));
  results.replaceChildren();
  if (!visible.length) {
    results.textContent = "（无结果）";
    return;
  }
  for (const post of visible) {
    const article = document.createElement("article");
    const heading = document.createElement("p");
    const title = document.createElement(post.link ? "a" : "span");
    if (post.link) title.href = post.link;
    appendHighlighted(title, post.title, fold);
    heading.append(title);
    if (post.ymd) {
      heading.append(" ");
      const time = document.createElement("time");
      time.dateTime = post.ymd;
      time.textContent = post.ymd;
      heading.append(time);
    }
    article.append(heading);
    const snippet = passage(post, scope, fold);
    if (snippet) {
      const paragraph = document.createElement("p");
      appendHighlighted(paragraph, snippet, fold);
      article.append(paragraph);
    }
    results.append(article);
  }
}

function movePart(current, direction) {
  const index = dateParts.indexOf(current);
  const next = dateParts[index + direction];
  if (next) next.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
});

form.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-part]")) {
    document.querySelector("#date-range").checked = true;
    render();
  }
});

form.addEventListener("keydown", (event) => {
  const el = event.target;
  if (!el.matches?.("[data-part]")) return;
  if (event.key === "Backspace" && el.value === "") {
    movePart(el, -1);
    event.preventDefault();
  }
});

form.addEventListener("input", (event) => {
  const el = event.target;
  if (el.matches?.("[data-part]")) {
    if (editingPart) return;
    editingPart = true;
    const previous = partLen.get(el) || 0;
    const digits = el.value.replace(/\D/g, "").slice(0, el.maxLength);
    if (digits !== el.value) el.value = digits;
    partLen.set(el, digits.length);
    editingPart = false;
    document.querySelector("#date-range").checked = true;
    if (digits.length === el.maxLength && previous < el.maxLength) movePart(el, 1);
  }
  render();
});

form.addEventListener("change", () => {
  render();
});

results.textContent = "正在加载……";

fetch(RSS_URL)
  .then((response) => {
    if (!response.ok) throw new Error(String(response.status));
    return response.text();
  })
  .then((xml) => {
    posts = parseRss(xml);
    ready = true;
    render();
  })
  .catch(() => {
    ready = false;
    results.textContent = "（错误：无法读取https://ventusuta.com/rss.xml）";
  });
