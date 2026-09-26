import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "KidChore — Việc nhà cho gia đình",
    template: "%s",
  },
  description:
    "Ứng dụng giao việc nhà, theo dõi thói quen và thưởng điểm cho trẻ trong gia đình.",
  applicationName: "KidChore",
  // Children share family tablets, so search engines should never index the app.
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "KidChore",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the layout own safe-area padding rather than zooming on rotate.
  maximumScale: 5,
  themeColor: "#7c3aed",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
