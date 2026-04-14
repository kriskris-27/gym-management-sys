"use client"
import { useState, useEffect } from "react"
import SpeedLoader from "@/app/components/SpeedLoader"
import { adminPageLoadingClass, adminPageShellClass } from "@/app/components/admin-page-shell"
// lucide-react removed


type MembershipType = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS"

interface PricingItem {
  membershipType: MembershipType
  amount: number
}

const planDetails: Record<MembershipType, { name: string; duration: string }> = {
  MONTHLY: { name: "Monthly", duration: "30 days" },
  QUARTERLY: { name: "Quarterly", duration: "90 days" },
  HALF_YEARLY: { name: "Half-Yearly", duration: "180 days" },
  ANNUAL: { name: "Annual", duration: "365 days" },
  OTHERS: { name: "Others", duration: "custom" },
}


const Spinner = ({ className }: { className?: string }) => (
  <svg className={`animate-spin ${className || ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
)

export default function SettingsPage() {
  const [openSection, setOpenSection] = useState<"GYM_DETAILS" | "CHANGE_PASSWORD" | "PLAN_PRICING" | null>(null)
  const [pricing, setPricing] = useState<PricingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [admissionFee, setAdmissionFee] = useState(0)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState("")
  const [gymName, setGymName] = useState("")
  const [gymPhone, setGymPhone] = useState("")
  const [passSaving, setPassSaving] = useState(false)
  const [passSaved, setPassSaved] = useState(false)
  const [passError, setPassError] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const [extraPlanNames, setExtraPlanNames] = useState<string[]>([])

  useEffect(() => {
    fetch("/api/settings/pricing")
      .then((res) => res.json())
      .then((data) => {
        if (data.pricing) setPricing(data.pricing)
        setAdmissionFee(Number(data.admissionFee ?? 0) || 0)
        if (Array.isArray(data.extraActivePlanNames)) {
          setExtraPlanNames(data.extraActivePlanNames)
        }
      })
      .catch(() => setError("Failed to load pricing"))
      .finally(() => setLoading(false))

    fetch("/api/settings/profile")
      .then((res) => res.json())
      .then((data) => {
        setGymName(String(data.gymName ?? ""))
        setGymPhone(String(data.gymPhone ?? ""))
      })
      .catch(() => setProfileError("Failed to load gym details"))
      .finally(() => setProfileLoading(false))
  }, [])

  const handleSave = async () => {
    const isInvalid = pricing.some(p => isNaN(p.amount) || p.amount < 0 || p.amount > 99999)
    if (isInvalid) {
      setError("Price must be between ₹0 and ₹99,999")
      return
    }
    if (isNaN(admissionFee) || admissionFee < 0 || admissionFee > 99999) {
      setError("Admission fee must be between ₹0 and ₹99,999")
      return
    }

    setSaving(true)
    setError("")
    
    try {
      const res = await fetch("/api/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing, admissionFee })
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

  const handleSaveProfile = async () => {
    if (!gymName.trim()) {
      setProfileError("Gym name is required")
      return
    }
    if (!gymPhone.trim()) {
      setProfileError("Gym phone is required")
      return
    }
    setProfileSaving(true)
    setProfileError("")
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gymName: gymName.trim(), gymPhone: gymPhone.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setProfileError(body.error || "Failed to save gym details")
        return
      }
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2000)
    } catch {
      setProfileError("Network error. Failed to save gym details.")
    } finally {
      setProfileSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPassError("All password fields are required")
      return
    }
    if (newPassword !== confirmPassword) {
      setPassError("New password and confirm password must match")
      return
    }
    setPassSaving(true)
    setPassError("")
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setPassError(body.error || "Failed to change password")
        return
      }
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setPassSaved(true)
      setTimeout(() => setPassSaved(false), 2000)
    } catch {
      setPassError("Network error. Failed to change password.")
    } finally {
      setPassSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={adminPageLoadingClass}>
        <SpeedLoader />
        <p className="text-[#666666] text-[12px] tracking-wider uppercase">Loading settings</p>
      </div>
    )
  }

  return (
    <div className={`${adminPageShellClass} animate-in fade-in duration-400`}>
      <div className="mb-8">
        <h1 className="text-[28px] font-black text-white">Settings</h1>
        <p className="text-[13px] text-[#444444] mt-1">Manage gym details, security, and pricing</p>
      </div>

     

      <div className="w-full max-w-[min(100%,560px)] mx-auto bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 sm:p-6 mb-5">
        <div className="themeFxCardOuter max-w-[300px] h-[250px]">
          <div className="themeFxCard h-[248px] flex items-center justify-center flex-col">
            <div className="themeFxCardRay" />
            <div className="themeFxCardLine themeFxCardLineTop" />
            <div className="themeFxCardLine themeFxCardLineBottom" />
            <div className="themeFxCardLine themeFxCardLineLeft" />
            <div className="themeFxCardLine themeFxCardLineRight" />
            <p className="font-black text-[2.2rem] tracking-[0.04em] bg-[linear-gradient(45deg,#000000_4%,#fff,#000)] bg-clip-text text-transparent">ROYAL</p>
            <p className="text-[12px] text-[#a9a9a9] mt-1.5 tracking-[0.08em] uppercase">Fitness</p>
          </div>
        </div>
      </div>

      <div className="w-full max-w-[min(100%,560px)] mx-auto bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 sm:p-6 mb-5">
        <button
          type="button"
          onClick={() => setOpenSection((prev) => (prev === "GYM_DETAILS" ? null : "GYM_DETAILS"))}
          className="w-full flex items-center justify-between border-b border-[#1C1C1C] pb-4 text-left"
          aria-expanded={openSection === "GYM_DETAILS"}
        >
          <div>
            <h2 className="text-[16px] font-bold text-white">Gym Details</h2>
            <p className="text-[12px] text-[#444444] mt-1">Update gym name and contact number</p>
          </div>
          <span className="text-[#888888] text-[18px] leading-none">{openSection === "GYM_DETAILS" ? "−" : "+"}</span>
        </button>

        {openSection === "GYM_DETAILS" && (
          <div className="mt-6">
            {profileLoading ? (
              <div className="h-24 bg-[#1C1C1C] rounded animate-pulse" />
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Gym Name</label>
                    <input
                      type="text"
                      value={gymName}
                      onChange={(e) => setGymName(e.target.value)}
                      className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:outline-none transition-all"
                      placeholder="Royal Fitness"
                    />
                  </div>
                  <div>
                    <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Gym Phone</label>
                    <input
                      type="text"
                      value={gymPhone}
                      onChange={(e) => setGymPhone(e.target.value)}
                      className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:outline-none transition-all"
                      placeholder="+91-9876543210"
                    />
                  </div>
                </div>
                {profileError && <p className="text-[11px] text-[#D11F00] mt-4">{profileError}</p>}
                <button
                  onClick={handleSaveProfile}
                  disabled={profileSaving}
                  className={`mt-6 w-full font-bold text-[12px] uppercase tracking-[0.1em] py-3.5 rounded-lg transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2
                    ${profileSaved ? "bg-green-600 text-white hover:bg-green-500" : "bg-[#D11F00] text-white hover:bg-[#B51A00]"}
                    ${profileSaving ? "opacity-80 cursor-not-allowed" : ""}
                  `}
                >
                  {profileSaving && <Spinner className="w-4 h-4" />}
                  {profileSaved ? "Saved ✓" : profileSaving ? "Saving..." : "Save Gym Details"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="w-full max-w-[min(100%,560px)] mx-auto bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 sm:p-6 mb-5">
        <button
          type="button"
          onClick={() => setOpenSection((prev) => (prev === "CHANGE_PASSWORD" ? null : "CHANGE_PASSWORD"))}
          className="w-full flex items-center justify-between border-b border-[#1C1C1C] pb-4 text-left"
          aria-expanded={openSection === "CHANGE_PASSWORD"}
        >
          <div>
            <h2 className="text-[16px] font-bold text-white">Change Password</h2>
            <p className="text-[12px] text-[#444444] mt-1">Update your login password</p>
          </div>
          <span className="text-[#888888] text-[18px] leading-none">{openSection === "CHANGE_PASSWORD" ? "−" : "+"}</span>
        </button>

        {openSection === "CHANGE_PASSWORD" && (
          <div className="mt-6">
            <div className="space-y-4">
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:outline-none transition-all"
                />
              </div>
            </div>
            {passError && <p className="text-[11px] text-[#D11F00] mt-4">{passError}</p>}
            <button
              onClick={handleChangePassword}
              disabled={passSaving}
              className={`mt-6 w-full font-bold text-[12px] uppercase tracking-[0.1em] py-3.5 rounded-lg transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2
                ${passSaved ? "bg-green-600 text-white hover:bg-green-500" : "bg-[#D11F00] text-white hover:bg-[#B51A00]"}
                ${passSaving ? "opacity-80 cursor-not-allowed" : ""}
              `}
            >
              {passSaving && <Spinner className="w-4 h-4" />}
              {passSaved ? "Password Updated ✓" : passSaving ? "Updating..." : "Change Password"}
            </button>
          </div>
        )}
      </div>

      <div className="w-full max-w-[min(100%,560px)] mx-auto bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 sm:p-6">
        <button
          type="button"
          onClick={() => setOpenSection((prev) => (prev === "PLAN_PRICING" ? null : "PLAN_PRICING"))}
          className="w-full flex items-center justify-between border-b border-[#1C1C1C] pb-4 text-left"
          aria-expanded={openSection === "PLAN_PRICING"}
        >
          <div>
            <h2 className="text-[16px] font-bold text-white">Plan Pricing</h2>
            <p className="text-[12px] text-[#444444] mt-1">
              Set the standard price for each membership plan
            </p>
          </div>
          <span className="text-[#888888] text-[18px] leading-none">{openSection === "PLAN_PRICING" ? "−" : "+"}</span>
        </button>

        {openSection === "PLAN_PRICING" && (
          <div className="mt-6">
            {extraPlanNames.length > 0 && (
              <div className="mb-5 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-4 py-3">
                <p className="text-[12px] font-bold text-[#F59E0B]">Extra active plans in database</p>
                <p className="text-[11px] text-[#888888] mt-1 leading-relaxed">
                  These names are not in the standard list (Monthly … Others). Add Member only uses the five standard plans.
                  Orphan rows: <span className="text-white font-medium">{extraPlanNames.join(", ")}</span>
                </p>
              </div>
            )}

            <div className="flex justify-between items-center py-4 border-b border-[#0D0D0D]">
              <div className="flex flex-col">
                <span className="text-[13px] font-medium text-white">Admission Fee</span>
                <span className="text-[11px] text-[#444444]">Applied only when enabled at Add Member</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-[#444444]">₹</span>
                <input
                  type="number"
                  min="0"
                  max="99999"
                  value={admissionFee || ""}
                  onChange={(e) => setAdmissionFee(e.target.value === "" ? 0 : Number(e.target.value))}
                  onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault()
                  }}
                  className="w-[120px] bg-[#0F0F0F] border border-[#242424] text-white text-[13px] text-right px-3 py-2 rounded-lg focus:border-[#D11F00] focus:outline-none transition-colors duration-200"
                  placeholder="0"
                />
              </div>
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
                        onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault()
                        }}
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
        )}
      </div>
    </div>
  )
}
