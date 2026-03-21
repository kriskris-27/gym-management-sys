"use client"
import { useState, useEffect } from "react"
// lucide-react removed


type MembershipType = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING"

interface PricingItem {
  membershipType: MembershipType
  amount: number
}

const planDetails: Record<MembershipType, { name: string; duration: string }> = {
  MONTHLY: { name: "Monthly", duration: "30 days" },
  QUARTERLY: { name: "Quarterly", duration: "90 days" },
  HALF_YEARLY: { name: "Half-Yearly", duration: "180 days" },
  ANNUAL: { name: "Annual", duration: "365 days" },
  PERSONAL_TRAINING: { name: "Personal Training", duration: "custom" },
}

const Spinner = ({ className }: { className?: string }) => (
  <svg className={`animate-spin ${className || ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
)

export default function SettingsPage() {
  const [pricing, setPricing] = useState<PricingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/settings/pricing")
      .then(res => res.json())
      .then(data => {
        if (data.pricing) setPricing(data.pricing)
      })
      .catch(() => setError("Failed to load pricing"))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    const isInvalid = pricing.some(p => isNaN(p.amount) || p.amount < 0 || p.amount > 99999)
    if (isInvalid) {
      setError("Price must be between ₹0 and ₹99,999")
      return
    }

    setSaving(true)
    setError("")
    
    try {
      const res = await fetch("/api/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing })
      })

      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        const body = await res.json()
        setError(body.error || "Failed to save. Try again.")
      }
    } catch {
      setError("Network error. Failed to save.")
    } finally {
      setSaving(false)
    }
  }

  const updatePrice = (membershipType: MembershipType, value: string) => {
    // Basic control to prevent weird strings while typing, allow empty string to coerce to 0 later if needed but form should handle it properly
    setPricing(prev => prev.map(p =>
      p.membershipType === membershipType
        ? { ...p, amount: value === "" ? 0 : Number(value) }
        : p
    ))
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#080808]">
        <Spinner className="h-6 w-6 text-[#D11F00]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#080808] p-8 animate-in fade-in duration-400">
      <div className="mb-8">
        <h1 className="text-[28px] font-black text-white">Settings</h1>
        <p className="text-[13px] text-[#444444] mt-1">Manage your gym plan pricing</p>
      </div>

      <div className="max-w-[560px] bg-[#111111] border border-[#1C1C1C] rounded-xl p-6">
        <div className="border-b border-[#1C1C1C] pb-4 mb-6">
          <h2 className="text-[16px] font-bold text-white">Plan Pricing</h2>
          <p className="text-[12px] text-[#444444] mt-1">
            Set the standard price for each membership plan
          </p>
        </div>

        <div className="flex flex-col">
          {pricing.map((plan, index) => {
            const isLast = index === pricing.length - 1
            const details = planDetails[plan.membershipType]
            
            return (
              <div key={plan.membershipType} className={`flex justify-between items-center py-4 ${isLast ? '' : 'border-b border-[#0D0D0D]'}`}>
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium text-white">{details.name}</span>
                  <span className="text-[11px] text-[#444444]">{details.duration}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-[#444444]">₹</span>
                  <input
                    type="number"
                    min="0"
                    max="99999"
                    value={plan.amount || ""}
                    onChange={(e) => updatePrice(plan.membershipType, e.target.value)}
                    className="w-[120px] bg-[#0F0F0F] border border-[#242424] text-white text-[13px] text-right px-3 py-2 rounded-lg focus:border-[#D11F00] focus:outline-none transition-colors duration-200"
                    placeholder="0"
                  />
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-[11px] text-[#333333] italic mt-2">
          Individual prices can be set per member
        </p>

        {error && (
          <p className="text-[11px] text-[#D11F00] mt-4">{error}</p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className={`mt-6 w-full font-bold text-[12px] uppercase tracking-[0.1em] py-3.5 rounded-lg transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2
            ${saved 
              ? "bg-green-600 text-white hover:bg-green-500" 
              : "bg-[#D11F00] text-white hover:bg-[#B51A00]"
            }
            ${saving ? "opacity-80 cursor-not-allowed" : ""}
          `}
        >
          {saving && <Spinner className="w-4 h-4" />}
          {saved ? "Saved ✓" : saving ? "Saving..." : "Save Pricing"}
        </button>
      </div>
    </div>
  )
}
