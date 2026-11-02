import StitchScreen from "../../stitch-screen";
import { getScreenMarkup } from "../../screen-source";

export const instant = false;

export default async function ProductPage({ params }: PageProps<"/product/[slug]">) {
  const { slug } = await params;
  return <StitchScreen html={getScreenMarkup("product")} catalogHtml={getScreenMarkup("catalog")} screen="product" slug={slug} />;
}
