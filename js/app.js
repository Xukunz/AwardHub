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
 * Smart horizontal scrolling for the carousel track.
 *
 * Why this exists:
 * - If you always use behavior:"smooth", clicking a far-away card makes the track
 *   animate from start to end (looks like "replaying" a long animation).
 * - The fix is: smooth only for short distances, jump (auto) for long distances.
 *
 * Design:
 * - Centers the chip inside the track viewport.
 * - Computes the scroll distance.
 * - Uses "auto" when distance is large (no long animation).
 * - Uses "smooth" when distance is small (nice micro-animation).
 */
function scrollChipIntoViewSmart(track, chip) {
  if (!track || !chip) return;

  // Target: center the chip in the viewport (horizontal only).
  const targetLeft = chip.offsetLeft - (track.clientWidth - chip.clientWidth) / 2;
  const clampedLeft = Math.max(0, targetLeft);

  const currentLeft = track.scrollLeft;
  const distance = Math.abs(clampedLeft - currentLeft);

  // "Far" means almost a full screen (track viewport width).
  // You can tune this threshold if you want more/less smooth.
  const FAR_THRESHOLD = track.clientWidth * 0.9;

  track.scrollTo({
    left: clampedLeft,
    behavior: distance > FAR_THRESHOLD ? "auto" : "smooth",
  });
}

/**
 * Convert a game name into a filename-friendly slug that matches your repo naming rules.
 *
 * Your repo naming rule (based on your actual filenames in /img/<year>/):
 * - lowercase
 * - tokens separated by underscore "_"
 * - "'s" becomes "_s" (IMPORTANT)
 *   Example: "Assassin's Creed" -> "assassin_s_creed"
 * - remove trademark symbols: ® ™ ©
 * - "&" becomes "and"
 * - collapse repeated underscores
 * - trim underscores
 */
function slugifyGameName(name) {
  if (!name) return "";

  return String(name)
    .toLowerCase()
    .trim()

    // Normalize common symbols
    .replace(/&/g, " and ")
    .replace(/[®™©]/g, "_")

    // IMPORTANT: keep a separator for "'s"
    // "assassin's" -> "assassin_s"
    .replace(/'s\b/g, "_s")

    // Any remaining apostrophes become separators as well
    // e.g. "dont" style vs "don_t" — this matches your existing filenames better.
    .replace(/'/g, "_")

    // Replace any non-alphanumeric with underscore
    .replace(/[^a-z0-9]+/g, "_")

    // Collapse multiple underscores
    .replace(/_+/g, "_")

    // Trim leading/trailing underscores
    .replace(/^_+|_+$/g, "");
}


/**
 * Build an icon URL from year + game name.
 * The primary format is WebP:
 *   /img/<year>/<slug>.webp
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
 */
function setLoading() {
  APP.innerHTML = `<div class="notice">Loading…</div>`;
}

/**
 * Render an error message in the main app container.
 */
function setError(msg) {
  APP.innerHTML = `<div class="notice">❌ ${escapeHtml(msg)}</div>`;
}

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
 * Extract and sort all available years found in the sheet.
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
 */
function buildYearDataFromRows(year, rows) {
  const awards = rows
    .filter((r) => Number(r.Year) === Number(year))
    .map((r, idx) => {
      const awardName = String(r.Title || "").trim() || `Award ${idx + 1}`;
      const winnerName = String(r.Winner || "").trim() || "Unknown Game";

      return {
        award_id: awardName
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^\w_]/g, ""),

        award_name: awardName,

        winner: {
          game_name: winnerName,
          icon_url: buildGameImageUrl(year, winnerName),

          // Reserved: external links (you'll fill these later)
          blogger_url: "",
          steam_url: ""
        },

        nominees: []
      };
    });

  // De-duplicate in case the sheet contains duplicate award entries
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
 * Fetch a single year's data (computed from full sheet rows).
 */
async function fetchYearData(year) {
  const rows = await fetchSheetRows();
  return buildYearDataFromRows(year, rows);
}

/**
 * Render an <img> tag with progressive fallbacks:
 * - Try src (.webp)
 * - Then .jpg
 * - Then .png
 * - Then placeholder
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

/** ---------------------------
 *  Navigation (History API)
 *  ---------------------------
 */

function navigate(to) {
  const url = normalizePath(to) + "/";
  history.pushState({}, "", url);
  route();
}

function replace(to) {
  const url = normalizePath(to) + "/";
  history.replaceState({}, "", url);
}

/** ---------------------------
 *  Views
 *  ---------------------------
 */

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

    APP.innerHTML = `
      <div class="hero">
        <h1 class="hero__title">AwardHub</h1>
        <p class="hero__desc">
          Steam Awards data is loaded live from Google Sheet. Click a year to view winners.
        </p>

        <div class="grid grid--years">
          ${yearsHtml}
        </div>

    `;
  } catch (e) {
    setError(e.message || String(e));
  }
}

/**
 * Render the header area for a year page.
 */
function renderYearHeader(year, awardCount, source) {
  return `
    <div class="hero">
      <h1 class="hero__title">Steam Game Awards ${year}</h1>
      <p class="hero__desc">
        Source: ${escapeHtml(source || "Steam")}. Total awards: ${awardCount}.
      </p>

      <div class="toolbar">
        <input id="searchBox" class="input" placeholder="Search by award / winner (live filter)" />
        <span class="badge">Year: ${year}</span>
        <a class="badge" href="/steamawards/">Back</a>
      </div>
    </div>
  `;
}

/**
 * Build a nicer "overview" block.
 * Note: current sheet does not provide description, so we use a structured placeholder.
 */
function buildAwardOverviewText(award) {
  const awardName = String(award?.award_name || "").trim();
  const winnerName = String(award?.winner?.game_name || "").trim();

  return `
${awardName ? `“${awardName}”` : "This award"} is showcased here with the winner and quick links.
We currently only have: Winner + icon + external URLs (Steam / Post).
Winner: ${winnerName || "Unknown"}.
`;
}

/**
 * External links buttons (reserved, can be empty and disabled).
 * You asked for 2 buttons that can link out: done.
 */
function renderExternalButtons(winner) {
  const postUrl = winner?.blogger_url || "";
  const steamUrl = winner?.steam_url || "";

  const postBtn = postUrl
    ? `<a class="btn btn--primary" href="${escapeHtml(postUrl)}" target="_blank" rel="noopener">Read Post</a>`
    : `<span class="btn btn--primary btn--disabled" title="blogger_url is missing">Post</span>`;

  const steamBtn = steamUrl
    ? `<a class="btn" href="${escapeHtml(steamUrl)}" target="_blank" rel="noopener">View on Steam</a>`
    : `<span class="btn btn--disabled" title="steam_url is missing">Buy</span>`;

  return `<div class="btnRow btnRow--tight">${postBtn}${steamBtn}</div>`;
}

/**
 * Featured (big) panel for the selected award.
 */
function renderFeaturedAward(award, year) {
  const awardName = escapeHtml(award?.award_name || "Unknown Award");
  const winnerName = escapeHtml(award?.winner?.game_name || "Unknown Game");
  const icon = award?.winner?.icon_url || "/img/placeholder.png";

  // buildAwardOverviewText() returns text with line breaks;
  // escapeHtml() makes it safe, then we convert "\n" to "<br/>" for display.
  const overview = escapeHtml(buildAwardOverviewText(award)).replaceAll("\n", "<br/>");

  return `
    <section class="featured">
      <div class="featured__left">
        <div class="featured__awardName">${awardName}</div>

        <div class="featured__media">
          ${imgWithFallback(icon, "featured__img")}
          <div class="featured__winnerBlock">
            <div class="featured__label">Winner</div>
            <div class="featured__winnerName">${winnerName}</div>
          </div>
        </div>

        ${renderExternalButtons(award?.winner)}
      </div>

      <aside class="featured__right">
        <div class="featured__rightTitle">Overview</div>
        <div class="featured__rightText">${overview}</div>

        <div class="featured__hint">
          Tip: Click a card below to switch awards. Search filters by award name / winner.
        </div>
      </aside>
    </section>
  `;
}

/**
 * Bottom horizontal carousel (award strip).
 * Clicking a chip selects the award and updates the featured panel.
 */
function renderAwardCarousel(awards, selectedIndex) {
  const items = awards
    .map((a, idx) => {
      const isActive = idx === selectedIndex;
      const awardName = escapeHtml(a.award_name || "Award");
      const winnerName = escapeHtml(a?.winner?.game_name || "Unknown");
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
            <div class="awardChip__winner">${winnerName}</div>
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

/**
 * Apply live filtering to awards (award name or winner name).
 * Returns { filteredAwards, indexMap } where indexMap maps filtered index -> original index.
 */
function filterAwards(allAwards, keyword) {
  const k = keyword.trim().toLowerCase();
  if (!k) {
    return { filteredAwards: allAwards, indexMap: allAwards.map((_, i) => i) };
  }

  const filtered = [];
  const map = [];
  allAwards.forEach((a, i) => {
    const award = String(a?.award_name || "").toLowerCase();
    const winner = String(a?.winner?.game_name || "").toLowerCase();
    if (award.includes(k) || winner.includes(k)) {
      filtered.push(a);
      map.push(i);
    }
  });
  return { filteredAwards: filtered, indexMap: map };
}

/**
 * Year page render (layout based on your mock).
 */
async function renderYearPage(year) {
  setLoading();
  try {
    const data = await fetchYearData(year);
    const allAwards = Array.isArray(data.awards) ? data.awards : [];
    if (allAwards.length === 0) {
      APP.innerHTML =
        renderYearHeader(year, 0, data.source) +
        `<div class="notice">No awards found for ${escapeHtml(year)}.</div>`;
      return;
    }

    // State (kept inside closure)
    let selectedOriginalIndex = 0;

    // Preserve horizontal scroll position across rerenders within this page view.
    let carouselScrollLeft = 0;

    // Filter state
    let indexMap = allAwards.map((_, i) => i);
    let filteredAwards = allAwards;
    let _lastSearchKeyword = "";

    function render() {
      const header = renderYearHeader(year, allAwards.length, data.source);

      // Translate selected original index -> filtered index
      let selectedFilteredIndex = indexMap.indexOf(selectedOriginalIndex);
      if (selectedFilteredIndex < 0) selectedFilteredIndex = 0;

      const selectedAward = filteredAwards[selectedFilteredIndex] || filteredAwards[0];
      const featured = renderFeaturedAward(selectedAward, year);
      const carousel = renderAwardCarousel(filteredAwards, selectedFilteredIndex);

      APP.innerHTML = `
        ${header}
        <div class="yearLayout">
          ${featured}
          ${carousel}
        </div>
      `;

      // Wire search (live filter)
      const searchBox = document.getElementById("searchBox");
      if (searchBox) {
        searchBox.value = _lastSearchKeyword;
        searchBox.addEventListener("input", (e) => {
          _lastSearchKeyword = String(e.target.value || "");
          const out = filterAwards(allAwards, _lastSearchKeyword);
          filteredAwards = out.filteredAwards;
          indexMap = out.indexMap;

          // If nothing matches, show a simple notice (keep the year header visible).
          if (filteredAwards.length === 0) {
            APP.innerHTML =
              header +
              `<div class="notice">No matches. Try a different keyword.</div>`;
            return;
          }

          // If current selection is filtered out, select the first visible item.
          if (!indexMap.includes(selectedOriginalIndex)) {
            selectedOriginalIndex = indexMap[0];
          }

          // Preserve scroll position before rerendering (important).
          const oldTrack = document.getElementById("awardCarousel");
          if (oldTrack) carouselScrollLeft = oldTrack.scrollLeft;

          render();

          // Keep focus in input after rerender
          const newBox = document.getElementById("searchBox");
          if (newBox) newBox.focus();
        });
      }

      // Wire carousel clicks + preserve scrolling
      const track = document.getElementById("awardCarousel");
      if (track) {
        // Restore previous scroll position AFTER DOM mount.
        // requestAnimationFrame helps after layout is ready.
        requestAnimationFrame(() => {
          track.scrollLeft = carouselScrollLeft;
        });

        // Keep scroll position updated when user drags the scrollbar.
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

          const idx = Number(btn.getAttribute("data-award-idx"));
          if (!Number.isFinite(idx)) return;

          // idx is filtered index -> map back to original index
          const original = indexMap[idx];
          if (!Number.isFinite(original)) return;

          // Capture current scroll position BEFORE rerender.
          carouselScrollLeft = track.scrollLeft;

          // Update selection and rerender.
          selectedOriginalIndex = original;
          render();

          // After rerender, run smart scroll to the active chip.
          // IMPORTANT:
          // - We do NOT force "smooth" for long distance (prevents replay-like animation).
          // - If the browser resets scrollLeft to 0 for a split second, distance becomes huge,
          //   and smart scroll will choose "auto" (no long animation).
          requestAnimationFrame(() => {
            const newTrack = document.getElementById("awardCarousel");
            if (!newTrack) return;

            // Best effort restore first (no animation).
            newTrack.scrollLeft = carouselScrollLeft;

            const active = newTrack.querySelector(".awardChip.is-active");
            if (!active) return;

            scrollChipIntoViewSmart(newTrack, active);

            // Update cache after scroll (in case we jumped).
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

/** ---------------------------
 *  Router
 *  ---------------------------
 */

async function route() {
  const parts = parsePathRoute();

  if (parts.length === 0) {
    replace("/steamawards");
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
 */

document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;

  const href = a.getAttribute("href");
  if (!href) return;

  // External / special links should behave normally.
  if (href.startsWith("http://") || href.startsWith("https://")) return;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return;
  if (href.startsWith("#")) return;

  // Only intercept absolute internal paths.
  if (!href.startsWith("/")) return;

  e.preventDefault();
  navigate(href);
});

window.addEventListener("popstate", route);
window.addEventListener("DOMContentLoaded", route);
