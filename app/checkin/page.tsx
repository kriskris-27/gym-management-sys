"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { formatDuration } from "@/lib/utils"

type CheckinStatus =
  | "idle"
  | "loading"
  | "checked_in"
  | "checked_out"
  | "already_done"
  | "not_found"
  | "error"

type ScanResult = {
  status: string
  memberName: string
  isExpired?: boolean
  message?: string
  checkedInAt?: string
  checkedOutAt?: string
  durationMinutes?: number
  durationFormatted?: string
}

const STORAGE_KEY = "gym_member_phone"
const PHONE_REGEX = /^[6-9]\d{9}$/

let autoCheckinStarted = false

function CheckinContent() {
  const searchParams = useSearchParams()
  const isManualMode = searchParams.get("mode") === "manual"

  const [status, setStatus] = useState<CheckinStatus>("idle")
  const [phone, setPhone] = useState("")
  const [result, setResult] = useState<ScanResult | null>(null)
  const [formError, setFormError] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [manualCountdown, setManualCountdown] = useState<number | null>(null)

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    })
  }

  const handleScan = useCallback(
    async (phoneNumber: string) => {
      setFormError("")
      setErrorMessage("")
      setStatus("loading")

      try {
        const res = await fetch("/api/attendance/scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(isManualMode ? { "x-manual-mode": "true" } : {}),
          },
          body: JSON.stringify({ phone: phoneNumber }),
        })

        const data = (await res.json()) as ScanResult & {
          status?: string
          error?: string
          message?: string
        }

        if (res.status === 404 && data.status === "NOT_FOUND") {
          localStorage.removeItem(STORAGE_KEY)
          setStatus("not_found")
          return
        }

        if (res.status === 429) {
          setErrorMessage("Too many attempts. Please wait a minute.")
          setStatus("error")
          return
        }

        if (!res.ok) {
          if (res.status === 400) {
            setFormError(
              (data as { error?: string }).error || "Invalid phone number."
            )
            setStatus("idle")
            return
          }
          setErrorMessage(data.error || "Something went wrong.")
          setStatus("error")
          return
        }

        if (!data.status) {
          setErrorMessage("Unexpected response.")
          setStatus("error")
          return
        }

        if (!isManualMode) {
          localStorage.setItem(STORAGE_KEY, phoneNumber)
        }

        setResult(data as ScanResult)

        if (data.status === "CHECKED_IN") setStatus("checked_in")
        else if (data.status === "CHECKED_OUT") setStatus("checked_out")
        else if (data.status === "ALREADY_DONE") setStatus("already_done")
        else {
          setErrorMessage("Unexpected status.")
          setStatus("error")
        }
      } catch {
        setErrorMessage("Network error. Check your connection.")
        setStatus("error")
      }
    },
    [isManualMode]
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    if (isManualMode) return
    if (autoCheckinStarted) return
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && PHONE_REGEX.test(saved)) {
      autoCheckinStarted = true
      void handleScan(saved)
    }
  }, [isManualMode, handleScan])

  useEffect(() => {
    if (!isManualMode) {
      setManualCountdown(null)
      return
    }
    if (
      status !== "checked_in" &&
      status !== "checked_out" &&
      status !== "already_done"
    ) {
      setManualCountdown(null)
      return
    }

    let n = 5
    setManualCountdown(n)
    const id = window.setInterval(() => {
      n -= 1
      setManualCountdown(n)
      if (n <= 0) {
        window.clearInterval(id)
        setStatus("idle")
        setPhone("")
        setResult(null)
        setManualCountdown(null)
      }
    }, 1000)

    return () => window.clearInterval(id)
  }, [isManualMode, status])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!PHONE_REGEX.test(phone)) {
      setFormError("Enter a valid 10-digit mobile number.")
      return
    }
    void handleScan(phone)
  }

  const handleNotYou = () => {
    if (!isManualMode) {
      localStorage.removeItem(STORAGE_KEY)
    }
    setStatus("idle")
    setPhone("")
    setResult(null)
    setFormError("")
    setManualCountdown(null)
  }

  const handleTryAnother = () => {
    localStorage.removeItem(STORAGE_KEY)
    setStatus("idle")
    setPhone("")
    setResult(null)
    setFormError("")
  }

  const showFooterLink =
    status === "checked_in" ||
    status === "checked_out" ||
    status === "already_done"

  const durationText =
    result?.durationFormatted ??
    (result?.durationMinutes != null
      ? formatDuration(result.durationMinutes)
      : "—")

  return (
    <div
      className={`relative flex min-h-screen flex-col items-center justify-center overflow-x-hidden bg-[#080808] px-6 pt-[env(safe-area-inset-top)] ${
        showFooterLink ? "pb-24" : ""
      } pb-[max(1rem,env(safe-area-inset-bottom))]`}
      style={{ touchAction: "manipulation" }}
    >
      <style>{`
        @keyframes checkinStateIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes checkinPop {
          from { transform: scale(0); }
          to { transform: scale(1); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes countFade {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .countdown-tick {
          animation: countFade 0.25s ease-out;
        }
        .checkin-state {
          animation: checkinStateIn 0.3s ease-out forwards;
        }
        .checkin-circle {
          animation: checkinPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .checkin-spin {
          animation: spin 0.8s linear infinite;
        }
      `}</style>

      {/* STATE: idle — phone entry */}
      {status === "idle" && (
        <div className="checkin-state flex w-full max-w-[360px] flex-col items-center">
          <div className="mb-10 flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#D11F00]">
              <span className="text-[20px] font-black text-white">S</span>
            </div>
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-white">
              Royal Fitness
            </p>
          </div>

          <div className="w-full rounded-2xl border border-[#1C1C1C] bg-[#111111] p-8">
            <h1 className="text-[22px] font-black text-white">
              Enter your phone
            </h1>
            <p className="mb-8 mt-1 text-[13px] text-[#444444]">
              We&apos;ll remember you next time
            </p>

            <form onSubmit={handleSubmit}>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={10}
                placeholder="9876543210"
                value={phone}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 10)
                  setPhone(v)
                  setFormError("")
                }}
                className="w-full rounded-xl border border-[#242424] bg-[#0F0F0F] px-4 py-4 text-center text-[20px] tracking-[0.15em] text-white placeholder:text-[#2A2A2A] focus:border-[#D11F00] focus:outline-none"
              />

              <button
                type="submit"
                disabled={phone.length !== 10}
                className="mt-4 w-full rounded-xl bg-[#D11F00] py-4 text-[14px] font-black uppercase tracking-[0.1em] text-white transition-all duration-200 hover:bg-[#B51A00] active:scale-[0.98] disabled:opacity-40"
              >
                Check In
              </button>
            </form>

            {formError ? (
              <p className="mt-3 text-center text-[12px] text-[#EF4444]">
                {formError === "Phone not registered."
                  ? "Phone not registered. Contact your gym owner."
                  : formError}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* STATE: loading */}
      {status === "loading" && (
        <div className="checkin-state flex flex-col items-center">
          <div className="checkin-spin h-12 w-12 rounded-full border-2 border-[#D11F00] border-t-transparent" />
          <p className="mt-4 text-[14px] text-[#444444]">Checking in...</p>
        </div>
      )}

      {/* STATE: checked in */}
      {status === "checked_in" && result && (
        <div className="checkin-state flex w-full max-w-[360px] flex-col items-center text-center">
          <div className="checkin-circle flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#10B981] bg-[#10B981]/10">
            <span className="text-[36px] font-black text-[#10B981]">✓</span>
          </div>
          <h2 className="mt-4 text-[28px] font-black text-white">Checked In!</h2>
          <p className="mt-1 text-[15px] text-[#444444]">
            Welcome, {result.memberName}
          </p>

          <div className="mt-6 w-full rounded-xl border border-[#1C1C1C] bg-[#111111] px-5 py-3">
            <p className="text-[20px] font-black text-white">
              {result.checkedInAt ? formatTime(result.checkedInAt) : "—"}
            </p>
            <p className="text-[11px] text-[#444444]">Check-in time</p>
          </div>

          {result.isExpired ? (
            <div className="mt-4 w-full rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/10 px-4 py-3">
              <p className="text-center text-[12px] text-[#F59E0B]">
                ⚠ Membership expired — contact owner
              </p>
            </div>
          ) : null}

          <p className="mt-6 text-[12px] text-[#333333]">
            Scan again to check out
          </p>

          {isManualMode && manualCountdown !== null && manualCountdown > 0 ? (
            <p
              key={manualCountdown}
              className="countdown-tick mt-2 text-[11px] text-[#333333]"
            >
              Resetting in {manualCountdown}s...
            </p>
          ) : null}
        </div>
      )}

      {/* STATE: checked out */}
      {status === "checked_out" && result && (
        <div className="checkin-state flex w-full max-w-[360px] flex-col items-center text-center">
          <div className="checkin-circle flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#D11F00] bg-[#D11F00]/10">
            <span className="text-[36px] font-black text-[#D11F00]">✓</span>
          </div>
          <h2 className="mt-4 text-[28px] font-black text-white">Checked Out!</h2>
          <p className="mt-1 text-[15px] text-[#444444]">
            See you next time, {result.memberName}
          </p>

          <div className="mt-6 w-full rounded-xl border border-[#1C1C1C] bg-[#111111] p-5 text-left">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[12px] text-[#444444]">Duration</span>
              <span className="text-[20px] font-black text-white">
                {durationText}
              </span>
            </div>
            <div className="my-4 h-px bg-[#1C1C1C]" />
            <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
              <span className="text-[#666666]">
                {result.checkedInAt ? formatTime(result.checkedInAt) : "—"}
              </span>
              <span className="text-[#D11F00]">→</span>
              <span className="text-[#666666]">
                {result.checkedOutAt ? formatTime(result.checkedOutAt) : "—"}
              </span>
            </div>
          </div>

          <p className="mt-4 text-[12px] text-[#333333]">Great workout! 💪</p>

          {isManualMode && manualCountdown !== null && manualCountdown > 0 ? (
            <p
              key={manualCountdown}
              className="countdown-tick mt-2 text-[11px] text-[#333333]"
            >
              Resetting in {manualCountdown}s...
            </p>
          ) : null}
        </div>
      )}

      {/* STATE: already done */}
      {status === "already_done" && result && (
        <div className="checkin-state flex w-full max-w-[360px] flex-col items-center text-center">
          <div className="checkin-circle flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#666666] bg-[#1C1C1C]">
            <span className="text-[32px] text-[#888888]">ℹ</span>
          </div>
          <h2 className="mt-4 text-[24px] font-black text-white">
            Already done today!
          </h2>
          <p className="mt-1 text-[14px] text-[#444444]">{result.memberName}</p>

          <div className="mt-6 w-full rounded-xl border border-[#1C1C1C] bg-[#111111] p-5 text-left">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[12px] text-[#444444]">Duration</span>
              <span className="text-[20px] font-black text-white">
                {durationText}
              </span>
            </div>
            <div className="my-4 h-px bg-[#1C1C1C]" />
            <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
              <span className="text-[#666666]">
                {result.checkedInAt ? formatTime(result.checkedInAt) : "—"}
              </span>
              <span className="text-[#D11F00]">→</span>
              <span className="text-[#666666]">
                {result.checkedOutAt ? formatTime(result.checkedOutAt) : "—"}
              </span>
            </div>
          </div>

          <p className="mt-4 text-[12px] text-[#333333]">See you tomorrow!</p>

          {isManualMode && manualCountdown !== null && manualCountdown > 0 ? (
            <p
              key={manualCountdown}
              className="countdown-tick mt-2 text-[11px] text-[#333333]"
            >
              Resetting in {manualCountdown}s...
            </p>
          ) : null}
        </div>
      )}

      {/* STATE: not found */}
      {status === "not_found" && (
        <div className="checkin-state flex w-full max-w-[360px] flex-col items-center text-center">
          <div className="checkin-circle flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#EF4444] bg-[#EF4444]/10">
            <span className="text-[36px] font-black text-[#EF4444]">✕</span>
          </div>
          <h2 className="mt-4 text-[24px] font-black text-white">Not registered</h2>
          <p className="mt-1 text-[13px] text-[#444444]">
            This number isn&apos;t in our system
          </p>

          <div className="mt-6 rounded-xl border border-[#1C1C1C] bg-[#111111] px-5 py-3 text-[13px] text-[#666666]">
            Contact your gym owner
          </div>

          <button
            type="button"
            onClick={handleTryAnother}
            className="mt-4 rounded-lg border border-[#242424] bg-transparent px-5 py-2.5 text-[12px] font-bold uppercase text-[#444444] hover:text-[#888888]"
          >
            Try another number
          </button>
        </div>
      )}

      {/* STATE: error */}
      {status === "error" && (
        <div className="checkin-state flex max-w-[360px] flex-col items-center text-center">
          <p className="text-[15px] text-[#EF4444]">{errorMessage}</p>
          <button
            type="button"
            onClick={() => {
              setStatus("idle")
              setErrorMessage("")
            }}
            className="mt-6 rounded-xl bg-[#D11F00] px-6 py-4 text-[14px] font-black uppercase tracking-[0.1em] text-white"
          >
            Try again
          </button>
        </div>
      )}

      {/* Footer: Not you / New member */}
      {showFooterLink ? (
        <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <button
            type="button"
            onClick={handleNotYou}
            className="text-[11px] text-[#333333] transition-colors hover:text-[#666666]"
          >
            {isManualMode ? "New member" : "Not you?"}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function CheckinFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#080808] px-6">
      <div className="checkin-spin h-12 w-12 rounded-full border-2 border-[#D11F00] border-t-transparent" />
      <p className="mt-4 text-[14px] text-[#444444]">Loading...</p>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .checkin-spin { animation: spin 0.8s linear infinite; }
      `}</style>
    </div>
  )
}

export default function CheckinPage() {
  return (
    <Suspense fallback={<CheckinFallback />}>
      <CheckinContent />
    </Suspense>
  )
}
