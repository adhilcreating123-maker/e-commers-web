import StitchScreen from "../stitch-screen";
import { getScreenMarkup } from "../screen-source";

export default function WishlistPage() {
  return <StitchScreen html={getScreenMarkup("catalog")} screen="wishlist" />;
}
