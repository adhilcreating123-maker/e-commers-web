"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getLatestCart, Product, useShoppingState } from "./store";
import { buildWhatsAppOrder, buildWhatsAppUrl, WHATSAPP_BUSINESS_PHONE } from "./whatsapp-order";
import { CatalogFilterItem, filterCatalogItems } from "./catalog-filters";

type Screen = "home" | "catalog" | "product" | "cart" | "wishlist";

const ACTIVE_PRODUCT_KEY = "nova:active-product:v1";
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function isMobileBrowser() {
  const clientHints = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof clientHints?.mobile === "boolean") return clientHints.mobile;

  const touchFirstPointer = window.matchMedia("(pointer: coarse) and (hover: none)").matches;
  const compactTouchScreen = navigator.maxTouchPoints > 0 && Math.min(window.innerWidth, window.innerHeight) <= 1024;
  return touchFirstPointer || compactTouchScreen;
}

function productFromCard(card: Element): Product | null {
  const name = card.querySelector("h2, h3, h4")?.textContent?.trim();
  let image = card.querySelector("img")?.getAttribute("src");
  if (!image) {
    const background = card.querySelector<HTMLElement>("[data-alt][style*='background-image']");
    image = background?.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
  }
  if (!name || !image) return null;
  const priceNode = Array.from(card.querySelectorAll("span, strong, p"))
    .find((node) => /^\$\s?[\d,]+(?:\.\d{2})?$/.test(node.textContent?.trim() ?? ""));
  if (!priceNode) return null;
  const priceMatch = priceNode?.textContent?.match(/[\d,]+(?:\.\d{2})?/);
  const price = priceMatch ? Number(priceMatch[0].replaceAll(",", "")) : 0;
  const description = card.querySelector("p")?.textContent?.trim() ?? "A curated NOVA piece.";
  const brand = card.querySelector(".p-space-md .font-label-caps")?.textContent?.trim();
  const id = slugify(name);
  const categoryByProduct: Record<string, string> = {
    "aura-reference-spatial-headphones": "tech-audio",
    "beosound-level-bespoke-obsidian": "tech-audio",
    "monitor-3-layer-gore-tex-coat": "designer-apparel",
    "chronometer-01-monolith-dlc": "timepieces",
    "brass-olfactory-diffuser-core": "home-living",
    "mw09-active-acoustic-earbuds": "tech-audio",
    "monolith-65-custom-terminal": "tech-audio",
    "vessel-carryall-28l-obsidian": "accessories",
    "sinfonia-resonance-turntable": "tech-audio",
  };
  const cardText = card.textContent?.toLowerCase() ?? "";
  const prices = Array.from(card.querySelectorAll("span, strong, p"))
    .map((node) => node.textContent?.trim() ?? "")
    .filter((text) => /^\$\s?[\d,]+(?:\.\d{2})?$/.test(text));
  const numericPrices = prices.map((text) => Number(text.replace(/[^\d.]/g, "")));
  const ratingText = cardText.match(/\b([0-5]\.\d)\s*\(/)?.[1];
  return {
    id, name, price, image, description, brand,
    category: categoryByProduct[id] ?? "uncategorized",
    isOnSale: numericPrices.length > 1,
    isLimited: /limited drop/i.test(cardText),
    available: !/sold out|unavailable/i.test(cardText),
    rating: ratingText ? Number(ratingText) : undefined,
  };
}

const categorySlug = (value: string) => {
  const text = value.trim().toLowerCase();
  if (!text || text.includes("all categor")) return "";
  if (/new arrivals?/.test(text)) return "new-arrivals";
  if (/limited|vault/.test(text)) return "limited-drops";
  if (/sale|archive/.test(text)) return "sale";
  if (/footwear|shoes|sneaker/.test(text)) return "footwear";
  if (/apparel|outerwear|clothing/.test(text)) return "designer-apparel";
  if (/home|living|architectural|object/.test(text)) return "home-living";
  if (/timepiece|watch/.test(text)) return "timepieces";
  if (/accessor|edc/.test(text)) return "accessories";
  if (/audio|acoustic|tech|sound/.test(text)) return "tech-audio";
  return slugify(text);
};

function syncWishlistButtons(root: HTMLElement, wishlist: Product[]) {
  root.querySelectorAll<HTMLButtonElement>('button[aria-label*="wishlist" i]').forEach((button) => {
    const card = button.closest("article, .product-card, a.group, div.group, [data-product-card]");
    const product = card ? productFromCard(card) : null;
    if (!product) return;
    const saved = wishlist.some((item) => item.id === product.id);
    const icon = button.querySelector<HTMLElement>(".material-symbols-outlined");
    if (icon?.textContent?.trim() === "favorite") icon.style.fontVariationSettings = saved ? "'FILL' 1" : "'FILL' 0";
    else if (icon) icon.textContent = saved ? "bookmark" : "bookmark_border";
    button.classList.toggle("text-primary-container", saved);
    button.classList.toggle("text-outline", !saved);
    button.classList.toggle("text-secondary", !saved);
    button.setAttribute("aria-label", saved ? "Remove from Wishlist" : "Add to Wishlist");
  });
}

function selectedProduct(root: HTMLElement): Product | null {
  try {
    const stored = localStorage.getItem(ACTIVE_PRODUCT_KEY);
    if (stored) return JSON.parse(stored) as Product;
  } catch { /* Ignore malformed local data and use the featured product. */ }
  const title = root.querySelector("main h1")?.textContent?.trim() || "NOVA Eclipse ANC Headphones";
  const image = root.querySelector<HTMLImageElement>("#main-product-img")?.src || "";
  const priceText = Array.from(root.querySelectorAll("span, strong"))
    .map((node) => node.textContent?.trim() ?? "")
    .find((text) => /^\$[\d,]+$/.test(text));
  return image ? {
    id: slugify(title), name: title, price: Number((priceText ?? "$349").replace(/[$,]/g, "")), image,
    description: root.querySelector("main p")?.textContent?.trim() ?? "Elevated design, engineered for everyday use.",
  } : null;
}

function cardMarkup(product: Product, saved: boolean) {
  return `<article class="group bg-surface-container-low rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col" data-product-id="${escapeHtml(product.id)}">
    <div class="relative aspect-square w-full bg-surface-container-lowest overflow-hidden"><img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="${escapeHtml(product.name)}" src="${escapeHtml(product.image)}"/><button aria-label="Save to Wishlist" data-action="wishlist" class="absolute top-space-sm right-space-sm w-8 h-8 rounded-full bg-surface-container-highest/80 backdrop-blur ${saved ? "text-primary-container" : "text-outline"} hover:text-primary-container flex items-center justify-center transition-colors"><span class="material-symbols-outlined text-base">${saved ? "bookmark" : "bookmark_border"}</span></button></div>
    <div class="p-space-md flex flex-col flex-1 justify-between gap-space-md"><div class="flex flex-col gap-space-2xs"><span class="font-label-caps text-label-caps uppercase tracking-wider text-outline font-semibold">${escapeHtml(product.brand ?? "NOVA Studio")}</span><h3 class="font-headline-sm text-headline-sm text-on-surface font-semibold group-hover:text-primary-container transition-colors line-clamp-1">${escapeHtml(product.name)}</h3><p class="font-body-sm text-body-sm text-outline line-clamp-1">${escapeHtml(product.description)}</p></div><div class="flex items-center justify-between pt-space-xs border-t border-surface-container-highest"><span class="font-headline-sm text-headline-sm text-on-surface font-bold">${money(product.price)}</span><button data-action="add" class="bg-primary-container text-on-primary-container px-space-md py-2 rounded-lg font-label-md text-label-md font-bold hover:bg-primary-fixed-dim transition-all flex items-center gap-1"><span class="material-symbols-outlined text-sm">add_shopping_cart</span> Add to Cart</button></div></div>
  </article>`;
}

function cartRow(product: Product) {
  const quantity = product.quantity ?? 1;
  return `<div class="flex flex-col sm:flex-row gap-space-md bg-surface-container p-space-md rounded-xl transition-all duration-200" data-cart-id="${escapeHtml(product.id)}">
    <div class="w-full sm:w-28 h-28 rounded-lg overflow-hidden shrink-0 bg-surface-container-highest"><img class="w-full h-full object-cover" alt="${escapeHtml(product.name)}" src="${escapeHtml(product.image)}"/></div>
    <div class="flex flex-col justify-between flex-1 min-w-0"><div class="flex items-start justify-between gap-space-sm"><div><h3 class="font-headline-sm text-headline-sm text-on-surface leading-tight">${escapeHtml(product.name)}</h3><p class="font-body-sm text-body-sm text-outline mt-0.5">${escapeHtml(product.description)}</p></div><span class="font-headline-sm text-headline-sm text-on-surface text-right whitespace-nowrap">${money(product.price * quantity)}</span></div>
    <div class="flex flex-wrap items-center justify-between gap-space-sm mt-space-md"><div class="flex items-center gap-space-xs bg-surface-container-lowest px-space-xs py-1 rounded-lg"><button data-action="decrease" aria-label="Decrease quantity" class="w-7 h-7 flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container rounded transition-colors" type="button"><span class="material-symbols-outlined text-sm">remove</span></button><span class="font-label-md text-label-md text-on-surface w-6 text-center font-bold">${quantity}</span><button data-action="increase" aria-label="Increase quantity" class="w-7 h-7 flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container rounded transition-colors" type="button"><span class="material-symbols-outlined text-sm">add</span></button></div><button data-action="remove" class="text-outline hover:text-error transition-colors flex items-center gap-1 font-label-md text-label-md" type="button"><span class="material-symbols-outlined text-base">delete</span><span>Remove</span></button></div></div>
  </div>`;
}

function ensureStickyCheckout(root: HTMLElement, button: HTMLButtonElement, total: number) {
  let bar = root.querySelector<HTMLElement>("[data-sticky-checkout-bar]");
  if (!bar) {
    bar = document.createElement("div");
    bar.dataset.stickyCheckoutBar = "true";
    bar.className = "nova-sticky-checkout-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Cart checkout");
    bar.innerHTML = '<div class="nova-sticky-checkout-total"><span>Order total</span><strong data-sticky-order-total></strong></div>';
    root.appendChild(bar);
  }
  const totalNode = bar.querySelector<HTMLElement>("[data-sticky-order-total]");
  if (totalNode) totalNode.textContent = money(total);
  if (button.parentElement !== bar) bar.appendChild(button);
}

function inlineCardCartControls(originalButton: string, height: number, fullWidth: boolean) {
  return `<div data-inline-cart-controls="true" data-original-button="${escapeHtml(originalButton)}" title="Added to Cart" class="nova-inline-card-cart-controls inline-flex max-w-full items-center justify-end gap-0.5 overflow-hidden rounded-lg" style="height:${height}px;width:${fullWidth ? "100%" : "max-content"}">
    <span aria-label="Added to Cart" title="Added to Cart" class="nova-inline-added-status inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap font-label-caps text-label-caps uppercase text-primary-container"><span class="material-symbols-outlined text-xs">check_circle</span><span>Added to Cart</span></span>
    <span class="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-container-lowest px-0.5">
      <button data-action="card-decrease" aria-label="Decrease quantity" class="w-4 h-5 flex items-center justify-center text-outline hover:text-on-surface rounded" type="button"><span class="material-symbols-outlined text-xs">remove</span></button>
      <span data-inline-quantity class="font-label-md text-label-md text-on-surface w-3 text-center font-bold">1</span>
      <button data-action="card-increase" aria-label="Increase quantity" class="w-4 h-5 flex items-center justify-center text-outline hover:text-on-surface rounded" type="button"><span class="material-symbols-outlined text-xs">add</span></button>
    </span>
    <a data-inline-go-to-cart="true" href="/cart" title="Go to Cart" aria-label="Go to Cart" class="nova-inline-go-to-cart inline-flex shrink-0 items-center justify-center gap-0.5 rounded bg-surface-container-highest px-1 py-0.5 text-on-surface hover:bg-primary-container hover:text-on-primary-container transition-colors"><span class="material-symbols-outlined text-xs" aria-hidden="true">shopping_bag</span><span class="font-label-caps text-label-caps whitespace-nowrap">GO TO CART</span></a>
  </div>`;
}

function inlineProductCartControls(originalButton: string, height: number) {
  return `<div data-product-cart-controls="true" data-original-button="${escapeHtml(originalButton)}" class="flex-1 min-w-0 inline-flex items-center justify-between gap-space-xs rounded-lg bg-primary-container px-space-xs text-on-primary-container" style="height:${height}px">
    <span class="inline-flex min-w-0 items-center gap-1 whitespace-nowrap font-label-md text-label-md font-bold"><span class="material-symbols-outlined text-sm">check_circle</span><span>Added to Cart</span></span>
    <span class="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-container-lowest px-0.5">
      <button data-action="product-decrease" aria-label="Decrease quantity" class="w-6 h-7 flex items-center justify-center text-outline hover:text-on-surface rounded" type="button"><span class="material-symbols-outlined text-sm">remove</span></button>
      <span data-product-quantity class="font-label-md text-label-md text-on-surface w-5 text-center font-bold">1</span>
      <button data-action="product-increase" aria-label="Increase quantity" class="w-6 h-7 flex items-center justify-center text-outline hover:text-on-surface rounded" type="button"><span class="material-symbols-outlined text-sm">add</span></button>
    </span>
  </div>`;
}

function productGoToCart() {
  return `<a data-product-go-to-cart="true" href="/cart" class="w-full h-10 inline-flex items-center justify-center gap-space-xs bg-primary-container text-on-primary-container font-label-md text-label-md font-bold rounded-lg hover:bg-primary-fixed-dim transition-colors"><span class="material-symbols-outlined text-sm">shopping_bag</span>Go to Cart</a>`;
}

function showToast(root: HTMLElement, message: string) {
  const toast = root.querySelector<HTMLElement>("#toast");
  const label = root.querySelector<HTMLElement>("#toast-message");
  if (!toast || !label) return;
  label.textContent = message;
  toast.classList.remove("translate-y-24", "opacity-0");
  toast.classList.add("translate-y-0", "opacity-100");
  window.setTimeout(() => {
    toast.classList.add("translate-y-24", "opacity-0");
    toast.classList.remove("translate-y-0", "opacity-100");
  }, 2400);
}

export default function StitchScreen({ html, catalogHtml, screen, slug }: { html: string; catalogHtml?: string; screen: Screen; slug?: string }) {
  const router = useRouter();
  const { cart, wishlist, ready, addToCart, removeFromCart, setQuantity, toggleWishlist } = useShoppingState();
  const [couponApplied, setCouponApplied] = useState(true);
  const markup = useMemo(() => {
    let content = html;
    if (screen === "wishlist") {
      content = content.replace("All Collections", "Saved Pieces")
        .replace(/<!-- Left Filters Sidebar -->[\s\S]*?<\/aside>/i, "")
        .replace("lg:col-span-9 flex flex-col gap-space-lg", "lg:col-span-12 flex flex-col gap-space-lg");
    }
    if (screen === "cart") {
      content = content
        .replace(/<!-- Section: Customer Delivery Information Form -->[\s\S]*?<\/form>\s*<\/div>/i, "")
        .replace("When you tap below, a pre-filled WhatsApp message containing your order items, delivery address, and total will open directly with our Concierge Desk. Our team confirms availability and sends your instant payment link or COD verification.", "When you tap below, a pre-filled WhatsApp message with your order items and total will open directly. Review the details in WhatsApp and send the message to request your order. Your order is not placed until the NOVA team confirms it.");
    }
    return content;
  }, [html, screen]);

  useEffect(() => {
    if (screen !== "home") return;
    let seconds = 5 * 3600 + 42 * 60 + 18;
    const tick = () => {
      if (seconds > 0) seconds -= 1;
      const hours = document.getElementById("timer-hours");
      const minutes = document.getElementById("timer-mins");
      const secs = document.getElementById("timer-secs");
      if (hours) hours.textContent = String(Math.floor(seconds / 3600)).padStart(2, "0");
      if (minutes) minutes.textContent = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
      if (secs) secs.textContent = String(seconds % 60).padStart(2, "0");
    };
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [screen]);

  useEffect(() => {
    const root = document.getElementById("nova-screen");
    if (!root) return;
    document.body.className = `bg-[#131313] text-[#e5e2e1] antialiased${screen === "cart" ? " nova-cart-page" : ""}`;

    // The Stitch header is fixed and can grow when its announcement wraps on mobile.
    // Measure it instead of relying on the original 112px desktop-only spacer.
    const header = document.querySelector<HTMLElement>("header");
    const main = root.querySelector<HTMLElement>("main");
    const updateHeaderOffset = () => {
      if (header && main) {
        const headerHeight = header.getBoundingClientRect().height;
        main.style.paddingTop = `${headerHeight}px`;
        root.style.setProperty("--nova-sticky-filter-top", `${headerHeight + 8}px`);
      }
    };
    const handleResize = () => updateHeaderOffset();
    updateHeaderOffset();
    const headerObserver = header && main ? new ResizeObserver(updateHeaderOffset) : null;
    if (headerObserver && header) headerObserver.observe(header);
    window.addEventListener("resize", handleResize);

    root.querySelectorAll<HTMLAnchorElement>("a[data-path]").forEach((link) => {
      const path = link.dataset.path;
      const icon = link.querySelector(".material-symbols-outlined")?.textContent?.trim();
      if (path === "home") link.href = "/";
      else if (path === "cart") link.href = "/cart";
      else if (path === "shop" && icon === "favorite") link.href = "/wishlist";
      else if (path === "shop") {
        const text = link.textContent?.trim() ?? "";
        const category = categorySlug(text);
        link.href = category ? `/catalog?category=${encodeURIComponent(category)}` : "/catalog";
      }
      else if (path === "account") link.href = "/wishlist";
      else if (["tracking", "orders"].includes(path ?? "")) link.href = "/cart";
      else link.href = "/catalog";
    });
    root.querySelectorAll<HTMLAnchorElement>('a[href="#"]').forEach((link) => {
      const text = link.textContent?.trim().toLowerCase() ?? "";
      if (text.includes("privacy") || text.includes("terms")) link.href = "/";
      else if (text.includes("catalog") || text.includes("collection") || text.includes("lookbook")) link.href = "/catalog";
    });
    root.querySelectorAll<HTMLElement>("[onclick], [onsubmit], [onchange]").forEach((node) => {
      node.removeAttribute("onclick"); node.removeAttribute("onsubmit"); node.removeAttribute("onchange");
    });

    const getCard = (element: Element) => element.closest("article, .product-card, a.group, div.group, [data-product-card]");
    const routeProduct = (): Product | null => {
      if (screen !== "product" || !slug) return null;
      try {
        const stored = JSON.parse(localStorage.getItem(ACTIVE_PRODUCT_KEY) ?? "null") as Product | null;
        if (stored?.id === slug) return stored;
      } catch { /* Use the product catalog for a direct product URL. */ }
      if (catalogHtml) {
        const parsed = new DOMParser().parseFromString(catalogHtml, "text/html");
        for (const card of parsed.querySelectorAll("#product-grid article, article")) {
          const product = productFromCard(card);
          if (product?.id === slug) return product;
        }
      }
      return null;
    };
    const navigateProduct = (product: Product) => {
      localStorage.setItem(ACTIVE_PRODUCT_KEY, JSON.stringify(product));
      router.push(`/product/${encodeURIComponent(product.id)}?from=${encodeURIComponent(window.location.pathname)}`);
    };
    const catalogPageSize = 6;
    let catalogVisibleLimit = Math.max(catalogPageSize, Number(root.dataset.catalogVisibleLimit ?? catalogPageSize));
    const runFilters = () => {
      if (screen !== "catalog") return;
      const grid = root.querySelector<HTMLElement>("#product-grid");
      if (!grid) return;

      const cards = Array.from(grid.querySelectorAll<HTMLElement>(":scope > article"));
      const entries = cards.flatMap((card, index) => {
        const product = productFromCard(card);
        if (!product) return [];
        if (card.dataset.originalOrder === undefined) card.dataset.originalOrder = String(index);
        card.dataset.productId = product.id;
        const image = card.querySelector<HTMLImageElement>("img");
        const cardText = card.textContent?.toLowerCase() ?? "";
        const item: CatalogFilterItem = {
          ...product,
          isNewArrival: /new arrival/i.test(cardText),
          isLimited: product.isLimited === true,
          isOnSale: product.isOnSale === true,
          imageDescription: `${image?.alt ?? ""} ${image?.dataset.alt ?? ""}`,
          originalOrder: Number(card.dataset.originalOrder),
        };
        return [{ card, item }];
      });
      const products = entries.map(({ item }) => item);
      const queryCategory = new URLSearchParams(window.location.search).get("category") ?? "";
      const selectedCategory = root.querySelector<HTMLElement>("[data-active-category]")?.dataset.categoryId ?? queryCategory;
      const brandOptions = Array.from(root.querySelectorAll<HTMLInputElement>("aside input[type=checkbox]"))
        .map((input) => ({ input, label: input.closest("label")?.textContent?.trim() ?? "" }))
        .filter(({ label }) => /^(NOVA Studio|Bang & Olufsen|Arc'teryx Veilance|Aesop Laboratory|Master & Dynamic)$/i.test(label));
      const activeBrands = brandOptions.filter(({ input }) => input.checked).map(({ label }) => label);
      const priceInputs = Array.from(root.querySelectorAll<HTMLInputElement>("aside input[type=number]"));
      const slider = root.querySelector<HTMLInputElement>("#price-slider");
      const minPrice = Number(priceInputs[0]?.value ?? slider?.min ?? 0);
      const maxPrice = Number(priceInputs[1]?.value ?? slider?.value ?? Number.POSITIVE_INFINITY);
      const searchInput = root.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
      const search = searchInput?.value.trim() ?? "";
      const color = root.querySelector<HTMLElement>("aside[data-selected-color]")?.dataset.selectedColor ?? "";
      const sort = root.querySelector<HTMLSelectElement>("#sort-select")?.value ?? "popularity";
      const filtered = filterCatalogItems(products, { category: selectedCategory, brands: activeBrands, minPrice, maxPrice, search, color, sort });
      const visibleItems = filtered.slice(0, catalogVisibleLimit);
      const visibleIds = new Set(visibleItems.map((item) => item.id));
      const cardsById = new Map(entries.map(({ card, item }) => [item.id, card]));

      filtered.forEach((item) => {
        const card = cardsById.get(item.id);
        if (card) { card.hidden = false; grid.appendChild(card); }
      });
      entries.forEach(({ card, item }) => { if (!visibleIds.has(item.id)) { card.hidden = true; grid.appendChild(card); } });

      const countBadge = root.querySelector<HTMLElement>("h1 + span");
      if (countBadge) { countBadge.dataset.filteredProductCount = "true"; countBadge.textContent = `${filtered.length} Curations`; }
      const paginationLabel = Array.from(root.querySelectorAll<HTMLElement>("span"))
        .find((node) => /^Displaying\s+\d+\s+of\s+\d+/i.test(node.textContent?.trim() ?? ""));
      if (paginationLabel) paginationLabel.textContent = `Displaying ${visibleItems.length} of ${filtered.length} Elevated Pieces`;
      const loadMore = root.querySelector<HTMLButtonElement>("#load-more-btn");
      if (loadMore) {
        loadMore.hidden = visibleItems.length >= filtered.length;
        loadMore.setAttribute("aria-label", `Load more elevated pieces (${Math.max(0, filtered.length - visibleItems.length)} remaining)`);
      }
      const progress = loadMore?.parentElement?.parentElement?.querySelector<HTMLElement>(".bg-primary-container.h-full");
      if (progress) progress.style.width = `${filtered.length ? Math.min(100, (visibleItems.length / filtered.length) * 100) : 0}%`;
      let emptyState = root.querySelector<HTMLElement>("[data-category-empty-state]");
      if (filtered.length === 0) {
        if (!emptyState) {
          emptyState = document.createElement("div");
          emptyState.dataset.categoryEmptyState = "true";
          emptyState.className = "col-span-full rounded-xl bg-surface-container p-space-xl text-center text-outline";
          emptyState.textContent = "No pieces match these filters. Try another category or clear your filters.";
          grid.appendChild(emptyState);
        }
        emptyState.hidden = false;
      } else if (emptyState) emptyState.hidden = true;

      const categoryLabels: Record<string, string> = {
        "new-arrivals": "New Arrivals", "tech-audio": "Tech & Audio", "designer-apparel": "Designer Apparel",
        "home-living": "Home & Living", accessories: "Accessories & EDC", timepieces: "Precision Timepieces",
        "limited-drops": "Limited Drops", sale: "Sale",
      };
      const minDefault = Number(priceInputs[0]?.defaultValue ?? 0);
      const maxDefault = Number(priceInputs[1]?.defaultValue ?? slider?.max ?? Number.POSITIVE_INFINITY);
      const priceIsActive = minPrice !== minDefault || maxPrice !== maxDefault;
      const chipValues: Array<{ type: string; value: string; label: string }> = [];
      if (selectedCategory) chipValues.push({ type: "category", value: selectedCategory, label: `Category: ${categoryLabels[selectedCategory] ?? selectedCategory}` });
      activeBrands.forEach((brand) => chipValues.push({ type: "brand", value: brand, label: `Brand: ${brand}` }));
      if (priceIsActive) chipValues.push({ type: "price", value: "range", label: `Price: $${minPrice.toLocaleString("en-US")} - $${maxPrice.toLocaleString("en-US")}` });
      if (color) chipValues.push({ type: "color", value: color, label: `Color: ${color}` });
      if (search) chipValues.push({ type: "search", value: search, label: `Search: ${search}` });
      const activeFilterCount = root.querySelector<HTMLElement>("[data-mobile-filter-count]");
      if (activeFilterCount) {
        activeFilterCount.textContent = chipValues.length ? ` (${chipValues.length})` : "";
        activeFilterCount.hidden = chipValues.length === 0;
      }
      const chipBar = grid.parentElement?.firstElementChild as HTMLElement | null;
      const chipContainer = chipBar?.querySelector<HTMLElement>(":scope > div.flex.items-center.gap-space-xs.flex-wrap") ?? null;
      if (chipContainer) {
        const label = chipContainer.querySelector<HTMLElement>(".font-label-caps.uppercase.text-outline");
        chipContainer.replaceChildren(...[...(label ? [label] : []), ...chipValues.map(({ type, value, label: text }) => {
          const chip = document.createElement("span");
          chip.className = "inline-flex items-center gap-1 font-label-caps text-label-caps bg-surface-container-high text-on-surface px-space-xs py-1 rounded-full";
          chip.append(document.createTextNode(text));
          const remove = document.createElement("button");
          remove.type = "button";
          remove.dataset.removeFilter = type;
          remove.dataset.filterValue = value;
          remove.setAttribute("aria-label", `Remove ${type} filter${type === "brand" ? ` ${value}` : ""}`);
          remove.className = "hover:text-error transition-colors";
          remove.innerHTML = '<span class="material-symbols-outlined text-xs">close</span>';
          chip.appendChild(remove);
          return chip;
        })]);
      }

      const categorySidebarLabels = Array.from(root.querySelectorAll<HTMLElement>("aside label"))
        .filter((label) => !label.querySelector("input") && /audio|apparel|accessor|timepiece|home/i.test(label.textContent ?? ""));
      categorySidebarLabels.forEach((label) => {
        const category = categorySlug(label.textContent?.replace(/\d+\s*$/, "") ?? "");
        const active = Boolean(category && category === selectedCategory);
        if (active) {
          label.dataset.activeCategory = "true";
          label.dataset.categoryId = category;
        } else {
          label.removeAttribute("data-active-category");
          delete label.dataset.categoryId;
        }
        label.classList.toggle("bg-surface-container", active);
        label.classList.toggle("hover:bg-surface-container-high", active);
        label.classList.toggle("hover:bg-surface-container", !active);
        const labelText = label.querySelector<HTMLElement>(":scope > span:first-child");
        labelText?.classList.toggle("text-on-surface", active);
        labelText?.classList.toggle("text-on-surface-variant", !active);
        labelText?.classList.toggle("group-hover:text-primary-container", active);
        labelText?.classList.toggle("group-hover:text-on-surface", !active);
        const count = label.querySelector<HTMLElement>(":scope > span:last-child");
        if (count && category) {
          const matchingCount = products.filter((item) => category === "tech-audio" ? item.category === "tech-audio" : item.category === category).length;
          count.textContent = String(matchingCount);
        }
      });
      const categoryNav = root.querySelector<HTMLElement>("nav[data-active-classes]");
      const activeClasses = categoryNav?.dataset.activeClasses?.split(/\s+/).filter(Boolean) ?? [];
      categoryNav?.querySelectorAll<HTMLAnchorElement>('a[data-path="shop"]').forEach((link) => {
        const id = categorySlug(link.textContent ?? "");
        const active = selectedCategory ? id === selectedCategory : !id;
        activeClasses.forEach((className) => link.classList.toggle(className, active));
      });

      const priceLabel = root.querySelector<HTMLElement>("#price-label");
      if (priceLabel) priceLabel.textContent = `$${minPrice.toLocaleString("en-US")} - $${maxPrice.toLocaleString("en-US")}`;
    };
    const resetCatalogFilters = () => {
      catalogVisibleLimit = Number.MAX_SAFE_INTEGER;
      root.dataset.catalogVisibleLimit = String(catalogVisibleLimit);
      root.querySelectorAll("[data-active-category]").forEach((item) => item.removeAttribute("data-active-category"));
      root.querySelectorAll<HTMLElement>("aside[data-selected-color]").forEach((aside) => delete aside.dataset.selectedColor);
      const url = new URL(window.location.href);
      url.searchParams.delete("category");
      window.history.replaceState(null, "", url);
      root.querySelectorAll<HTMLInputElement>("aside input[type=checkbox]").forEach((input) => { input.checked = false; });
      const priceInputs = Array.from(root.querySelectorAll<HTMLInputElement>("aside input[type=number]"));
      if (priceInputs[0]) priceInputs[0].value = priceInputs[0].defaultValue || "0";
      if (priceInputs[1]) priceInputs[1].value = priceInputs[1].defaultValue || "1500";
      const slider = root.querySelector<HTMLInputElement>("#price-slider");
      if (slider) slider.value = String(Math.min(Number(priceInputs[1]?.value ?? slider.max), Number(slider.max)));
      root.querySelectorAll<HTMLInputElement>('input[placeholder*="Search"]').forEach((input) => { input.value = ""; });
      const sort = root.querySelector<HTMLSelectElement>("#sort-select");
      if (sort) sort.value = "popularity";
      root.querySelectorAll("aside button[title]").forEach((button) => {
        button.classList.remove("ring-2", "ring-primary-container");
      });
      runFilters();
    };
    let openMobileFilterDrawer = () => {};
    let closeMobileFilterDrawer = () => {};
    if (screen === "catalog") {
      let filterButton = root.querySelector<HTMLButtonElement>("[data-mobile-filter-open]");
      let filterDrawer = root.querySelector<HTMLElement>("[data-mobile-filter-drawer]");
      if (!filterButton) {
        filterButton = document.createElement("button");
        filterButton.type = "button";
        filterButton.dataset.mobileFilterOpen = "true";
        filterButton.dataset.mobileFilterAction = "open";
        filterButton.className = "nova-filter-products-button";
        filterButton.setAttribute("aria-expanded", "false");
        filterButton.setAttribute("aria-label", "Filter products by category, brand, or price");
        filterButton.innerHTML = '<span class="material-symbols-outlined nova-filter-products-icon" aria-hidden="true">filter_alt</span><span class="nova-filter-products-copy"><strong>FILTER PRODUCTS<span class="nova-filter-products-count" data-mobile-filter-count hidden></span></strong><small>Category · Brand · Price</small></span>';
        filterDrawer = document.createElement("div");
        filterDrawer.dataset.mobileFilterDrawer = "true";
        filterDrawer.className = "nova-mobile-filter-drawer";
        filterDrawer.setAttribute("aria-hidden", "true");
        filterDrawer.innerHTML = `
          <button type="button" class="nova-mobile-filter-backdrop" data-mobile-filter-action="close" aria-label="Close filters"></button>
          <section class="nova-mobile-filter-panel" role="dialog" aria-modal="true" aria-label="Shopping filters">
            <header class="nova-mobile-filter-header"><h2>Filters</h2><button type="button" data-mobile-filter-action="close" aria-label="Close filters"><span class="material-symbols-outlined" aria-hidden="true">close</span><span>Close</span></button></header>
            <div class="nova-mobile-filter-content" data-mobile-filter-content>
              <div class="nova-mobile-filter-search" data-mobile-filter-search><label for="nova-mobile-search">Search products</label></div>
              <div class="nova-mobile-filter-sort" data-mobile-filter-sort><label for="sort-select">Sort by</label></div>
            </div>
            <footer class="nova-mobile-filter-footer"><button type="button" data-mobile-filter-action="clear">Clear All</button><button type="button" data-mobile-filter-action="apply">Apply Filters</button></footer>
          </section>`;
        root.appendChild(filterDrawer);
      }

      const aside = root.querySelector<HTMLElement>("#product-grid")?.parentElement?.previousElementSibling?.querySelector<HTMLElement>("aside")
        ?? root.querySelector<HTMLElement>("aside");
      aside?.setAttribute("data-mobile-filter-sidebar", "true");
      const productMain = root.querySelector<HTMLElement>("#product-grid")?.closest<HTMLElement>("main");
      productMain?.classList.remove("lg:col-span-9");
      productMain?.classList.add("lg:col-span-12");
      const productGrid = root.querySelector<HTMLElement>("#product-grid");
      productGrid?.classList.add("nova-catalog-grid");
      const activeToolbar = productGrid?.parentElement?.firstElementChild as HTMLElement | null;
      if (activeToolbar && filterButton) {
        activeToolbar.dataset.stickyFilterToolbar = "true";
        activeToolbar.classList.add("nova-catalog-active-toolbar");
        activeToolbar.insertBefore(filterButton, activeToolbar.firstChild);
      }
      const applySection = Array.from(aside?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.trim() === "Apply Filter Selection")?.closest<HTMLElement>(".flex.flex-col.gap-space-xs.pt-space-xs");
      applySection?.setAttribute("data-mobile-filter-original-apply", "true");

      const searchInput = root.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
      const searchWrapper = searchInput?.parentElement?.parentElement as HTMLElement | null;
      if (searchWrapper && !searchWrapper.dataset.mobileSearchWrapper) searchWrapper.dataset.mobileSearchWrapper = "true";
      const sortWrapper = root.querySelector<HTMLSelectElement>("#sort-select")?.closest<HTMLElement>(".relative");
      sortWrapper?.setAttribute("data-mobile-sort-wrapper", "true");

      const restoreMobileFilterElements = () => {
        const restore = (selector: string, placeholderSelector: string) => {
          const node = root.querySelector<HTMLElement>(selector);
          const placeholder = root.querySelector<HTMLElement>(placeholderSelector);
          if (node && placeholder?.parentNode) { placeholder.parentNode.insertBefore(node, placeholder); placeholder.remove(); }
        };
        restore("aside[data-mobile-filter-sidebar]", "[data-mobile-filter-aside-placeholder]");
        restore("[data-mobile-sort-wrapper]", "[data-mobile-sort-placeholder]");
        const search = root.querySelector<HTMLElement>("[data-mobile-search-wrapper]");
        const searchPlaceholder = root.querySelector<HTMLElement>("[data-mobile-search-placeholder]");
        if (search && searchPlaceholder?.parentNode) {
          search.className = search.dataset.mobileOriginalClass ?? search.className;
          delete search.dataset.mobileOriginalClass;
          searchPlaceholder.parentNode.insertBefore(search, searchPlaceholder);
          searchPlaceholder.remove();
        }
      };
      const closeDrawer = () => {
        filterDrawer?.classList.remove("is-open");
        filterDrawer?.setAttribute("aria-hidden", "true");
        filterButton?.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nova-mobile-filter-open");
        restoreMobileFilterElements();
      };
      closeMobileFilterDrawer = closeDrawer;
      const openDrawer = () => {
        if (!filterDrawer || !filterButton) return;
        const content = filterDrawer.querySelector<HTMLElement>("[data-mobile-filter-content]");
        const searchTarget = filterDrawer.querySelector<HTMLElement>("[data-mobile-filter-search]");
        const sortTarget = filterDrawer.querySelector<HTMLElement>("[data-mobile-filter-sort]");
        const sidebar = root.querySelector<HTMLElement>("aside[data-mobile-filter-sidebar]");
        const sort = root.querySelector<HTMLElement>("[data-mobile-sort-wrapper]");
        const search = root.querySelector<HTMLElement>("[data-mobile-search-wrapper]");
        if (sidebar?.parentNode && !root.querySelector("[data-mobile-filter-aside-placeholder]")) {
          const placeholder = document.createElement("div"); placeholder.hidden = true; placeholder.dataset.mobileFilterAsidePlaceholder = "true";
          sidebar.parentNode.insertBefore(placeholder, sidebar);
        }
        if (sort?.parentNode && !root.querySelector("[data-mobile-sort-placeholder]")) {
          const placeholder = document.createElement("div"); placeholder.hidden = true; placeholder.dataset.mobileSortPlaceholder = "true";
          sort.parentNode.insertBefore(placeholder, sort);
        }
        if (search?.parentNode && !root.querySelector("[data-mobile-search-placeholder]")) {
          const placeholder = document.createElement("div"); placeholder.hidden = true; placeholder.dataset.mobileSearchPlaceholder = "true";
          search.dataset.mobileOriginalClass = search.className;
          search.parentNode.insertBefore(placeholder, search);
        }
        if (search && searchTarget) {
          search.classList.remove("hidden", "md:flex", "flex-1", "max-w-md", "mx-space-lg");
          search.classList.add("w-full");
          searchTarget.appendChild(search);
        }
        if (sort && sortTarget) sortTarget.appendChild(sort);
        if (sidebar && content) content.appendChild(sidebar);
        filterDrawer.classList.add("is-open");
        filterDrawer.setAttribute("aria-hidden", "false");
        filterButton.setAttribute("aria-expanded", "true");
        document.body.classList.add("nova-mobile-filter-open");
      };
      openMobileFilterDrawer = openDrawer;
    }
    const updateCartDom = () => {
      if (screen !== "cart" || !ready) return;
      const firstItem = root.querySelector<HTMLElement>("#cart-item-1, #cart-item-2");
      const panel = firstItem?.closest<HTMLElement>(".bg-surface-container-low.rounded-xl")
        ?? root.querySelector<HTMLElement>("#coupon-field")?.closest<HTMLElement>(".bg-surface-container-low.rounded-xl");
      if (!panel) return;
      panel.querySelectorAll("#cart-item-1, #cart-item-2").forEach((node) => node.remove());
      let items = panel.querySelector<HTMLElement>("[data-cart-dynamic-items]");
      if (!items) {
        items = document.createElement("div");
        items.dataset.cartDynamicItems = "true";
        items.className = "flex flex-col gap-space-md";
        const coupon = panel.querySelector<HTMLElement>("#coupon-field")?.closest<HTMLElement>(".bg-surface-container-lowest.p-space-md.rounded-xl");
        if (coupon) panel.insertBefore(items, coupon); else panel.appendChild(items);
      }
      items.innerHTML = cart.length
        ? cart.map(cartRow).join("")
        : `<div class="rounded-xl bg-surface-container p-space-xl text-center"><span class="material-symbols-outlined text-4xl text-primary-container">shopping_bag</span><h3 class="font-headline-md text-headline-md mt-space-sm">Your bag is waiting</h3><p class="font-body-md text-body-md text-outline mt-space-xs">Explore the collection and add a piece to your curation.</p><a href="/catalog" class="inline-flex mt-space-md bg-primary-container text-on-primary-container font-label-lg text-label-lg px-space-lg py-space-sm rounded-lg">Explore the Collection</a></div>`;
      const subtotal = cart.reduce((sum, product) => sum + product.price * (product.quantity ?? 1), 0);
      const total = Math.max(0, subtotal - (couponApplied && subtotal ? 50 : 0));
      const summary = root.querySelector<HTMLElement>("#summary-total")?.closest<HTMLElement>(".bg-surface-container-low.rounded-xl");
      const subtotalRow = summary && Array.from(summary.querySelectorAll<HTMLElement>("div.flex.items-center.justify-between"))
        .find((row) => row.textContent?.trim().startsWith("Subtotal"));
      const subtotalLabel = subtotalRow?.querySelector("span");
      if (subtotalLabel) subtotalLabel.textContent = `Subtotal (${cart.reduce((sum, item) => sum + (item.quantity ?? 1), 0)} items)`;
      const subtotalValue = subtotalRow?.querySelectorAll("span")[1];
      if (subtotalValue) subtotalValue.textContent = money(subtotal);
      const totalNode = root.querySelector<HTMLElement>("#summary-total");
      if (totalNode) totalNode.textContent = money(total);
      const itemCount = root.querySelector("main h1 span");
      if (itemCount) itemCount.textContent = `(${cart.reduce((sum, item) => sum + (item.quantity ?? 1), 0)} Items)`;
      const orderButton = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.dataset.checkout || button.textContent?.includes("Place Order via WhatsApp"));
      if (orderButton) {
        orderButton.dataset.checkout = "true";
        orderButton.disabled = cart.length === 0;
        orderButton.setAttribute("aria-disabled", String(cart.length === 0));
        orderButton.classList.toggle("opacity-50", cart.length === 0);
        orderButton.classList.toggle("cursor-not-allowed", cart.length === 0);
        orderButton.innerHTML = `<span class="material-symbols-outlined">chat</span> Place Order via WhatsApp • ${money(total)}`;
        ensureStickyCheckout(root, orderButton, total);
      }
    };
    const updateWishlistDom = () => {
      if (screen !== "wishlist" || !ready) return;
      const grid = root.querySelector<HTMLElement>("#product-grid");
      if (!grid) return;
      grid.innerHTML = wishlist.length
        ? wishlist.map((product) => cardMarkup(product, true)).join("")
        : `<div class="col-span-full rounded-xl bg-surface-container-low p-space-2xl text-center"><span class="material-symbols-outlined text-4xl text-primary-container">favorite</span><h2 class="font-headline-md text-headline-md mt-space-sm">No saved pieces yet</h2><p class="font-body-md text-body-md text-outline mt-space-xs">Tap the heart on a piece to keep it close.</p><a href="/catalog" class="inline-flex mt-space-md bg-primary-container text-on-primary-container font-label-lg text-label-lg px-space-lg py-space-sm rounded-lg">Explore the Collection</a></div>`;
    };
    const updateProductCardCart = () => {
      if (screen !== "home" && screen !== "catalog" && screen !== "wishlist") return;
      const cards = screen === "catalog" || screen === "wishlist"
        ? Array.from(root.querySelectorAll<HTMLElement>("#product-grid article"))
        : Array.from(root.querySelectorAll<HTMLElement>("main .group"));
      cards.forEach((card) => {
        const product = productFromCard(card);
        if (!product) return;
        const cartItem = cart.find((item) => item.id === product.id);
        const quantity = cartItem ? cartItem.quantity ?? 1 : 0;
        let controls = card.querySelector<HTMLElement>("[data-inline-cart-controls]");
        if (quantity > 0) {
          if (!controls) {
            const addButton = Array.from(card.querySelectorAll<HTMLButtonElement>("button"))
              .find((button) => {
                const label = button.getAttribute("aria-label")?.toLowerCase() ?? "";
                const icon = button.querySelector(".material-symbols-outlined")?.textContent?.trim();
                return button.dataset.action === "add" || label.includes("add to cart") || /quick add|add to bag/i.test(button.textContent ?? "") || button.textContent?.trim() === "Add" || icon === "add_shopping_cart";
              });
            if (!addButton) return;
            const template = document.createElement("template");
            template.innerHTML = inlineCardCartControls(
              addButton.outerHTML,
              addButton.getBoundingClientRect().height,
              addButton.classList.contains("w-full"),
            );
            controls = template.content.firstElementChild as HTMLElement | null;
            if (!controls) return;
            addButton.replaceWith(controls);
          }
          const count = controls?.querySelector<HTMLElement>("[data-inline-quantity]");
          if (count) count.textContent = String(quantity);
          return;
        }
        if (controls) {
          const template = document.createElement("template");
          template.innerHTML = controls.dataset.originalButton ?? "";
          const originalButton = template.content.firstElementChild;
          if (originalButton) controls.replaceWith(originalButton);
        }
      });
      if (screen !== "catalog") return;
      const visibleCount = cards.filter((card) => !card.hidden).length;
      const countNode = root.querySelector<HTMLElement>("[data-filtered-product-count]");
      if (countNode) countNode.textContent = String(visibleCount);
      const grid = root.querySelector<HTMLElement>("#product-grid");
      let emptyState = root.querySelector<HTMLElement>("[data-category-empty-state]");
      if (grid && visibleCount === 0) {
        if (!emptyState) {
          emptyState = document.createElement("div");
          emptyState.dataset.categoryEmptyState = "true";
          emptyState.className = "col-span-full rounded-xl bg-surface-container p-space-xl text-center text-outline";
          emptyState.textContent = "No pieces match these filters. Try another category or clear your filters.";
          grid.appendChild(emptyState);
        }
        emptyState.hidden = false;
      } else if (emptyState) emptyState.hidden = true;
    };
    const updateProductDetailCart = () => {
      if (screen !== "product") return;
      const product = routeProduct();
      if (!product) return;
      const cartItem = cart.find((item) => item.id === product.id);
      const quantity = cartItem ? cartItem.quantity ?? 1 : 0;
      const quantityValue = root.querySelector<HTMLElement>("#qty-val");
      const quantityPanel = quantityValue?.parentElement?.parentElement?.parentElement;
      let controls = root.querySelector<HTMLElement>("[data-product-cart-controls]");
      if (quantity > 0) {
        if (!controls) {
          const addButton = root.querySelector<HTMLButtonElement>("#add-to-cart-btn");
          if (!addButton) return;
          const height = addButton.getBoundingClientRect().height;
          const template = document.createElement("template");
          template.innerHTML = inlineProductCartControls(addButton.outerHTML, height);
          controls = template.content.firstElementChild as HTMLElement | null;
          if (!controls) return;
          const actionRow = addButton.parentElement;
          addButton.replaceWith(controls);
          const goTemplate = document.createElement("template");
          goTemplate.innerHTML = productGoToCart();
          const goToCart = goTemplate.content.firstElementChild as HTMLAnchorElement | null;
          if (goToCart && actionRow) actionRow.insertAdjacentElement("afterend", goToCart);
        }
        if (quantityPanel instanceof HTMLElement) quantityPanel.hidden = true;
        const count = controls.querySelector<HTMLElement>("[data-product-quantity]");
        if (count) count.textContent = String(quantity);
        return;
      }
      if (controls) {
        const template = document.createElement("template");
        template.innerHTML = controls.dataset.originalButton ?? "";
        const originalButton = template.content.firstElementChild;
        if (originalButton) controls.replaceWith(originalButton);
        root.querySelector("[data-product-go-to-cart]")?.remove();
      }
      if (quantityPanel instanceof HTMLElement) quantityPanel.hidden = false;
    };
    const updateHeaderCounts = () => {
      const cartLink = root.querySelector<HTMLAnchorElement>('a[data-path="cart"]');
      const badge = cartLink?.querySelector<HTMLElement>("span.absolute");
      const count = cart.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
      if (badge) { badge.textContent = String(count); badge.hidden = count === 0; }
      const favoriteLink = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[data-path='shop']"))
        .find((link) => link.querySelector(".material-symbols-outlined")?.textContent?.trim() === "favorite");
      const favoriteBadge = favoriteLink?.querySelector<HTMLElement>("span.absolute");
      if (favoriteBadge) { favoriteBadge.textContent = String(wishlist.length); favoriteBadge.hidden = wishlist.length === 0; }
      syncWishlistButtons(root, wishlist);
    };
    const applyProductDetails = () => {
      if (screen !== "product") return;
      let product: Product | null = null;
      product = routeProduct();
      if (!product) return;
      const title = root.querySelector<HTMLElement>("main h1");
      if (title) title.textContent = product.name;
      const mainImage = root.querySelector<HTMLImageElement>("#main-product-img");
      if (mainImage) { mainImage.src = product.image; mainImage.alt = product.name; }
      root.querySelectorAll<HTMLImageElement>(".thumb-btn img").forEach((image) => { image.src = product!.image; image.alt = product!.name; });
      root.querySelectorAll<HTMLElement>("main span").forEach((node) => {
        if (/^\$349(?:\.00)?$/.test(node.textContent?.trim() ?? "")) node.textContent = money(product!.price);
      });
      const addButton = root.querySelector<HTMLElement>("#add-to-cart-btn");
      if (addButton) addButton.dataset.currentProduct = product.id;
      const description = Array.from(root.querySelectorAll<HTMLElement>("main p"))
        .find((node) => node.textContent?.includes("Signature acoustic reproduction"));
      if (description) description.textContent = product.description;
      const addLabel = root.querySelector<HTMLElement>("#add-to-cart-btn span:last-child");
      if (addLabel) addLabel.textContent = `Add to Cart • ${money(product.price)}`;
      const brandLabel = root.querySelector<HTMLElement>("main .font-label-caps.text-primary-container");
      if (brandLabel && product.brand) brandLabel.textContent = product.brand;
      const text = `${product.name} ${product.description}`;
      const [category, subcategory] = /watch|chronometer|timepiece|monolith dlc/i.test(product.name) ? ["Timepieces", "Chronographs"]
        : /coat|jacket|apparel|outerwear|hoodie|footwear/i.test(text) ? ["Apparel & Outerwear", "Outerwear"]
        : /diffuser|lantern|ceramic|home|object/i.test(text) ? ["Home & Objects", "Objects"]
        : /wallet|backpack|carryall|folio|terminal|interconnect|cable|adapter/i.test(text) ? ["Accessories", "Carry & Utility"]
        : ["Tech & Acoustics", "Audio"];
      const crumbs = Array.from(root.querySelectorAll<HTMLElement>("main a, main nav a"));
      if (crumbs.length > 1) crumbs[1].textContent = category;
      if (crumbs.length > 2) crumbs[2].textContent = subcategory;
      const crumbTitle = root.querySelector<HTMLElement>("main nav span:last-child, main .breadcrumb span:last-child");
      if (crumbTitle) crumbTitle.textContent = product.name;
      const productText = Array.from(root.querySelectorAll<HTMLElement>("main p"))
        .find((node) => node.textContent?.includes("Signature acoustic reproduction"));
      if (productText) productText.textContent = product.description;
      const sku = Array.from(root.querySelectorAll<HTMLElement>("main span, main p"))
        .find((node) => node.textContent?.includes("SKU:"));
      if (sku) sku.textContent = `SKU: ${product.id.toUpperCase().slice(0, 12)}`;
      const saved = wishlist.some((item) => item.id === product.id);
      const favorite = Array.from(root.querySelectorAll<HTMLElement>("main button .material-symbols-outlined"))
        .find((icon) => icon.textContent?.trim() === "favorite");
      if (favorite) {
        favorite.style.fontVariationSettings = saved ? "'FILL' 1" : "'FILL' 0";
        favorite.closest("button")?.classList.toggle("text-primary-container", saved);
        favorite.closest("button")?.setAttribute("aria-label", saved ? "Remove from Wishlist" : "Add to Wishlist");
      }
      root.querySelectorAll<HTMLElement>("main span").forEach((node) => {
        if (node.textContent?.trim() === "$420" || node.textContent?.trim() === "17% Savings") node.hidden = true;
      });
    };
    if (screen === "catalog" && root.dataset.catalogFiltersInitialized !== "true") {
      root.querySelector('button[aria-label="Remove search term"]')?.parentElement?.remove();
      root.querySelectorAll<HTMLInputElement>("aside input[type=checkbox]").forEach((input) => {
        const label = input.closest("label")?.textContent?.trim() ?? "";
        if (/^(NOVA Studio|Bang & Olufsen|Arc'teryx Veilance|Aesop Laboratory|Master & Dynamic)$/i.test(label)) input.checked = false;
      });
      const priceInputs = Array.from(root.querySelectorAll<HTMLInputElement>("aside input[type=number]"));
      const slider = root.querySelector<HTMLInputElement>("#price-slider");
      if (priceInputs[0]) priceInputs[0].value = priceInputs[0].defaultValue || "0";
      if (priceInputs[1]) priceInputs[1].value = priceInputs[1].defaultValue || slider?.max || "1500";
      if (slider && priceInputs[1]) slider.value = String(Math.min(Number(priceInputs[1].value), Number(slider.max)));
      root.dataset.catalogFiltersInitialized = "true";
    }
    const render = () => {
      updateCartDom(); updateWishlistDom(); updateProductCardCart(); updateHeaderCounts(); applyProductDetails(); updateProductDetailCart();
      if (screen === "catalog") runFilters();
    };
    render();

    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const button = target.closest<HTMLButtonElement>("button");
      const link = target.closest<HTMLAnchorElement>("a");
      const card = getCard(target);

      if (screen === "catalog") {
        if (button?.dataset.mobileFilterAction === "open") { openMobileFilterDrawer(); return; }
        if (button?.dataset.mobileFilterAction === "close") { closeMobileFilterDrawer(); return; }
        if (button?.dataset.mobileFilterAction === "clear") { resetCatalogFilters(); return; }
        if (button?.dataset.mobileFilterAction === "apply") { runFilters(); closeMobileFilterDrawer(); return; }
        if (target.closest("[data-mobile-filter-backdrop]")) { closeMobileFilterDrawer(); return; }
      }

      if (link && !button && link.getAttribute("href")?.startsWith("#")) {
        event.preventDefault();
        const label = link.textContent?.trim().toLowerCase() ?? "";
        const icon = link.querySelector(".material-symbols-outlined")?.textContent?.trim();
        if (icon === "share") {
          if (navigator.share) void navigator.share({ title: "NOVA", url: window.location.href });
          else void navigator.clipboard?.writeText(window.location.href);
          showToast(root, "NOVA link ready to share");
          return;
        }
        if (icon === "forum" || icon === "chat") { window.open(`https://wa.me/${WHATSAPP_BUSINESS_PHONE}`, "_blank", "noopener,noreferrer"); return; }
        if (label === "home") { router.push("/"); return; }
        if (label === "catalog" || label.includes("acoustics archive")) { router.push("/catalog"); return; }
        if (label.includes("credit") || label.includes("stripe")) { showToast(root, "Card checkout is not configured. Use WhatsApp Concierge."); return; }
        const product = card ? productFromCard(card) : null;
        if (product) navigateProduct(product);
        else router.push("/catalog");
        return;
      }

      if (link && (link.hasAttribute("data-inline-go-to-cart") || link.hasAttribute("data-product-go-to-cart"))) {
        event.preventDefault();
        router.push("/cart");
        return;
      }

      if (button?.dataset.action === "wishlist" || button?.getAttribute("aria-label")?.toLowerCase().includes("wishlist")) {
        event.preventDefault();
        const product = card ? productFromCard(card) : null;
        const selected = product ?? (screen === "product" ? routeProduct() ?? selectedProduct(root) : null);
        if (selected) { toggleWishlist(selected); showToast(root, wishlist.some((item) => item.id === selected.id) ? "Removed from Wishlist" : "Saved to Wishlist"); }
        return;
      }
      if (button?.querySelector(".material-symbols-outlined")?.textContent?.trim() === "favorite" && screen === "product") {
        const product = routeProduct() ?? selectedProduct(root);
        if (product) { toggleWishlist(product); showToast(root, wishlist.some((item) => item.id === product.id) ? "Removed from Wishlist" : "Saved to Wishlist"); }
        return;
      }
      if (button?.dataset.action === "add" || (button && (/add to cart|quick add/i.test(button.textContent ?? "") || button.getAttribute("aria-label")?.toLowerCase().includes("add to cart") || button.querySelector(".material-symbols-outlined")?.textContent?.trim() === "add_shopping_cart") && !button.id.includes("wishlist"))) {
        event.preventDefault();
        const product = card ? productFromCard(card) : routeProduct() ?? selectedProduct(root);
        if (product && button.id === "add-to-cart-btn") product.quantity = Math.max(1, Number(root.querySelector<HTMLElement>("#qty-val")?.textContent ?? "1"));
        if (product) { addToCart(product); showToast(root, "Added to your bag"); }
        return;
      }
      if (button?.dataset.action === "remove-wishlist") {
        const product = card ? productFromCard(card) : null;
        if (product) toggleWishlist(product);
        return;
      }
      if (button?.dataset.action === "remove" || button?.getAttribute("onclick")?.includes("removeItem")) {
        const row = button.closest<HTMLElement>("[data-cart-id]");
        const id = row?.dataset.cartId;
        if (id) removeFromCart(id);
        return;
      }
      if (button?.dataset.action === "product-increase" || button?.dataset.action === "product-decrease") {
        const product = routeProduct();
        const item = product ? cart.find((entry) => entry.id === product.id) : null;
        if (item) {
          const nextQuantity = (item.quantity ?? 1) + (button.dataset.action === "product-increase" ? 1 : -1);
          if (nextQuantity <= 0) removeFromCart(item.id);
          else setQuantity(item.id, nextQuantity);
        }
        return;
      }
      if (button?.dataset.action === "card-increase" || button?.dataset.action === "card-decrease") {
        const card = button.closest<HTMLElement>("[data-product-id], article, .group");
        const product = card ? productFromCard(card) : null;
        const item = product ? cart.find((entry) => entry.id === product.id) : null;
        if (item) {
          const nextQuantity = (item.quantity ?? 1) + (button.dataset.action === "card-increase" ? 1 : -1);
          if (nextQuantity <= 0) removeFromCart(item.id);
          else setQuantity(item.id, nextQuantity);
        }
        return;
      }
      if (button?.dataset.action === "increase" || button?.dataset.action === "decrease") {
        const row = button.closest<HTMLElement>("[data-cart-id]");
        const item = cart.find((entry) => entry.id === row?.dataset.cartId);
        if (item) {
          const nextQuantity = (item.quantity ?? 1) + (button.dataset.action === "increase" ? 1 : -1);
          if (nextQuantity <= 0) removeFromCart(item.id);
          else setQuantity(item.id, nextQuantity);
        }
        return;
      }
      if (button?.id === "add-to-cart-btn") {
        const product = routeProduct() ?? selectedProduct(root);
        if (product) { addToCart(product); showToast(root, "Allocation secured in your bag"); }
        return;
      }
      if (button && (button.textContent?.trim() === "+" || button.textContent?.trim() === "−" || button.textContent?.trim() === "-")) {
        const quantity = root.querySelector<HTMLElement>("#qty-val");
        if (quantity) quantity.textContent = String(Math.max(1, Math.min(7, Number(quantity.textContent ?? "1") + (button.textContent.trim() === "+" ? 1 : -1))));
        return;
      }
      if (button?.id.startsWith("thumb-")) {
        const index = Number(button.id.split("-").at(-1));
        const image = button.querySelector<HTMLImageElement>("img");
        const mainImage = root.querySelector<HTMLImageElement>("#main-product-img");
        if (image && mainImage) mainImage.src = image.src;
        root.querySelectorAll(".thumb-btn").forEach((thumb, i) => { thumb.classList.toggle("opacity-60", i !== index); thumb.classList.toggle("ring-2", i === index); thumb.classList.toggle("ring-primary-container", i === index); });
        return;
      }
      if (button?.classList.contains("color-swatch-card")) {
        root.querySelectorAll(".color-swatch-card").forEach((item) => item.classList.remove("ring-2", "ring-primary-container"));
        button.classList.add("ring-2", "ring-primary-container");
        const name = root.querySelector<HTMLElement>("#selected-color-name");
        if (name) name.textContent = button.textContent?.trim() ?? "";
        return;
      }
      if (screen === "catalog" && button?.closest("aside") && ["Obsidian", "Chalk", "Amber", "Slate"].includes(button.title)) {
        const aside = button.closest<HTMLElement>("aside");
        if (aside?.dataset.selectedColor === button.title) delete aside.dataset.selectedColor;
        else if (aside) aside.dataset.selectedColor = button.title;
        root.querySelectorAll("aside button[title]").forEach((swatch) => {
          const selected = swatch === button && aside?.dataset.selectedColor === button.title;
          swatch.classList.toggle("ring-2", selected);
          swatch.classList.toggle("ring-primary-container", selected);
        });
        runFilters();
        return;
      }
      if (button?.classList.contains("cushion-pill")) {
        root.querySelectorAll(".cushion-pill").forEach((item) => item.classList.remove("ring-1", "ring-primary-container"));
        button.classList.add("ring-1", "ring-primary-container");
        return;
      }
      if (button?.id.startsWith("tab-btn-")) {
        const tab = button.id.replace("tab-btn-", "");
        root.querySelectorAll("[id^='tab-content-']").forEach((panel) => panel.classList.toggle("hidden", panel.id !== `tab-content-${tab}`));
        root.querySelectorAll("[id^='tab-btn-']").forEach((item) => {
          item.classList.toggle("bg-primary-container", item.id === button.id);
          item.classList.toggle("text-on-primary-container", item.id === button.id);
          item.classList.toggle("font-bold", item.id === button.id);
        });
        return;
      }
      if (button?.id.includes("wishlist") || button?.getAttribute("aria-label")?.toLowerCase().includes("wishlist")) {
        router.push("/wishlist");
        return;
      }
      if (screen === "catalog" && button?.dataset.removeFilter) {
        const filter = button.dataset.removeFilter;
        const value = button.dataset.filterValue ?? "";
        if (filter === "category") {
          root.querySelectorAll("[data-active-category]").forEach((item) => item.removeAttribute("data-active-category"));
          const url = new URL(window.location.href);
          url.searchParams.delete("category");
          window.history.replaceState(null, "", url);
        } else if (filter === "brand") {
          root.querySelectorAll<HTMLInputElement>("aside input[type=checkbox]").forEach((input) => {
            if ((input.closest("label")?.textContent?.trim() ?? "").toLocaleLowerCase() === value.toLocaleLowerCase()) input.checked = false;
          });
        } else if (filter === "price") {
          const prices = Array.from(root.querySelectorAll<HTMLInputElement>("aside input[type=number]"));
          if (prices[0]) prices[0].value = prices[0].defaultValue || "0";
          if (prices[1]) prices[1].value = prices[1].defaultValue || "1500";
          const slider = root.querySelector<HTMLInputElement>("#price-slider");
          if (slider) slider.value = String(Math.min(Number(prices[1]?.value ?? slider.max), Number(slider.max)));
        } else if (filter === "color") {
          root.querySelectorAll<HTMLElement>("aside[data-selected-color]").forEach((aside) => delete aside.dataset.selectedColor);
          root.querySelectorAll("aside button[title]").forEach((swatch) => swatch.classList.remove("ring-2", "ring-primary-container"));
        } else if (filter === "search") {
          root.querySelectorAll<HTMLInputElement>('input[placeholder*="Search"]').forEach((input) => { input.value = ""; });
        }
        runFilters();
        return;
      }
      if (button?.id === "reset-filters") {
        resetCatalogFilters();
        return;
      }
      if (button?.textContent?.trim().toLowerCase() === "clear all") {
        resetCatalogFilters();
        return;
      }
      const pricePreset = button?.textContent?.trim();
      if (screen === "catalog" && ["Under $250", "$250 - $750", "$750+"].includes(pricePreset ?? "")) {
        const prices = Array.from(root.querySelectorAll<HTMLInputElement>("aside input[type=number]"));
        const slider = root.querySelector<HTMLInputElement>("#price-slider");
        const bounds = pricePreset === "Under $250" ? [0, 250] : pricePreset === "$250 - $750" ? [250, 750] : [750, Number(slider?.max ?? prices[1]?.max ?? 1500)];
        if (prices[0]) prices[0].value = String(bounds[0]);
        if (prices[1]) prices[1].value = String(bounds[1]);
        if (slider) slider.value = String(Math.min(bounds[1], Number(slider.max)));
        runFilters();
        return;
      }
      if (button?.textContent?.trim() === "Apply Filter Selection") { runFilters(); closeMobileFilterDrawer(); showToast(root, "Vault filters applied"); return; }
      if (screen === "catalog" && button?.id === "load-more-btn") {
        event.preventDefault();
        catalogVisibleLimit += catalogPageSize;
        root.dataset.catalogVisibleLimit = String(catalogVisibleLimit);
        runFilters();
        return;
      }
      if (button?.querySelector(".material-symbols-outlined")?.textContent?.trim() === "close") {
        const filter = button.getAttribute("aria-label")?.toLowerCase() ?? "";
        if (filter.includes("audio")) root.querySelectorAll("[data-active-category]").forEach((item) => item.removeAttribute("data-active-category"));
        if (filter.includes("brand")) root.querySelectorAll<HTMLInputElement>("aside input[type=checkbox]").forEach((input) => { if (/nova studio/i.test(input.closest("label")?.textContent ?? "")) input.checked = false; });
        if (filter.includes("price")) { const slider = root.querySelector<HTMLInputElement>("#price-slider"); if (slider) slider.value = slider.max; }
        const chip = button.closest(".bg-surface-container-high, .bg-surface-container");
        if (chip && !chip.closest("#product-grid")) chip.remove();
        runFilters();
        return;
      }
      if (button?.getAttribute("aria-label") === "Remove search term") {
        const search = root.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
        if (search) search.value = "";
        runFilters();
        return;
      }
      if (button?.textContent?.trim() === "Unlock Terminal") { router.push("/catalog"); return; }
      if (button && ["All Disciplines", "Audio", "Apparel", "Objects"].includes(button.textContent?.trim() ?? "")) {
        const filter = button.textContent?.trim() ?? "All Disciplines";
        const productCards = root.querySelectorAll<HTMLElement>("article, a.group, div.group");
        productCards.forEach((item) => {
          if (!productFromCard(item)) return;
          const text = item.textContent?.toLowerCase() ?? "";
          item.hidden = filter !== "All Disciplines" && !(filter === "Audio" ? /audio|acoustic|speaker|headphone|dac|earbud|turntable/.test(text) : filter === "Apparel" ? /apparel|coat|trench|hoodie|wear|footwear/.test(text) : /object|living|lantern|ceramic|craft|home/.test(text));
        });
        return;
      }
      if (button?.textContent?.trim() === "Apply") {
        const code = root.querySelector<HTMLInputElement>("#coupon-field")?.value.trim().toUpperCase();
        setCouponApplied(code === "NOVA50");
        showToast(root, code === "NOVA50" ? "$50 Welcome Voucher Applied" : "Invalid or expired allocation token");
        return;
      }
      if (button?.id === "verify-pin" || button?.textContent?.trim() === "Verify") {
        const pin = root.querySelector<HTMLInputElement>("#pincode-input")?.value.trim() ?? "";
        const status = root.querySelector<HTMLElement>("#delivery-status");
        if (status) status.textContent = pin.length >= 4 ? `Priority route active for ${pin}: delivery by Thursday, Oct 24 • Express Air` : "Please provide a valid postal code to calculate logistics routing.";
        return;
      }
      if (button?.textContent?.trim().toLowerCase() === "join") {
        const email = root.querySelector<HTMLInputElement>('input[type="email"]')?.value.trim();
        showToast(root, email ? "You’re on the private dispatch list" : "Enter your email to join the private dispatch");
        return;
      }
      if (button && (button.textContent?.includes("WhatsApp") || button.textContent?.includes("1-Click"))) {
        event.preventDefault();
        const oneClick = button.textContent.includes("1-Click");
        let checkoutCart = getLatestCart();
        if (oneClick) {
          const product = routeProduct() ?? selectedProduct(root);
          if (product) {
            product.quantity = Math.max(1, Number(root.querySelector<HTMLElement>("#qty-val")?.textContent ?? "1"));
            addToCart(product);
            checkoutCart = getLatestCart();
          }
        }
        if (!checkoutCart.length) { showToast(root, "Add a piece to your bag before checkout"); return; }
        const invalidProduct = checkoutCart.find((item) =>
          typeof item.name !== "string" || !item.name.trim() ||
          typeof item.price !== "number" || !Number.isFinite(item.price) || item.price < 0 ||
          (item.quantity !== undefined && (!Number.isInteger(item.quantity) || item.quantity < 1))
        );
        if (invalidProduct) {
          console.error("[NOVA WhatsApp checkout] Invalid cart product:", invalidProduct);
          showToast(root, "A cart item has invalid product details. Please remove it and add it again.");
          return;
        }
        let order: ReturnType<typeof buildWhatsAppOrder>;
        try {
          order = buildWhatsAppOrder(checkoutCart, couponApplied);
        } catch (error) {
          console.error("[NOVA WhatsApp checkout] Could not build order message:", error);
          showToast(root, "Unable to prepare your order message. Please try again.");
          return;
        }
        const { encodedMessage, url: whatsappUrl } = buildWhatsAppUrl(order.message, isMobileBrowser());
        if (process.env.NODE_ENV === "development") {
          console.log("[NOVA WhatsApp checkout] Cart data:", checkoutCart);
          console.log("[NOVA WhatsApp checkout] Message:", order.message);
          console.log("[NOVA WhatsApp checkout] Encoded message:", encodedMessage);
          console.log("[NOVA WhatsApp checkout] URL:", whatsappUrl);
        }
        window.open(whatsappUrl, "_blank", "noopener,noreferrer");
        return;
      }
      if (button?.querySelector(".material-symbols-outlined")?.textContent?.trim() === "zoom_in") {
        const image = root.querySelector<HTMLImageElement>("#main-product-img");
        if (image) { image.classList.toggle("scale-125"); image.classList.toggle("cursor-zoom-out"); }
        return;
      }
      if (button?.textContent?.trim() === "Submit Consignment Review") {
        showToast(root, "Thank you. Your review was submitted for verification.");
        return;
      }
      if (button && /share/i.test(button.querySelector(".material-symbols-outlined")?.textContent ?? "")) {
        if (navigator.share) void navigator.share({ title: "NOVA", url: window.location.href });
        else void navigator.clipboard?.writeText(window.location.href);
        return;
      }

      if (card && !button && !link) {
        const product = productFromCard(card);
        if (product) navigateProduct(product);
      }
    };

    const input = (event: Event) => {
      const target = event.target;
      if (screen !== "catalog" || !(target instanceof HTMLInputElement)) return;
      if (target.id === "price-slider") {
        const numberInputs = Array.from(root.querySelectorAll<HTMLInputElement>("aside input[type=number]"));
        if (numberInputs[1]) numberInputs[1].value = target.value;
        if (numberInputs[0] && Number(numberInputs[0].value) > Number(target.value)) numberInputs[0].value = target.value;
        const priceLabel = root.querySelector<HTMLElement>("#price-label");
        const minValue = Number(numberInputs[0]?.value ?? 0);
        if (priceLabel) priceLabel.textContent = `$${minValue.toLocaleString("en-US")} - $${Number(target.value).toLocaleString("en-US")}`;
        runFilters();
        return;
      }
      if (target.type === "number" && target.closest("aside")) {
        const prices = Array.from(root.querySelectorAll<HTMLInputElement>("aside input[type=number]"));
        if (prices[0] && prices[1] && Number(prices[0].value) > Number(prices[1].value)) {
          if (target === prices[0]) prices[1].value = prices[0].value;
          else prices[0].value = prices[1].value;
        }
        const slider = root.querySelector<HTMLInputElement>("#price-slider");
        if (slider && prices[1]) slider.value = String(Math.min(Number(prices[1].value), Number(slider.max)));
        runFilters();
        return;
      }
      if (target.placeholder.toLowerCase().includes("search")) runFilters();
    };
    const change = (event: Event) => {
      if (screen === "catalog" && (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement)) runFilters();
    };
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.id === "checkout-form") {
        event.preventDefault();
        root.querySelector<HTMLButtonElement>('button[data-checkout]')?.click();
      } else if (form instanceof HTMLFormElement) {
        event.preventDefault();
        showToast(root, "Thanks for joining the NOVA private dispatch");
      }
    };
    const category = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const label = target.closest("aside label, aside button");
      if (!label || label.querySelector("input")) return;
      const text = label.textContent?.trim().replace(/\d+$/, "").trim() ?? "";
      const aside = label.closest("aside");
      if (!aside || !text) return;
      const prior = aside.querySelector<HTMLElement>("[data-active-category]");
      const id = categorySlug(text);
      const clearingCategory = prior?.dataset.categoryId === id;
      if (clearingCategory) { prior?.removeAttribute("data-active-category"); if (prior) delete prior.dataset.categoryId; }
      else { prior?.removeAttribute("data-active-category"); if (prior) delete prior.dataset.categoryId; (label as HTMLElement).dataset.activeCategory = text; (label as HTMLElement).dataset.categoryId = id; }
      const url = new URL(window.location.href);
      if (clearingCategory || !id) url.searchParams.delete("category");
      else url.searchParams.set("category", id);
      window.history.replaceState(null, "", url);
      runFilters();
    };
    const escapeFilterDrawer = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileFilterDrawer();
    };

    root.addEventListener("click", click);
    root.addEventListener("input", input);
    root.addEventListener("change", change);
    root.addEventListener("submit", submit);
    root.addEventListener("click", category, true);
    window.addEventListener("keydown", escapeFilterDrawer);
    return () => {
      headerObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", escapeFilterDrawer);
      root.removeEventListener("click", click); root.removeEventListener("input", input);
      root.removeEventListener("change", change); root.removeEventListener("submit", submit);
      root.removeEventListener("click", category, true);
    };
  }, [screen, slug, catalogHtml, cart, wishlist, ready, couponApplied, router, addToCart, removeFromCart, setQuantity, toggleWishlist]);

  useEffect(() => {
    const root = document.getElementById("nova-screen");
    if (!root) return;
    const cartCount = cart.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
    const badge = root.querySelector<HTMLElement>('a[data-path="cart"] span.absolute');
    if (badge) { badge.textContent = String(cartCount); badge.hidden = cartCount === 0; }
    const updateRows = () => {
      if (screen !== "cart" || !ready) return;
      const first = root.querySelector<HTMLElement>("#cart-item-1, #cart-item-2");
      const panel = first?.closest<HTMLElement>(".bg-surface-container-low.rounded-xl")
        ?? root.querySelector<HTMLElement>("#coupon-field")?.closest<HTMLElement>(".bg-surface-container-low.rounded-xl");
      if (!panel) return;
      panel.querySelectorAll("#cart-item-1, #cart-item-2").forEach((row) => row.remove());
      let list = panel.querySelector<HTMLElement>("[data-cart-dynamic-items]");
      if (!list) {
        list = document.createElement("div"); list.dataset.cartDynamicItems = "true"; list.className = "flex flex-col gap-space-md";
        const coupon = panel.querySelector<HTMLElement>("#coupon-field")?.closest<HTMLElement>(".bg-surface-container-lowest.p-space-md.rounded-xl");
        if (coupon) panel.insertBefore(list, coupon); else panel.appendChild(list);
      }
      list.innerHTML = cart.length ? cart.map(cartRow).join("") : `<div class="rounded-xl bg-surface-container p-space-xl text-center"><span class="material-symbols-outlined text-4xl text-primary-container">shopping_bag</span><h3 class="font-headline-md text-headline-md mt-space-sm">Your bag is waiting</h3><p class="font-body-md text-body-md text-outline mt-space-xs">Explore the collection and add a piece to your curation.</p><a href="/catalog" class="inline-flex mt-space-md bg-primary-container text-on-primary-container font-label-lg text-label-lg px-space-lg py-space-sm rounded-lg">Explore the Collection</a></div>`;
      const subtotal = cart.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0);
      const total = Math.max(0, subtotal - (couponApplied && subtotal ? 50 : 0));
      const totalEl = root.querySelector<HTMLElement>("#summary-total"); if (totalEl) totalEl.textContent = money(total);
      const heading = root.querySelector("main h1 span"); if (heading) heading.textContent = `(${cartCount} Items)`;
      const subtotalRow = Array.from(root.querySelectorAll<HTMLElement>("div.flex.items-center.justify-between")).find((row) => row.textContent?.trim().startsWith("Subtotal"));
      const spans = subtotalRow?.querySelectorAll("span"); if (spans?.[0]) spans[0].textContent = `Subtotal (${cartCount} items)`; if (spans?.[1]) spans[1].textContent = money(subtotal);
      const checkout = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.dataset.checkout || button.textContent?.includes("Place Order via WhatsApp"));
      if (checkout) {
        checkout.dataset.checkout = "true";
        checkout.disabled = cart.length === 0;
        checkout.setAttribute("aria-disabled", String(cart.length === 0));
        checkout.classList.toggle("opacity-50", cart.length === 0);
        checkout.classList.toggle("cursor-not-allowed", cart.length === 0);
        checkout.innerHTML = `<span class="material-symbols-outlined">chat</span> Place Order via WhatsApp • ${money(total)}`;
        ensureStickyCheckout(root, checkout, total);
      }
    };
    const updateWishlist = () => {
      if (screen !== "wishlist" || !ready) return;
      const grid = root.querySelector<HTMLElement>("#product-grid"); if (!grid) return;
      grid.innerHTML = wishlist.length ? wishlist.map((item) => cardMarkup(item, true)).join("") : `<div class="col-span-full rounded-xl bg-surface-container-low p-space-2xl text-center"><span class="material-symbols-outlined text-4xl text-primary-container">favorite</span><h2 class="font-headline-md text-headline-md mt-space-sm">No saved pieces yet</h2><p class="font-body-md text-body-md text-outline mt-space-xs">Tap the heart on a piece to keep it close.</p><a href="/catalog" class="inline-flex mt-space-md bg-primary-container text-on-primary-container font-label-lg text-label-lg px-space-lg py-space-sm rounded-lg">Explore the Collection</a></div>`;
    };
    updateRows(); updateWishlist();
    const favoriteLink = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[data-path='shop']"))
      .find((link) => link.querySelector(".material-symbols-outlined")?.textContent?.trim() === "favorite");
    const favoriteBadge = favoriteLink?.querySelector<HTMLElement>("span.absolute");
    if (favoriteBadge) { favoriteBadge.textContent = String(wishlist.length); favoriteBadge.hidden = wishlist.length === 0; }
    syncWishlistButtons(root, wishlist);
  }, [screen, cart, wishlist, ready, couponApplied]);

  return <div id="nova-screen" className="bg-surface text-on-surface antialiased" dangerouslySetInnerHTML={{ __html: markup }} />;
}
