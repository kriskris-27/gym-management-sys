"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import { DateTime } from "luxon"
import { GYM_TIMEZONE } from "@/lib/gym-datetime"
import { formatDuration } from "@/lib/utils"

type CheckinStatus =
  | "idle"
  | "loading"
  | "checked_in"
  | "checked_out"
  | "already_done"
  | "not_found"
  | "inactive"
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
/** QR mode: after CHECKED_IN, block auto POST on reload until explicit checkout (avoids accidental Chrome revisit). */
const RESUME_CHECKIN_KEY = "gym_checkin_resume"
const PHONE_REGEX = /^[6-9]\d{9}$/

type ResumePayload = { phone: string; memberName: string; checkedInAt: string }

function readResume(): ResumePayload | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(RESUME_CHECKIN_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as ResumePayload
    if (!p.phone || !PHONE_REGEX.test(p.phone)) return null
    if (!p.checkedInAt) {
      clearResume()
      return null
    }
    const checkInZ = DateTime.fromISO(p.checkedInAt, {
      zone: "utc",
    }).setZone(GYM_TIMEZONE)
    const todayStart = DateTime.now().setZone(GYM_TIMEZONE).startOf("day")
    if (!checkInZ.isValid || !checkInZ.hasSame(todayStart, "day")) {
      clearResume()
      return null
    }
    return p
  } catch {
    return null
  }
}

function writeResume(payload: ResumePayload) {
  localStorage.setItem(RESUME_CHECKIN_KEY, JSON.stringify(payload))
}

function clearResume() {
  localStorage.removeItem(RESUME_CHECKIN_KEY)
}

let autoCheckinStarted = false

function tryCloseBrowserTab() {
  window.close()
}

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
          clearResume()
          setStatus("not_found")
          return
        }

        if (data.status === "INACTIVE") {
          // Don't clear localStorage — phone is valid
          // member just needs to renew
          setResult(data as ScanResult)
          setStatus("inactive")
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

        if (data.status === "CHECKED_IN") {
          setPhone(phoneNumber)
          if (!isManualMode) {
            writeResume({
              phone: phoneNumber,
              memberName: data.memberName ?? "Member",
              checkedInAt: data.checkedInAt ?? "",
            })
          }
          setStatus("checked_in")
        } else if (data.status === "CHECKED_OUT") {
          if (!isManualMode) clearResume()
          setStatus("checked_out")
        } else if (data.status === "ALREADY_DONE") {
          if (!isManualMode) clearResume()
          setStatus("already_done")
        } else {
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
    if (!saved || !PHONE_REGEX.test(saved)) return

    const resume = readResume()
    if (resume && resume.phone === saved) {
      autoCheckinStarted = true
      setTimeout(() => {
        setPhone(resume.phone)
        setResult({
          status: "CHECKED_IN",
          memberName: resume.memberName,
          checkedInAt: resume.checkedInAt,
        })
        setStatus("checked_in")
      }, 0)
      return
    }

    autoCheckinStarted = true
    setTimeout(() => {
      void handleScan(saved)
    }, 0)
  }, [isManualMode, handleScan])

  useEffect(() => {
    if (!isManualMode) {
      // Use setTimeout to avoid calling setState synchronously in effect
      setTimeout(() => {
        setManualCountdown(null)
      }, 0)
      return
    }
    if (
      status !== "checked_in" &&
      status !== "checked_out" &&
      status !== "already_done"
    ) {
      // Use setTimeout to avoid calling setState synchronously in effect
      setTimeout(() => {
        setManualCountdown(null)
      }, 0)
      return
    }

    let n = 5
    // Use setTimeout to avoid calling setState synchronously in effect
    setTimeout(() => {
      setManualCountdown(n)
    }, 0)
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
      clearResume()
    }
    setStatus("idle")
    setPhone("")
    setResult(null)
    setFormError("")
    setManualCountdown(null)
  }

  const handleTryAnother = () => {
    localStorage.removeItem(STORAGE_KEY)
    clearResume()
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

  const canCheckout =
    status === "checked_in" && PHONE_REGEX.test(phone)

  return (
    <div
      className={`relative flex min-h-dvh flex-col items-center justify-center overflow-x-hidden bg-[#080808] px-4 sm:px-6 md:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] ${
        showFooterLink ? "pb-24" : ""
      } pb-[max(1.25rem,env(safe-area-inset-bottom))]`}
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
        <div className="checkin-state flex w-full max-w-[min(100%,26rem)] flex-col items-center">
          <div className="mb-10 flex flex-col items-center">
            <Image
              src="/logo.png"
              alt="Royal Fitness logo"
              width={72}
              height={72}
              priority
              className="h-[72px] w-[72px] object-contain"
            />
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
        <div className="checkin-state flex w-full max-w-[min(100%,26rem)] flex-col items-center text-center">
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

          <p className="mt-4 text-[12px] leading-relaxed text-[#555555]">
            When leaving, open this link again and tap{" "}
            <span className="text-[#888888]">Check out</span>. Reopening this page
            by mistake won&apos;t check you out.
          </p>

          <div className="mt-6 flex w-full flex-col gap-3">
            <button
              type="button"
              disabled={!canCheckout}
              onClick={() => {
                if (canCheckout) void handleScan(phone)
              }}
              className="w-full rounded-xl border border-[#D11F00]/40 bg-[#D11F00]/15 py-4 text-[14px] font-black uppercase tracking-[0.08em] text-[#D11F00] transition-all duration-200 hover:bg-[#D11F00]/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Check out
            </button>
            <button
              type="button"
              onClick={() => tryCloseBrowserTab()}
              className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414] py-3.5 text-[12px] font-bold uppercase tracking-[0.06em] text-[#888888] transition-colors hover:border-[#333333] hover:text-[#b0b0b0] active:scale-[0.99]"
            >
              Close tab
            </button>
            <p className="text-center text-[10px] text-[#333333]">
              &quot;Close tab&quot; may not work in all browsers; you can switch
              apps or swipe the tab away.
            </p>
          </div>

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
        <div className="checkin-state flex w-full max-w-[min(100%,26rem)] flex-col items-center text-center">
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

          <button
            type="button"
            onClick={() => tryCloseBrowserTab()}
            className="mt-6 w-full rounded-xl border border-[#2A2A2A] bg-[#141414] py-3.5 text-[12px] font-bold uppercase tracking-[0.06em] text-[#888888] transition-colors hover:border-[#333333] hover:text-[#b0b0b0] active:scale-[0.99]"
          >
            Close tab
          </button>

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
        <div className="checkin-state flex w-full max-w-[min(100%,26rem)] flex-col items-center text-center">
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

          <button
            type="button"
            onClick={() => tryCloseBrowserTab()}
            className="mt-6 w-full rounded-xl border border-[#2A2A2A] bg-[#141414] py-3.5 text-[12px] font-bold uppercase tracking-[0.06em] text-[#888888] transition-colors hover:border-[#333333] hover:text-[#b0b0b0] active:scale-[0.99]"
          >
            Close tab
          </button>

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

      {/* STATE: inactive — Membership Expired */}
      {status === "inactive" && result && (
        <div className="checkin-state flex w-full max-w-[min(100%,26rem)] flex-col items-center text-center">
          <div className="checkin-circle flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#F59E0B] bg-[#F59E0B]/10">
            <span className="text-[36px] text-[#F59E0B]">⏰</span>
          </div>
          <h2 className="mt-4 text-[26px] font-black text-white">
            Membership Expired
          </h2>
          <p className="mt-2 text-[14px] text-[#666666]">
            Hi {result?.memberName}
          </p>

          <div className="mt-6 w-full rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/10 px-5 py-4">
            <p className="text-center text-[13px] font-medium text-[#F59E0B]">
              Your membership has expired.
            </p>
            <p className="mt-1 text-center text-[12px] text-[#888888]">
              Please contact your gym owner to renew.
            </p>
          </div>

          <button
            type="button"
            onClick={handleNotYou}
            className="mt-8 text-[11px] text-[#333333] transition-colors hover:text-[#666666]"
          >
            Not you?
          </button>
        </div>
      )}

      {/* STATE: not found */}
      {status === "not_found" && (
        <div className="checkin-state flex w-full max-w-[min(100%,26rem)] flex-col items-center text-center">
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
        <div className="checkin-state flex w-full max-w-[min(100%,26rem)] flex-col items-center text-center">
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
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#080808] px-4 sm:px-6 pb-[env(safe-area-inset-bottom)]">
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
