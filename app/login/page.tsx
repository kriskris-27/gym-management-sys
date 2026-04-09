"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"

const schema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Minimum 6 characters")
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  // On mount → check already logged in
  useEffect(() => {
    fetch("/api/dashboard/summary", { credentials: 'include' })
      .then(res => { if (res.ok) router.push("/admin/dashboard") })
      .catch(() => {})
  }, [router])

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify(data)
      })
      if (res.ok) {
        router.push("/admin/dashboard")
      } else {
        const json = await res.json()
        setError(json.error ?? "Invalid credentials")
        setValue("password", "")
      }
    } catch {
      setError("Something went wrong. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInBottom {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeInUp {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes errorSlideDown {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .animate-slideInLeft { animation: slideInLeft 0.6s ease-out forwards; }
        .animate-slideInRight { animation: slideInRight 0.6s ease-out 0.1s both; }
        .animate-slideInBottom { animation: slideInBottom 0.5s ease-out both; }
        .animate-fadeInUp { animation: fadeInUp 0.4s ease-out both; }
        .animate-fadeIn { animation: fadeIn 0.4s both; }
        .animate-error { animation: errorSlideDown 0.3s ease-out forwards; }
        .animate-spin-custom { animation: spin 1s linear infinite; }
      `}</style>

      <div className="min-h-screen bg-[#080808] grid grid-cols-1 md:grid-cols-2 text-white font-sans selection:bg-[#D11F00]/30">
        
        {/* LEFT COLUMN */}
        <div className="hidden md:flex flex-col justify-between p-12 border-right border-[#1C1C1C] animate-slideInLeft border-r-[1px]">
          {/* TOP: Logo row */}
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Royal Fitness"
              width={40}
              height={40}
              className="w-10 h-10 object-contain"
              unoptimized
            />
            <span className="text-[#D11F00] text-[11px] font-bold tracking-[0.25em] uppercase">
              Royal Fitness
            </span>
          </div>

          {/* MIDDLE: Hero */}
          <div className="flex flex-col">
            <div className="flex flex-col uppercase font-black tracking-tight leading-[0.92] text-[72px]">
              <span className="animate-slideInBottom [animation-delay:0.2s]">Train</span>
              <span className="animate-slideInBottom [animation-delay:0.3s]">Harder.</span>
              <span className="animate-slideInBottom [animation-delay:0.4s]">Manage</span>
              <span className="text-[#D11F00] animate-slideInBottom [animation-delay:0.5s]">Smarter.</span>
            </div>
            
            <div className="w-12 h-[3px] bg-[#D11F00] my-8 animate-fadeIn [animation-delay:0.6s]" />

            <span className="text-[#444444] text-[11px] font-semibold tracking-[0.2em] uppercase animate-fadeIn [animation-delay:0.7s]">
              Complete gym management system
            </span>
          </div>

          {/* BOTTOM: Stat pills */}
          <div className="flex gap-3 animate-fadeIn [animation-delay:0.6s]">
            {["high speed", "99% Uptime", "Real-time"].map((stat) => (
              <div 
                key={stat}
                className="bg-[#111111] border border-[#1C1C1C] text-[#555555] text-[11px] px-3.5 py-1.5 rounded-full"
              >
                {stat}
              </div>
            ))}
          </div>
        </div>

        {/* MOBILE LOGO DISPLAY */}
        <div className="flex md:hidden flex-col p-8 gap-6 animate-slideInLeft">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Royal Fitness"
              width={40}
              height={40}
              className="w-10 h-10 object-contain"
              unoptimized
            />
            <span className="text-[#D11F00] text-[11px] font-bold tracking-[0.25em] uppercase">
              Royal Fitness
            </span>
          </div>
          <div className="uppercase font-black tracking-tight leading-[0.92] text-5xl">
            Train Harder. <br /> Manage <span className="text-[#D11F00]">Smarter.</span>
          </div>
          <span className="text-[#444444] text-[10px] font-semibold tracking-[0.2em] uppercase">
            Complete gym management system
          </span>
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col justify-center items-center p-8 md:p-12 animate-slideInRight">
          <div className="max-w-[360px] w-full">
            <div className="animate-fadeInUp [animation-delay:0.3s]">
              <span className="text-[#D11F00] text-[10px] font-bold tracking-[0.2em] uppercase block mb-6">
                Owner Access
              </span>
              <h2 className="text-white text-[36px] font-black tracking-tight mb-1.5">
                Sign in
              </h2>
              <p className="text-[#444444] text-[13px] mb-9">
                Enter your credentials to continue
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* USERNAME FIELD */}
              <div className="animate-fadeInUp [animation-delay:0.4s]">
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
                  Username
                </label>
                <input
                  {...register("username")}
                  type="text"
                  placeholder="admin"
                  className={`w-full bg-[#111111] border ${errors.username ? "border-[#D11F00]" : "border-[#242424]"} text-white text-[14px] rounded-[10px] px-4 py-3.5 placeholder:text-[#2A2A2A] focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200`}
                />
                {errors.username && (
                   <span className="text-[#D11F00] text-[10px] mt-1 block uppercase font-bold tracking-wider">
                     {errors.username.message}
                   </span>
                )}
              </div>

              {/* PASSWORD FIELD */}
              <div className="animate-fadeInUp [animation-delay:0.5s]">
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    {...register("password")}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className={`w-full bg-[#111111] border ${errors.password ? "border-[#D11F00]" : "border-[#242424]"} text-white text-[14px] rounded-[10px] px-4 py-3.5 placeholder:text-[#2A2A2A] focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#444444] hover:text-[#D11F00] transition-colors cursor-pointer"
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    )}
                  </button>
                </div>
                {errors.password && (
                   <span className="text-[#D11F00] text-[10px] mt-1 block uppercase font-bold tracking-wider">
                     {errors.password.message}
                   </span>
                )}
              </div>

              {/* SIGN IN BUTTON */}
              <button
                type="submit"
                disabled={loading}
                className={`w-full bg-[#D11F00] hover:bg-[#B51A00] text-white font-black text-[13px] tracking-[0.1em] uppercase py-4 rounded-[10px] mt-2 transition-all duration-200 active:scale-[0.98] flex items-center justify-center ${loading ? "opacity-70 cursor-not-allowed" : "cursor-pointer"} animate-fadeInUp [animation-delay:0.6s]`}
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <svg className="animate-spin-custom h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Signing in...</span>
                  </div>
                ) : (
                  "Sign In"
                )}
              </button>

              {/* ERROR MESSAGE */}
              {error && (
                <p className="text-[#D11F00] text-[12px] text-center mt-3 animate-error font-medium">
                  {error}
                </p>
              )}
            </form>

            <footer className="border-t border-[#1C1C1C] mt-8 pt-5 text-[#2A2A2A] text-[11px] text-center animate-fadeIn [animation-delay:0.8s]">
              Powered by Starliette
            </footer>
          </div>
        </div>
      </div>
    </>
  )
}
