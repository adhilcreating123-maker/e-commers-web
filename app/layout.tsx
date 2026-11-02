import type { Metadata } from "next";
import { StoreProvider } from "./store";
import "./globals.css";

export const metadata: Metadata = {
  title: "NOVA — Everything, Elevated.",
  description: "A curated marketplace for elevated design, audio, and collector pieces.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="bg-[#131313] text-[#e5e2e1] antialiased">
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
