/* AwardHub - minimal HTML5 SPA (History API router)
 *
 * Key design:
 * - Static site (GitHub Pages compatible) + client-side routing (History API).
 * - Data is loaded live from Google Sheet via Apps Script JSON API.
 * - UI is rendered with vanilla JS (no framework).
 * - Game icon URLs are derived from "year + winner/merit game name" -> slug -> file path.
 * - Image fallback: try .webp, then .jpg, then .png, finally placeholder.
 *
 * IMPORTANT:
 * - History routing requires server fallback (GitHub Pages 404.html -> index.html).
 * - Use absolute paths (/steamawards/..., /img/...) to avoid path issues under nested routes.
 *
 * Stability fixes included:
 * - Prevent "first visit blank screen" caused by redirect race with 404 fallback restore.
 * - Prevent "carousel long replay animation" when clicking far-away chips.
 *
 * Data schema note:
 * - Your Google Sheet column header changed from "Winner" -> "Merit".
 * - This file is backward compatible:
 *   It reads Merit first, and falls back to Winner if Merit is missing.
 */

/* ============================================================================
   DOM helpers
   ============================================================================ */

/**
 * Lazily retrieve #app.
 * Why:
 * - Guarantees the element exists at the moment we need it.
 * - Throws early if index.html template is wrong.
 */
function getAppEl() {
  const el = document.getElementById("app");
  if (!el) throw new Error('Missing #app element in index.html');
  return el;
}

/**
 * Sync footer year display.
 * Safe to call any time (no-op if #yearNow missing).
 */
function syncYearNow() {
  const YEAR_NOW = document.getElementById("yearNow");
  if (YEAR_NOW) YEAR_NOW.textContent = String(new Date().getFullYear());
}

/* ============================================================================
   Root auto redirect (safe with 404 restore)
   ============================================================================ */

/**
 * Rewrite "/" -> "/steamawards/" ONLY when:
 * - user is truly at root, AND
 * - there is no deep-link restore pending from 404.html (sessionStorage key)
 *
 * Why:
 * - 404.html stores the original deep-link into sessionStorage.
 * - index.html restores it early.
 * - If we force-redirect unconditionally, we break deep-link restore and may render blank.
 *
 * Implementation detail:
 * - Use history.replaceState() (soft redirect) to avoid full reload and race conditions.
 */
function safeRewriteRootToSteamAwards() {
  const pendingRestore = sessionStorage.getItem("awardhub:redirect");
  if (pendingRestore) return;

  const path = (location.pathname || "").replace(/\/+$/, "");
  const isRoot = path === "" || path === "/" || path === "/index.html";

  if (isRoot) {
    history.replaceState({}, "", "/steamawards/");
  }
}

/* ============================================================================
   Data source
   ============================================================================ */

/**
 * Google Sheet JSON API endpoint (Apps Script Web App).
 * Returns:
 * {
 *   ok: true,
 *   sheet: "...",
 *   rows: N,
 *   data: [{Year, Title, Merit, ...}, ...]  // or {Year, Title, Winner, ...} for old sheet
 * }
 */
const SHEET_API_URL =
  "https://script.google.com/macros/s/AKfycbwqm5cQV5jB7QHkAgRAySN4ie9Q1ugEuH8EwwygkDsHaZn21vqMrsiRXk-GJrH5ElRN/exec?sheet=steam_awards_all";

/**
 * In-memory cache for sheet rows.
 * - Prevents repeated network calls during navigation.
 * - Reset only on page reload.
 */
let _sheetCache = null;

/* ============================================================================
   Utilities
   ============================================================================ */

/**
 * Escape string for safe HTML insertion (prevents HTML injection).
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
 * Convert a game name into a filename-friendly slug that matches your repo files.
 *
 * Based on your existing /img/<year>/ naming:
 * - lowercase
 * - tokens separated by "_"
 * - "'s" becomes "_s"
 * - remove ® ™ ©
 * - "&" becomes "and"
 * - collapse underscores
 */
function slugifyGameName(name) {
  if (!name) return "";

  return String(name)
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[®™©]/g, "_")
    .replace(/'s\b/g, "_s")
    .replace(/'/g, "_")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Build icon URL from year + game name.
 * Primary format is WebP:
 *   /img/<year>/<slug>.webp
 */
function buildGameImageUrl(year, gameName) {
  const slug = slugifyGameName(gameName);
  if (!year || !slug) return "/img/placeholder.png";
  return `/img/${year}/${slug}.webp`;
}

/**
 * Normalize a path:
 * - Ensure leading "/"
 * - Remove trailing slashes
 * - Return "/" for empty
 */
function normalizePath(p) {
  if (!p) return "/";
  let x = p.startsWith("/") ? p : "/" + p;
  x = x.replace(/\/+$/, "");
  return x === "" ? "/" : x;
}

/**
 * Parse current URL pathname into route parts.
 * Example:
 *   "/steamawards/2024/" => ["steamawards", "2024"]
 */
function parsePathRoute() {
  const path = normalizePath(location.pathname);
  return path.split("/").filter(Boolean);
}

/**
 * Render loading state.
 */
function setLoading() {
  getAppEl().innerHTML = `<div class="notice">Loading…</div>`;
}

/**
 * Render error state.
 */
function setError(msg) {
  getAppEl().innerHTML = `<div class="notice">❌ ${escapeHtml(msg)}</div>`;
}

/* ============================================================================
   Fetch + transform data
   ============================================================================ */

/**
 * Fetch all rows from the Sheet API (cached).
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
 * Extract and sort all available years.
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
 * Convert flat sheet rows into the UI structure for a single year.
 *
 * IMPORTANT for your column rename:
 * - Old sheet: { Winner }
 * - New sheet: { Merit }
 * We read:
 *   meritOrWinner = r.Merit ?? r.Winner ?? ""
 */
function buildYearDataFromRows(year, rows) {
  const awards = rows
    .filter((r) => Number(r.Year) === Number(year))
    .map((r, idx) => {
      const gameName = String(r.Title || "").trim() || "Unknown Game";
      const meritName = String((r.Merit ?? r.Winner ?? "")).trim() || `Award ${idx + 1}`;

      return {
        award_id: meritName
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^\w_]/g, ""),

        award_name: meritName,

        winner: {
          game_name: gameName,
          icon_url: buildGameImageUrl(year, gameName),

          blogger_url: "",
          steam_url: ""
        },

        nominees: []
      };
    });

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
 * Fetch computed year data.
 */
async function fetchYearData(year) {
  const rows = await fetchSheetRows();
  return buildYearDataFromRows(year, rows);
}

/**
 * Render an <img> with progressive fallbacks:
 * - try .webp
 * - then .jpg
 * - then .png
 * - then placeholder
 */
function imgWithFallback(url, className = "gameCard__img") {
  const safe = escapeHtml(url || "/img/placeholder.png");
  return `
    <img class="${escapeHtml(className)}"
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

/* ============================================================================
   Navigation (History API)
   ============================================================================ */

function navigate(to) {
  const url = normalizePath(to) + "/";
  history.pushState({}, "", url);
  route();
}

function replace(to) {
  const url = normalizePath(to) + "/";
  history.replaceState({}, "", url);
}

/* ============================================================================
   Views
   ============================================================================ */

async function renderHome() {
  setLoading();
  try {
    const rows = await fetchSheetRows();
    const years = getAvailableYearsFromRows(rows);

    const yearsHtml = years
      .map((y) => {
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

    getAppEl().innerHTML = `
      <div class="hero">
        <h1 class="hero__title">AwardHub</h1>
        <p class="hero__desc">
          Steam Awards data is loaded live from Google Sheet. Click a year to view results.
        </p>

        <div class="grid grid--years">
          ${yearsHtml}
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
        <input id="searchBox" class="input" placeholder="Search by award / merit (live filter)" />
        <span class="badge">Year: ${year}</span>
        <a class="badge" href="/steamawards/">Back</a>
      </div>
    </div>
  `;
}

/**
 * Placeholder overview text.
 * Note:
 * - Internally we still store the text under winner.game_name for compatibility.
 * - If your sheet uses Merit, this is effectively the Merit value.
 */
function buildAwardOverviewText(award) {
  const awardName = String(award?.award_name || "").trim();
  const meritName = String(award?.winner?.game_name || "").trim();

  return `
${awardName ? `“${awardName}”` : "This award"} is showcased here with the highlighted game and quick links.
Merit: ${meritName || "Unknown"}.
`;
}

function renderExternalButtons(winner) {
  const postUrl = winner?.blogger_url || "";
  const steamUrl = winner?.steam_url || "";

  const postBtn = postUrl
    ? `<a class="btn btn--primary" href="${escapeHtml(postUrl)}" target="_blank" rel="noopener">Read Post</a>`
    : `<span class="btn btn--primary btn--disabled" title="blogger_url is missing">Post</span>`;

  const steamBtn = steamUrl
    ? `<a class="btn" href="${escapeHtml(steamUrl)}" target="_blank" rel="noopener">View on Steam</a>`
    : `<span class="btn btn--disabled" title="steam_url is missing">Steam</span>`;

  return `<div class="btnRow btnRow--tight">${postBtn}${steamBtn}</div>`;
}

function renderFeaturedAward(award, year) {
  const awardName = escapeHtml(award?.award_name || "Unknown Award");
  const meritName = escapeHtml(award?.winner?.game_name || "Unknown Game");
  const icon = award?.winner?.icon_url || "/img/placeholder.png";
  const overview = escapeHtml(buildAwardOverviewText(award)).replaceAll("\n", "<br/>");

  return `
    <section class="featured">
      <div class="featured__left">
        <div class="featured__awardName">${awardName}</div>

        <div class="featured__media">
          ${imgWithFallback(icon, "featured__img")}
          <div class="featured__winnerBlock">
            <div class="featured__label">Merit</div>
            <div class="featured__winnerName">${meritName}</div>
          </div>
        </div>

        ${renderExternalButtons(award?.winner)}
      </div>

      <aside class="featured__right">
        <div class="featured__rightTitle">Overview</div>
        <div class="featured__rightText">${overview}</div>

        <div class="featured__hint">
          Tip: Click a card below to switch awards. Search filters by award name / merit.
        </div>
      </aside>
    </section>
  `;
}

function renderAwardCarousel(awards, selectedIndex) {
  const items = awards
    .map((a, idx) => {
      const isActive = idx === selectedIndex;
      const awardName = escapeHtml(a.award_name || "Award");
      const meritName = escapeHtml(a?.winner?.game_name || "Unknown");
      const icon = a?.winner?.icon_url || "/img/placeholder.png";
      const key = escapeHtml(a.award_id || String(idx));

      return `
        <button class="awardChip ${isActive ? "is-active" : ""}"
                type="button"
                data-award-idx="${idx}"
                data-award-key="${key}"
                aria-label="${awardName}">
          <div class="awardChip__imgWrap">
            ${imgWithFallback(icon, "awardChip__img")}
          </div>
          <div class="awardChip__text">
            <div class="awardChip__award">${awardName}</div>
            <div class="awardChip__winner">${meritName}</div>
          </div>
        </button>
      `;
    })
    .join("");

  return `
    <section class="carousel">
      <div class="carousel__title">Awards</div>
      <div class="carousel__track" id="awardCarousel">
        ${items}
      </div>
    </section>
  `;
}

function filterAwards(allAwards, keyword) {
  const k = keyword.trim().toLowerCase();
  if (!k) return { filteredAwards: allAwards, indexMap: allAwards.map((_, i) => i) };

  const filtered = [];
  const map = [];
  allAwards.forEach((a, i) => {
    const award = String(a?.award_name || "").toLowerCase();
    const merit = String(a?.winner?.game_name || "").toLowerCase();
    if (award.includes(k) || merit.includes(k)) {
      filtered.push(a);
      map.push(i);
    }
  });

  return { filteredAwards: filtered, indexMap: map };
}

/* ============================================================================
   Carousel scroll behavior control
   ============================================================================ */

function withTempScrollBehavior(track, behavior, fn) {
  if (!track) return;
  const prev = track.style.scrollBehavior;
  track.style.scrollBehavior = behavior;
  try {
    fn();
  } finally {
    track.style.scrollBehavior = prev;
  }
}

function scrollChipIntoViewSmart(track, chip) {
  if (!track || !chip) return;

  const targetLeft = chip.offsetLeft - (track.clientWidth - chip.clientWidth) / 2;
  const clampedLeft = Math.max(0, targetLeft);

  const currentLeft = track.scrollLeft;
  const distance = Math.abs(clampedLeft - currentLeft);

  const FAR_THRESHOLD = track.clientWidth * 0.9;

  if (distance > FAR_THRESHOLD) {
    withTempScrollBehavior(track, "auto", () => {
      track.scrollTo({ left: clampedLeft, behavior: "auto" });
    });
  } else {
    withTempScrollBehavior(track, "smooth", () => {
      track.scrollTo({ left: clampedLeft, behavior: "smooth" });
    });
  }
}

/* ============================================================================
   Year page renderer
   ============================================================================ */

async function renderYearPage(year) {
  setLoading();
  try {
    const data = await fetchYearData(year);
    const allAwards = Array.isArray(data.awards) ? data.awards : [];

    if (allAwards.length === 0) {
      getAppEl().innerHTML =
        renderYearHeader(year, 0, data.source) +
        `<div class="notice">No awards found for ${escapeHtml(year)}.</div>`;
      return;
    }

    let selectedOriginalIndex = 0;
    let carouselScrollLeft = 0;
    let filteredAwards = allAwards;
    let indexMap = allAwards.map((_, i) => i);
    let lastKeyword = "";

    function render() {
      const header = renderYearHeader(year, allAwards.length, data.source);

      let selectedFilteredIndex = indexMap.indexOf(selectedOriginalIndex);
      if (selectedFilteredIndex < 0) selectedFilteredIndex = 0;

      const selectedAward = filteredAwards[selectedFilteredIndex] || filteredAwards[0];

      getAppEl().innerHTML = `
        ${header}
        <div class="yearLayout">
          ${renderFeaturedAward(selectedAward, year)}
          ${renderAwardCarousel(filteredAwards, selectedFilteredIndex)}
        </div>
      `;

      const searchBox = document.getElementById("searchBox");
      if (searchBox) {
        searchBox.value = lastKeyword;
        searchBox.addEventListener("input", () => {
          lastKeyword = String(searchBox.value || "");
          const out = filterAwards(allAwards, lastKeyword);
          filteredAwards = out.filteredAwards;
          indexMap = out.indexMap;

          if (filteredAwards.length === 0) {
            getAppEl().innerHTML = header + `<div class="notice">No matches. Try a different keyword.</div>`;
            return;
          }

          if (!indexMap.includes(selectedOriginalIndex)) {
            selectedOriginalIndex = indexMap[0];
          }

          const oldTrack = document.getElementById("awardCarousel");
          if (oldTrack) carouselScrollLeft = oldTrack.scrollLeft;

          render();

          const newBox = document.getElementById("searchBox");
          if (newBox) newBox.focus();
        });
      }

      const track = document.getElementById("awardCarousel");
      if (track) {
        requestAnimationFrame(() => {
          withTempScrollBehavior(track, "auto", () => {
            track.scrollLeft = carouselScrollLeft;
          });
        });

        track.addEventListener(
          "scroll",
          () => {
            carouselScrollLeft = track.scrollLeft;
          },
          { passive: true }
        );

        track.addEventListener("click", (e) => {
          const btn = e.target.closest(".awardChip");
          if (!btn) return;

          const filteredIdx = Number(btn.getAttribute("data-award-idx"));
          if (!Number.isFinite(filteredIdx)) return;

          const originalIdx = indexMap[filteredIdx];
          if (!Number.isFinite(originalIdx)) return;

          carouselScrollLeft = track.scrollLeft;
          selectedOriginalIndex = originalIdx;

          render();

          requestAnimationFrame(() => {
            const newTrack = document.getElementById("awardCarousel");
            if (!newTrack) return;

            withTempScrollBehavior(newTrack, "auto", () => {
              newTrack.scrollLeft = carouselScrollLeft;
            });

            const active = newTrack.querySelector(".awardChip.is-active");
            if (!active) return;

            scrollChipIntoViewSmart(newTrack, active);
            carouselScrollLeft = newTrack.scrollLeft;
          });
        });
      }
    }

    render();
  } catch (e) {
    setError(e.message || String(e));
  }
}

/* ============================================================================
   Router
   ============================================================================ */

async function route() {
  syncYearNow();

  // Must happen BEFORE parsing route parts.
  safeRewriteRootToSteamAwards();

  const parts = parsePathRoute();

  if (parts.length === 0) {
    replace("/steamawards");
    await renderHome();
    return;
  }

  if (parts[0] === "steamawards") {
    if (parts.length === 1) {
      await renderHome();
      return;
    }

    const year = Number(parts[1]);
    if (!year || !Number.isFinite(year)) {
      setError('Invalid year. Example: "/steamawards/2024/"');
      return;
    }

    await renderYearPage(year);
    return;
  }

  getAppEl().innerHTML = `
    <div class="hero">
      <h1 class="hero__title">404</h1>
      <p class="hero__desc">The page you’re looking for doesn’t exist.</p>
      <div class="toolbar">
        <a class="badge" href="/steamawards/">Back</a>
      </div>
    </div>
  `;
}

/* ============================================================================
   Link interception (internal SPA navigation)
   ============================================================================ */

document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;

  const href = a.getAttribute("href");
  if (!href) return;

  if (href.startsWith("http://") || href.startsWith("https://")) return;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return;
  if (href.startsWith("#")) return;
  if (!href.startsWith("/")) return;

  e.preventDefault();
  navigate(href);
});

window.addEventListener("popstate", route);
window.addEventListener("DOMContentLoaded", route);
