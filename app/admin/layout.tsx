"use client"

import { usePathname, useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"

const navItems = [
  { name: "Dashboard", path: "/admin/dashboard", icon: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  )},
  { name: "Members", path: "/admin/members", icon: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )},
  { name: "Attendance", path: "/admin/attendance", icon: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )},
  { name: "Payments", path: "/admin/payments", icon: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  )},
  { name: "Reports", path: "/admin/reports", icon: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )},
  { name: "Settings", path: "/admin/settings", icon: (color: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )},
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [showIntro, setShowIntro] = useState(false)

  // Auth Guard: Verify still logged in
  useEffect(() => {
    let mounted = true
    
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/dashboard/summary", { credentials: 'include' })
        if (!res.ok && mounted) {
          console.log('Auth check failed, redirecting to login')
          router.push("/login")
        }
      } catch (error) {
        console.error('Auth check error:', error)
        if (mounted) {
          router.push("/login")
        }
      } finally {
        if (mounted) {
          setAuthChecked(true)
        }
      }
    }
    
    checkAuth()
    
    return () => {
      mounted = false
    }
  }, [router])

  // Post-login intro: show once for 3 seconds
  useEffect(() => {
    const shouldShowIntro = sessionStorage.getItem("show_post_login_intro") === "1"
    if (!shouldShowIntro) return

    setShowIntro(true)

    const endTimer = setTimeout(() => {
      setShowIntro(false)
      sessionStorage.removeItem("show_post_login_intro")
    }, 6200)

    return () => {
      clearTimeout(endTimer)
    }
  }, [])

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" })
      if (res.ok) router.push("/login")
    } catch (error) {
      console.error("Logout failed", error)
    }
  }

  const isActive = (path: string) => pathname?.startsWith(path)

  // Show loading while checking authentication
  if (!authChecked) {
    return (
      <div className="flex bg-[#080808] min-h-screen text-white font-sans items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D11F00] mx-auto mb-4"></div>
          <p>Checking authentication...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex bg-[#080808] min-h-screen text-white font-sans selection:bg-[#D11F00]/30">
      <style>{`
        @keyframes slideInSidebar {
          from { transform: translateX(-240px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes introFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scrollMaskReveal {
          0% { clip-path: inset(100% 0 0 0); opacity: 0; transform: translateY(40px); }
          25% { opacity: 1; }
          58% { clip-path: inset(0 0 0 0); transform: translateY(0); opacity: 1; }
          100% { clip-path: inset(0 0 100% 0); transform: translateY(-40px); opacity: 0.2; }
        }
        @keyframes logoZoomDock {
          0%, 35% {
            opacity: 0;
            transform: perspective(2000px) translate3d(0, 0, -2200px) scale(9.5);
            filter: blur(34px);
          }
          50% {
            opacity: 1;
            transform: perspective(2000px) translate3d(0, 0, -800px) scale(6.2);
            filter: blur(18px);
          }
          68% {
            opacity: 1;
            transform: perspective(2000px) translate3d(0, 0, -120px) scale(1.7);
            filter: blur(4px);
          }
          85% {
            opacity: 1;
            transform: perspective(2000px) translate3d(10vw, 0, 0) scale(1);
            filter: blur(0px);
          }
          100% {
            opacity: 1;
            transform: perspective(2000px) translate3d(24vw, 0, 0) scale(0.82);
            filter: blur(0px);
          }
        }
        @keyframes logoTagIn {
          0%, 82% { opacity: 0; transform: translate(24vw, 12px); letter-spacing: 0.28em; }
          100% { opacity: 1; transform: translate(24vw, 0); letter-spacing: 0.2em; }
        }
        .animate-sidebar { animation: slideInSidebar 0.4s ease-out forwards; }
        .animate-intro-fade { animation: introFadeIn 0.55s ease-out both; }
        .animate-scroll-mask { animation: scrollMaskReveal 3.1s cubic-bezier(0.19, 1, 0.22, 1) forwards; }
        .animate-logo-dock { animation: logoZoomDock 4.8s cubic-bezier(0.16, 1, 0.3, 1) 1s forwards; will-change: transform, opacity, filter; }
        .animate-logo-label { animation: logoTagIn 4.8s cubic-bezier(0.22, 1, 0.36, 1) 1s forwards; }
      `}</style>

      {showIntro && (
        <div className="fixed inset-0 z-[9999] bg-[#080808] flex items-center justify-center overflow-hidden animate-intro-fade">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_22%,rgba(209,31,0,0.2)_0%,transparent_52%),radial-gradient(circle_at_78%_84%,rgba(209,31,0,0.16)_0%,transparent_48%),linear-gradient(180deg,#090909_0%,#080808_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.05)_50%,transparent_100%)] opacity-50" />

          <div className="relative w-full h-full flex items-center justify-center px-6">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="animate-scroll-mask">
                <h1 className="text-white uppercase text-center font-[var(--font-display)] leading-[0.88] text-[clamp(58px,12vw,196px)] tracking-[0.08em]">
                  Royal Fitness
                </h1>
              </div>
            </div>

            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="opacity-0 animate-logo-dock drop-shadow-[0_0_55px_rgba(209,31,0,0.5)]">
                <Image
                  src="/logo.png"
                  alt="Royal Fitness"
                  width={480}
                  height={480}
                  className="w-[min(85vw,85vh)] h-auto object-contain"
                  unoptimized
                />
              </div>
              <span className="opacity-0 animate-logo-label text-white text-[11px] md:text-[16px] tracking-[0.2em] font-[var(--font-display)] uppercase">
                Royal Fitness
              </span>
            </div>
          </div>
        </div>
      )}
      {!showIntro && (
        <>
          {/* MOBILE HAMBURGER */}
          <div className="md:hidden fixed top-4 left-4 z-50">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 bg-[#111111] border border-[#1C1C1C] rounded-lg text-[#555555] hover:text-[#D11F00] transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>

          {/* SIDEBAR OVERLAY (MOBILE) */}
          {sidebarOpen && (
            <div
              className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* SIDEBAR */}
          <aside className={`
            fixed left-0 top-0 h-full w-[240px] bg-[#0D0D0D] border-r border-[#1C1C1C] flex flex-col justify-between py-6 z-50
            transition-transform duration-300 md:translate-x-0 animate-sidebar
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          `}>
            {/* TOP: Logo */}
            <div className="px-6 pb-6 border-b border-[#1C1C1C]">
              <div className="flex items-center gap-3">
                <Image
                  src="/logo.png"
                  alt="Royal Fitness"
                  width={30}
                  height={30}
                  className="w-[30px] h-[30px] object-contain"
                  unoptimized
                />
                <span className="text-white text-[11px] font-bold tracking-[0.2em] uppercase">
                  Royal Fitness
                </span>
              </div>
            </div>

            {/* MIDDLE: Navigation */}
            <nav className="flex-1 px-3 py-6 space-y-0.5">
              {navItems.map((item) => {
                const active = isActive(item.path)
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group
                      ${active
                        ? "text-white font-semibold bg-[#1C1C1C] border-l-2 border-[#D11F00] pl-[10px]"
                        : "text-[#444444] hover:text-[#888888] hover:bg-[#1C1C1C]"}
                    `}
                  >
                    <div className={`${active ? "text-[#D11F00]" : "text-[#333333] group-hover:text-[#555555]"} transition-colors`}>
                      {item.icon(active ? "#D11F00" : (active ? "#D11F00" : "currentColor"))}
                    </div>
                    <span className="text-[13px] font-medium">{item.name}</span>
                  </Link>
                )
              })}
            </nav>

            {/* BOTTOM: Owner Info + Logout */}
            <div className="px-3">
              <div className="pt-4 border-t border-[#1C1C1C] space-y-4">
                <div className="flex items-center gap-3 px-3">
                  <div className="w-8 h-8 rounded-full bg-[#D11F00] flex items-center justify-center">
                    <span className="text-white font-bold text-xs uppercase">A</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-white text-[13px] font-medium leading-none">Admin</span>
                    <span className="text-[#444444] text-[11px] mt-1">Owner</span>
                  </div>
                </div>

                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 px-3 rounded-lg text-[#444444] text-[12px] hover:text-[#D11F00] hover:bg-[#1C1C1C] transition-all duration-200 group"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:translate-x-0.5 transition-transform">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </aside>

          {/* MAIN CONTENT */}
          <main className="flex-1 md:ml-[240px] min-h-screen bg-[#080808] overflow-y-auto">
            {children}
          </main>
        </>
      )}
    </div>
  )
}
