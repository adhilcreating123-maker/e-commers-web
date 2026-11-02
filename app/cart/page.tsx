import StitchScreen from "../stitch-screen";
import { getScreenMarkup } from "../screen-source";

export default function CartPage() {
  return <StitchScreen html={getScreenMarkup("cart")} screen="cart" />;
}
