import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "Royal Fitness — Check-in",
  description: "Member check-in and check-out",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Royal Fitness Check-in",
  },
}

export const viewport: Viewport = {
  themeColor: "#D11F00",
  width: "device-width",
  initialScale: 1,
}

export default function CheckinLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
