import StitchScreen from "./stitch-screen";
import { getScreenMarkup } from "./screen-source";

export default function HomePage() {
  return <StitchScreen html={getScreenMarkup("home")} screen="home" />;
}
