"use client";

import { useSyncExternalStore } from "react";

export type Product = {
  id: string;
  name: string;
  price: number;
  image: string;
  description: string;
  brand?: string;
  category?: string;
  rating?: number;
  isOnSale?: boolean;
  isLimited?: boolean;
  available?: boolean;
  quantity?: number;
};

type Snapshot = { cart: Product[]; wishlist: Product[]; ready: boolean };
type ShoppingState = Snapshot & {
  addToCart: (product: Product) => void;
  removeFromCart: (id: string) => void;
  setQuantity: (id: string, quantity: number) => void;
  toggleWishlist: (product: Product) => void;
};

const CART_KEY = "nova:cart:v1";
const WISHLIST_KEY = "nova:wishlist:v1";
const serverSnapshot: Snapshot = { cart: [], wishlist: [], ready: false };
let snapshot: Snapshot = serverSnapshot;
let hydrated = false;
const listeners = new Set<() => void>();

function readProducts(key: string): Product[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is Product => Boolean(item && typeof item.id === "string" && typeof item.name === "string"))
      : [];
  } catch { return []; }
}

function hydrateFromStorage() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  snapshot = { cart: readProducts(CART_KEY), wishlist: readProducts(WISHLIST_KEY), ready: true };
}

function emit() { listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CART_KEY && event.key !== WISHLIST_KEY && event.key !== null) return;
    snapshot = { cart: readProducts(CART_KEY), wishlist: readProducts(WISHLIST_KEY), ready: true };
    hydrated = true;
    emit();
  };
  window.addEventListener("storage", onStorage);
  hydrateFromStorage();
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

function getSnapshot() { hydrateFromStorage(); return snapshot; }
function getServerSnapshot() { return serverSnapshot; }
export function getLatestCart(): Product[] {
  hydrateFromStorage();
  const cart = readProducts(CART_KEY);
  snapshot = { ...snapshot, cart, ready: true };
  hydrated = true;
  return cart;
}
function save(next: Snapshot) {
  snapshot = next;
  hydrated = true;
  localStorage.setItem(CART_KEY, JSON.stringify(next.cart));
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(next.wishlist));
  emit();
}

function addToCart(product: Product) {
  hydrateFromStorage();
  const amount = product.quantity ?? 1;
  const existing = snapshot.cart.find((item) => item.id === product.id);
  const cart = existing
    ? snapshot.cart.map((item) => item.id === product.id ? { ...item, quantity: (item.quantity ?? 1) + amount } : item)
    : [...snapshot.cart, { ...product, quantity: amount }];
  save({ ...snapshot, cart, ready: true });
}

function removeFromCart(id: string) { save({ ...snapshot, cart: snapshot.cart.filter((item) => item.id !== id), ready: true }); }
function setQuantity(id: string, quantity: number) {
  save({ ...snapshot, cart: snapshot.cart.map((item) => item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item), ready: true });
}
function toggleWishlist(product: Product) {
  const exists = snapshot.wishlist.some((item) => item.id === product.id);
  const wishlist = exists ? snapshot.wishlist.filter((item) => item.id !== product.id) : [...snapshot.wishlist, product];
  save({ ...snapshot, wishlist, ready: true });
}

export function StoreProvider({ children }: { children: React.ReactNode }) { return children; }

export function useShoppingState(): ShoppingState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...state, addToCart, removeFromCart, setQuantity, toggleWishlist };
}
