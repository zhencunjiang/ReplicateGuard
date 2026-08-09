import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReplicateGuard — single-cell design preflight",
  description:
    "Audit biological replication, pairing, batch confounding and contrast estimability before single-cell differential expression.",
  openGraph: {
    title: "ReplicateGuard — single-cell design preflight",
    description:
      "Do not mistake cell counts for biological replication. Audit the design before single-cell differential expression.",
    images: [
      {
        url: "/replicateguard-social.png",
        width: 1731,
        height: 909,
        alt: "Cell observations grouped into biological samples",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/replicateguard-social.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
