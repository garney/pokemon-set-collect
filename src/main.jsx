import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "./react-overrides.css";

const STORAGE_KEY = "setdex.collections.v1";
const VARIANTS = [
  { id: "normal", label: "Normal", short: "N" },
  { id: "reverse", label: "Reverse", short: "R" },
  { id: "pokeball", label: "Pokeball", short: "P" },
  { id: "masterball", label: "Masterball", short: "M" },
];
const COLLECTION_TYPES = ["set", "custom", "artist"];

function App() {
  const [route, setRoute] = useState("home");
  const [collections, setCollections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeVariant, setActiveVariant] = useState("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    loadCollections().then((items) => {
      setCollections(items);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === activeCollectionId),
    [collections, activeCollectionId],
  );

  function persist(nextCollections) {
    setCollections(nextCollections);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCollections, null, 2));
    fetch("/api/collections", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collections: nextCollections }),
    }).catch(() => showToast("Saved in browser only. Node server was not reachable."));
  }

  function showToast(message) {
    setToast(message);
  }

  function openCollection(collectionId) {
    setActiveCollectionId(collectionId);
    setRoute("detail");
    setActiveFilter("all");
    setActiveVariant("all");
    setSearch("");
  }

  function go(nextRoute) {
    setRoute(nextRoute);
    setSearch("");
  }

  function saveCollection(form, existingId = "") {
    const data = Object.fromEntries(new FormData(form).entries());
    let nextCollections;
    if (existingId) {
      nextCollections = collections.map((collection) =>
        collection.id === existingId ? { ...collection, ...data } : collection,
      );
    } else {
      const collection = {
        id: crypto.randomUUID(),
        ...data,
        cards: [],
      };
      nextCollections = [collection, ...collections];
      setActiveCollectionId(collection.id);
      setRoute("detail");
    }
    persist(nextCollections);
    setModal(null);
  }

  function deleteCollection(collectionId) {
    persist(collections.filter((collection) => collection.id !== collectionId));
    setRoute("home");
    setModal(null);
  }

  function saveCard(collectionId, form, existingCardId = "") {
    const data = new FormData(form);
    const variants = data.getAll("variants");
    const cardData = {
      name: data.get("name"),
      number: data.get("number"),
      supertype: data.get("supertype"),
      rarity: data.get("rarity"),
      artist: data.get("artist"),
      imageUrl: data.get("imageUrl"),
      notes: data.get("notes"),
      variants: variants.length ? variants : ["normal"],
    };
    const collection = collections.find((item) => item.id === collectionId);
    const existing = collection?.cards.find((card) => card.id === existingCardId);
    const lastSoldPrice = parseOptionalMoney(data.get("lastSoldPrice"));
    cardData.market = {
      ebayAu: lastSoldPrice
        ? {
            query: ebaySearchQuery(collection, cardData),
            sourceUrl: data.get("lastSoldUrl"),
            fetchedAt: new Date().toISOString(),
            currency: "AUD",
            lastPrice: lastSoldPrice,
            averagePrice: null,
            sales: [],
          }
        : existing?.market || { ebayAu: null },
    };

    const nextCollections = collections.map((item) => {
      if (item.id !== collectionId) return item;
      if (existingCardId) {
        return {
          ...item,
          cards: item.cards.map((card) => {
            if (card.id !== existingCardId) return card;
            const owned = { ...(card.owned || {}) };
            cardData.variants.forEach((variant) => {
              owned[variant] = Boolean(owned[variant]);
            });
            return { ...card, ...cardData, owned };
          }),
        };
      }
      const owned = {};
      cardData.variants.forEach((variant) => {
        owned[variant] = false;
      });
      return { ...item, cards: [...item.cards, { id: crypto.randomUUID(), ...cardData, owned }] };
    });
    persist(nextCollections);
    setModal(null);
  }

  function deleteCard(collectionId, cardId) {
    persist(
      collections.map((collection) =>
        collection.id === collectionId
          ? { ...collection, cards: collection.cards.filter((card) => card.id !== cardId) }
          : collection,
      ),
    );
    setModal(null);
  }

  function toggleVariant(collectionId, cardId, variant) {
    persist(
      collections.map((collection) =>
        collection.id === collectionId
          ? {
              ...collection,
              cards: collection.cards.map((card) =>
                card.id === cardId
                  ? { ...card, owned: { ...card.owned, [variant]: !card.owned?.[variant] } }
                  : card,
              ),
            }
          : collection,
      ),
    );
  }

  async function refreshEbayPrice(collectionId, cardId) {
    const collection = collections.find((item) => item.id === collectionId);
    const card = collection?.cards.find((item) => item.id === cardId);
    if (!collection || !card) return;
    showToast("Fetching eBay AU sold prices...");
    try {
      const query = ebaySearchQuery(collection, card);
      const response = await fetch(`/api/ebay/sold-prices?query=${encodeURIComponent(query)}`);
      const ebayAu = await response.json();
      if (!response.ok) throw new Error(ebayAu.sourceUrl || "Could not fetch eBay prices");
      const nextCollections = collections.map((item) =>
        item.id === collectionId
          ? {
              ...item,
              cards: item.cards.map((nextCard) =>
                nextCard.id === cardId ? { ...nextCard, market: { ...(nextCard.market || {}), ebayAu } } : nextCard,
              ),
            }
          : item,
      );
      persist(nextCollections);
      setModal({ type: "card", collectionId, cardId });
      showToast(ebayAu.lastPrice ? `Last sold ${formatAud(ebayAu.lastPrice)}` : "No sold prices found");
    } catch {
      showToast("Could not fetch eBay AU prices. You can add a manual price in Edit.");
    }
  }

  async function importSetByQuery(query) {
    showToast("Searching sets...");
    try {
      const matches = await findSetMatches(query);
      if (!matches.length) {
        showToast("No sets found for that search");
        return;
      }
      if (matches.length === 1) {
        await importPokemonSet(matches[0].id, matches[0]);
        return;
      }
      setModal({ type: "set-results", matches });
    } catch {
      showToast("Could not search sets. Check the name or import JSON instead.");
    }
  }

  async function importPokemonSet(setId, knownSet = null) {
    showToast("Importing set...");
    try {
      const [setJson, cardsResponse] = await Promise.all([
        knownSet
          ? Promise.resolve({ data: knownSet })
          : fetch(`https://api.pokemontcg.io/v2/sets/${encodeURIComponent(setId)}`).then((response) => response.json()),
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
      persist([collection, ...collections]);
      setActiveCollectionId(collection.id);
      setRoute("detail");
      setModal(null);
      showToast(`Imported ${collection.name}`);
    } catch {
      showToast("Could not import that set. Try another result or import JSON.");
    }
  }

  async function importArtist(artist) {
    showToast("Fetching artist cards...");
    try {
      const query = `artist:"${artist.replaceAll('"', '\\"')}"`;
      const response = await fetch(
        `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&orderBy=set.releaseDate,number&pageSize=250`,
      );
      if (!response.ok) throw new Error("Fetch failed");
      const cardsJson = await response.json();
      const cards = normalizeCards((cardsJson.data || []).map(cardFromPossibleApi));
      if (!cards.length) {
        showToast("No cards found for that artist");
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
      persist([collection, ...collections]);
      setActiveCollectionId(collection.id);
      setRoute("detail");
      setModal(null);
      showToast(`Imported ${cards.length} cards by ${artist}`);
    } catch {
      showToast("Could not fetch that artist. Check the spelling or import JSON instead.");
    }
  }

  function importCollectionsFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          persist(normalizeCollections(parsed.collections || parsed));
          showToast("Imported collections");
        } catch {
          showToast("That file could not be imported");
        }
      });
      reader.readAsText(file);
    });
    input.click();
  }

  function exportCollections() {
    const blob = new Blob([JSON.stringify({ collections }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `setdex-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importCardsJson(collectionId, json) {
    try {
      const parsed = JSON.parse(json);
      const cards = Array.isArray(parsed) ? parsed : parsed.cards || parsed.data || [];
      persist(
        collections.map((collection) =>
          collection.id === collectionId
            ? { ...collection, cards: [...collection.cards, ...normalizeCards(cards.map(cardFromPossibleApi))] }
            : collection,
        ),
      );
      setModal(null);
      showToast(`Imported ${cards.length} cards`);
    } catch {
      showToast("That JSON could not be imported");
    }
  }

  const content = isLoading ? (
    <section className="empty-state">
      <h3>Loading collection file</h3>
      <p className="muted">Reading data/collections.json from the local Node server.</p>
    </section>
  ) : route === "detail" && activeCollection ? (
    <CollectionDetail
      collection={activeCollection}
      activeFilter={activeFilter}
      activeVariant={activeVariant}
      search={search}
      onBack={() => go(activeCollection.type === "set" ? "sets" : "custom")}
      onEdit={() => setModal({ type: "collection", collectionId: activeCollection.id })}
      onAddCard={() => setModal({ type: "card-form", collectionId: activeCollection.id })}
      onImportCards={() => setModal({ type: "import-cards", collectionId: activeCollection.id })}
      onFilter={setActiveFilter}
      onVariant={setActiveVariant}
      onSearch={setSearch}
      onOpenCard={(cardId) => setModal({ type: "card", collectionId: activeCollection.id, cardId })}
      onToggleVariant={toggleVariant}
    />
  ) : route === "sets" ? (
    <CollectionIndex
      type="set"
      collections={collections.filter((collection) => collection.type === "set")}
      onAdd={() => setModal({ type: "collection", preferredType: "set" })}
      onOpen={openCollection}
      onSetSearch={() => setModal({ type: "set-search" })}
      onArtistSearch={() => setModal({ type: "artist-search" })}
      onImport={importCollectionsFile}
      onExport={exportCollections}
    />
  ) : route === "custom" ? (
    <CollectionIndex
      type="custom"
      collections={collections.filter((collection) => collection.type !== "set")}
      onAdd={() => setModal({ type: "collection", preferredType: "custom" })}
      onOpen={openCollection}
      onSetSearch={() => setModal({ type: "set-search" })}
      onArtistSearch={() => setModal({ type: "artist-search" })}
      onImport={importCollectionsFile}
      onExport={exportCollections}
    />
  ) : (
    <Home
      collections={collections}
      onAdd={() => setModal({ type: "collection" })}
      onRoute={go}
      onOpen={openCollection}
      onOpenCard={(collectionId, cardId) => setModal({ type: "card", collectionId, cardId })}
    />
  );

  return (
    <div className="app-shell">
      <Topbar onHome={() => go("home")} onImport={importCollectionsFile} onExport={exportCollections} />
      <Tabs route={route} onRoute={go} />
      <main className="content">{content}</main>
      <BottomNav route={route} onRoute={go} onAdd={() => setModal({ type: "collection" })} />
      {modal && (
        <Modal title={modalTitle(modal)} kicker={modalKicker(modal)} onClose={() => setModal(null)}>
          <ModalContent
            modal={modal}
            collections={collections}
            onSaveCollection={saveCollection}
            onDeleteCollection={deleteCollection}
            onSaveCard={saveCard}
            onDeleteCard={deleteCard}
            onToggleVariant={toggleVariant}
            onEditCard={(collectionId, cardId) => setModal({ type: "card-form", collectionId, cardId })}
            onRefreshEbay={refreshEbayPrice}
            onImportSetQuery={importSetByQuery}
            onImportPokemonSet={importPokemonSet}
            onImportArtist={importArtist}
            onImportCardsJson={importCardsJson}
          />
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Topbar({ onHome, onImport, onExport }) {
  return (
    <header className="topbar">
      <button className="brand plain-reset" onClick={onHome} aria-label="Go home">
        <span className="brand-mark">S</span>
        <span>
          <h1>SetDex</h1>
          <p>Local Pokemon collection tracker</p>
        </span>
      </button>
      <div className="top-actions">
        <button className="icon-button" type="button" onClick={onImport} title="Import JSON">
          In
        </button>
        <button className="icon-button" type="button" onClick={onExport} title="Export JSON">
          Out
        </button>
      </div>
    </header>
  );
}

function Tabs({ route, onRoute }) {
  return (
    <nav className="tabs" aria-label="Primary">
      {[
        ["home", "Home"],
        ["sets", "Sets"],
        ["custom", "Custom"],
      ].map(([id, label]) => (
        <button key={id} className={`tab ${route === id ? "is-active" : ""}`} onClick={() => onRoute(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}

function BottomNav({ route, onRoute, onAdd }) {
  return (
    <nav className="bottom-nav" aria-label="Mobile">
      {[
        ["home", "Home", "H"],
        ["sets", "Sets", "S"],
        ["add", "Add", "+"],
        ["custom", "Custom", "C"],
      ].map(([id, label, icon]) => (
        <button
          key={id}
          className={`nav-item ${route === id ? "is-active" : ""}`}
          onClick={id === "add" ? onAdd : () => onRoute(id)}
        >
          <span>{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Home({ collections, onAdd, onRoute, onOpen, onOpenCard }) {
  const allStats = aggregateStats(collections);
  const setStats = aggregateStats(collections.filter((item) => item.type === "set"));
  const artistStats = aggregateStats(collections.filter((item) => item.type === "artist"));
  return (
    <>
      <section className="screen-head">
        <div className="screen-title">
          <h1>Collection Overview</h1>
          <p>{collections.length} collections tracked on this device</p>
        </div>
        <button className="primary-button" type="button" onClick={onAdd}>
          + Add
        </button>
      </section>
      <section className="overview-grid">
        <Metric label="All" stats={allStats} color="var(--teal)" />
        <Metric label="Sets" stats={setStats} color="var(--red)" />
        <Metric label="Artists" stats={artistStats} color="var(--blue)" />
        <article className="metric">
          <div className="metric__value">{allStats.needed}</div>
          <div className="metric__label">Variants needed</div>
        </article>
      </section>
      <section className="section">
        <div className="section-header">
          <h2>Recent Collections</h2>
          <button className="plain-button" onClick={() => onRoute("sets")}>
            View sets
          </button>
        </div>
        <div className="collection-list">
          {collections.slice(0, 6).map((collection) => (
            <CollectionRow key={collection.id} collection={collection} onOpen={() => onOpen(collection.id)} />
          ))}
          {!collections.length && <Empty title="No collections yet" body="Create a set or custom list to start tracking." />}
        </div>
      </section>
      <section className="section">
        <div className="section-header">
          <h2>Card Collection Preview</h2>
          <button className="plain-button" onClick={() => onRoute("custom")}>
            Custom
          </button>
        </div>
        <div className="collection-list">
          {collections
            .flatMap((collection) => collection.cards.map((card) => ({ collection, card })))
            .slice(0, 5)
            .map(({ collection, card }) => (
              <PreviewCard key={`${collection.id}:${card.id}`} collection={collection} card={card} onOpen={() => onOpenCard(collection.id, card.id)} />
            ))}
        </div>
      </section>
    </>
  );
}

function Metric({ label, stats, color }) {
  return (
    <article className="metric">
      <div className="progress-ring" style={{ "--p": stats.percent, "--c": color }}>
        <span>{stats.percent}%</span>
      </div>
      <div className="metric__label">{label}</div>
      <div className="metric__value">{stats.owned}</div>
      <div className="metric__label">{stats.total} total</div>
    </article>
  );
}

function CollectionIndex({ type, collections, onAdd, onOpen, onSetSearch, onArtistSearch, onImport, onExport }) {
  const title = type === "set" ? "Sets" : "Custom Collections";
  return (
    <>
      <section className="screen-head">
        <div className="screen-title">
          <h1>{title}</h1>
          <p>{type === "set" ? "Master official sets and variants." : "Build chase lists, artist runs, and personal goals."}</p>
        </div>
        <button className="primary-button" type="button" onClick={onAdd}>
          + Add
        </button>
      </section>
      <div className="toolbar">
        <button className="secondary-button" onClick={onSetSearch}>
          Find Pokemon TCG set
        </button>
        <button className="secondary-button" onClick={onArtistSearch}>
          Find artist/illus
        </button>
        <button className="secondary-button" onClick={onImport}>
          Import JSON
        </button>
        <button className="secondary-button" onClick={onExport}>
          Export
        </button>
      </div>
      <section className="section collection-list">
        {collections.map((collection) => (
          <CollectionRow key={collection.id} collection={collection} onOpen={() => onOpen(collection.id)} />
        ))}
        {!collections.length && <Empty title={`No ${title.toLowerCase()} yet`} body="Use Add to create one locally." />}
      </section>
    </>
  );
}

function CollectionRow({ collection, onOpen }) {
  const stats = collectionStats(collection);
  return (
    <button className="collection-row" onClick={onOpen}>
      <Thumb src={collection.imageUrl} />
      <span>
        <h3>{collection.name}</h3>
        <p className="muted">{collectionTypeLabel(collection.type)}</p>
        <p className="muted">
          {stats.owned} / {stats.total} variants acquired
        </p>
        <span className="progress-line">
          <span style={{ width: `${stats.percent}%` }} />
        </span>
      </span>
      <span className="chevron">{stats.percent}%</span>
    </button>
  );
}

function PreviewCard({ collection, card, onOpen }) {
  const ownedCount = card.variants.filter((variant) => card.owned[variant]).length;
  return (
    <button className="collection-row" onClick={onOpen}>
      <Thumb src={card.imageUrl} />
      <span>
        <h3>{card.name}</h3>
        <p className="muted">{collection.name}</p>
        <p className="muted">
          {card.number} / {card.rarity || "Unknown rarity"}
        </p>
      </span>
      <span className="chevron">
        {ownedCount}/{card.variants.length}
      </span>
    </button>
  );
}

function CollectionDetail(props) {
  const {
    collection,
    activeFilter,
    activeVariant,
    search,
    onBack,
    onEdit,
    onAddCard,
    onImportCards,
    onFilter,
    onVariant,
    onSearch,
    onOpenCard,
    onToggleVariant,
  } = props;
  const stats = collectionStats(collection);
  const filteredCards = getFilteredCards(collection, search, activeFilter, activeVariant);
  return (
    <section className="layout-two">
      <aside>
        <div className="screen-head">
          <button className="icon-button" onClick={onBack} aria-label="Back">
            Back
          </button>
          <button className="plain-button" onClick={onEdit}>
            Edit
          </button>
        </div>
        <div className="detail-panel">
          <div className="set-hero">
            <Thumb src={collection.imageUrl} />
            <div>
              <h1>{collection.name}</h1>
              <p className="muted">{collection.goal || "Collection goal"}</p>
              <p className="muted">{collection.releaseDate ? `Released ${collection.releaseDate}` : collectionTypeLabel(collection.type)}</p>
            </div>
          </div>
          <div className="progress-line">
            <span style={{ width: `${stats.percent}%` }} />
          </div>
          <p className="muted">
            {stats.percent}% complete - {stats.owned} / {stats.total} variants acquired
          </p>
          <div className="button-row">
            <button className="secondary-button" onClick={onAddCard}>
              Add card
            </button>
            <button className="secondary-button" onClick={onImportCards}>
              Import cards
            </button>
          </div>
        </div>
      </aside>
      <section>
        <div className="filters">
          {["all", "owned", "needed"].map((filter) => (
            <button key={filter} className={`chip ${activeFilter === filter ? "is-active" : ""}`} onClick={() => onFilter(filter)}>
              {titleCase(filter)}
            </button>
          ))}
        </div>
        <div className="filters">
          {["all", ...VARIANTS.map((item) => item.id)].map((variant) => (
            <button key={variant} className={`chip ${activeVariant === variant ? "is-active" : ""}`} onClick={() => onVariant(variant)}>
              {variant === "all" ? "All variants" : variantLabel(variant)}
            </button>
          ))}
        </div>
        <div className="field-grid" style={{ marginBottom: 12 }}>
          <label>
            Search cards
            <input
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder="Name, number, rarity, artist"
            />
          </label>
        </div>
        <div className="grid">
          {filteredCards.map((card) => (
            <CardTile
              key={card.id}
              collection={collection}
              card={card}
              onOpen={() => onOpenCard(card.id)}
              onToggleVariant={(variant) => onToggleVariant(collection.id, card.id, variant)}
            />
          ))}
          {!filteredCards.length && <Empty title="No cards match" body="Try another filter or add cards to this collection." />}
        </div>
      </section>
    </section>
  );
}

function CardTile({ collection, card, onOpen, onToggleVariant }) {
  return (
    <article className="card-item">
      <button className="plain-reset card-open-button" onClick={onOpen}>
        <img className="card-art" src={card.imageUrl} alt={card.name} loading="lazy" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
        <div className="card-meta">
          <div className="card-number">#{card.number || "-"}</div>
          <h3>{card.name}</h3>
          <p className="muted">{card.artist || card.rarity || "Unknown rarity"}</p>
          {card.market?.ebayAu?.lastPrice ? <p className="price-badge">{formatAud(card.market.ebayAu.lastPrice)} last sold</p> : null}
        </div>
      </button>
      <div className="variant-row" aria-label="Variants">
        {card.variants.map((variant) => (
          <button
            key={variant}
            className={`variant-pill ${card.owned?.[variant] ? "is-owned" : ""}`}
            onClick={() => onToggleVariant(variant)}
            title={variantLabel(variant)}
          >
            {variantShort(variant)}
          </button>
        ))}
      </div>
    </article>
  );
}

function Modal({ title, kicker, onClose, children }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true">
        <header className="modal__header">
          <div>
            <p className="eyebrow">{kicker}</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            x
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ModalContent(props) {
  const { modal, collections } = props;
  const collection = collections.find((item) => item.id === modal.collectionId);
  const card = collection?.cards.find((item) => item.id === modal.cardId);
  if (modal.type === "collection") {
    return (
      <CollectionForm
        collection={collections.find((item) => item.id === modal.collectionId)}
        preferredType={modal.preferredType}
        onSave={props.onSaveCollection}
        onDelete={props.onDeleteCollection}
      />
    );
  }
  if (modal.type === "card-form" && collection) {
    return <CardForm collection={collection} card={card} onSave={props.onSaveCard} onDelete={props.onDeleteCard} />;
  }
  if (modal.type === "card" && collection && card) {
    return (
      <CardDetail
        collection={collection}
        card={card}
        onToggleVariant={props.onToggleVariant}
        onEdit={props.onEditCard}
        onRefreshEbay={props.onRefreshEbay}
      />
    );
  }
  if (modal.type === "set-search") return <SetSearchForm onSubmit={props.onImportSetQuery} />;
  if (modal.type === "set-results") return <SetResults matches={modal.matches} onImport={props.onImportPokemonSet} />;
  if (modal.type === "artist-search") return <ArtistSearchForm onSubmit={props.onImportArtist} />;
  if (modal.type === "import-cards" && collection) return <ImportCardsForm collection={collection} onImport={props.onImportCardsJson} />;
  return null;
}

function CollectionForm({ collection, preferredType = "", onSave, onDelete }) {
  const selectedType = collection?.type || preferredType || "set";
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(event.currentTarget, collection?.id); }}>
      <div className="field-grid">
        <label>
          Type
          <select name="type" defaultValue={selectedType}>
            <option value="set">Pokemon set</option>
            <option value="custom">Custom collection</option>
            <option value="artist">Artist / illustrator</option>
          </select>
        </label>
        <label>Name<input name="name" required defaultValue={collection?.name || ""} placeholder="Scarlet & Violet master set" /></label>
        <label>Code<input name="code" defaultValue={collection?.code || ""} placeholder="sv1 or my-chase-list" /></label>
        <label>Release date<input name="releaseDate" type="date" defaultValue={collection?.releaseDate || ""} /></label>
        <label>Cover image URL<input name="imageUrl" defaultValue={collection?.imageUrl || ""} placeholder="https://..." /></label>
        <label>Goal<input name="goal" defaultValue={collection?.goal || ""} placeholder="Master set, illustrator run, favorites..." /></label>
      </div>
      <div className="button-row">
        <button className="primary-button" type="submit">{collection ? "Save collection" : "Create collection"}</button>
        {collection ? <button className="danger-button" type="button" onClick={() => onDelete(collection.id)}>Delete</button> : null}
      </div>
    </form>
  );
}

function CardForm({ collection, card, onSave, onDelete }) {
  const checkedVariants = new Set(card?.variants || ["normal"]);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(collection.id, event.currentTarget, card?.id); }}>
      <div className="field-grid">
        <label>Name<input name="name" required defaultValue={card?.name || ""} placeholder="Pikachu" /></label>
        <label>Number<input name="number" defaultValue={card?.number || ""} placeholder="025" /></label>
        <label>Type<input name="supertype" defaultValue={card?.supertype || ""} placeholder="Lightning" /></label>
        <label>Rarity<input name="rarity" defaultValue={card?.rarity || ""} placeholder="Rare Holo" /></label>
        <label>Artist / illustrator<input name="artist" defaultValue={card?.artist || ""} placeholder="Mitsuhiro Arita" /></label>
        <label>Card image URL<input name="imageUrl" defaultValue={card?.imageUrl || ""} placeholder="https://..." /></label>
        <label>Manual eBay AU last sold price<input name="lastSoldPrice" inputMode="decimal" defaultValue={card?.market?.ebayAu?.lastPrice || ""} placeholder="42.50" /></label>
        <label>Last sold source URL<input name="lastSoldUrl" defaultValue={card?.market?.ebayAu?.sourceUrl || ""} placeholder="https://www.ebay.com.au/..." /></label>
        <label>Notes<textarea name="notes" defaultValue={card?.notes || ""} /></label>
      </div>
      <h3>Variants to collect</h3>
      <div className="filters">
        {VARIANTS.map((variant) => (
          <label key={variant.id} className="chip">
            <input type="checkbox" name="variants" value={variant.id} defaultChecked={checkedVariants.has(variant.id)} /> {variant.label}
          </label>
        ))}
      </div>
      <div className="button-row">
        <button className="primary-button" type="submit">{card ? "Save card" : "Add card"}</button>
        {card ? <button className="danger-button" type="button" onClick={() => onDelete(collection.id, card.id)}>Delete</button> : null}
      </div>
    </form>
  );
}

function CardDetail({ collection, card, onToggleVariant, onEdit, onRefreshEbay }) {
  const ebayUrl = card.market?.ebayAu?.sourceUrl || ebaySoldSearchUrl(ebaySearchQuery(collection, card));
  return (
    <div className="modal-body-pad">
      <div className="card-detail">
        {card.imageUrl ? <img className="detail-art" src={card.imageUrl} alt={card.name} onError={(event) => (event.currentTarget.style.display = "none")} /> : null}
        <dl className="detail-table">
          <DetailRow label="Collection" value={collection.name} />
          <DetailRow label="Number" value={card.number || "-"} />
          <DetailRow label="Type" value={card.supertype || "-"} />
          <DetailRow label="Rarity" value={card.rarity || "-"} />
          <DetailRow label="Artist" value={card.artist || "-"} />
          <DetailRow label="eBay AU last sold" value={card.market?.ebayAu?.lastPrice ? formatAud(card.market.ebayAu.lastPrice) : "-"} />
          <DetailRow label="eBay AU average" value={card.market?.ebayAu?.averagePrice ? formatAud(card.market.ebayAu.averagePrice) : "-"} />
          <DetailRow label="Variants" value={card.variants.map((variant) => `${variantLabel(variant)} ${card.owned[variant] ? "owned" : "needed"}`).join(", ")} />
          <DetailRow label="Notes" value={card.notes || "-"} />
        </dl>
        <EbaySales card={card} />
        <div className="button-row">
          {card.variants.map((variant) => (
            <button key={variant} className={`variant-pill ${card.owned[variant] ? "is-owned" : ""}`} onClick={() => onToggleVariant(collection.id, card.id, variant)}>
              {variantLabel(variant)}
            </button>
          ))}
          <button className="secondary-button" onClick={() => onRefreshEbay(collection.id, card.id)}>Refresh eBay AU</button>
          <a className="secondary-button button-link" href={ebayUrl} target="_blank" rel="noreferrer">Open eBay sold</a>
          <button className="secondary-button" onClick={() => onEdit(collection.id, card.id)}>Edit</button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function EbaySales({ card }) {
  const ebay = card.market?.ebayAu;
  if (!ebay?.sales?.length) {
    return (
      <section className="sales-panel">
        <h3>eBay AU sold prices</h3>
        <p className="muted">No sold-price snapshot yet. Use Refresh eBay AU to fetch recent completed listings.</p>
      </section>
    );
  }
  return (
    <section className="sales-panel">
      <h3>eBay AU sold prices</h3>
      <p className="muted">Fetched {formatDateTime(ebay.fetchedAt)} from sold/completed listings.</p>
      <div className="sales-list">
        {ebay.sales.map((sale, index) => (
          <a key={`${sale.url}:${index}`} className="sale-row" href={sale.url || ebay.sourceUrl} target="_blank" rel="noreferrer">
            <span><strong>{sale.title || "Sold listing"}</strong><small>{sale.soldDate || "Recent sold listing"}</small></span>
            <b>{formatAud(sale.price)}</b>
          </a>
        ))}
      </div>
    </section>
  );
}

function SetSearchForm({ onSubmit }) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget).get("setQuery").trim()); }}>
      <div className="field-grid">
        <label>Pokemon TCG set name or id<input name="setQuery" required placeholder="151, Paldea Evolved, sv1" /></label>
      </div>
      <p className="muted">Search by set name or code. If there are multiple matches, choose the one you want.</p>
      <div className="button-row"><button className="primary-button" type="submit">Search sets</button></div>
    </form>
  );
}

function SetResults({ matches, onImport }) {
  return (
    <div className="modal-body-pad">
      <div className="collection-list">
        {matches.map((set) => (
          <button key={set.id} className="collection-row" onClick={() => onImport(set.id, set)}>
            <Thumb src={set.images?.logo || set.images?.symbol || ""} />
            <span><h3>{set.name}</h3><p className="muted">{set.series || "Pokemon TCG"} {set.releaseDate ? `- ${set.releaseDate}` : ""}</p><p className="muted">{set.id} {set.total ? `- ${set.total} cards` : ""}</p></span>
            <span className="chevron">Import</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ArtistSearchForm({ onSubmit }) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget).get("artist").trim()); }}>
      <div className="field-grid">
        <label>Artist / illustrator name<input name="artist" required placeholder="Mitsuhiro Arita" /></label>
      </div>
      <p className="muted">Creates a custom artist collection from PokemonTCG.io cards that match the illustrator field.</p>
      <div className="button-row"><button className="primary-button" type="submit">Import artist collection</button></div>
    </form>
  );
}

function ImportCardsForm({ collection, onImport }) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onImport(collection.id, new FormData(event.currentTarget).get("json")); }}>
      <div className="field-grid">
        <label>Cards JSON<textarea name="json" placeholder='[{"name":"Pikachu","number":"025","artist":"Mitsuhiro Arita","imageUrl":"https://...","variants":["normal","reverse"]}]' /></label>
      </div>
      <p className="muted">Accepts an array of cards, a Pokemon TCG API card array, or an object with a cards property.</p>
      <div className="button-row"><button className="primary-button" type="submit">Import cards</button></div>
    </form>
  );
}

function Thumb({ src }) {
  return <img className="thumb" src={src || ""} alt="" loading="lazy" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />;
}

function Empty({ title, body }) {
  return <div className="empty-state"><h3>{title}</h3><p className="muted">{body}</p></div>;
}

async function loadCollections() {
  try {
    const response = await fetch("/api/collections");
    if (!response.ok) throw new Error("Could not load collections");
    const payload = await response.json();
    return normalizeCollections(payload.collections || payload);
  } catch {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeCollections(JSON.parse(raw)) : [];
  }
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
    variants.forEach((variant) => { owned[variant] = Boolean(card.owned?.[variant]); });
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
      market: { ebayAu: card.market?.ebayAu || null },
      notes: card.notes || "",
    };
  });
}

function collectionStats(collection) {
  const total = collection.cards.reduce((sum, card) => sum + card.variants.length, 0);
  const owned = collection.cards.reduce((sum, card) => sum + card.variants.filter((variant) => card.owned[variant]).length, 0);
  return { total, owned, needed: Math.max(total - owned, 0), percent: total ? Math.round((owned / total) * 100) : 0 };
}

function aggregateStats(collections) {
  return collections.reduce((acc, collection) => {
    const stats = collectionStats(collection);
    acc.total += stats.total;
    acc.owned += stats.owned;
    acc.needed += stats.needed;
    acc.percent = acc.total ? Math.round((acc.owned / acc.total) * 100) : 0;
    return acc;
  }, { total: 0, owned: 0, needed: 0, percent: 0 });
}

function getFilteredCards(collection, search, activeFilter, activeVariant) {
  return collection.cards.filter((card) => {
    const matchesText = `${card.name} ${card.number} ${card.rarity} ${card.artist}`.toLowerCase().includes(search.toLowerCase());
    const owned = card.variants.some((variant) => card.owned[variant]);
    const needs = card.variants.some((variant) => !card.owned[variant]);
    const matchesFilter = activeFilter === "all" || (activeFilter === "owned" && owned) || (activeFilter === "needed" && needs);
    const matchesVariant = activeVariant === "all" || card.variants.includes(activeVariant);
    return matchesText && matchesFilter && matchesVariant;
  });
}

async function findSetMatches(query) {
  const normalized = query.toLowerCase();
  const directSet = await fetchPokemonSetById(query);
  const response = await fetch("https://api.pokemontcg.io/v2/sets?pageSize=250");
  if (!response.ok) throw new Error("Set search failed");
  const setsJson = await response.json();
  const matches = (setsJson.data || []).filter((set) => `${set.id} ${set.name} ${set.series}`.toLowerCase().includes(normalized));
  if (directSet && !matches.some((set) => set.id === directSet.id)) matches.unshift(directSet);
  return matches.sort((a, b) => setMatchRank(a, normalized) - setMatchRank(b, normalized) || (b.releaseDate || "").localeCompare(a.releaseDate || "")).slice(0, 12);
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

function modalTitle(modal) {
  if (modal.type === "collection") return modal.collectionId ? "Edit collection" : "Add collection";
  if (modal.type === "card-form") return modal.cardId ? "Edit card" : "Add card";
  if (modal.type === "card") return "Card info";
  if (modal.type === "set-search") return "Find a set";
  if (modal.type === "set-results") return "Choose a set";
  if (modal.type === "artist-search") return "Find artist/illus";
  if (modal.type === "import-cards") return "Import cards";
  return "SetDex";
}

function modalKicker(modal) {
  if (modal.type === "set-search" || modal.type === "artist-search") return "Pokemon TCG API";
  if (modal.type === "card") return "Card info";
  return "Tracker";
}

function collectionTypeLabel(type) {
  if (type === "set") return "Pokemon set";
  if (type === "artist") return "Artist / illustrator";
  return "Custom collection";
}

function titleCase(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function variantLabel(id) { return VARIANTS.find((variant) => variant.id === id)?.label || titleCase(id); }
function variantShort(id) { return VARIANTS.find((variant) => variant.id === id)?.short || id.slice(0, 1).toUpperCase(); }
function setMatchRank(set, query) {
  const id = set.id.toLowerCase();
  const name = set.name.toLowerCase();
  if (id === query || name === query) return 0;
  if (name.startsWith(query) || id.startsWith(query)) return 1;
  return 2;
}
function slugify(value) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
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
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function ebaySearchQuery(collection, card) {
  return ["pokemon card", card.name, card.number, collection.type === "set" ? collection.name : "", card.rarity?.includes("Reverse") ? "reverse" : ""].filter(Boolean).join(" ");
}
function ebaySoldSearchUrl(query) {
  const params = new URLSearchParams({ _nkw: query, LH_Sold: "1", LH_Complete: "1", _sop: "13" });
  return `https://www.ebay.com.au/sch/i.html?${params.toString()}`;
}

createRoot(document.getElementById("root")).render(<App />);
