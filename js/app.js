/* AwardHub - minimal HTML5 SPA (hash router) */

const APP = document.getElementById("app");
const YEAR_NOW = document.getElementById("yearNow");
if (YEAR_NOW) YEAR_NOW.textContent = String(new Date().getFullYear());

// Google Sheet JSON API（Apps Script Web App）
const SHEET_API_URL =
  "https://script.google.com/macros/s/AKfycbwqm5cQV5jB7QHkAgRAySN4ie9Q1ugEuH8EwwygkDsHaZn21vqMrsiRXk-GJrH5ElRN/exec?sheet=steam_awards_all";

// Memory Cache
let _sheetCache = null;

/**
 * Add new years here when you ship new JSON files.
 * Example data path: data/steam_awards_2024.json
 */
const AVAILABLE_YEARS = [2024, 2023, 2022, 2021, 2020, 2019, 2018];

/** ---- Utils ---- **/
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseHashRoute() {
  const hash = location.hash || "#/";
  const path = hash.replace(/^#/, "");
  const parts = path.split("/").filter(Boolean);
  return parts;
}

function setLoading() {
  APP.innerHTML = `<div class="notice">Loading…</div>`;
}

function setError(msg) {
  APP.innerHTML = `<div class="notice">❌ ${escapeHtml(msg)}</div>`;
}

async function fetchSheetRows() {
  if (_sheetCache) return _sheetCache;

  const res = await fetch(SHEET_API_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load sheet api (HTTP ${res.status})`);

  const json = await res.json();
  if (!json || json.ok !== true) {
    throw new Error(json?.error || "Sheet API returned not ok");
  }

  const rows = Array.isArray(json.data) ? json.data : [];
  _sheetCache = rows;
  return rows;
}

function getAvailableYearsFromRows(rows) {
  const years = new Set();
  rows.forEach((r) => {
    const y = Number(r.Year);
    if (Number.isFinite(y)) years.add(y);
  });
  return Array.from(years).sort((a, b) => b - a);
}

// 把扁平 rows => 你页面需要的 awards 结构
function buildYearDataFromRows(year, rows) {
  const awards = rows
    .filter((r) => Number(r.Year) === Number(year))
    .map((r, idx) => {
      const awardName = String(r.Title || "").trim() || `Award ${idx + 1}`;
      const winnerName = String(r.Winner || "").trim() || "Unknown Game";

      return {
        award_id: awardName.toLowerCase().replace(/\s+/g, "_").replace(/[^\w_]/g, ""),
        award_name: awardName,
        winner: {
          game_name: winnerName,
          icon_url: "img/placeholder.png", // 你表里没提供就先用占位图
          blogger_url: "",
          steam_url: ""
        },
        nominees: [] // 明确置空
      };
    });

  // 去重（如果同一年同奖项重复）
  const seen = new Set();
  const deduped = [];
  for (const a of awards) {
    const key = `${year}__${a.award_name}__${a.winner.game_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }

  return {
    year,
    source: "Steam Awards (Google Sheet)",
    awards: deduped
  };
}

async function fetchYearData(year) {
  const rows = await fetchSheetRows();
  return buildYearDataFromRows(year, rows);
}


function imgWithFallback(url) {
  const safe = escapeHtml(url || "img/placeholder.png");
  return `
    <img class="gameCard__img"
         src="${safe}"
         alt=""
         loading="lazy"
         onerror="this.onerror=null;this.src='img/placeholder.png';" />
  `;
}

/** ---- Views ---- **/
async function renderHome() {
  setLoading();
  try {
    const rows = await fetchSheetRows();
    const years = getAvailableYearsFromRows(rows);

    const yearsHtml = years
      .map((y) => {
        return `
          <a class="card yearCard" href="#/steam-awards/${y}" aria-label="Steam Awards ${y}">
            <div>
              <div class="yearCard__year">${y}</div>
              <div class="yearCard__meta">Steam Game Awards</div>
            </div>
            <div class="badge">Open</div>
          </a>
        `;
      })
      .join("");

    APP.innerHTML = `
      <div class="hero">
        <h1 class="hero__title">AwardHub</h1>
        <p class="hero__desc">
          Steam Awards data is loaded live from Google Sheet. Click a year to view winners.
        </p>

        <div class="grid grid--years">
          ${yearsHtml}
        </div>

        <div class="notice">
          Data source: Google Sheet → Apps Script JSON API.
        </div>
      </div>
    `;
  } catch (e) {
    setError(e.message || String(e));
  }
}

function renderYearHeader(year, awardCount, source) {
  return `
    <div class="hero">
      <h1 class="hero__title">Steam Game Awards ${year}</h1>
      <p class="hero__desc">
        Source: ${escapeHtml(source || "Steam")}. Total awards: ${awardCount}.
      </p>

      <div class="toolbar">
        <input id="searchBox" class="input" placeholder="Search by game name (live filter)" />
        <span class="badge">Year: ${year}</span>
        <a class="badge" href="#/">Back to Home</a>
      </div>
    </div>
  `;
}

function renderAwardSection(award) {
  const awardName = escapeHtml(award.award_name || award.award_id || "Unknown Award");
  const winner = award.winner;

  const winnerCard = winner
    ? renderGameCard(winner, true)
    : `<div class="notice">No winner data for this award yet.</div>`;

  return `
    <section class="section" data-award-id="${escapeHtml(award.award_id || "")}">
      <div class="section__head">
        <div>
          <h2 class="section__title">${awardName}</h2>
          <div class="section__sub">Winner</div>
        </div>
      </div>

      <div class="gameGrid">
        ${winnerCard}
      </div>
    </section>
  `;
}


function renderGameCard(game, isWinner) {
  const name = escapeHtml(game.game_name || "Unknown Game");
  const icon = game.icon_url || "img/placeholder.png";
  const blogger = game.blogger_url || "";
  const steam = game.steam_url || "";

  const bloggerBtn = blogger
    ? `<a class="btn btn--primary" href="${escapeHtml(blogger)}" target="_blank" rel="noopener">Read Post</a>`
    : `<span class="btn btn--primary btn--disabled" title="blogger_url is missing">Post not published</span>`;

  const steamBtn = steam
    ? `<a class="btn" href="${escapeHtml(steam)}" target="_blank" rel="noopener">Steam</a>`
    : `<span class="btn btn--disabled" title="steam_url is missing">Steam</span>`;

  return `
    <article class="gameCard" data-game-name="${name.toLowerCase()}">
      ${isWinner ? `<div class="ribbon">WINNER</div>` : ""}
      <div class="gameCard__inner">
        ${imgWithFallback(icon)}
        <div>
          <p class="gameCard__name">${name}</p>
          <div class="gameCard__meta">${isWinner ? "Winner" : "Nominee"}</div>
        </div>
      </div>
      <div class="btnRow">
        ${bloggerBtn}
        ${steamBtn}
      </div>
    </article>
  `;
}

function applySearchFilter(keyword) {
  const k = keyword.trim().toLowerCase();
  const cards = APP.querySelectorAll(".gameCard");
  cards.forEach((card) => {
    const gameName = card.getAttribute("data-game-name") || "";
    card.style.display = gameName.includes(k) ? "" : "none";
  });
}

/** ---- Router ---- **/
async function route() {
  const parts = parseHashRoute();

  // #/ => home
if (parts.length === 0) {
  await renderHome();
  return;
}

  // #/steam-awards/2024
  if (parts[0] === "steam-awards") {
    const year = Number(parts[1]);
    if (!year || !Number.isFinite(year)) {
      setError('Invalid year. Example: "#/steam-awards/2024"');
      return;
    }

    setLoading();
    try {
      const data = await fetchYearData(year);
      const awards = Array.isArray(data.awards) ? data.awards : [];
      const header = renderYearHeader(year, awards.length, data.source);
      const body = awards.map(renderAwardSection).join("");

      APP.innerHTML = header + body;

      const searchBox = document.getElementById("searchBox");
      if (searchBox) {
        searchBox.addEventListener("input", (e) => applySearchFilter(e.target.value));
      }
    } catch (e) {
      setError(e.message || String(e));
    }
    return;
  }

  // Unknown route
  APP.innerHTML = `
    <div class="hero">
      <h1 class="hero__title">404</h1>
      <p class="hero__desc">The page you’re looking for doesn’t exist.</p>
      <div class="toolbar">
        <a class="badge" href="#/">Back to Home</a>
      </div>
    </div>
  `;
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);
