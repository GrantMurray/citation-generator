"use strict";

// Private files live inside the encrypted bundle (see src/vault.js).
const TEMPLATE_PATH = "assets/forms/citation_fillable.pdf";
const SITES_PATH = "assets/data/numbers.csv";
const BUNDLE_URL = "assets/locked/bundle.bin";
const ZOOMS = [1, 1.5, 2, 3, 4];
const STORE = { issuedBy: "cg.issuedBy", next: "cg.nextCitation", draft: "cg.draft", theme: "cg.theme" };
const DEFAULT_NEXT = "260167"; // the scanned original was 260166

const $ = (sel) => document.querySelector(sel);
const form = $("#citation");
const field = (name) => form.elements.namedItem(name);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

// ---- Site data ---------------------------------------------------------

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some(Boolean));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || "").trim()])));
}

function pageLabel(page) {
  const m = /^(\d+)([UL])?$/i.exec(page);
  if (!m) return `Block ${page}`;
  const half = { U: " (Upper)", L: " (Lower)" }[(m[2] || "").toUpperCase()] || "";
  return `Block ${m[1]}${half}`;
}

const siteKey = (block, site) => `${Number(block)}-${Number(site)}`;
const siteText = (s) => `Block ${s.block}, Site ${s.label || s.site}`;

let pages = [];          // [{ page, label, image, pdfPage, sites: [] }]
const sites = new Map(); // "block-site" -> row
const byCode = new Map();

function loadSites(rows) {
  const grouped = new Map();
  for (const r of rows) {
    const s = {
      ...r,
      left: +r.left, top: +r.top, width: +r.width, height: +r.height,
    };
    sites.set(siteKey(s.block, s.site), s);
    byCode.set(s.code, s);
    if (!grouped.has(s.page)) {
      grouped.set(s.page, { page: s.page, label: pageLabel(s.page), image: s.image, pdfPage: +s.pdf_page, sites: [] });
    }
    grouped.get(s.page).sites.push(s);
  }
  pages = [...grouped.values()].sort((a, b) => a.pdfPage - b.pdfPage);
}

// Accepts "4-23", "4 23", "4U-23", "Block 4 Site 23", "b4 s23", or a site code like "04023".
function parseLocation(text) {
  const nums = text.match(/\d+/g) || [];
  if (nums.length === 1 && nums[0].length === 5 && byCode.has(nums[0])) {
    return { site: byCode.get(nums[0]) };
  }
  if (nums.length === 2) {
    const [block, site] = nums;
    return { block, siteNo: site, site: sites.get(siteKey(block, site)) || null };
  }
  return { block: null, site: null, hasNumbers: nums.length > 0 };
}

// ---- Map ---------------------------------------------------------------

let currentPage = null;
let zoomIndex = 0;
let picked = null;

function renderPageTabs() {
  const wrap = $("#map-pages");
  wrap.innerHTML = "";
  for (const p of pages) {
    const b = document.createElement("button");
    b.type = "button";
    b.role = "tab";
    b.textContent = p.label.replace("Block ", "");
    b.title = p.label;
    b.dataset.page = p.page;
    b.addEventListener("click", () => showPage(p.page));
    wrap.append(b);
  }
}

function showPage(page, { focusSite } = {}) {
  const p = pages.find((x) => x.page === page);
  if (!p) return;
  if (currentPage !== p) {
    currentPage = p;
    $("#map-title").textContent = p.label;
    $("#map-img").src = Vault.url(`assets/maps/pages/${p.image}`);
    $("#map-img").alt = `${p.label} site map`;
    const layer = $("#hotspots");
    layer.innerHTML = "";
    for (const s of p.sites) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "site";
      b.dataset.key = siteKey(s.block, s.site);
      b.setAttribute("aria-label", siteText(s));
      b.title = siteText(s);
      Object.assign(b.style, {
        left: `${s.left * 100}%`, top: `${s.top * 100}%`,
        width: `${s.width * 100}%`, height: `${s.height * 100}%`,
      });
      b.addEventListener("click", () => pickSite(s));
      layer.append(b);
    }
    for (const tab of $("#map-pages").children) {
      const on = tab.dataset.page === page;
      tab.setAttribute("aria-selected", on);
      if (on) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  markPicked();
  if (focusSite) scrollToSite(focusSite);
}

function markPicked() {
  const key = picked && siteKey(picked.block, picked.site);
  for (const b of $("#hotspots").children) b.classList.toggle("picked", b.dataset.key === key);
}

function scrollToSite(s) {
  const vp = $("#map-viewport");
  const canvas = $("#map-canvas");
  const go = () => {
    const x = (s.left + s.width / 2) * canvas.clientWidth - vp.clientWidth / 2;
    const y = (s.top + s.height / 2) * canvas.clientHeight - vp.clientHeight / 2;
    vp.scrollTo({ left: Math.max(0, x), top: Math.max(0, y), behavior: "smooth" });
  };
  const img = $("#map-img");
  img.complete ? go() : img.addEventListener("load", go, { once: true });
}

// On phones the whole-page map is too small to tap individual sites.
const narrowScreen = () => window.matchMedia("(max-width: 700px)").matches;

function setZoom(index) {
  const vp = $("#map-viewport");
  const canvas = $("#map-canvas");
  // keep the point at the centre of the viewport in place
  const cx = (vp.scrollLeft + vp.clientWidth / 2) / canvas.clientWidth;
  const cy = (vp.scrollTop + vp.clientHeight / 2) / canvas.clientHeight;
  zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, index));
  canvas.style.width = `${ZOOMS[zoomIndex] * 100}%`;
  vp.scrollLeft = cx * canvas.clientWidth - vp.clientWidth / 2;
  vp.scrollTop = cy * canvas.clientHeight - vp.clientHeight / 2;
  $("#zoom-out").disabled = zoomIndex === 0;
  $("#zoom-in").disabled = zoomIndex === ZOOMS.length - 1;
}

// ---- Location & autofill -----------------------------------------------

let autoVehicleLocation = "";

function setStatus(text, kind = "") {
  const el = $("#loc-status");
  el.textContent = text;
  el.className = `hint ${kind}`;
}

function pickSite(s, { fromTyping = false } = {}) {
  picked = s;
  if (!fromTyping) field("Block/Site Or Address").value = siteText(s);
  setStatus(`${siteText(s)} on the ${pageLabel(s.page)} map.`, "ok");
  if (fromTyping && narrowScreen() && zoomIndex < 3) setZoom(3);
  showPage(s.page, { focusSite: fromTyping ? s : null });
  syncVehicleLocation();
  changed();
}

function onLocationTyped() {
  const text = field("Block/Site Or Address").value.trim();
  const r = parseLocation(text);
  if (!text) {
    picked = null; markPicked();
    setStatus("Type a block and site, or tap a site on the map.");
  } else if (r.site) {
    pickSite(r.site, { fromTyping: true });
    setStatus(`Found ${siteText(r.site)} on the ${pageLabel(r.site.page)} map.`, "ok");
  } else {
    picked = null; markPicked();
    if (r.block) {
      setStatus(`Block ${Number(r.block)}, Site ${Number(r.siteNo)} isn't on the map. It will print as typed.`, "warn");
      const p = pages.find((x) => x.sites[0].block === String(Number(r.block)));
      if (p && currentPage?.sites[0].block !== p.sites[0].block) showPage(p.page);
    } else {
      setStatus("Not a block/site. It will print as typed (e.g. an address or area).");
    }
  }
  syncVehicleLocation();
}

function locationText() {
  return picked ? siteText(picked) : field("Block/Site Or Address").value.trim();
}

// Vehicle location follows the site only when the vehicle section is in use.
function syncVehicleLocation() {
  const vl = field("Vehicle Location");
  const inUse = field("Category Vehicle/Traffic").checked ||
    ["Vehicle Make Model", "Vehicle License"].some((n) => field(n).value.trim());
  const untouched = !vl.value.trim() || vl.value === autoVehicleLocation;
  if (inUse && untouched) {
    autoVehicleLocation = locationText();
    vl.value = autoVehicleLocation;
  }
}

function pad(n) { return String(n).padStart(2, "0"); }

function fillNow() {
  const d = new Date();
  field("Date").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  field("Time").value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextCitation() {
  return store.get(STORE.next) || DEFAULT_NEXT;
}

function bumpCitation(used) {
  if (!/^\d+$/.test(used) || used !== nextCitation()) return;
  store.set(STORE.next, String(BigInt(used) + 1n).padStart(used.length, "0"));
}

function applyDefaults() {
  fillNow();
  field("Citation Number").value = nextCitation();
  field("Issued By").value = store.get(STORE.issuedBy) || "";
  clearSignatures();
}

// ---- Form values ---------------------------------------------------------

function formatDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v;
}

function formatTime(v) {
  const m = /^(\d{2}):(\d{2})/.exec(v);
  if (!m) return v;
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

function collectValues() {
  const values = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") values[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) values[el.name] = el.value; else values[el.name] ??= ""; }
    else if (el.type === "date") values[el.name] = formatDate(el.value);
    else if (el.type === "time") values[el.name] = formatTime(el.value);
    else values[el.name] = el.value.trim();
  }
  return values;
}

function saveDraft() {
  const raw = {};
  for (const el of form.elements) {
    if (!el.name || el.type === "hidden") continue; // signatures stay off the device
    if (el.type === "checkbox") raw[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) raw[el.name] = el.value; }
    else raw[el.name] = el.value;
  }
  store.set(STORE.draft, JSON.stringify(raw));
}

// Called whenever the citation changes: keep the draft and the PDF current.
function changed() {
  saveDraft();
  schedulePdf();
}

function restoreDraft() {
  let raw;
  try { raw = JSON.parse(store.get(STORE.draft) || "null"); } catch { raw = null; }
  if (!raw) return false;
  for (const el of form.elements) {
    if (!el.name || !(el.name in raw)) continue;
    if (el.type === "checkbox") el.checked = !!raw[el.name];
    else if (el.type === "radio") el.checked = raw[el.name] === el.value;
    else el.value = raw[el.name];
  }
  return true;
}

function newCitation() {
  form.reset();
  picked = null;
  autoVehicleLocation = "";
  store.del(STORE.draft);
  applyDefaults();
  onLocationTyped();
  updateDescHint();
  schedulePdf();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateDescHint() {
  const n = field("Description of Violation").value.length;
  const el = $("#desc-hint");
  el.textContent = n > 270
    ? `${n} characters — will print in smaller text to fit the three lines.`
    : `${n}/270 characters fit at normal size.`;
  el.className = `hint ${n > 270 ? "warn" : ""}`;
}

// ---- Signature pads ------------------------------------------------------
// Each .sig box holds a canvas to sign on and a hidden input that keeps the
// strokes, cropped to the ink, as a PNG data URL; fill.js stamps it on the
// PDF. Signatures are never saved on the device, not even in the draft.

const SIG_INK = "#1b2f6b";
const sigPads = [];

function makeSignaturePad(box) {
  const canvas = box.querySelector("canvas");
  const input = field(box.dataset.input);
  const ctx = canvas.getContext("2d");
  let last = null, lastMid = null, width = 2.5, lastTime = 0;

  function clear() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // Redraws the current signature, scaled to fit (after a resize or reset).
  function show() {
    clear();
    const url = input.value;
    if (!url || !canvas.width) return;
    const img = new Image();
    img.onload = () => {
      if (input.value !== url) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr, ch = canvas.height / dpr;
      const k = Math.min((cw - 16) / img.width, (ch - 16) / img.height, 1 / dpr);
      const iw = img.width * k, ih = img.height * k;
      ctx.drawImage(img, (cw - iw) / 2, (ch - ih) / 2, iw, ih);
    };
    img.src = url;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    show();
  }

  // PNG of just the inked area (plus a little margin), or "" if blank.
  function cropped() {
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return "";
    const m = 4;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
    x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Faster strokes draw thinner, like a real pen; a stylus uses pressure.
  const penWidth = (e, p, t) => {
    let target;
    if (e.pointerType === "pen" && e.pressure > 0) target = 1 + e.pressure * 3;
    else {
      const speed = Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, t - lastTime);
      target = Math.min(3.4, Math.max(1.1, 3.4 - speed * 1.1));
    }
    return (width = width * 0.7 + target * 0.3);
  };

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    last = lastMid = point(e);
    lastTime = e.timeStamp;
    width = 2.5;
    ctx.fillStyle = SIG_INK;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!last) return;
    for (const ev of e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) {
      const p = point(ev);
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.strokeStyle = SIG_INK;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.lineWidth = penWidth(ev, p, ev.timeStamp);
      ctx.beginPath();
      ctx.moveTo(lastMid.x, lastMid.y);
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      ctx.stroke();
      last = p; lastMid = mid; lastTime = ev.timeStamp;
    }
  });
  const end = () => {
    if (!last) return;
    last = lastMid = null;
    input.value = cropped();
    changed();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  box.querySelector(".sig-clear").addEventListener("click", () => {
    input.value = "";
    clear();
    changed();
  });
  new ResizeObserver(resize).observe(canvas);
  return { reset() { input.value = ""; clear(); } };
}

function setUpSignaturePads() {
  store.del("cg.staffSig"); // saved by an earlier version
  for (const box of form.querySelectorAll(".sig")) sigPads.push(makeSignaturePad(box));
}

const clearSignatures = () => sigPads.forEach((p) => p.reset());

// ---- PDF -----------------------------------------------------------------

let templateBytes = null;
let lastUrl = null;
let lastFile = null;
let lastValues = null;

// Phones and tablets get a share sheet (Save to Files, Print, AirDrop...);
// downloads from an installed iOS web app are unreliable.
const touchDevice = () => window.matchMedia("(pointer: coarse)").matches;
const canShareFile = (file) => !!(navigator.canShare && navigator.canShare({ files: [file] }));

// The PDF is rebuilt shortly after every change, so Download / Share / Open
// always hand out the current citation. Builds never overlap; changes made
// during one trigger another when it finishes.
const PDF_DELAY = 250;
let pdfTimer = null, building = false, dirty = false;

function schedulePdf() {
  dirty = true;
  form.classList.add("stale");
  clearTimeout(pdfTimer);
  pdfTimer = setTimeout(buildPdf, PDF_DELAY);
}

async function buildPdf() {
  if (building) return;
  building = true;
  dirty = false;
  const status = $("#pdf-status");
  try {
    templateBytes ||= Vault.bytes(TEMPLATE_PATH);
    const values = collectValues();
    const bytes = await window.fillCitation(PDFLib, templateBytes, values);

    const num = values["Citation Number"] || "draft";
    const where = picked ? `-B${picked.block}-S${picked.site}` : "";
    const name = `citation-${num}${where}.pdf`;
    lastValues = values;
    lastFile = new File([bytes], name, { type: "application/pdf" });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(lastFile);

    for (const dl of [$("#download-main"), $("#download-link")]) {
      dl.href = lastUrl;
      dl.download = name;
    }
    $("#open-link").href = lastUrl;
    // The bottom bar offers one main action: the share sheet on phones and
    // tablets, a download elsewhere. The rest sit under the status line.
    const share = canShareFile(lastFile) && touchDevice();
    $("#share-btn").hidden = !share;
    $("#download-main").hidden = share;
    $("#download-link").hidden = !share;
    $("#pdf-result").hidden = false;
    status.textContent = `${name} is up to date. Print at actual size (100%).`;
  } catch (err) {
    console.error(err);
    status.textContent = `Couldn't update the PDF: ${err.message}`;
  } finally {
    building = false;
    if (dirty) schedulePdf();
    else form.classList.remove("stale");
  }
}

// Once the PDF has been handed out, remember the issuer and move on to the
// next citation number for the next "New citation".
function pdfUsed() {
  if (!lastValues) return;
  if (lastValues["Issued By"]) store.set(STORE.issuedBy, lastValues["Issued By"]);
  bumpCitation(lastValues["Citation Number"]);
}

async function sharePdf() {
  if (!lastFile) return;
  try {
    await navigator.share({ files: [lastFile], title: lastFile.name });
    pdfUsed();
  } catch (err) {
    if (err.name !== "AbortError") $("#pdf-status").textContent = `Couldn't share: ${err.message}`;
  }
}

// ---- Offline support -----------------------------------------------------

async function setUpOffline() {
  const el = $("#offline-status");
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    const check = async () => !!(await caches.match(BUNDLE_URL));
    for (let i = 0; i < 30 && !(await check()); i++) await new Promise((r) => setTimeout(r, 1000));
    if (await check()) {
      const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
      el.textContent = installed
        ? "✓ Available offline."
        : "✓ Available offline. Add to Home Screen to open it without a connection.";
    }
  } catch (err) {
    console.warn("Offline support unavailable:", err);
  }
}

// ---- Wiring --------------------------------------------------------------

function wire() {
  const loc = field("Block/Site Or Address");
  loc.addEventListener("input", onLocationTyped);
  loc.addEventListener("change", () => { if (picked) loc.value = siteText(picked); changed(); });
  loc.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); loc.dispatchEvent(new Event("change")); loc.blur(); }
  });

  $("#zoom-in").addEventListener("click", () => setZoom(zoomIndex + 1));
  $("#zoom-out").addEventListener("click", () => setZoom(zoomIndex - 1));

  // Typing in an "Other (describe)" box ticks its checkbox.
  for (const el of form.querySelectorAll("[data-checks]")) {
    el.addEventListener("input", () => { if (el.value.trim()) field(el.dataset.checks).checked = true; });
  }
  // Entering a fine or a deadline ticks the matching outcome.
  field("Fine Amount").addEventListener("input", (e) => {
    if (e.target.value.trim()) field("Outcome Fine Issued").checked = true;
  });
  field("Corrective Action Required By").addEventListener("change", (e) => {
    if (e.target.value) field("Outcome Corrective Action Required").checked = true;
  });
  // Status boxes behave like a single choice.
  const statuses = ["Status Member", "Status Guest", "Status Contractor", "Status Vendor"];
  for (const n of statuses) {
    field(n).addEventListener("change", (e) => {
      if (e.target.checked) statuses.filter((o) => o !== n).forEach((o) => { field(o).checked = false; });
    });
  }
  for (const n of ["Category Vehicle/Traffic", "Vehicle Make Model", "Vehicle License"]) {
    field(n).addEventListener(n.startsWith("Category") ? "change" : "input", syncVehicleLocation);
  }
  setUpSignaturePads();
  field("Description of Violation").addEventListener("input", updateDescHint);

  form.addEventListener("input", changed);
  form.addEventListener("change", changed);
  form.addEventListener("submit", (e) => e.preventDefault());
  $("#share-btn").addEventListener("click", sharePdf);
  $("#download-main").addEventListener("click", pdfUsed);
  $("#download-link").addEventListener("click", pdfUsed);
  $("#open-link").addEventListener("click", pdfUsed);
  $("#new-btn").addEventListener("click", () => {
    if (confirm("Clear this citation and start a new one?")) newCitation();
  });
}

// ---- Access code ---------------------------------------------------------

function showLock(message = "") {
  $("#citation").hidden = true;
  $("#lock-btn").hidden = true;
  $("#lock").hidden = false;
  $("#lock-error").textContent = message;
  $("#lock-code").focus();
}

async function onUnlockSubmit(e) {
  e.preventDefault();
  const btn = $("#lock-submit");
  const err = $("#lock-error");
  btn.disabled = true;
  err.textContent = "Checking…";
  try {
    if (await Vault.unlock($("#lock-code").value, $("#lock-remember").checked)) {
      $("#lock-code").value = "";
      err.textContent = "";
      start();
    } else {
      err.textContent = "That code didn't work.";
      $("#lock-code").select();
    }
  } catch (ex) {
    console.error(ex);
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
}

function lockApp() {
  if (!confirm("Lock the app? The access code will need to be entered again on this device.")) return;
  Vault.lock();
  location.reload();
}

// ---- Light / dark theme --------------------------------------------------
// Follows the device setting until the switch is used; the choice is then
// kept on this device (index.html applies it before the page paints).

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");

function showThemeButton() {
  const dark = currentTheme() === "dark";
  const btn = $("#theme-btn");
  btn.innerHTML = dark ? SUN : MOON;
  btn.title = btn.ariaLabel = dark ? "Switch to light mode" : "Switch to dark mode";
}

function setUpThemeSwitch() {
  $("#theme-btn").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set(STORE.theme, next);
    showThemeButton();
  });
  systemDark.addEventListener("change", showThemeButton);
  showThemeButton();
}

// ---- Startup ---------------------------------------------------------------

function start() {
  $("#lock").hidden = true;
  $("#citation").hidden = false;
  $("#lock-btn").hidden = false;
  if (!restoreDraft()) applyDefaults();
  updateDescHint();
  try {
    loadSites(parseCSV(Vault.text(SITES_PATH)));
  } catch (err) {
    console.error(err);
    setStatus("Couldn't load the site list. You can still type a location.", "warn");
    schedulePdf();
    return;
  }
  renderPageTabs();
  showPage(pages[0].page);
  setZoom(narrowScreen() ? 3 : 0);
  if (field("Block/Site Or Address").value) onLocationTyped();
  schedulePdf();
}

async function init() {
  setUpThemeSwitch();
  wire();
  $("#lock-form").addEventListener("submit", onUnlockSubmit);
  $("#lock-btn").addEventListener("click", lockApp);
  setUpOffline();
  if (!Vault.isSupported()) {
    showLock("This browser can't unlock the app. Open it over HTTPS.");
    $("#lock-submit").disabled = true;
    return;
  }
  let opened = false;
  try {
    opened = await Vault.unlockRemembered();
  } catch (err) {
    showLock(err.message);
    return;
  }
  opened ? start() : showLock();
}

init();
