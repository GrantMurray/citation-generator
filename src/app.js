"use strict";

// Private files live inside the encrypted bundle (see src/vault.js).
const TEMPLATE_PATH = "assets/forms/citation_fillable.pdf";
const SITES_PATH = "assets/data/numbers.csv";
const BUNDLE_URL = "assets/locked/bundle.bin";
const ZOOMS = [1, 1.5, 2, 3, 4];
const STORE = { issuedBy: "cg.issuedBy", next: "cg.nextCitation", draft: "cg.draft" };
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
  saveDraft();
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
  const issuer = store.get(STORE.issuedBy) || "";
  field("Issued By").value = issuer;
  field("Staff Volunteer Name Signature").value = issuer;
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
    if (!el.name) continue;
    if (el.type === "checkbox") raw[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) raw[el.name] = el.value; }
    else raw[el.name] = el.value;
  }
  store.set(STORE.draft, JSON.stringify(raw));
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
  $("#pdf-status").textContent = "";
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

// ---- PDF -----------------------------------------------------------------

let templateBytes = null;
let lastUrl = null;
let lastFile = null;

// Phones and tablets get a share sheet (Save to Files, Print, AirDrop...);
// downloads from an installed iOS web app are unreliable.
const touchDevice = () => window.matchMedia("(pointer: coarse)").matches;
const canShareFile = (file) => !!(navigator.canShare && navigator.canShare({ files: [file] }));

async function createPdf(e) {
  e.preventDefault();
  const btn = $("#pdf-btn");
  const status = $("#pdf-status");
  btn.disabled = true;
  $("#pdf-result").hidden = true;
  status.textContent = "Creating PDF…";
  try {
    templateBytes ||= Vault.bytes(TEMPLATE_PATH);
    const values = collectValues();
    const bytes = await window.fillCitation(PDFLib, templateBytes, values);

    const num = values["Citation Number"] || "draft";
    const where = picked ? `-B${picked.block}-S${picked.site}` : "";
    const name = `citation-${num}${where}.pdf`;
    lastFile = new File([bytes], name, { type: "application/pdf" });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(lastFile);

    const dl = $("#download-link");
    dl.href = lastUrl;
    dl.download = name;
    $("#open-link").href = lastUrl;
    const share = canShareFile(lastFile);
    $("#share-btn").hidden = !share;
    $("#pdf-result").hidden = false;

    if (share && touchDevice()) {
      status.textContent = `${name} is ready. Print at actual size (100%).`;
    } else {
      dl.click();
      status.textContent = `Downloaded ${name}. Print at actual size (100%).`;
    }

    if (values["Issued By"]) store.set(STORE.issuedBy, values["Issued By"]);
    bumpCitation(values["Citation Number"]);
  } catch (err) {
    console.error(err);
    status.textContent = `Couldn't create the PDF: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function sharePdf() {
  if (!lastFile) return;
  try {
    await navigator.share({ files: [lastFile], title: lastFile.name });
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
  loc.addEventListener("change", () => { if (picked) loc.value = siteText(picked); saveDraft(); });
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
  field("Issued By").addEventListener("change", (e) => {
    const staff = field("Staff Volunteer Name Signature");
    const prev = store.get(STORE.issuedBy) || "";
    if (!staff.value.trim() || staff.value === prev) staff.value = e.target.value;
  });
  field("Description of Violation").addEventListener("input", updateDescHint);

  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);
  form.addEventListener("submit", createPdf);
  $("#share-btn").addEventListener("click", sharePdf);
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
    return;
  }
  renderPageTabs();
  showPage(pages[0].page);
  setZoom(narrowScreen() ? 3 : 0);
  if (field("Block/Site Or Address").value) onLocationTyped();
}

async function init() {
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
