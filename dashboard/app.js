"use strict";

/* Token Radar — board logic.
   Data arrives as window.RADAR (see data.js beside this page).
   Every figure on screen is derived from that object at render time:
   nothing about any protocol is hard-coded here. */

const RADAR = window.RADAR || { rows: [], live: [], model: {} };
const BOARD = Array.isArray(RADAR.rows) ? RADAR.rows : [];
const LIVE = Array.isArray(RADAR.live) ? RADAR.live : [];
const MODEL = RADAR.model || {};

const view = {
  tab: "pre",          // "pre" | "live"
  query: "",
  category: "",
  chain: "",
  risk: "",
  minTvl: 0,
  watchOnly: false,
  sortKey: "rank",
  sortDir: 1,          // 1 = ascending by the key
  picked: null,        // slug of the open detail row
};

const $ = (id) => document.getElementById(id);

/* ---------- small formatters ---------- */

function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function compactMoney(usd) {
  if (usd == null || !isFinite(usd)) return "—";
  const sign = usd < 0 ? "-" : "";
  const n = Math.abs(usd);
  if (n >= 1e9) return sign + "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return sign + "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return sign + "$" + (n / 1e3).toFixed(1) + "K";
  return sign + "$" + Math.round(n);
}

function signedPct(pct) {
  if (pct == null || !isFinite(pct)) return { text: "—", cls: "mute" };
  const shown = (pct > 0 ? "+" : "") + pct.toFixed(2) + "%";
  return { text: shown, cls: pct > 0 ? "gain" : pct < 0 ? "loss" : "mute" };
}

function ageText(days) {
  if (days == null) return "—";
  if (days >= 365) return (days / 365).toFixed(1) + "y";
  return days + "d";
}

function multOf(row, key) {
  if (typeof row[key] === "number") return row[key];
  if (row.model && typeof row.model[key] === "number") return row.model[key];
  return null;
}

/* ---------- the farm plan ----------
   Seven steps, built from the row's own fields so the plan on screen
   is the same plan board.json carries for that protocol.
   Stake size follows TVL: under $100M -> $50, under $1B -> $100, else $150.
   The weekly cost follows the first chain: Ethereum is pricey gas ($8),
   Bitcoin routes cost fees ($5), everything else about $1 of gas.
   Holding time follows age: a year or more -> 30 days, half a year -> 45,
   younger (or unlisted) -> 60, except unlisted rows which hold 30. */

function stakeFor(row) {
  if (row.tvl_usd >= 1e9) return 150;
  if (row.tvl_usd >= 1e8) return 100;
  return 50;
}

function feeFor(row) {
  const first = (row.chains && row.chains[0]) || "";
  if (first === "Ethereum") return { amount: 8, kind: "gas" };
  if (first === "Bitcoin") return { amount: 5, kind: "fees" };
  return { amount: 1, kind: "gas" };
}

function holdFor(row) {
  const age = row.age_days;
  if (age == null || age >= 365) return 30;
  if (age >= 180) return 45;
  return 60;
}

function planFor(row) {
  const amt = stakeFor(row);
  const fee = feeFor(row);
  const hold = holdFor(row);
  const chains = row.chains || [];
  const main = chains[0] || "";
  const again = chains.length >= 2
    ? " Repeat the same position on " + chains[1] +
      " if the app supports it, so the activity is visible on more than one chain."
    : "";
  const cat = row.category || "";
  const name = row.name;
  let deed;
  if (["Risk Curators", "Onchain Capital Allocator", "Yield", "Yield Aggregator"].includes(cat)) {
    deed = "Deposit $" + amt + " into a " + name + " vault on " + main +
      " and keep the shares for the whole qualifying window.";
  } else if (["Lending", "CDP", "Collateral Markets", "Uncollateralized Lending"].includes(cat)) {
    deed = "Supply $" + amt + " of USDC to " + name + " on " + main +
      " and borrow a small amount against it, then repay the borrow before the position closes.";
  } else if (["Dexs", "Indexes", "Leveraged Farming"].includes(cat)) {
    deed = "Provide $" + amt + " of liquidity to " + name + "'s main pool on " + main +
      " and make one swap through it each week.";
  } else if (["Derivatives", "Basis Trading", "Interest Rate Derivatives"].includes(cat)) {
    deed = "Deposit $" + amt + " of USDC as margin on " + name +
      " and open one small hedged position, then close it the same week.";
  } else if (cat === "RWA") {
    deed = "Mint $" + amt + " of the protocol's yield asset on " + main +
      " and hold it; check the asset's backing page before you mint.";
  } else if (cat === "Staking Pool" || cat === "Restaking") {
    deed = "Stake $" + amt + " of the chain's staking asset through " + name +
      " and keep the receipt until the window ends.";
  } else if (cat === "Dual-Token Stablecoin" || cat === "Stablecoin Wrapper") {
    deed = "Mint or deposit $" + amt + " of the stable asset through " + name + " on " + main +
      " and hold it through the window.";
  } else if (cat === "Chain") {
    deed = "Use $" + amt + " across " + name + "'s own apps on " + main +
      ": one deposit and one transaction a week for the whole window.";
  } else if (cat === "Insurance") {
    deed = "Buy $" + amt + " of cover from " + name + " on " + main +
      " and keep the policy active for the whole window.";
  } else if (cat === "Payments") {
    deed = "Route $" + amt + " of real payments through " + name + " on " + main +
      " across two separate weeks, not in one lump.";
  } else if (cat === "Prediction Market") {
    deed = "Fund $" + amt + " and place one market position on " + name +
      ", then settle it and place a second one the next week.";
  } else {
    deed = "Deposit $" + amt + " of USDC into " + name + " on " + main +
      " and keep the position open.";
  }
  const tail = " Cost: $" + amt + " of capital and about $" + fee.amount +
    " of " + fee.kind + ". Time: 15 minutes to set up.";
  const first = cat === "Prediction Market" ? deed + tail : deed + again + tail;
  return [
    "Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.",
    first,
    "Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep a screenshot of each one. Cost: about $" + fee.amount + " of " + fee.kind + " a week. Time: 10 minutes a week.",
    "Hold the position for at least " + hold + " days so the activity is counted in more than one snapshot. Cost: the $" + amt + " stays in the position. Time: " + hold + " days.",
    "Once a month, open the protocol's own docs and check the position is still earning points or rewards, and revoke any approval you no longer use. Cost: no fee to check. Time: 10 minutes a month.",
    "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    "Write the wallet, the dates and every transaction hash in a farm log, and plan the exit: unwind in two steps so a failed transaction never strands the whole position. Cost: nothing but the log. Time: 5 minutes.",
  ];
}

/* ---------- filtering + sorting ---------- */

function matches(row) {
  if (view.watchOnly && !row.on_watchlist) return false;
  if (view.category && row.category !== view.category) return false;
  if (view.chain && !(row.chains || []).includes(view.chain)) return false;
  if (view.risk && row.risk_tier !== view.risk) return false;
  if (view.minTvl && !(row.tvl_usd >= view.minTvl)) return false;
  if (view.query) {
    const hay = [row.name, row.category, (row.chains || []).join(" ")].join(" ").toLowerCase();
    if (!hay.includes(view.query)) return false;
  }
  return true;
}

function visiblePre() {
  const rows = BOARD.filter(matches);
  const key = view.sortKey;
  const dir = view.sortDir;
  const val = (r) => {
    if (key === "change_7d") return r.change_7d == null ? -Infinity : r.change_7d;
    if (key === "age_days") return r.age_days == null ? -Infinity : r.age_days;
    return r[key];
  };
  rows.sort((a, b) => {
    const d = val(a) - val(b);
    return d !== 0 ? d * dir : a.rank - b.rank;
  });
  return rows;
}

function visibleLive() {
  const rows = LIVE.filter((r) => {
    if (view.category && r.category !== view.category) return false;
    if (view.chain && !(r.chains || []).includes(view.chain)) return false;
    if (view.minTvl && !(r.tvl_usd >= view.minTvl)) return false;
    if (view.query) {
      const hay = [r.name, r.category, (r.chains || []).join(" ")].join(" ").toLowerCase();
      if (!hay.includes(view.query)) return false;
    }
    return true;
  });
  const key = view.sortKey === "rank" || view.sortKey === "implied_value_usd" ? "tvl_usd"
    : view.sortKey === "readiness_score" ? "tvl_usd" : view.sortKey;
  rows.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" || typeof bv === "string") {
      return String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv)) * view.sortDir;
    }
    const an = av == null ? -Infinity : av;
    const bn = bv == null ? -Infinity : bv;
    return (an - bn) * view.sortDir;
  });
  return rows;
}

/* ---------- rendering ---------- */

function fillSelects() {
  const cats = [...new Set(BOARD.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(BOARD.flatMap((r) => r.chains || []))].sort();
  for (const c of cats) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    $("cat").appendChild(o);
  }
  for (const c of chains) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    $("chain").appendChild(o);
  }
}

function paintHero() {
  $("mastmeta").textContent = "Snapshot " + (RADAR.as_of || "—") +
    " · DefiLlama protocol index · " + (RADAR.model_version || "radar") + " model";
  $("heroTitle").textContent = (RADAR.watchlist_size || 0) +
    " watchlist protocols, ranked by implied value";
  $("heroIntro").textContent =
    "The watchlist is the floor: every protocol with at least " +
    compactMoney(RADAR.floor_usd || 50000000) + " of TVL and no token on record. " +
    "The early radar adds " + (RADAR.early_size || 0) + " pre-token protocols below that floor, " +
    "every one that passes the same exclusion rule. Implied value is a model, not a promise: " +
    "no token is predicted, and no airdrop is promised.";
  $("statTvl").textContent = compactMoney(RADAR.total_tvl_usd);
  $("statMedian").textContent = compactMoney(RADAR.median_implied_usd);
  $("statCategory").textContent = RADAR.top_category || "—";
  const side = [
    ["Watchlist covered", (RADAR.watchlist_size || 0) + " / " + (RADAR.watchlist_size || 0)],
    ["Pre-token rows scored", String(RADAR.board_size || BOARD.length)],
    ["Early rows below the floor", String(RADAR.early_size || 0)],
    ["Live-token protocols set aside", String(RADAR.live_size || LIVE.length)],
  ];
  $("heroSide").innerHTML = side.map(([k, v]) =>
    '<div class="kv"><dt>' + esc(k) + '</dt><dd>' + esc(v) + "</dd></div>").join("");
}

function headCell(label, key) {
  const mark = view.sortKey === key ? (view.sortDir === 1 ? " ↓" : " ↑") : "";
  return '<th><button type="button" data-sort="' + key + '">' +
    esc(label) + mark + "</button></th>";
}

function meterBar(frac, label) {
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  return '<span class="meter"><span class="track"><span class="fill" style="width:' +
    pct + '%"></span></span><span class="val">' + esc(label) + "</span></span>";
}

function riskTag(tier) {
  return '<span class="tag ' + esc(tier || "") + '">' + esc(tier || "—") + "</span>";
}

function renderBoard() {
  const head = $("boardHead");
  const body = $("boardBody");
  if (view.tab === "live") {
    $("boardNote").textContent =
      "Protocols that already record a token, set aside from the pre-token board. Their market cap is shown, never a model value.";
    head.innerHTML = "<tr>" + headCell("Protocol", "name") +
      "<th>Category</th><th>Chains</th>" + headCell("TVL", "tvl_usd") +
      headCell("7d", "change_7d") + headCell("Market cap", "mcap_usd") + "</tr>";
    const rows = visibleLive();
    body.innerHTML = rows.map((r) => {
      const g = signedPct(r.change_7d);
      return "<tr data-slug=\"" + esc(r.slug) + "\" data-live=\"1\">" +
        '<td><div class="proto-name">' + esc(r.name) + "</div>" +
        '<div class="proto-sub">' + esc(r.category || "—") + "</div></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc((r.chains || []).join(", ")) + "</td>" +
        '<td class="num">' + esc(compactMoney(r.tvl_usd)) + "</td>" +
        '<td class="num"><span class="' + g.cls + '">' + esc(g.text) + "</span></td>" +
        '<td class="num">' + esc(compactMoney(r.mcap_usd)) + "</td></tr>";
    }).join("");
    $("rowCount").textContent = rows.length + " rows shown";
    $("emptyMsg").hidden = rows.length > 0;
    return;
  }

  $("boardNote").textContent =
    "Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.";
  head.innerHTML = "<tr>" + headCell("Rank", "rank") + "<th>Protocol</th>" +
    headCell("TVL", "tvl_usd") + headCell("7d", "change_7d") +
    headCell("Age", "age_days") + headCell("Ready", "readiness_score") +
    headCell("Implied value", "implied_value_usd") + "<th>Risk</th><th>Token</th></tr>";
  const rows = visiblePre();
  const top = Math.max(1, ...BOARD.map((r) => r.implied_value_usd || 0));
  body.innerHTML = rows.map((r) => {
    const g = signedPct(r.change_7d);
    const sub = (r.category || "—") + " on " + (r.chains || []).slice(0, 2).join(", ") +
      (r.on_watchlist ? " · watchlist" : "");
    return '<tr data-slug="' + esc(r.slug) + '"' +
      (view.picked === r.slug ? ' class="picked"' : "") + ">" +
      '<td class="rank">' + r.rank + "</td>" +
      '<td><div class="proto-name">' + esc(r.name) + "</div>" +
      '<div class="proto-sub">' + esc(sub) + "</div></td>" +
      '<td class="num">' + esc(compactMoney(r.tvl_usd)) + "</td>" +
      '<td class="num"><span class="' + g.cls + '">' + esc(g.text) + "</span></td>" +
      '<td class="num">' + esc(ageText(r.age_days)) + "</td>" +
      '<td class="num">' + meterBar((r.readiness_score || 0) / 100, String(r.readiness_score)) + "</td>" +
      '<td class="num">' + meterBar((r.implied_value_usd || 0) / top, compactMoney(r.implied_value_usd)) + "</td>" +
      "<td>" + riskTag(r.risk_tier) + "</td>" +
      '<td><span class="token-flag">no token</span></td></tr>';
  }).join("");
  $("rowCount").textContent = rows.length + " rows shown";
  $("emptyMsg").hidden = rows.length > 0;
}

/* ---------- detail sheet ---------- */

function factRow(label, value, mono) {
  return '<div class="kv"><dt>' + esc(label) + '</dt><dd' +
    (mono ? ' class="mono"' : "") + ">" + value + "</dd></div>";
}

function recomputed(row) {
  const base = MODEL.base_multiple == null ? 0.25 : MODEL.base_multiple;
  const g = multOf(row, "growth_multiplier");
  const m = multOf(row, "maturity_multiplier");
  const b = multOf(row, "breadth_multiplier");
  if (g == null || m == null || b == null) return null;
  return Math.round(row.tvl_usd * base * g * m * b);
}

function openSheet(slug, live) {
  const row = live
    ? LIVE.find((r) => r.slug === slug)
    : BOARD.find((r) => r.slug === slug);
  if (!row) return;
  view.picked = slug;
  const inner = $("sheetInner");
  if (live) {
    const g = signedPct(row.change_7d);
    inner.innerHTML =
      '<div class="sheet-top"><div><p class="sheet-kicker">Live token · set aside from the board</p>' +
      "<h2>" + esc(row.name) + "</h2>" +
      '<p class="sheet-sub">' + esc(row.category || "—") + " on " + esc((row.chains || []).join(", ")) + "</p></div>" +
      '<button class="close-btn" type="button" id="sheetClose">Close</button></div>' +
      "<h3>Market</h3><dl class=\"facts\">" +
      factRow("TVL", esc(compactMoney(row.tvl_usd))) +
      factRow("Seven-day change", '<span class="' + g.cls + '">' + esc(g.text) + "</span>") +
      factRow("Market cap", esc(compactMoney(row.mcap_usd))) +
      factRow("Chains", esc(String((row.chains || []).length))) +
      "</dl>" +
      '<p class="sheet-note">This protocol already records a token, so it sits outside the pre-token board and carries no implied value. It is listed here so the radar stays honest about what it leaves out.</p>';
  } else {
    const again = recomputed(row);
    const g = signedPct(row.change_7d);
    const steps = planFor(row);
    const chainLine = (row.chains || []).join(", ");
    inner.innerHTML =
      '<div class="sheet-top"><div><p class="sheet-kicker">Rank ' + row.rank + " of " + BOARD.length +
      (row.on_watchlist ? " · watchlist" : "") + "</p>" +
      "<h2>" + esc(row.name) + "</h2>" +
      '<p class="sheet-sub">' + esc(row.category || "—") + " on " + esc(chainLine) + "</p></div>" +
      '<button class="close-btn" type="button" id="sheetClose">Close</button></div>' +
      "<h3>Implied value</h3><dl class=\"facts\">" +
      factRow("TVL", esc(compactMoney(row.tvl_usd))) +
      factRow("Seven-day growth", '<span class="' + g.cls + '">' + esc(g.text) + "</span>") +
      factRow("Age with no token", esc(ageText(row.age_days))) +
      factRow("First listed", esc(row.listed_at || "—")) +
      factRow("Chains", esc(String((row.chains || []).length))) +
      factRow("Base multiple", esc(String(MODEL.base_multiple == null ? "—" : MODEL.base_multiple)), true) +
      factRow("Growth multiplier", esc(String(multOf(row, "growth_multiplier") == null ? "—" : multOf(row, "growth_multiplier"))), true) +
      factRow("Maturity multiplier", esc(String(multOf(row, "maturity_multiplier") == null ? "—" : multOf(row, "maturity_multiplier"))), true) +
      factRow("Breadth multiplier", esc(String(multOf(row, "breadth_multiplier") == null ? "—" : multOf(row, "breadth_multiplier"))), true) +
      factRow("Implied value", esc(compactMoney(row.implied_value_usd))) +
      factRow("Readiness (0–100)", esc(String(row.readiness_score))) +
      factRow("Risk tier", riskTag(row.risk_tier)) +
      "</dl>" +
      '<p class="sheet-note">Model ' + esc(RADAR.model_version || "radar") +
      " scores every protocol with the same function. This page recomputes the row above as " +
      esc(again == null ? "—" : compactMoney(again)) +
      ", the same figure board.json carries. It is an estimate, not a price. The protocol records no token: that is what the snapshot says, not proof it has none.</p>" +
      "<h3>Farm plan</h3><ol class=\"plan\">" +
      steps.map((s) => {
        const cut = s.indexOf(" Cost: ");
        const main = cut >= 0 ? s.slice(0, cut) : s;
        const rest = cut >= 0 ? s.slice(cut) : "";
        return "<li>" + esc(main) +
          (rest ? '<span class="cost">' + esc(rest) + "</span>" : "") + "</li>";
      }).join("") + "</ol>";
  }
  $("sheet").hidden = false;
  $("scrim").hidden = false;
  $("sheetClose").addEventListener("click", closeSheet);
  renderBoard();
}

function closeSheet() {
  view.picked = null;
  $("sheet").hidden = true;
  $("scrim").hidden = true;
  renderBoard();
}

/* ---------- CSV export ---------- */

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv() {
  let head, lines;
  if (view.tab === "live") {
    head = ["name", "category", "chains", "tvl_usd", "change_7d", "mcap_usd"];
    lines = visibleLive().map((r) => [r.name, r.category, (r.chains || []).join("; "),
      r.tvl_usd, r.change_7d, r.mcap_usd].map(csvCell).join(","));
  } else {
    head = ["rank", "name", "category", "chains", "tvl_usd", "change_7d", "age_days",
      "implied_value_usd", "readiness_score", "risk_tier", "on_watchlist"];
    lines = visiblePre().map((r) => [r.rank, r.name, r.category, (r.chains || []).join("; "),
      r.tvl_usd, r.change_7d, r.age_days, r.implied_value_usd, r.readiness_score,
      r.risk_tier, r.on_watchlist].map(csvCell).join(","));
  }
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = view.tab === "live" ? "token-radar-live.csv" : "token-radar-board.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- wiring ---------- */

function setTab(tab) {
  view.tab = tab;
  view.sortKey = tab === "live" ? "tvl_usd" : "rank";
  view.sortDir = tab === "live" ? -1 : 1;
  $("tabPre").classList.toggle("on", tab === "pre");
  $("tabLive").classList.toggle("on", tab === "live");
  $("tabPre").setAttribute("aria-selected", String(tab === "pre"));
  $("tabLive").setAttribute("aria-selected", String(tab === "live"));
  $("watchOnly").disabled = tab === "live";
  closeSheet();
  renderBoard();
}

function boot() {
  fillSelects();
  paintHero();
  renderBoard();

  $("q").addEventListener("input", (e) => {
    view.query = e.target.value.trim().toLowerCase();
    renderBoard();
  });
  $("cat").addEventListener("change", (e) => { view.category = e.target.value; renderBoard(); });
  $("chain").addEventListener("change", (e) => { view.chain = e.target.value; renderBoard(); });
  $("risk").addEventListener("change", (e) => { view.risk = e.target.value; renderBoard(); });
  $("minTvl").addEventListener("change", (e) => { view.minTvl = Number(e.target.value); renderBoard(); });
  $("watchOnly").addEventListener("click", (e) => {
    view.watchOnly = !view.watchOnly;
    e.currentTarget.setAttribute("aria-pressed", String(view.watchOnly));
    renderBoard();
  });
  $("tabPre").addEventListener("click", () => setTab("pre"));
  $("tabLive").addEventListener("click", () => setTab("live"));
  $("csvBtn").addEventListener("click", downloadCsv);
  $("scrim").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  $("boardHead").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sort]");
    if (!btn) return;
    const key = btn.getAttribute("data-sort");
    if (view.sortKey === key) view.sortDir = -view.sortDir;
    else { view.sortKey = key; view.sortDir = (key === "name" || key === "rank") ? 1 : -1; }
    renderBoard();
  });
  $("boardBody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-slug]");
    if (tr) openSheet(tr.getAttribute("data-slug"), tr.getAttribute("data-live") === "1");
  });
}

document.addEventListener("DOMContentLoaded", boot);
