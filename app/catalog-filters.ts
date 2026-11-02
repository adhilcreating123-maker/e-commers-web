export type CatalogFilterItem = {
  id: string;
  name: string;
  brand?: string;
  description: string;
  imageDescription: string;
  category?: string;
  price: number;
  rating?: number;
  isNewArrival: boolean;
  isLimited: boolean;
  isOnSale: boolean;
  originalOrder: number;
};

export type CatalogFilterState = {
  category: string;
  brands: string[];
  minPrice: number;
  maxPrice: number;
  search: string;
  color: string;
  sort: string;
};

export function filterCatalogItems(items: readonly CatalogFilterItem[], filters: CatalogFilterState) {
  const search = filters.search.trim().toLocaleLowerCase();
  const brands = filters.brands.map((brand) => brand.trim().toLocaleLowerCase()).filter(Boolean);
  const category = filters.category.trim().toLocaleLowerCase();
  const color = filters.color.trim().toLocaleLowerCase();

  const filtered = items.filter((item) => {
    const matchesCategory = !category || category === "all" ||
      (category === "new-arrivals" ? item.isNewArrival :
        category === "limited-drops" ? item.isLimited :
          category === "sale" ? item.isOnSale : item.category === category);
    const matchesBrand = !brands.length || brands.some((brand) => (item.brand ?? "").toLocaleLowerCase() === brand);
    const matchesPrice = item.price >= filters.minPrice && item.price <= filters.maxPrice;
    const matchesSearch = !search || `${item.name} ${item.brand ?? ""} ${item.description} ${item.imageDescription}`.toLocaleLowerCase().includes(search);
    const imageText = `${item.imageDescription} ${item.name}`.toLocaleLowerCase();
    const matchesColor = !color ||
      (color === "obsidian" ? /black|dark|obsidian/.test(imageText) :
        color === "chalk" ? /white|silver|chalk/.test(imageText) :
          color === "amber" || color === "amber gold" ? /amber|gold|bronze/.test(imageText) :
            /slate|grey|gray|titanium/.test(imageText));

    return matchesCategory && matchesBrand && matchesPrice && matchesSearch && matchesColor;
  });

  return filtered.sort((a, b) => {
    if (filters.sort === "price-asc") return a.price - b.price || a.originalOrder - b.originalOrder;
    if (filters.sort === "price-desc") return b.price - a.price || a.originalOrder - b.originalOrder;
    if (filters.sort === "newest") return Number(b.isNewArrival) - Number(a.isNewArrival) || b.originalOrder - a.originalOrder;
    if (filters.sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0) || a.originalOrder - b.originalOrder;
    return a.originalOrder - b.originalOrder;
  });
}
