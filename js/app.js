/* AwardHub - minimal HTML5 SPA (History API router)
 *
 * Key design:
 * - Static site (GitHub Pages compatible) + client-side routing (History API).
 * - Data is loaded live from Google Sheet via Apps Script JSON API.
 * - UI is rendered with vanilla JS (no framework).
 * - Game icon URLs are derived from "year + winner game name" -> slug -> file path.
 * - Image fallback: try .webp, then .jpg, then .png, finally placeholder.
 *
 * IMPORTANT:
 * - History routing requires server fallback (e.g., GitHub Pages 404.html -> index.html).
 * - Use absolute paths (/steamawards/..., /img/...) to avoid path issues under nested routes.
 */

const APP = document.getElementById("app");
const YEAR_NOW = document.getElementById("yearNow");
if (YEAR_NOW) YEAR_NOW.textContent = String(new Date().getFullYear());

/**
 * Google Sheet JSON API endpoint (Apps Script Web App).
 * It returns:
 * {
 *   ok: true,
 *   sheet: "...",
 *   rows: N,
 *   data: [{Year, Title, Winner, ...}, ...]
 * }
 */
const SHEET_API_URL =
  "https://script.google.com/macros/s/AKfycbwqm5cQV5jB7QHkAgRAySN4ie9Q1ugEuH8EwwygkDsHaZn21vqMrsiRXk-GJrH5ElRN/exec?sheet=steam_awards_all";

/**
 * Simple in-memory cache for sheet data.
 * - Avoids repeated network calls when navigating between years.
 * - Reset only when page reloads.
 */
let _sheetCache = null;

/** ---------------------------
 *  Utilities
 *  ---------------------------
 */

/**
 * Escape string for safe insertion into HTML (prevents HTML injection).
 * Use it for any user-controlled / external content (sheet rows).
 */
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Convert a game name into a filename-friendly slug that matches your repo naming rules.
 *
 * Repo naming convention (based on your screenshots):
 * - lowercase
 * - words separated by underscore
 * - special symbols removed
 * - IMPORTANT: "'s" becomes "_s" (e.g., Assassin's -> assassin_s)
 *
 * Examples:
 * - "Assassin's Creed® Odyssey" -> "assassin_s_creed_odyssey"
 * - "Tom Clancy's Rainbow Six® Siege X" -> "tom_clancy_s_rainbow_siege_x"
 * - "Marvel's Guardians of the Galaxy" -> "marvel_s_guardians_of_the_galaxy"
 */
function slugifyGameName(name) {
  if (!name) return "";

  return String(name)
    .toLowerCase()
    .trim()

    // convert "'s" to "s" (Marvel's -> marvels)
    .replace(/'s\b/g, "s")

    // remove remaining apostrophes
    .replace(/'/g, "")

    // & -> and
    .replace(/&/g, "and")

    // remove trademark symbols
    .replace(/[®™©]/g, "")

    // replace non-alphanumeric with underscore
    .replace(/[^a-z0-9]+/g, "_")

    // collapse multiple underscores
    .replace(/_+/g, "_")

    // trim underscores
    .replace(/^_+|_+$/g, "");
}


/**
 * Build an icon URL from year + game name.
 * The primary format is WebP:
 *   /img/<year>/<slug>.webp
 *
 * Notes:
 * - Use absolute path to avoid nested route path issues.
 * - If slug or year is missing, return placeholder.
 */
function buildGameImageUrl(year, gameName) {
  const slug = slugifyGameName(gameName);
  if (!year || !slug) return "/img/placeholder.png";
  return `/img/${year}/${slug}.webp`;
}

/**
 * Normalize a path:
 * - Ensure it starts with "/"
 * - Remove trailing slashes
 * - Return "/" for empty values
 */
function normalizePath(p) {
  if (!p) return "/";
  let x = p.startsWith("/") ? p : "/" + p;
  x = x.replace(/\/+$/, "");
  return x === "" ? "/" : x;
}

/**
 * Parse the current URL as a "route parts array" using History routing.
 * Example:
 *   location.pathname = "/steamawards/2024/"
 *   => ["steamawards", "2024"]
 */
function parsePathRoute() {
  const path = normalizePath(location.pathname);
  const parts = path.split("/").filter(Boolean);
  return parts;
}

/**
 * Render a temporary loading state.
 * Called before async work like fetching data.
 */
function setLoading() {
  APP.innerHTML = `<div class="notice">Loading…</div>`;
}

/**
 * Render an error message in the main app container.
 * Escapes content to avoid HTML injection.
 */
function setError(msg) {
  APP.innerHTML = `<div class="notice">❌ ${escapeHtml(msg)}</div>`;
}

/**
 * Fetch all rows from the Sheet API (cached).
 * - Uses "no-store" to avoid browser caching stale responses.
 * - Validates the API response.
 */
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

/**
 * Extract and sort all available years found in the sheet.
 * The UI uses these to render year cards on the home page.
 */
function getAvailableYearsFromRows(rows) {
  const years = new Set();
  rows.forEach((r) => {
    const y = Number(r.Year);
    if (Number.isFinite(y)) years.add(y);
  });
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * Convert flat sheet rows into the structure used by the UI.
 * - Filter only rows of the requested year.
 * - Each row becomes an "award" section with a winner card.
 * - icon_url is derived from (year, winnerName).
 *
 * Data output shape:
 * {
 *   year: 2018,
 *   source: "...",
 *   awards: [
 *     { award_id, award_name, winner: { game_name, icon_url, ... }, nominees: [] },
 *     ...
 *   ]
 * }
 */
function buildYearDataFromRows(year, rows) {
  const awards = rows
    .filter((r) => Number(r.Year) === Number(year))
    .map((r, idx) => {
      const awardName = String(r.Title || "").trim() || `Award ${idx + 1}`;
      const winnerName = String(r.Winner || "").trim() || "Unknown Game";

      return {
        // award_id is used as a stable DOM attribute for sections
        award_id: awardName
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^\w_]/g, ""),

        award_name: awardName,

        winner: {
          game_name: winnerName,

          // Primary icon path is webp based on repo naming convention
          icon_url: buildGameImageUrl(year, winnerName),

          // Reserved for future use (blogger post URL)
          blogger_url: "",

          // Reserved for future use (steam store URL)
          steam_url: ""
        },

        // Nominees currently not displayed; keep for possible future
        nominees: []
      };
    });

  /**
   * De-duplicate in case the sheet contains duplicate award entries:
   * - We use year + award_name + winner_name as the key.
   */
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

/**
 * Fetch a single year's data.
 * Currently this is computed from the full sheet rows.
 * (If your dataset becomes huge, you can optimize by fetching only a year subset.)
 */
async function fetchYearData(year) {
  const rows = await fetchSheetRows();
  return buildYearDataFromRows(year, rows);
}

/**
 * Render an <img> tag with progressive fallbacks:
 * - Try the provided src (usually .webp)
 * - If fails: try .jpg
 * - If fails: try .png
 * - If fails: use placeholder
 *
 * Why:
 * - During migration to WebP, some images might still exist only as jpg/png.
 * - This avoids broken icons even if the repo isn't fully converted yet.
 */
function imgWithFallback(url) {
  const safe = escapeHtml(url || "/img/placeholder.png");
  return `
    <img class="gameCard__img"
         src="${safe}"
         alt=""
         loading="lazy"
         onerror="
           const src=this.src;
           const tried=this.dataset.tried||'';
           if(!tried){
             this.dataset.tried='jpg';
             this.src=src.replace(/\\.webp($|\\?)/i,'.jpg$1');
             return;
           }
           if(tried==='jpg'){
             this.dataset.tried='png';
             this.src=src.replace(/\\.jpg($|\\?)/i,'.png$1');
             return;
           }
           this.onerror=null;
           this.src='/img/placeholder.png';
         " />
  `;
}

/** ---------------------------
 *  Navigation (History API)
 *  ---------------------------
 */

/**
 * Navigate to a new internal route using History API without full page reload.
 * - Ensures normalized trailing slash for consistency.
 * - Calls route() to render the new view.
 */
function navigate(to) {
  const url = normalizePath(to) + "/";
  history.pushState({}, "", url);
  route();
}

/**
 * Replace current URL (no new history entry).
 * Useful for default redirects (e.g., "/" -> "/steamawards/").
 */
function replace(to) {
  const url = normalizePath(to) + "/";
  history.replaceState({}, "", url);
}

/** ---------------------------
 *  Views
 *  ---------------------------
 */

/**
 * Render the home page:
 * - Loads sheet rows (cached).
 * - Builds a list of available years.
 * - Renders year cards that link to /steamawards/<year>/
 */
async function renderHome() {
  setLoading();
  try {
    const rows = await fetchSheetRows();
    const years = getAvailableYearsFromRows(rows);

    const yearsHtml = years
      .map((y) => {
        // Use absolute path so it works under nested routes and history mode
        return `
          <a class="card yearCard" href="/steamawards/${y}/" aria-label="Steam Awards ${y}">
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

/**
 * Render the top header area for a year page.
 * Includes search input and back link.
 */
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
        <a class="badge" href="/steamawards/">Back</a>
      </div>
    </div>
  `;
}

/**
 * Render one award section (title + winner card).
 * Nominees are intentionally omitted in the UI.
 */
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

/**
 * Render one game card.
 * - Uses data-game-name for client-side search filtering.
 * - Uses imgWithFallback() for progressive image fallback.
 */
function renderGameCard(game, isWinner) {
  const name = escapeHtml(game.game_name || "Unknown Game");
  const icon = game.icon_url || "/img/placeholder.png";
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

/**
 * Apply live search filtering to all game cards on the current page.
 * - This is a client-side filter; no network calls.
 * - It matches case-insensitively against the rendered game name.
 */
function applySearchFilter(keyword) {
  const k = keyword.trim().toLowerCase();
  const cards = APP.querySelectorAll(".gameCard");
  cards.forEach((card) => {
    const gameName = card.getAttribute("data-game-name") || "";
    card.style.display = gameName.includes(k) ? "" : "none";
  });
}

/** ---------------------------
 *  Router
 *  ---------------------------
 *
 * Supported routes:
 * - /steamawards/           -> home (list years)
 * - /steamawards/<year>/    -> year details
 *
 * Default:
 * - "/" auto-replaces to "/steamawards/"
 */
async function route() {
  const parts = parsePathRoute();

  // Root path: redirect to /steamawards/ (History replace to avoid extra history entry)
  if (parts.length === 0) {
    replace("/steamawards");
    return;
  }

  // /steamawards or /steamawards/<year>
  if (parts[0] === "steamawards") {
    // /steamawards/ -> list years
    if (parts.length === 1) {
      await renderHome();
      return;
    }

    // /steamawards/<year>/
    const year = Number(parts[1]);
    if (!year || !Number.isFinite(year)) {
      setError('Invalid year. Example: "/steamawards/2024/"');
      return;
    }

    setLoading();
    try {
      const data = await fetchYearData(year);
      const awards = Array.isArray(data.awards) ? data.awards : [];
      const header = renderYearHeader(year, awards.length, data.source);
      const body = awards.map(renderAwardSection).join("");

      APP.innerHTML = header + body;

      // Wire up live search input
      const searchBox = document.getElementById("searchBox");
      if (searchBox) {
        searchBox.addEventListener("input", (e) => applySearchFilter(e.target.value));
      }
    } catch (e) {
      setError(e.message || String(e));
    }
    return;
  }

  // Unknown route -> show a simple 404 view (client-side)
  APP.innerHTML = `
    <div class="hero">
      <h1 class="hero__title">404</h1>
      <p class="hero__desc">The page you’re looking for doesn’t exist.</p>
      <div class="toolbar">
        <a class="badge" href="/steamawards/">Back</a>
      </div>
    </div>
  `;
}

/** ---------------------------
 *  Link interception (internal SPA navigation)
 *  ---------------------------
 *
 * We intercept clicks on internal <a href="/..."> links to avoid full page reload.
 * - External URLs (http/https) are NOT intercepted.
 * - mailto/tel are NOT intercepted.
 * - hash-only links are NOT intercepted.
 * - Only absolute internal paths (starting with "/") are intercepted.
 */
document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;

  const href = a.getAttribute("href");
  if (!href) return;

  // Do not intercept external links
  if (href.startsWith("http://") || href.startsWith("https://")) return;

  // Do not intercept special schemes
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return;

  // Do not intercept hash-only anchors
  if (href.startsWith("#")) return;

  // Intercept only internal absolute paths
  if (!href.startsWith("/")) return;

  e.preventDefault();
  navigate(href);
});

/**
 * Handle browser back/forward buttons.
 * popstate fires when the active history entry changes.
 */
window.addEventListener("popstate", route);

/**
 * Initial render when the document is ready.
 */
window.addEventListener("DOMContentLoaded", route);
