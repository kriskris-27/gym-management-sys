import { type ReactNode } from "react"

/**
 * Tablet-first admin content: comfortable padding from md up; mobile clears the fixed menu + notches.
 * max-w keeps ultra-wide desktops readable; mx-auto centers on laptop.
 */
export const adminPageShellClass =
  "w-full min-h-dvh max-w-[min(100%,1920px)] mx-auto bg-[#080808] text-white font-sans selection:bg-[#D11F00]/30 overflow-x-hidden px-4 pt-[max(4.5rem,calc(env(safe-area-inset-top)+2.75rem))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-5 md:px-6 md:pt-8 lg:px-8 lg:pt-10 xl:px-12"

export const adminPageLoadingClass =
  "w-full min-h-dvh max-w-[min(100%,1920px)] mx-auto bg-[#080808] text-white flex flex-col items-center justify-center gap-3 px-4 pt-[max(4.5rem,calc(env(safe-area-inset-top)+2.75rem))] pb-[max(2rem,env(safe-area-inset-bottom))] md:pt-8"

export function AdminPageShell({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`${adminPageShellClass} ${className}`.trim()}>{children}</div>
}
