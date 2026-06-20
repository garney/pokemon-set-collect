const STORAGE_KEY = "setdex.collections.v1";

const VARIANTS = [
  { id: "normal", label: "Normal", short: "N" },
  { id: "reverse", label: "Reverse", short: "R" },
  { id: "pokeball", label: "Pokeball", short: "P" },
  { id: "masterball", label: "Masterball", short: "M" },
];

const COLLECTION_TYPES = ["set", "custom", "artist"];

const sampleCollections = [
  {
    id: crypto.randomUUID(),
    type: "set",
    name: "Scarlet & Violet Base Set",
    code: "sv1",
    releaseDate: "2023-03-31",
    imageUrl:
      "https://images.pokemontcg.io/sv1/logo.png",
    goal: "Master set",
    cards: [
      makeCard("001", "Sprigatito", "Grass", "Common", "https://images.pokemontcg.io/sv1/1.png", ["normal", "reverse"]),
      makeCard("002", "Floragato", "Grass", "Uncommon", "https://images.pokemontcg.io/sv1/2.png", ["normal", "reverse"]),
      makeCard("003", "Meowscarada", "Grass", "Rare", "https://images.pokemontcg.io/sv1/3.png", ["normal", "reverse"]),
      makeCard("004", "Fuecoco", "Fire", "Common", "https://images.pokemontcg.io/sv1/4.png", ["normal", "reverse"]),
      makeCard("005", "Crocalor", "Fire", "Uncommon", "https://images.pokemontcg.io/sv1/5.png", ["normal", "reverse"]),
      makeCard("006", "Skeledirge", "Fire", "Rare", "https://images.pokemontcg.io/sv1/6.png", ["normal", "reverse"]),
      makeCard("007", "Quaxly", "Water", "Common", "https://images.pokemontcg.io/sv1/7.png", ["normal", "reverse"]),
      makeCard("008", "Quaxwell", "Water", "Uncommon", "https://images.pokemontcg.io/sv1/8.png", ["normal", "reverse"]),
    ],
  },
  {
    id: crypto.randomUUID(),
    type: "custom",
    name: "Favorite Charizard Cards",
    code: "custom-charizard",
    releaseDate: "",
    imageUrl:
      "https://images.pokemontcg.io/swsh9/18.png",
    goal: "Personal chase list",
    cards: [
      makeCard("018", "Charizard", "Fire", "Rare Holo", "https://images.pokemontcg.io/swsh9/18.png", ["normal"]),
      makeCard("020", "Charizard V", "Fire", "Ultra Rare", "https://images.pokemontcg.io/swsh9/154.png", ["normal"]),
      makeCard("174", "Charizard ex", "Fire", "Special Illustration Rare", "https://images.pokemontcg.io/sv3pt5/199.png", ["normal"]),
    ],
  },
];

function makeCard(number, name, supertype, rarity, imageUrl, variants = ["normal"], artist = "") {
  const owned = {};
  variants.forEach((variant, index) => {
    owned[variant] = index === 0 && Number.parseInt(number, 10) % 3 !== 2;
  });
  return {
    id: crypto.randomUUID(),
    number,
    name,
    supertype,
    rarity,
    artist,
    imageUrl,
    variants,
    owned,
    notes: "",
  };
}

const state = {
  route: "home",
  activeCollectionId: null,
  activeFilter: "all",
  activeVariant: "all",
  search: "",
  collections: [],
  isLoading: true,
};

async function loadCollections() {
  try {
    const response = await fetch("/api/collections");
    if (!response.ok) throw new Error("Could not load collections");
    const payload = await response.json();
    state.collections = normalizeCollections(payload.collections || payload);
  } catch {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.collections = raw ? normalizeCollections(JSON.parse(raw)) : sampleCollections;
  } finally {
    state.isLoading = false;
    render();
  }
}

function saveCollections() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.collections, null, 2));
  fetch("/api/collections", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ collections: state.collections }),
  }).catch(() => {
    toast("Saved in browser only. Node server was not reachable.");
  });
}

function normalizeCollections(collections) {
  return (Array.isArray(collections) ? collections : []).map((collection) => ({
    id: collection.id || crypto.randomUUID(),
    type: COLLECTION_TYPES.includes(collection.type) ? collection.type : "custom",
    name: collection.name || "Untitled collection",
    code: collection.code || "",
    releaseDate: collection.releaseDate || "",
    imageUrl: collection.imageUrl || "",
    goal: collection.goal || "",
    cards: normalizeCards(collection.cards || []),
  }));
}

function normalizeCards(cards) {
  return cards.map((card) => {
    const variants = Array.isArray(card.variants) && card.variants.length ? card.variants : ["normal"];
    const owned = {};
    variants.forEach((variant) => {
      owned[variant] = Boolean(card.owned?.[variant]);
    });
    return {
      id: card.id || crypto.randomUUID(),
      number: String(card.number || ""),
      name: card.name || "Unnamed card",
      supertype: card.supertype || card.type || "",
      rarity: card.rarity || "",
      artist: card.artist || card.illustrator || "",
      imageUrl: card.imageUrl || card.images?.large || card.images?.small || "",
      variants,
      owned,
      market: normalizeMarket(card.market),
      notes: card.notes || "",
    };
  });
}

function normalizeMarket(market = {}) {
  return {
    ebayAu: market.ebayAu || null,
  };
}

function collectionStats(collection) {
  const total = collection.cards.reduce((sum, card) => sum + card.variants.length, 0);
  const owned = collection.cards.reduce(
    (sum, card) => sum + card.variants.filter((variant) => card.owned[variant]).length,
    0,
  );
  return {
    total,
    owned,
    needed: Math.max(total - owned, 0),
    percent: total ? Math.round((owned / total) * 100) : 0,
  };
}

function render() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    ${renderTopbar()}
    ${renderTabs()}
    <main class="content">${renderRoute()}</main>
    ${renderBottomNav()}
  `;
  bindEvents();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <button class="brand plain-reset" data-route="home" aria-label="Go home">
        <span class="brand-mark">S</span>
        <span>
          <h1>SetDex</h1>
          <p>Local Pokemon collection tracker</p>
        </span>
      </button>
      <div class="top-actions">
        <button class="icon-button" type="button" data-open-import title="Import JSON">In</button>
        <button class="icon-button" type="button" data-export title="Export JSON">Out</button>
      </div>
    </header>
  `;
}

function renderTabs() {
  const tabs = [
    ["home", "Home"],
    ["sets", "Sets"],
    ["custom", "Custom"],
  ];
  return `
    <nav class="tabs" aria-label="Primary">
      ${tabs.map(([id, label]) => `<button class="tab ${state.route === id ? "is-active" : ""}" data-route="${id}">${label}</button>`).join("")}
    </nav>
  `;
}

function renderBottomNav() {
  const items = [
    ["home", "Home", "H"],
    ["sets", "Sets", "S"],
    ["add", "Add", "+"],
    ["custom", "Custom", "C"],
  ];
  return `
    <nav class="bottom-nav" aria-label="Mobile">
      ${items
        .map(([id, label, icon]) => `<button class="nav-item ${state.route === id ? "is-active" : ""}" data-${id === "add" ? "open-add" : "route"}="${id}"><span>${icon}</span><span>${label}</span></button>`)
        .join("")}
    </nav>
  `;
}

function renderRoute() {
  if (state.isLoading) return renderLoading();
  if (state.route === "detail") return renderCollectionDetail();
  if (state.route === "sets") return renderCollectionIndex("set");
  if (state.route === "custom") return renderCollectionIndex("custom");
  return renderHome();
}

function renderLoading() {
  return `
    <section class="empty-state">
      <h3>Loading collection file</h3>
      <p class="muted">Reading data/collections.json from the local Node server.</p>
    </section>
  `;
}

function renderHome() {
  const allStats = aggregateStats(state.collections);
  const setStats = aggregateStats(state.collections.filter((item) => item.type === "set"));
  const artistStats = aggregateStats(state.collections.filter((item) => item.type === "artist"));
  return `
    <section class="screen-head">
      <div class="screen-title">
        <h1>Collection Overview</h1>
        <p>${state.collections.length} collections tracked on this device</p>
      </div>
      <button class="primary-button" type="button" data-open-add>+ Add</button>
    </section>
    <section class="overview-grid">
      ${renderMetric("All", allStats, "var(--teal)")}
      ${renderMetric("Sets", setStats, "var(--red)")}
      ${renderMetric("Artists", artistStats, "var(--blue)")}
      <article class="metric">
        <div class="metric__value">${allStats.needed}</div>
        <div class="metric__label">Variants needed</div>
      </article>
    </section>
    <section class="section">
      <div class="section-header">
        <h2>Recent Collections</h2>
        <button class="plain-button" data-route="sets">View sets</button>
      </div>
      <div class="collection-list">
        ${state.collections.slice(0, 6).map(renderCollectionRow).join("") || renderEmpty("No collections yet", "Create a set or custom list to start tracking.")}
      </div>
    </section>
    <section class="section">
      <div class="section-header">
        <h2>Card Collection Preview</h2>
        <button class="plain-button" data-route="custom">Custom</button>
      </div>
      <div class="collection-list">
        ${state.collections.flatMap((collection) => collection.cards.map((card) => ({ collection, card }))).slice(0, 5).map(renderPreviewCard).join("")}
      </div>
    </section>
  `;
}

function aggregateStats(collections) {
  return collections.reduce(
    (acc, collection) => {
      const stats = collectionStats(collection);
      acc.total += stats.total;
      acc.owned += stats.owned;
      acc.needed += stats.needed;
      acc.percent = acc.total ? Math.round((acc.owned / acc.total) * 100) : 0;
      return acc;
    },
    { total: 0, owned: 0, needed: 0, percent: 0 },
  );
}

function renderMetric(label, stats, color) {
  return `
    <article class="metric">
      <div class="progress-ring" style="--p:${stats.percent};--c:${color}"><span>${stats.percent}%</span></div>
      <div class="metric__label">${label}</div>
      <div class="metric__value">${stats.owned}</div>
      <div class="metric__label">${stats.total} total</div>
    </article>
  `;
}

function renderCollectionIndex(type) {
  const collections = state.collections.filter((item) => (type === "custom" ? item.type !== "set" : item.type === type));
  const title = type === "set" ? "Sets" : "Custom Collections";
  return `
    <section class="screen-head">
      <div class="screen-title">
        <h1>${title}</h1>
        <p>${type === "set" ? "Master official sets and variants." : "Build chase lists, artist runs, and personal goals."}</p>
      </div>
      <button class="primary-button" type="button" data-open-add="${type}">+ Add</button>
    </section>
    <div class="toolbar">
      <button class="secondary-button" data-open-api>Find Pokemon TCG set</button>
      <button class="secondary-button" data-open-artist-api>Find artist/illus</button>
      <button class="secondary-button" data-open-import>Import JSON</button>
      <button class="secondary-button" data-export>Export</button>
    </div>
    <section class="section collection-list">
      ${collections.map(renderCollectionRow).join("") || renderEmpty(`No ${title.toLowerCase()} yet`, "Use Add to create one locally.")}
    </section>
  `;
}

function renderCollectionRow(collection) {
  const stats = collectionStats(collection);
  return `
    <button class="collection-row" data-open-collection="${collection.id}">
      <img class="thumb" src="${safeAttr(collection.imageUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span>
        <h3>${escapeHtml(collection.name)}</h3>
        <p class="muted">${escapeHtml(collectionTypeLabel(collection.type))}</p>
        <p class="muted">${stats.owned} / ${stats.total} variants acquired</p>
        <span class="progress-line"><span style="width:${stats.percent}%"></span></span>
      </span>
      <span class="chevron">${stats.percent}%</span>
    </button>
  `;
}

function renderPreviewCard({ collection, card }) {
  const ownedCount = card.variants.filter((variant) => card.owned[variant]).length;
  return `
    <button class="collection-row" data-open-card="${collection.id}:${card.id}">
      <img class="thumb" src="${safeAttr(card.imageUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span>
        <h3>${escapeHtml(card.name)}</h3>
        <p class="muted">${escapeHtml(collection.name)}</p>
        <p class="muted">${escapeHtml(card.number)} / ${escapeHtml(card.rarity || "Unknown rarity")}</p>
      </span>
      <span class="chevron">${ownedCount}/${card.variants.length}</span>
    </button>
  `;
}

function renderCollectionDetail() {
  const collection = getActiveCollection();
  if (!collection) {
    state.route = "home";
    return renderHome();
  }
  const stats = collectionStats(collection);
  const filteredCards = collection.cards.filter((card) => {
    const matchesText = `${card.name} ${card.number} ${card.rarity} ${card.artist}`.toLowerCase().includes(state.search.toLowerCase());
    const owned = card.variants.some((variant) => card.owned[variant]);
    const needs = card.variants.some((variant) => !card.owned[variant]);
    const matchesFilter = state.activeFilter === "all" || (state.activeFilter === "owned" && owned) || (state.activeFilter === "needed" && needs);
    const matchesVariant = state.activeVariant === "all" || card.variants.includes(state.activeVariant);
    return matchesText && matchesFilter && matchesVariant;
  });

  return `
    <section class="layout-two">
      <aside>
        <div class="screen-head">
          <button class="icon-button" data-route="${collection.type === "set" ? "sets" : "custom"}" aria-label="Back">Back</button>
          <button class="plain-button" data-edit-collection="${collection.id}">Edit</button>
        </div>
        <div class="detail-panel">
          <div class="set-hero">
            <img class="thumb" src="${safeAttr(collection.imageUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            <div>
              <h1>${escapeHtml(collection.name)}</h1>
              <p class="muted">${escapeHtml(collection.goal || "Collection goal")}</p>
              <p class="muted">${collection.releaseDate ? `Released ${escapeHtml(collection.releaseDate)}` : collectionTypeLabel(collection.type)}</p>
            </div>
          </div>
          <div class="progress-line"><span style="width:${stats.percent}%"></span></div>
          <p class="muted">${stats.percent}% complete - ${stats.owned} / ${stats.total} variants acquired</p>
          <div class="button-row">
            <button class="secondary-button" data-open-card-form="${collection.id}">Add card</button>
            <button class="secondary-button" data-open-import-cards="${collection.id}">Import cards</button>
          </div>
        </div>
      </aside>
      <section>
        <div class="filters">
          ${["all", "owned", "needed"].map((filter) => `<button class="chip ${state.activeFilter === filter ? "is-active" : ""}" data-filter="${filter}">${titleCase(filter)}</button>`).join("")}
        </div>
        <div class="filters">
          ${["all", ...VARIANTS.map((item) => item.id)].map((variant) => `<button class="chip ${state.activeVariant === variant ? "is-active" : ""}" data-variant="${variant}">${variant === "all" ? "All variants" : variantLabel(variant)}</button>`).join("")}
        </div>
        <div class="field-grid" style="margin-bottom:12px">
          <label>Search cards
            <input type="search" data-search value="${safeAttr(state.search)}" placeholder="Name, number, rarity, artist" />
          </label>
        </div>
        <div class="grid">
          ${filteredCards.map((card) => renderCardTile(collection, card)).join("") || renderEmpty("No cards match", "Try another filter or add cards to this collection.")}
        </div>
      </section>
    </section>
  `;
}

function renderCardTile(collection, card) {
  return `
    <article class="card-item">
      <button class="plain-reset" data-open-card="${collection.id}:${card.id}" style="width:100%;text-align:left">
        <img class="card-art" src="${safeAttr(card.imageUrl)}" alt="${safeAttr(card.name)}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="card-meta">
          <div class="card-number">#${escapeHtml(card.number || "-")}</div>
          <h3>${escapeHtml(card.name)}</h3>
          <p class="muted">${escapeHtml(card.artist || card.rarity || "Unknown rarity")}</p>
          ${card.market?.ebayAu?.lastPrice ? `<p class="price-badge">${formatAud(card.market.ebayAu.lastPrice)} last sold</p>` : ""}
        </div>
      </button>
      <div class="variant-row" aria-label="Variants">
        ${card.variants.map((variant) => `<button class="variant-pill ${card.owned[variant] ? "is-owned" : ""}" data-toggle-variant="${collection.id}:${card.id}:${variant}" title="${variantLabel(variant)}">${variantShort(variant)}</button>`).join("")}
      </div>
    </article>
  `;
}

function renderEmpty(title, body) {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(body)}</p></div>`;
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = button.dataset.route;
      if (route === "add") return openAddModal();
      state.route = route;
      state.search = "";
      render();
    });
  });

  document.querySelectorAll("[data-open-add]").forEach((button) => {
    button.addEventListener("click", () => openAddModal(button.dataset.openAdd || ""));
  });

  document.querySelectorAll("[data-open-collection]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCollectionId = button.dataset.openCollection;
      state.route = "detail";
      state.activeFilter = "all";
      state.activeVariant = "all";
      render();
    });
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeFilter = button.dataset.filter;
      render();
    });
  });

  document.querySelectorAll("[data-variant]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeVariant = button.dataset.variant;
      render();
    });
  });

  document.querySelectorAll("[data-search]").forEach((input) => {
    input.addEventListener("input", () => {
      state.search = input.value;
      render();
    });
  });

  document.querySelectorAll("[data-toggle-variant]").forEach((button) => {
    button.addEventListener("click", () => {
      const [collectionId, cardId, variant] = button.dataset.toggleVariant.split(":");
      const card = findCard(collectionId, cardId);
      if (!card) return;
      card.owned[variant] = !card.owned[variant];
      saveCollections();
      render();
    });
  });

  document.querySelectorAll("[data-open-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const [collectionId, cardId] = button.dataset.openCard.split(":");
      openCardDetail(collectionId, cardId);
    });
  });

  document.querySelectorAll("[data-open-card-form]").forEach((button) => {
    button.addEventListener("click", () => openCardForm(button.dataset.openCardForm));
  });

  document.querySelectorAll("[data-open-import-cards]").forEach((button) => {
    button.addEventListener("click", () => openImportCards(button.dataset.openImportCards));
  });

  document.querySelectorAll("[data-edit-collection]").forEach((button) => {
    button.addEventListener("click", () => openAddModal("", button.dataset.editCollection));
  });

  document.querySelectorAll("[data-open-import]").forEach((button) => {
    button.addEventListener("click", openImportCollections);
  });

  document.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", exportCollections);
  });

  document.querySelectorAll("[data-open-api]").forEach((button) => {
    button.addEventListener("click", openApiModal);
  });

  document.querySelectorAll("[data-open-artist-api]").forEach((button) => {
    button.addEventListener("click", openArtistApiModal);
  });
}

function openAddModal(preferredType = "", editId = "") {
  const existing = state.collections.find((item) => item.id === editId);
  const body = `
    <form data-collection-form>
      <div class="field-grid">
        <label>Type
          <select name="type">
            <option value="set" ${(existing?.type || preferredType) === "set" ? "selected" : ""}>Pokemon set</option>
            <option value="custom" ${(existing?.type || preferredType) === "custom" ? "selected" : ""}>Custom collection</option>
            <option value="artist" ${(existing?.type || preferredType) === "artist" ? "selected" : ""}>Artist / illustrator</option>
          </select>
        </label>
        <label>Name
          <input name="name" required value="${safeAttr(existing?.name || "")}" placeholder="Scarlet & Violet master set" />
        </label>
        <label>Code
          <input name="code" value="${safeAttr(existing?.code || "")}" placeholder="sv1 or my-chase-list" />
        </label>
        <label>Release date
          <input name="releaseDate" type="date" value="${safeAttr(existing?.releaseDate || "")}" />
        </label>
        <label>Cover image URL
          <input name="imageUrl" value="${safeAttr(existing?.imageUrl || "")}" placeholder="https://..." />
        </label>
        <label>Goal
          <input name="goal" value="${safeAttr(existing?.goal || "")}" placeholder="Master set, illustrator run, favorites..." />
        </label>
      </div>
      <div class="button-row">
        <button class="primary-button" type="submit">${existing ? "Save collection" : "Create collection"}</button>
        ${existing ? `<button class="danger-button" type="button" data-delete-collection="${existing.id}">Delete</button>` : ""}
      </div>
    </form>
  `;
  const modal = showModal(existing ? "Edit collection" : "Add collection", "Tracker", body);
  modal.querySelector("[data-collection-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (existing) {
      Object.assign(existing, Object.fromEntries(form.entries()));
    } else {
      const collection = {
        id: crypto.randomUUID(),
        type: form.get("type"),
        name: form.get("name"),
        code: form.get("code"),
        releaseDate: form.get("releaseDate"),
        imageUrl: form.get("imageUrl"),
        goal: form.get("goal"),
        cards: [],
      };
      state.collections.unshift(collection);
      state.activeCollectionId = collection.id;
      state.route = "detail";
    }
    saveCollections();
    closeModal();
    render();
  });
  modal.querySelector("[data-delete-collection]")?.addEventListener("click", (event) => {
    state.collections = state.collections.filter((item) => item.id !== event.currentTarget.dataset.deleteCollection);
    state.route = "home";
    saveCollections();
    closeModal();
    render();
  });
}

function openCardForm(collectionId, editCardId = "") {
  const collection = state.collections.find((item) => item.id === collectionId);
  const existing = collection?.cards.find((card) => card.id === editCardId);
  if (!collection) return;
  const checkedVariants = new Set(existing?.variants || ["normal"]);
  const body = `
    <form data-card-form>
      <div class="field-grid">
        <label>Name
          <input name="name" required value="${safeAttr(existing?.name || "")}" placeholder="Pikachu" />
        </label>
        <label>Number
          <input name="number" value="${safeAttr(existing?.number || "")}" placeholder="025" />
        </label>
        <label>Type
          <input name="supertype" value="${safeAttr(existing?.supertype || "")}" placeholder="Lightning" />
        </label>
        <label>Rarity
          <input name="rarity" value="${safeAttr(existing?.rarity || "")}" placeholder="Rare Holo" />
        </label>
        <label>Artist / illustrator
          <input name="artist" value="${safeAttr(existing?.artist || "")}" placeholder="Mitsuhiro Arita" />
        </label>
        <label>Card image URL
          <input name="imageUrl" value="${safeAttr(existing?.imageUrl || "")}" placeholder="https://..." />
        </label>
        <label>Manual eBay AU last sold price
          <input name="lastSoldPrice" inputmode="decimal" value="${safeAttr(existing?.market?.ebayAu?.lastPrice || "")}" placeholder="42.50" />
        </label>
        <label>Last sold source URL
          <input name="lastSoldUrl" value="${safeAttr(existing?.market?.ebayAu?.sourceUrl || "")}" placeholder="https://www.ebay.com.au/..." />
        </label>
        <label>Notes
          <textarea name="notes">${escapeHtml(existing?.notes || "")}</textarea>
        </label>
      </div>
      <h3>Variants to collect</h3>
      <div class="filters">
        ${VARIANTS.map((variant) => `<label class="chip"><input type="checkbox" name="variants" value="${variant.id}" ${checkedVariants.has(variant.id) ? "checked" : ""}> ${variant.label}</label>`).join("")}
      </div>
      <div class="button-row">
        <button class="primary-button" type="submit">${existing ? "Save card" : "Add card"}</button>
        ${existing ? `<button class="danger-button" type="button" data-delete-card="${existing.id}">Delete</button>` : ""}
      </div>
    </form>
  `;
  const modal = showModal(existing ? "Edit card" : "Add card", collection.name, body);
  modal.querySelector("[data-card-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const variants = form.getAll("variants");
    const cardData = {
      name: form.get("name"),
      number: form.get("number"),
      supertype: form.get("supertype"),
      rarity: form.get("rarity"),
      artist: form.get("artist"),
      imageUrl: form.get("imageUrl"),
      notes: form.get("notes"),
      variants: variants.length ? variants : ["normal"],
    };
    const lastSoldPrice = parseOptionalMoney(form.get("lastSoldPrice"));
    cardData.market = {
      ebayAu: lastSoldPrice
        ? {
            query: ebaySearchQuery(collection, cardData),
            sourceUrl: form.get("lastSoldUrl"),
            fetchedAt: new Date().toISOString(),
            currency: "AUD",
            lastPrice: lastSoldPrice,
            averagePrice: null,
            sales: [],
          }
        : existing?.market || { ebayAu: null },
    };
    if (existing) {
      Object.assign(existing, cardData);
      existing.owned = existing.owned || {};
      existing.variants.forEach((variant) => {
        existing.owned[variant] = Boolean(existing.owned[variant]);
      });
    } else {
      const owned = {};
      cardData.variants.forEach((variant) => {
        owned[variant] = false;
      });
      collection.cards.push({ id: crypto.randomUUID(), ...cardData, owned });
    }
    saveCollections();
    closeModal();
    render();
  });
  modal.querySelector("[data-delete-card]")?.addEventListener("click", (event) => {
    collection.cards = collection.cards.filter((card) => card.id !== event.currentTarget.dataset.deleteCard);
    saveCollections();
    closeModal();
    render();
  });
}

function openCardDetail(collectionId, cardId) {
  const collection = state.collections.find((item) => item.id === collectionId);
  const card = findCard(collectionId, cardId);
  if (!collection || !card) return;
  const ebayUrl = card.market?.ebayAu?.sourceUrl || ebaySoldSearchUrl(ebaySearchQuery(collection, card));
  const body = `
    <div class="modal-body-pad">
      <div class="card-detail">
        <img class="detail-art" src="${safeAttr(card.imageUrl)}" alt="${safeAttr(card.name)}" onerror="this.style.display='none'">
        <dl class="detail-table">
          <div><dt>Collection</dt><dd>${escapeHtml(collection.name)}</dd></div>
          <div><dt>Number</dt><dd>${escapeHtml(card.number || "-")}</dd></div>
          <div><dt>Type</dt><dd>${escapeHtml(card.supertype || "-")}</dd></div>
          <div><dt>Rarity</dt><dd>${escapeHtml(card.rarity || "-")}</dd></div>
          <div><dt>Artist</dt><dd>${escapeHtml(card.artist || "-")}</dd></div>
          <div><dt>eBay AU last sold</dt><dd>${card.market?.ebayAu?.lastPrice ? formatAud(card.market.ebayAu.lastPrice) : "-"}</dd></div>
          <div><dt>eBay AU average</dt><dd>${card.market?.ebayAu?.averagePrice ? formatAud(card.market.ebayAu.averagePrice) : "-"}</dd></div>
          <div><dt>Variants</dt><dd>${card.variants.map((variant) => `${variantLabel(variant)} ${card.owned[variant] ? "owned" : "needed"}`).join(", ")}</dd></div>
          <div><dt>Notes</dt><dd>${escapeHtml(card.notes || "-")}</dd></div>
        </dl>
        ${renderEbaySales(card)}
        <div class="button-row">
          ${card.variants.map((variant) => `<button class="variant-pill ${card.owned[variant] ? "is-owned" : ""}" data-toggle-variant="${collection.id}:${card.id}:${variant}">${variantLabel(variant)}</button>`).join("")}
          <button class="secondary-button" data-refresh-ebay="${collection.id}:${card.id}">Refresh eBay AU</button>
          <a class="secondary-button button-link" href="${safeAttr(ebayUrl)}" target="_blank" rel="noreferrer">Open eBay sold</a>
          <button class="secondary-button" data-edit-card="${collection.id}:${card.id}">Edit</button>
        </div>
      </div>
    </div>
  `;
  const modal = showModal(card.name, "Card info", body);
  modal.querySelectorAll("[data-toggle-variant]").forEach((button) => {
    button.addEventListener("click", () => {
      const [, , variant] = button.dataset.toggleVariant.split(":");
      card.owned[variant] = !card.owned[variant];
      saveCollections();
      closeModal();
      render();
      openCardDetail(collectionId, cardId);
    });
  });
  modal.querySelector("[data-edit-card]").addEventListener("click", () => {
    closeModal();
    openCardForm(collectionId, cardId);
  });
  modal.querySelector("[data-refresh-ebay]")?.addEventListener("click", async () => {
    await refreshEbayPrice(collectionId, cardId);
  });
}

function renderEbaySales(card) {
  const ebay = card.market?.ebayAu;
  if (!ebay?.sales?.length) {
    return `
      <section class="sales-panel">
        <h3>eBay AU sold prices</h3>
        <p class="muted">No sold-price snapshot yet. Use Refresh eBay AU to fetch recent completed listings.</p>
      </section>
    `;
  }
  return `
    <section class="sales-panel">
      <h3>eBay AU sold prices</h3>
      <p class="muted">Fetched ${formatDateTime(ebay.fetchedAt)} from sold/completed listings.</p>
      <div class="sales-list">
        ${ebay.sales
          .map(
            (sale) => `
              <a class="sale-row" href="${safeAttr(sale.url || ebay.sourceUrl)}" target="_blank" rel="noreferrer">
                <span>
                  <strong>${escapeHtml(sale.title || "Sold listing")}</strong>
                  <small>${escapeHtml(sale.soldDate || "Recent sold listing")}</small>
                </span>
                <b>${formatAud(sale.price)}</b>
              </a>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

async function refreshEbayPrice(collectionId, cardId) {
  const collection = state.collections.find((item) => item.id === collectionId);
  const card = findCard(collectionId, cardId);
  if (!collection || !card) return;
  const query = ebaySearchQuery(collection, card);
  toast("Fetching eBay AU sold prices...");
  try {
    const response = await fetch(`/api/ebay/sold-prices?query=${encodeURIComponent(query)}`);
    const ebayAu = await response.json();
    if (!response.ok) {
      throw new Error(ebayAu.sourceUrl || "Could not fetch eBay prices");
    }
    card.market = {
      ...(card.market || {}),
      ebayAu,
    };
    saveCollections();
    closeModal();
    render();
    openCardDetail(collectionId, cardId);
    toast(ebayAu.lastPrice ? `Last sold ${formatAud(ebayAu.lastPrice)}` : "No sold prices found");
  } catch {
    toast("Could not fetch eBay AU prices. You can add a manual price in Edit.");
  }
}

function ebaySearchQuery(collection, card) {
  const pieces = [
    "pokemon card",
    card.name,
    card.number,
    collection.type === "set" ? collection.name : "",
    card.rarity?.includes("Reverse") ? "reverse" : "",
  ];
  return pieces.filter(Boolean).join(" ");
}

function ebaySoldSearchUrl(query) {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: "1",
    LH_Complete: "1",
    _sop: "13",
  });
  return `https://www.ebay.com.au/sch/i.html?${params.toString()}`;
}

function openImportCards(collectionId) {
  const collection = state.collections.find((item) => item.id === collectionId);
  if (!collection) return;
  const body = `
    <form data-import-cards-form>
      <div class="field-grid">
        <label>Cards JSON
          <textarea name="json" placeholder='[{"name":"Pikachu","number":"025","artist":"Mitsuhiro Arita","imageUrl":"https://...","variants":["normal","reverse"]}]'></textarea>
        </label>
      </div>
      <p class="muted">Accepts an array of cards, a Pokemon TCG API card array, or an object with a cards property.</p>
      <div class="button-row">
        <button class="primary-button" type="submit">Import cards</button>
      </div>
    </form>
  `;
  const modal = showModal("Import cards", collection.name, body);
  modal.querySelector("[data-import-cards-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const parsed = JSON.parse(new FormData(event.currentTarget).get("json"));
      const cards = Array.isArray(parsed) ? parsed : parsed.cards || parsed.data || [];
      collection.cards.push(...normalizeCards(cards.map(cardFromPossibleApi)));
      saveCollections();
      closeModal();
      render();
      toast(`Imported ${cards.length} cards`);
    } catch {
      toast("That JSON could not be imported");
    }
  });
}

function openImportCollections() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.className = "hidden-input";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state.collections = normalizeCollections(parsed.collections || parsed);
        saveCollections();
        render();
        toast("Imported collections");
      } catch {
        toast("That file could not be imported");
      }
    });
    reader.readAsText(file);
  });
  document.body.append(input);
  input.click();
  input.remove();
}

function exportCollections() {
  const blob = new Blob([JSON.stringify({ collections: state.collections }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `setdex-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function openApiModal() {
  const body = `
    <form data-api-form>
      <div class="field-grid">
        <label>Pokemon TCG set name or id
          <input name="setQuery" required placeholder="151, Paldea Evolved, sv1" />
        </label>
      </div>
      <p class="muted">Search by set name or code. If there are multiple matches, choose the one you want.</p>
      <div class="button-row">
        <button class="primary-button" type="submit">Search sets</button>
      </div>
    </form>
  `;
  const modal = showModal("Find a set", "Pokemon TCG API", body);
  modal.querySelector("[data-api-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("setQuery").trim();
    if (!query) return;
    toast("Searching sets...");
    try {
      const matches = await findSetMatches(query);
      if (!matches.length) {
        toast("No sets found for that search");
        return;
      }
      if (matches.length === 1) {
        await importPokemonSet(matches[0].id, matches[0]);
        return;
      }
      showSetSearchResults(modal, matches);
    } catch {
      toast("Could not search sets. Check the name or import JSON instead.");
    }
  });
}

async function findSetMatches(query) {
  const normalized = query.toLowerCase();
  const directSet = await fetchPokemonSetById(query);
  const response = await fetch("https://api.pokemontcg.io/v2/sets?pageSize=250");
  if (!response.ok) throw new Error("Set search failed");
  const setsJson = await response.json();
  const matches = (setsJson.data || []).filter((set) => {
    const haystack = `${set.id} ${set.name} ${set.series}`.toLowerCase();
    return haystack.includes(normalized);
  });
  if (directSet && !matches.some((set) => set.id === directSet.id)) {
    matches.unshift(directSet);
  }
  return matches
    .sort((a, b) => setMatchRank(a, normalized) - setMatchRank(b, normalized) || (b.releaseDate || "").localeCompare(a.releaseDate || ""))
    .slice(0, 12);
}

async function fetchPokemonSetById(setId) {
  try {
    const response = await fetch(`https://api.pokemontcg.io/v2/sets/${encodeURIComponent(setId)}`);
    if (!response.ok) return null;
    return (await response.json()).data;
  } catch {
    return null;
  }
}

function setMatchRank(set, query) {
  const id = set.id.toLowerCase();
  const name = set.name.toLowerCase();
  if (id === query || name === query) return 0;
  if (name.startsWith(query) || id.startsWith(query)) return 1;
  return 2;
}

function showSetSearchResults(modal, matches) {
  modal.querySelector("[data-modal-title]").textContent = "Choose a set";
  modal.querySelector("[data-modal-body]").innerHTML = `
    <div class="modal-body-pad">
      <div class="collection-list">
        ${matches
          .map(
            (set) => `
              <button class="collection-row" data-import-set-id="${safeAttr(set.id)}">
                <img class="thumb" src="${safeAttr(set.images?.logo || set.images?.symbol || "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
                <span>
                  <h3>${escapeHtml(set.name)}</h3>
                  <p class="muted">${escapeHtml(set.series || "Pokemon TCG")} ${set.releaseDate ? `- ${escapeHtml(set.releaseDate)}` : ""}</p>
                  <p class="muted">${escapeHtml(set.id)} ${set.total ? `- ${set.total} cards` : ""}</p>
                </span>
                <span class="chevron">Import</span>
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
  modal.querySelectorAll("[data-import-set-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const set = matches.find((item) => item.id === button.dataset.importSetId);
      try {
        await importPokemonSet(button.dataset.importSetId, set);
      } catch {
        toast("Could not import that set. Try another result or import JSON.");
      }
    });
  });
}

async function importPokemonSet(setId, knownSet = null) {
  toast("Importing set...");
  const [setJson, cardsResponse] = await Promise.all([
    knownSet ? Promise.resolve({ data: knownSet }) : fetch(`https://api.pokemontcg.io/v2/sets/${encodeURIComponent(setId)}`).then((response) => response.json()),
    fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(setId)}&orderBy=number&pageSize=250`),
  ]);
  if (!cardsResponse.ok || !setJson.data) throw new Error("Set import failed");
  const cardsJson = await cardsResponse.json();
  const collection = {
    id: crypto.randomUUID(),
    type: "set",
    name: setJson.data.name,
    code: setJson.data.id,
    releaseDate: setJson.data.releaseDate || "",
    imageUrl: setJson.data.images?.logo || setJson.data.images?.symbol || "",
    goal: "Master set",
    cards: normalizeCards((cardsJson.data || []).map(cardFromPossibleApi)),
  };
  state.collections.unshift(collection);
  state.activeCollectionId = collection.id;
  state.route = "detail";
  saveCollections();
  closeModal();
  render();
  toast(`Imported ${collection.name}`);
}

function openArtistApiModal() {
  const body = `
    <form data-artist-api-form>
      <div class="field-grid">
        <label>Artist / illustrator name
          <input name="artist" required placeholder="Mitsuhiro Arita" />
        </label>
      </div>
      <p class="muted">Creates a custom artist collection from PokemonTCG.io cards that match the illustrator field.</p>
      <div class="button-row">
        <button class="primary-button" type="submit">Import artist collection</button>
      </div>
    </form>
  `;
  const modal = showModal("Find artist/illus", "Pokemon TCG API", body);
  modal.querySelector("[data-artist-api-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const artist = new FormData(event.currentTarget).get("artist").trim();
    if (!artist) return;
    toast("Fetching artist cards...");
    try {
      const query = `artist:"${artist.replaceAll('"', '\\"')}"`;
      const response = await fetch(
        `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&orderBy=set.releaseDate,number&pageSize=250`,
      );
      if (!response.ok) throw new Error("Fetch failed");
      const cardsJson = await response.json();
      const cards = normalizeCards((cardsJson.data || []).map(cardFromPossibleApi));
      if (!cards.length) {
        toast("No cards found for that artist");
        return;
      }
      const collection = {
        id: crypto.randomUUID(),
        type: "artist",
        name: `${artist} illustrations`,
        code: slugify(artist),
        releaseDate: "",
        imageUrl: cards[0]?.imageUrl || "",
        goal: `Collect cards illustrated by ${artist}`,
        cards,
      };
      state.collections.unshift(collection);
      state.activeCollectionId = collection.id;
      state.route = "detail";
      saveCollections();
      closeModal();
      render();
      toast(`Imported ${cards.length} cards by ${artist}`);
    } catch {
      toast("Could not fetch that artist. Check the spelling or import JSON instead.");
    }
  });
}

function cardFromPossibleApi(card) {
  const hasReverse = ["Common", "Uncommon", "Rare", "Rare Holo"].includes(card.rarity);
  return {
    id: card.id || crypto.randomUUID(),
    number: card.number || "",
    name: card.name || "Unnamed card",
    supertype: card.supertype || card.types?.join(", ") || "",
    rarity: card.rarity || "",
    artist: card.artist || card.illustrator || "",
    imageUrl: card.imageUrl || card.images?.large || card.images?.small || "",
    variants: card.variants || (hasReverse ? ["normal", "reverse"] : ["normal"]),
    owned: card.owned || {},
    notes: card.notes || "",
  };
}

function showModal(title, kicker, body) {
  closeModal();
  const template = document.querySelector("#modal-template").content.cloneNode(true);
  template.querySelector("[data-modal-title]").textContent = title;
  template.querySelector("[data-modal-kicker]").textContent = kicker;
  template.querySelector("[data-modal-body]").innerHTML = body;
  document.body.append(template);
  const modal = document.querySelector(".modal-backdrop");
  modal.addEventListener("click", (event) => {
    if (event.target.hasAttribute("data-close-modal")) closeModal();
  });
  return modal;
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
}

function getActiveCollection() {
  return state.collections.find((item) => item.id === state.activeCollectionId);
}

function findCard(collectionId, cardId) {
  return state.collections.find((item) => item.id === collectionId)?.cards.find((card) => card.id === cardId);
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function variantLabel(id) {
  return VARIANTS.find((variant) => variant.id === id)?.label || titleCase(id);
}

function variantShort(id) {
  return VARIANTS.find((variant) => variant.id === id)?.short || id.slice(0, 1).toUpperCase();
}

function collectionTypeLabel(type) {
  if (type === "set") return "Pokemon set";
  if (type === "artist") return "Artist / illustrator";
  return "Custom collection";
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseOptionalMoney(value) {
  const parsed = Number.parseFloat(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function formatAud(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `AU $${parsed.toFixed(2)}` : "-";
}

function formatDateTime(value) {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAttr(value) {
  return escapeHtml(value || "");
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  document.body.append(item);
  setTimeout(() => item.remove(), 2600);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

render();
loadCollections();
