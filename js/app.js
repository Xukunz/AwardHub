/* AwardHub - minimal HTML5 SPA (hash router) */

const APP = document.getElementById("app");
const YEAR_NOW = document.getElementById("yearNow");
if (YEAR_NOW) YEAR_NOW.textContent = String(new Date().getFullYear());

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

async function fetchYearData(year) {
  const url = `data/steam_awards_${year}.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load: ${url} (HTTP ${res.status})`);
  return await res.json();
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
function renderHome() {
  const yearsHtml = AVAILABLE_YEARS
    .slice()
    .sort((a, b) => b - a)
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
        A clean, static showcase for Steam Game Awards by year.
        Each award includes a Winner and Nominees. Click a game card to open its Blogger post.
      </p>

      <div class="grid grid--years">
        ${yearsHtml}
      </div>

      <div class="notice">
        Note: If a card shows “Post not published”, it means <code>blogger_url</code> is missing in your data.
      </div>
    </div>
  `;
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

  const nominees = Array.isArray(award.nominees) ? award.nominees : [];
  const nomineesHtml = nominees.length
    ? nominees.map((g) => renderGameCard(g, false)).join("")
    : `<div class="notice">No nominees data for this award yet.</div>`;

  return `
    <section class="section" data-award-id="${escapeHtml(award.award_id || "")}">
      <div class="section__head">
        <div>
          <h2 class="section__title">${awardName}</h2>
          <div class="section__sub">Winner + Nominees</div>
        </div>
        <span class="badge">${nominees.length} nominees</span>
      </div>

      <div class="gameGrid">
        ${winnerCard}
        ${nomineesHtml}
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
    renderHome();
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
