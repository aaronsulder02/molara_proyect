import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Molara — Tu consultorio dental agenda solo por WhatsApp", template: "%s · Molara" },
  description:
    "Asistente inteligente para consultorios odontológicos: agenda, confirma y recuerda citas por WhatsApp con la API oficial de Meta, agenda web, bandeja compartida y métricas de Instagram.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  openGraph: { title: "Molara", description: "Recepción inteligente por WhatsApp para consultorios dentales", type: "website", locale: "es_CL" },
};

export const viewport: Viewport = { themeColor: "#0E9F8E" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
