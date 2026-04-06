"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useCreateMember } from "@/hooks/useCreateMember"

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters")
    .max(100).regex(/^[^<>]*$/, "Invalid characters"),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter valid 10-digit Indian mobile number"),
  membershipType: z.enum([
    "MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL", "OTHERS"
  ]),
  discountAmount: z.coerce.number().min(0, "Discount cannot be negative").max(99999, "Discount too high"),
  paidAmount: z.coerce.number().min(0, "Amount cannot be negative").max(99999, "Amount too high"),
  paymentMode: z.enum(["CASH", "UPI", "CARD"]),
  startDate: z.string().min(1, "Start date required"),
  endDate: z.string().optional(),
  manualPlanName: z.string().optional(),
  manualAmount: z.coerce.number().optional(),
}).refine(data => {
  if (data.membershipType === "OTHERS") {
    return !!data.endDate && data.endDate.length > 0
  }
  return true;
}, {
  message: "End date required for Others",
  path: ["endDate"]
}).refine(data => {
  if (data.membershipType === "OTHERS" && !data.manualPlanName) {
    return false;
  }
  return true;
}, {
  message: "Plan name required for Others",
  path: ["manualPlanName"]
}).refine(data => {
  if (data.membershipType === "OTHERS" && (data.manualAmount === undefined || data.manualAmount === null)) {
    return false;
  }
  return true;
}, {
  message: "Manual amount required for Others",
  path: ["manualAmount"]
})

interface PricingPlan {
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS"
  amount: number
}

interface FormData {
  name: string
  phone: string
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS"
  discountAmount: number
  paidAmount: number
  paymentMode: "CASH" | "UPI" | "CARD"
  startDate: string
  endDate?: string
  manualPlanName?: string
  manualAmount?: number
}

export default function AddMemberPage() {
  const router = useRouter()
  const createMemberMutation = useCreateMember()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [generalError, setGeneralError] = useState("")

  const [priceLoading, setPriceLoading] = useState(false)
  const [plans, setPlans] = useState<PricingPlan[]>([])
  const [basePrice, setBasePrice] = useState(0)

  const getTodayStr = () => {
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000
    const istNow = new Date(now.getTime() + istOffset)
    return istNow.toISOString().split("T")[0]
  }

  // Load all plans on mount
  useEffect(() => {
    const loadPlans = async () => {
      setPriceLoading(true)
      try {
        const res = await fetch("/api/settings/pricing")
        const data = await res.json()
        if (data.pricing) {
          setPlans(data.pricing)
          // Find initial plan amount
          const initial = data.pricing.find((p: PricingPlan) => p.membershipType === "MONTHLY")
          setBasePrice(initial?.amount || 0)
        }
      } catch (error) {
        console.error("❌ loadPlans error:", error)
      } finally {
        setPriceLoading(false)
      }
    }
    loadPlans()
  }, [])

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors }
  } = useForm<FormData>({
    resolver: zodResolver(schema as any),
    defaultValues: {
      membershipType: "MONTHLY",
      discountAmount: 0,
      paidAmount: 0,
      paymentMode: "CASH",
      startDate: getTodayStr(),
      endDate: "",
      manualPlanName: "",
    }
  })

  const startDate = watch("startDate")
  const membershipType = watch("membershipType")
  const discountAmount = watch("discountAmount")
  const manualAmount = watch("manualAmount")
  
  const isOthers = membershipType === "OTHERS"

  // Calculate final amount: if Others, use manualAmount as base; otherwise use basePrice (fetched from plans)
  const currentBasePrice = isOthers ? (manualAmount || 0) : (basePrice || 0)
  const finalAmount = Math.max(0, currentBasePrice - (discountAmount || 0))

  // Instant local lookup when membershipType changes
  useEffect(() => {
    if (membershipType && membershipType !== "OTHERS" && plans.length > 0) {
      const found = plans.find((p: PricingPlan) => p.membershipType === membershipType)
      const price = found?.amount || 0
      setBasePrice(price)
      // Reset discount if plan changes, to be safe
      setValue("discountAmount", 0, { shouldValidate: true })
      // Auto-set paid amount to full price initially
      setValue("paidAmount", price, { shouldValidate: true })
    } else if (membershipType === "OTHERS") {
      setBasePrice(0)
      setValue("discountAmount", 0, { shouldValidate: true })
      setValue("paidAmount", 0, { shouldValidate: true })
    }
  }, [membershipType, plans, setValue])

  // Sync paidAmount with finalAmount unless user manually changed it? 
  // For simplicity, let's just sync it when discount changes too
  useEffect(() => {
     if (membershipType !== "OTHERS") {
       setValue("paidAmount", finalAmount, { shouldValidate: true })
     }
  }, [finalAmount, membershipType, setValue])

  // Auto-calculate end date
  useEffect(() => {
    if (membershipType !== "OTHERS" && startDate) {
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
    } else if (membershipType === "OTHERS") {
      setValue("endDate", "", { shouldValidate: true })
    }
  }, [startDate, membershipType, setValue])

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setGeneralError("")
    
    try {
      const transformedData = {
        ...data,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        status: "ACTIVE" as const
      }
      
      const result = await createMemberMutation.mutateAsync(transformedData)
      setSuccess(true)
      setTimeout(() => {
        router.push(`/admin/members/${result.member.id}`)
      }, 1000)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("phone")) {
          setError("phone", { message: "A member with this phone already exists" })
        } else {
          setGeneralError(error.message || "Something went wrong. Try again.")
        }
      } else {
        setGeneralError("Something went wrong. Try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  // Debug unseen errors
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.log("Form validation errors preventing submit:", errors);
    }
  }, [errors]);

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
        <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-6">
          
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
                <option value="OTHERS">Others (Manual Entry)</option>
              </select>
              <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-[#555555]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
          </div>

          {/* OTHERS CUSTOM FIELDS: Plan Name & Manual Base Price */}
          {isOthers && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-4 bg-[#1A1A1A]/30 border border-[#242424] rounded-lg animate-fadeUp">
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
                  Custom Plan Name
                </label>
                <input
                  {...register("manualPlanName")}
                  type="text"
                  placeholder="e.g. Boxing Coach"
                  className={`w-full bg-[#0F0F0F] border ${errors.manualPlanName ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-4 py-2.5 placeholder:text-[#333333] focus:border-[#D11F00] focus:outline-none transition-all`}
                />
                {errors.manualPlanName && (
                  <p className="text-[#D11F00] text-[11px] mt-1.5 animate-error">{errors.manualPlanName.message}</p>
                )}
              </div>
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-2">
                  Plan Amount (₹)
                </label>
                <input
                  {...register("manualAmount", { valueAsNumber: true })}
                  type="number"
                  placeholder="e.g. 5000"
                  className={`w-full bg-[#0F0F0F] border ${errors.manualAmount ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-4 py-2.5 placeholder:text-[#333333] focus:border-[#D11F00] focus:outline-none transition-all`}
                />
                {errors.manualAmount && (
                  <p className="text-[#D11F00] text-[11px] mt-1.5 animate-error">{errors.manualAmount.message}</p>
                )}
              </div>
            </div>
          )}

          {/* PRICING SECTION: Base, Discount, Final */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-4 bg-[#0A0A0A] border border-[#1C1C1C] rounded-lg">
            {/* Base Price */}
            <div>
               <label className="text-[#444444] text-[9px] font-bold tracking-[0.15em] uppercase block mb-2">
                Base Price
              </label>
              <div className="text-[16px] font-bold text-[#666666] pt-1">
                ₹{currentBasePrice}
              </div>
            </div>

            {/* Discount Input */}
            <div>
              <label className="text-[#555555] text-[9px] font-bold tracking-[0.15em] uppercase block mb-2">
                Discount (₹)
              </label>
              <input
                {...register("discountAmount", { valueAsNumber: true })}
                type="number"
                min="0"
                placeholder="0"
                className={`w-full bg-[#0F0F0F] border ${errors.discountAmount ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-3 py-2.5 focus:border-[#D11F00] focus:outline-none transition-all`}
              />
            </div>

            {/* Final Total */}
            <div>
              <label className="text-[#D11F00] text-[9px] font-bold tracking-[0.15em] uppercase block mb-2">
                Total to Pay
              </label>
              <div className="text-[18px] font-black text-white pt-0.5">
                ₹{finalAmount}
              </div>
            </div>
          </div>
          {errors.discountAmount && (
            <p className="text-[#D11F00] text-[11px] mt-1 animate-error">{errors.discountAmount.message as string}</p>
          )}

          {/* PAYMENT RECEIPT: Actual Received & Mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-5 bg-[#D11F00]/5 border border-[#D11F00]/10 rounded-xl relative overflow-hidden group transition-all hover:bg-[#D11F00]/8 hover:border-[#D11F00]/20">
            {/* Amount Paid Today */}
            <div className="space-y-1">
               <label className="text-white text-[10px] font-bold tracking-[0.2em] uppercase block mb-2 flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-all">
                <span className="w-1 h-3 bg-[#D11F00] rounded-full inline-block"></span>
                Amount Received Today (₹)
              </label>
              <input
                {...register("paidAmount", { valueAsNumber: true })}
                type="number"
                min="0"
                placeholder="0"
                className={`w-full bg-[#0F0F0F]/80 backdrop-blur-md border ${errors.paidAmount ? 'border-[#D11F00]' : 'border-[#242424]'} text-[18px] font-black text-[#D11F00] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:outline-none transition-all placeholder:text-[#222222]`}
              />
              {errors.paidAmount && (
                <p className="text-[#D11F00] text-[11px] mt-1.5 animate-error px-1">{errors.paidAmount.message}</p>
              )}
              <div className="flex justify-between items-center px-1">
                <p className="text-[#444444] text-[10px] italic font-medium">Balance Due: ₹{Math.max(0, finalAmount - (watch("paidAmount") || 0))}</p>
                <button 
                  type="button" 
                  onClick={() => setValue("paidAmount", finalAmount)}
                  className="text-[#D11F00] text-[9px] font-bold uppercase tracking-tighter hover:underline"
                >
                  Full Payment
                </button>
              </div>
            </div>

            {/* Payment Mode */}
            <div>
              <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-3">
                Payment Mode
              </label>
              <div className="relative">
                <select
                  {...register("paymentMode")}
                  className="w-full bg-[#0F0F0F]/80 backdrop-blur-md border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3.5 focus:border-[#D11F00] focus:outline-none transition-all cursor-pointer appearance-none"
                >
                  <option value="CASH">CASH</option>
                  <option value="UPI">UPI / G-PAY</option>
                  <option value="CARD">DEBIT / CREDIT CARD</option>
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-[#555555]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
              </div>
            </div>
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
              <label className={`text-[10px] font-bold tracking-[0.15em] uppercase block mb-2 ${!isOthers ? "text-[#333333]" : "text-[#555555]"}`}>
                End Date
              </label>
              <input
                {...register("endDate")}
                type="date"
                disabled={!isOthers}
                className={`w-full bg-[#0F0F0F] border border-[#242424] text-[14px] rounded-lg px-4 py-3.5 transition-all duration-200 [color-scheme:dark]
                  ${!isOthers ? "text-[#555555] opacity-50 cursor-not-allowed" : "text-white focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none cursor-pointer"}
                  ${errors.endDate ? 'border-[#D11F00]' : ''}
                `}
              />
              {!isOthers && (
                <p className="text-[#333333] text-[11px] mt-1.5 font-medium leading-tight">Auto-calculated</p>
              )}
              {isOthers && errors.endDate && (
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
