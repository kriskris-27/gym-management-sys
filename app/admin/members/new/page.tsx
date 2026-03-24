"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters")
    .max(100).regex(/^[^<>]*$/, "Invalid characters"),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter valid 10-digit Indian mobile number"),
  membershipType: z.enum([
    "MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL", "PERSONAL_TRAINING"
  ]),
  customPrice: z.number().min(0, "Price cannot be negative").max(99999, "Price too high"),
  startDate: z.string().min(1, "Start date required"),
  endDate: z.string().optional()
}).refine(data => {
  if (data.membershipType === "PERSONAL_TRAINING") {
    return !!data.endDate && data.endDate.length > 0
  }
  return true
}, {
  message: "End date required for Personal Training",
  path: ["endDate"]
})

interface PricingPlan {
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING"
  amount: number
}

type FormData = z.infer<typeof schema>

export default function AddMemberPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [generalError, setGeneralError] = useState("")

  const [priceLoading, setPriceLoading] = useState(false)

  const getTodayStr = () => {
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    const istNow = new Date(now.getTime() + istOffset)
    return istNow.toISOString().split("T")[0]
  }

  const fetchPlanPrice = async (type: string) => {
    setPriceLoading(true)
    try {
      const res = await fetch("/api/settings/pricing")
      const data = await res.json()
      const plan = data.pricing?.find((p: PricingPlan) => p.membershipType === type)
      setValue("customPrice", plan?.amount ?? 0, { shouldValidate: false })
    } catch {
      setValue("customPrice", 0)
    } finally {
      setPriceLoading(false)
    }
  }

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      membershipType: "MONTHLY",
      customPrice: 0,
      startDate: getTodayStr(),
      endDate: ""
    }
  })

  const startDate = watch("startDate")
  const membershipType = watch("membershipType")
  const customPrice = watch("customPrice")

  // Auto-fetch plan price when membershipType changes
  useEffect(() => {
    if (membershipType) {
      fetchPlanPrice(membershipType)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipType])

  // Auto-calculate end date
  useEffect(() => {
    if (membershipType !== "PERSONAL_TRAINING" && startDate) {
      const start = new Date(startDate)
      if (!isNaN(start.getTime())) {
        const durations: Record<string, number> = {
          MONTHLY: 30,
          QUARTERLY: 90,
          HALF_YEARLY: 180,
          ANNUAL: 365,
        }
        const days = durations[membershipType] || 30
        const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000)
        setValue("endDate", end.toISOString().split("T")[0], { shouldValidate: true })
      }
    } else if (membershipType === "PERSONAL_TRAINING") {
      // Clear auto-calculated end date to force manual entry
      setValue("endDate", "", { shouldValidate: true })
    }
  }, [startDate, membershipType, setValue])

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setGeneralError("")
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })
      
      const json = await res.json()
      
      if (res.ok) {
        setSuccess(true)
        setTimeout(() => {
          router.push(`/admin/members/${json.member.id}`)
        }, 1000)
      } else if (res.status === 409) {
        setError("phone", { message: "A member with this phone already exists" })
      } else {
        setGeneralError(json.error || "Something went wrong. Try again.")
      }
    } catch (e) {
      setGeneralError("Something went wrong. Try again.")
    } finally {
      setLoading(false)
    }
  }

  const isPersonalTraining = membershipType === "PERSONAL_TRAINING"

  return (
    <div className="w-full min-h-screen bg-[#080808] p-8 text-white font-sans selection:bg-[#D11F00]/30 flex flex-col items-start overflow-x-hidden">
      <style>{`
        @keyframes fadeUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes errorSlideDown {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-fadeUp { animation: fadeUp 0.4s ease-out forwards; }
        .animate-spin-custom { animation: spin 1s linear infinite; }
        .animate-error { animation: errorSlideDown 0.3s ease-out forwards; }
      `}</style>

      {/* TOP ROW: Header */}
      <div className="flex flex-col animate-fadeUp opacity-0 w-full mb-8">
        <button 
          onClick={() => router.push("/admin/members")}
          className="text-[#444444] text-[12px] hover:text-white transition-colors cursor-pointer self-start mb-4 flex items-center gap-1.5 font-medium tracking-wide uppercase"
        >
          <span>←</span> Members
        </button>
        <h1 className="text-white text-[28px] font-black tracking-tight">Add Member</h1>
        <p className="text-[#444444] text-[13px] mt-1 font-medium">Register a new gym member</p>
      </div>

      {/* FORM CARD */}
      <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-8 w-full max-w-[560px] animate-fadeUp opacity-0 [animation-delay:0.1s]">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          
          {/* FIELD 1: Full Name */}
          <div>
            <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
              Full Name
            </label>
            <input
              {...register("name")}
              type="text"
              placeholder="e.g. Raj Kumar"
              className={`w-full bg-[#0F0F0F] border ${errors.name ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-4 py-3.5 placeholder:text-[#333333] focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200`}
            />
            {errors.name && (
              <p className="text-[#D11F00] text-[11px] mt-1.5 animate-error">{errors.name.message}</p>
            )}
          </div>

          {/* FIELD 2: Phone Number */}
          <div>
            <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
              Phone Number
            </label>
            <input
              {...register("phone")}
              type="tel"
              placeholder="e.g. 9876543210"
              className={`w-full bg-[#0F0F0F] border ${errors.phone ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-4 py-3.5 placeholder:text-[#333333] focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200`}
            />
            {errors.phone && (
              <p className="text-[#D11F00] text-[11px] mt-1.5 animate-error">{errors.phone.message}</p>
            )}
          </div>

          {/* FIELD 3: Membership Type */}
          <div>
            <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
              Membership Plan
            </label>
            <div className="relative">
              <select
                {...register("membershipType")}
                className="appearance-none w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3.5 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 cursor-pointer"
              >
                <option value="MONTHLY">Monthly (30 days)</option>
                <option value="QUARTERLY">Quarterly (90 days)</option>
                <option value="HALF_YEARLY">Half-Yearly (180 days)</option>
                <option value="ANNUAL">Annual (365 days)</option>
                <option value="PERSONAL_TRAINING">Personal Training (custom dates)</option>
              </select>
              <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-[#555555]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
          </div>

          {/* FIELD 4: Plan Amount */}
          <div>
            <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
              Plan Amount
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#555555] text-[14px] font-medium select-none">₹</span>
              <input
                {...register("customPrice")}
                type="number"
                min="0"
                max="99999"
                placeholder="0"
                className={`w-full bg-[#0F0F0F] border ${
                  errors.customPrice ? 'border-[#D11F00]' : 'border-[#242424]'
                } text-white text-[14px] rounded-lg pl-9 pr-4 py-3.5 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200`}
              />
              {priceLoading && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#444444] text-[11px]">fetching...</span>
              )}
            </div>
            {errors.customPrice && (
              <p className="text-[#D11F00] text-[11px] mt-1.5 animate-error">{errors.customPrice.message as string}</p>
            )}
            {isPersonalTraining && !errors.customPrice ? (
              <p className="text-[#D11F00] text-[11px] mt-1.5 italic">Set custom amount for this member</p>
            ) : (
              <p className="text-[#333333] text-[11px] mt-1.5 italic">Pre-filled from plan pricing. Edit to give discount.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* FIELD 4: Start Date */}
            <div>
              <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
                Start Date
              </label>
              <input
                {...register("startDate")}
                type="date"
                className={`w-full bg-[#0F0F0F] border ${errors.startDate ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-4 py-3.5 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 [color-scheme:dark] cursor-pointer`}
              />
              {errors.startDate && (
                <p className="text-[#D11F00] text-[11px] mt-1.5 animate-error">{errors.startDate.message}</p>
              )}
            </div>

            {/* FIELD 5: End Date */}
            <div>
              <label className={`text-[10px] font-bold tracking-[0.15em] uppercase block mb-2 ${!isPersonalTraining ? "text-[#333333]" : "text-[#555555]"}`}>
                End Date
              </label>
              <input
                {...register("endDate")}
                type="date"
                disabled={!isPersonalTraining}
                className={`w-full bg-[#0F0F0F] border border-[#242424] text-[14px] rounded-lg px-4 py-3.5 transition-all duration-200 [color-scheme:dark]
                  ${!isPersonalTraining ? "text-[#555555] opacity-50 cursor-not-allowed" : "text-white focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none cursor-pointer"}
                  ${errors.endDate ? 'border-[#D11F00]' : ''}
                `}
              />
              {!isPersonalTraining && (
                <p className="text-[#333333] text-[11px] mt-1.5 font-medium leading-tight">Auto-calculated from plan</p>
              )}
              {isPersonalTraining && errors.endDate && (
                <p className="text-[#D11F00] text-[11px] mt-1.5 animate-error">{errors.endDate.message}</p>
              )}
            </div>
          </div>

          {generalError && (
             <div className="bg-[#D11F00]/10 border border-[#D11F00]/20 rounded-lg p-3 animate-error">
               <p className="text-[#D11F00] text-[12px] font-medium text-center">{generalError}</p>
             </div>
          )}

          {/* FORM BOTTOM */}
          <div className="mt-8 pt-6 border-t border-[#1C1C1C] flex gap-3 items-center flex-col-reverse sm:flex-row">
            <button
              type="button"
              onClick={() => router.push("/admin/members")}
              className="w-full sm:w-auto bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] font-bold text-[12px] tracking-[0.1em] uppercase px-6 py-3.5 rounded-lg transition-all duration-200 cursor-pointer text-center"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={loading || success}
              className={`w-full sm:w-auto flex-1 text-white font-bold text-[12px] tracking-[0.1em] uppercase px-8 py-3.5 rounded-lg transition-all duration-200 flex items-center justify-center
                ${success ? "bg-[#10B981] hover:bg-[#10B981]" : "bg-[#D11F00] hover:bg-[#B51A00] active:scale-[0.98]"}
                ${(loading && !success) ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}
              `}
            >
              {success ? (
                <span className="flex items-center gap-2">Added! <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
              ) : loading ? (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin-custom h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Adding...</span>
                </div>
              ) : (
                "Add Member"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
