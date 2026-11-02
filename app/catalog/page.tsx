import StitchScreen from "../stitch-screen";
import { getScreenMarkup } from "../screen-source";

export default function CatalogPage() {
  return <StitchScreen html={getScreenMarkup("catalog")} screen="catalog" />;
}
