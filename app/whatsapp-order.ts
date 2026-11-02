type CheckoutProduct = {
  name: string;
  price: number;
  quantity?: number;
};

export const WHATSAPP_BUSINESS_PHONE = "917907314512";
const formatPrice = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildWhatsAppOrder(items: readonly CheckoutProduct[], couponApplied: boolean) {
  if (!items.length) throw new Error("The cart is empty.");

  for (const item of items) {
    if (!item.name.trim() || !Number.isFinite(item.price) || item.price < 0) {
      throw new Error("A cart item has an invalid name or price.");
    }
    if (item.quantity !== undefined && (!Number.isInteger(item.quantity) || item.quantity < 1)) {
      throw new Error("A cart item has an invalid quantity.");
    }
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0);
  const discount = couponApplied && subtotal ? Math.min(50, subtotal) : 0;
  const total = Math.max(0, subtotal - discount);
  const lines = items.map((item) => {
    const quantity = item.quantity ?? 1;
    return `Product: ${item.name}\nQuantity: ${quantity}\nUnit Price: ${formatPrice(item.price)}\nTotal: ${formatPrice(item.price * quantity)}`;
  }).join("\n\n");
  const message = `NEW ORDER REQUEST\n\n${lines}\n\nSubtotal: ${formatPrice(subtotal)}${discount ? `\nDiscount: -${formatPrice(discount)}` : ""}\nGrand Total: ${formatPrice(total)}\n\nPlease confirm my order.`;

  return { message, subtotal, discount, total };
}

export function buildWhatsAppUrl(message: string, isMobile: boolean) {
  const encodedMessage = encodeURIComponent(message);
  const url = isMobile
    ? `https://wa.me/${WHATSAPP_BUSINESS_PHONE}?text=${encodedMessage}`
    : `https://web.whatsapp.com/send?phone=${WHATSAPP_BUSINESS_PHONE}&text=${encodedMessage}`;

  return { encodedMessage, url };
}
