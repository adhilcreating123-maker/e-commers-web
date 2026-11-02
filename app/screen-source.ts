import { readFileSync } from "node:fs";
import path from "node:path";

const screenFiles = {
  home: "home_page/code.html",
  catalog: "shopping_catalog/code.html",
  product: "product_details/code.html",
  cart: "cart_and_whatsapp_checkout/code.html",
} as const;

function getAssetManifest() {
  const manifestPath = path.join(process.cwd(), "public", "stitch-assets", "manifest.json");
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")) as Record<string, string>;
  } catch { return {}; }
}

export type ScreenName = keyof typeof screenFiles | "wishlist";

export function getScreenMarkup(screen: Exclude<ScreenName, "wishlist">) {
  const filename = path.join(process.cwd(), "stitch_nova_e_commerce_ui_design", "stitch_nova_e_commerce_ui_design", screenFiles[screen]);
  const document = readFileSync(filename, "utf8");
  const body = document.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];

  if (!body) throw new Error(`Could not find the ${screen} Stitch screen body.`);

  let markup = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on[a-z]+=(?:"[^"]*"|'[^']*')/gi, "");
  // The supplied Stitch files reference a protected Google-hosted logo that is
  // not included in the assets bundle. Keep the original NOVA wordmark text.
  markup = markup.replace(/<img\b(?=[^>]*\balt="NOVA Brand Logo")[^>]*>/gi, "");
  markup = markup.replace(/<input\b[^>]*>/gi, (input) =>
    /\btype="email"/i.test(input) ? input.replace(/\bclass="([^"]*)"/i, (_match, classes: string) => `class="${classes} min-w-0"`) : input,
  );
  for (const [remote, local] of Object.entries(getAssetManifest())) markup = markup.split(remote).join(local);
  return markup;
}

