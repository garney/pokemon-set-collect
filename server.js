const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

loadEnvFile();

const PORT = Number(process.env.PORT || 4174);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "collections.json");
const EBAY_AU_ORIGIN = "https://www.ebay.com.au";
const EBAY_ENV = process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
const EBAY_MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || "EBAY_AU";
const EBAY_SCOPE = process.env.EBAY_SCOPE || "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";
const EBAY_API_BASE = EBAY_ENV === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const EBAY_TOKEN_URL = `${EBAY_API_BASE}/identity/v1/oauth2/token`;
const EBAY_SOLD_SEARCH_URL = `${EBAY_API_BASE}/buy/marketplace_insights/v1_beta/item_sales/search`;
let ebayTokenCache = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const COLLECTION_TYPES = ["set", "custom", "artist"];

const seedCollections = [
  {
    id: crypto.randomUUID(),
    type: "set",
    name: "Scarlet & Violet Base Set",
    code: "sv1",
    releaseDate: "2023-03-31",
    imageUrl: "https://images.pokemontcg.io/sv1/logo.png",
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
    imageUrl: "https://images.pokemontcg.io/swsh9/18.png",
    goal: "Personal chase list",
    cards: [
      makeCard("018", "Charizard", "Fire", "Rare Holo", "https://images.pokemontcg.io/swsh9/18.png", ["normal"]),
      makeCard("154", "Charizard V", "Fire", "Ultra Rare", "https://images.pokemontcg.io/swsh9/154.png", ["normal"]),
      makeCard("199", "Charizard ex", "Fire", "Special Illustration Rare", "https://images.pokemontcg.io/sv3pt5/199.png", ["normal"]),
    ],
  },
];

function makeCard(number, name, supertype, rarity, imageUrl, variants, artist = "") {
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

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ collections: seedCollections }, null, 2));
  }
}

async function readCollections() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeCollections(payload) {
  await ensureDataFile();
  const collections = normalizeCollections(payload.collections || payload);
  await fs.writeFile(DATA_FILE, JSON.stringify({ collections }, null, 2));
  return { collections };
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

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8_000_000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function safeStaticPath(urlPath) {
  const requested = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const filePath = safeStaticPath(url.pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const type = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "content-type": type });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === "/api/collections" && request.method === "GET") {
      sendJson(response, 200, await readCollections());
      return;
    }

    if (url.pathname === "/api/collections" && request.method === "PUT") {
      const body = await readRequestBody(request);
      sendJson(response, 200, await writeCollections(JSON.parse(body || "{}")));
      return;
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        ebay: {
          env: EBAY_ENV,
          marketplaceId: EBAY_MARKETPLACE_ID,
          configured: hasEbayApiCredentials(),
        },
      });
      return;
    }

    if (url.pathname === "/api/ebay/sold-prices" && request.method === "GET") {
      const query = url.searchParams.get("query") || "";
      if (!query.trim()) {
        sendJson(response, 400, { error: "Missing query" });
        return;
      }
      try {
        sendJson(response, 200, await fetchEbaySoldPrices(query));
      } catch (error) {
        sendJson(response, 502, {
          error: error.message || "Could not fetch eBay sold prices",
          sourceUrl: ebaySoldSearchUrl(query),
        });
      }
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

ensureDataFile().then(() => {
  server.listen(PORT, () => {
    console.log(`SetDex running at http://localhost:${PORT}`);
  });
});

async function fetchEbaySoldPrices(query) {
  const sourceUrl = ebaySoldSearchUrl(query);
  if (hasEbayApiCredentials()) {
    try {
      return await fetchEbayApiSoldPrices(query, sourceUrl);
    } catch (error) {
      const fallback = await fetchEbayScrapedSoldPrices(query, sourceUrl).catch(() => null);
      if (fallback?.sales?.length) return fallback;
      throw error;
    }
  }

  return fetchEbayScrapedSoldPrices(query, sourceUrl);
}

async function fetchEbayApiSoldPrices(query, sourceUrl) {
  const token = await getEbayApplicationToken();
  const searchUrl = new URL(EBAY_SOLD_SEARCH_URL);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("limit", "20");

  const response = await fetch(searchUrl, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": EBAY_MARKETPLACE_ID,
      "accept-language": "en-AU",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.message || `eBay API returned ${response.status}`);
  }

  const sales = normalizeEbayApiSales(payload).slice(0, 8);
  const prices = sales.map((sale) => sale.price).filter((price) => Number.isFinite(price));
  const averagePrice = prices.length ? roundMoney(prices.reduce((sum, price) => sum + price, 0) / prices.length) : null;
  const currency = sales.find((sale) => sale.currency)?.currency || "AUD";
  return {
    query,
    source: "ebay-api",
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    currency,
    lastPrice: prices[0] ?? null,
    averagePrice,
    sales,
  };
}

async function fetchEbayScrapedSoldPrices(query, sourceUrl) {
  const searchUrl = sourceUrl;

  const response = await fetch(searchUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "accept-language": "en-AU,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`eBay returned ${response.status}`);

  const html = await response.text();
  const sales = parseEbaySoldHtml(html).slice(0, 8);
  const prices = sales.map((sale) => sale.price).filter((price) => Number.isFinite(price));
  const averagePrice = prices.length ? roundMoney(prices.reduce((sum, price) => sum + price, 0) / prices.length) : null;
  return {
    query,
    source: "ebay-sold-search",
    sourceUrl: searchUrl.toString(),
    fetchedAt: new Date().toISOString(),
    currency: "AUD",
    lastPrice: prices[0] ?? null,
    averagePrice,
    sales,
  };
}

async function getEbayApplicationToken() {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60_000) {
    return ebayTokenCache.accessToken;
  }
  const credentials = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: EBAY_SCOPE,
  });
  const response = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `eBay token returned ${response.status}`);
  }
  ebayTokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max((payload.expires_in || 0) - 60, 60) * 1000,
  };
  return ebayTokenCache.accessToken;
}

function hasEbayApiCredentials() {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

function normalizeEbayApiSales(payload) {
  const items = payload.itemSales || payload.itemSummaries || payload.items || [];
  return items
    .map((item) => {
      const price = Number(item.price?.value || item.itemPrice?.value || item.currentBidPrice?.value);
      if (!Number.isFinite(price)) return null;
      return {
        title: item.title || "Sold listing",
        price,
        currency: item.price?.currency || item.itemPrice?.currency || item.currentBidPrice?.currency || "AUD",
        displayPrice: formatAud(price),
        soldDate: item.itemSoldDate || item.lastSoldDate || item.dateSold || "",
        url: cleanEbayUrl(item.itemWebUrl || item.itemAffiliateWebUrl || item.legacyItemWebUrl || ""),
      };
    })
    .filter(Boolean);
}

function ebaySoldSearchUrl(query) {
  const searchUrl = new URL("/sch/i.html", EBAY_AU_ORIGIN);
  searchUrl.searchParams.set("_nkw", query);
  searchUrl.searchParams.set("LH_Sold", "1");
  searchUrl.searchParams.set("LH_Complete", "1");
  searchUrl.searchParams.set("_sop", "13");
  return searchUrl.toString();
}

function parseEbaySoldHtml(html) {
  const itemBlocks = html.split(/<li[^>]+class="[^"]*s-item[^"]*"[^>]*>/i).slice(1);
  return itemBlocks
    .map((block) => {
      const title = decodeHtml(stripTags(matchFirst(block, /<div[^>]+class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || ""));
      const rawPrice = decodeHtml(stripTags(matchFirst(block, /<span[^>]+class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || ""));
      const url = decodeHtml(matchFirst(block, /<a[^>]+class="[^"]*s-item__link[^"]*"[^>]+href="([^"]+)"/i) || "");
      const soldDate = decodeHtml(stripTags(matchFirst(block, /<span[^>]+class="[^"]*s-item__title--tagblock[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || ""));
      const price = parseAudPrice(rawPrice);
      if (!title || !Number.isFinite(price)) return null;
      return {
        title: title.replace(/^New Listing/i, "").trim(),
        price,
        displayPrice: formatAud(price),
        soldDate,
        url: cleanEbayUrl(url),
      };
    })
    .filter(Boolean);
}

function parseAudPrice(rawPrice) {
  const match = rawPrice.replace(/,/g, "").match(/(?:AU\s*)?\$([0-9]+(?:\.[0-9]{1,2})?)/i);
  return match ? Number(match[1]) : null;
}

function matchFirst(value, pattern) {
  return value.match(pattern)?.[1] || "";
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanEbayUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function formatAud(value) {
  return `AU $${value.toFixed(2)}`;
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fsSync.existsSync(envPath)) return;
  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}
