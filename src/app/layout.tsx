import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const openSans = localFont({
  src: "../../public/fonts/OpenSans-Variable.ttf",
  variable: "--font-open-sans",
  weight: "300 800",
  style: "normal",
  display: "swap",
});
export const metadata: Metadata = {
  title: "Ритм — трекер привычек",
  description:
    "Печатные трекеры привычек, распознавание отметок и история выполнения.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={openSans.variable}>
      <body>{children}</body>
    </html>
  );
}
