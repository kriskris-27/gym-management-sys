/**
 * WhatsApp Cloud API (Meta Graph) for template messages.
 * When WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID and template env names are set,
 * sends real templates; otherwise falls back to console stub for local dev.
 */

export type WhatsAppNotifyType = "EXPIRY_5_DAY" | "EXPIRY_1_DAY" | "INACTIVITY"

export type WhatsAppSendResult = {
  ok: boolean
  providerMessageId?: string
  errorCode?: string
  errorMessage?: string
  mode: "cloud" | "stub"
}

function readEnv(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== "" ? v.trim() : undefined
}

export function isWhatsAppCloudConfigured(): boolean {
  return !!(
    readEnv("WHATSAPP_ACCESS_TOKEN") &&
    readEnv("WHATSAPP_PHONE_NUMBER_ID") &&
    readEnv("WHATSAPP_TEMPLATE_EXPIRY_5_DAY") &&
    readEnv("WHATSAPP_TEMPLATE_EXPIRY_1_DAY") &&
    readEnv("WHATSAPP_TEMPLATE_INACTIVITY")
  )
}

/**
 * E.164 digits only (no +), suitable for Cloud API `to` field.
 * 10-digit local numbers get WHATSAPP_PHONE_DEFAULT_CC (e.g. 91) when set.
 */
export function normalizeWhatsAppTo(raw: string, defaultCountryCode?: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const digits = trimmed.replace(/\D/g, "")
  if (!digits) return null

  if (digits.length >= 11 && digits.length <= 15) {
    return digits
  }

  if (digits.length === 10 && defaultCountryCode) {
    const cc = defaultCountryCode.replace(/\D/g, "")
    if (!cc) return null
    const combined = `${cc}${digits}`
    return combined.length <= 15 ? combined : null
  }

  return null
}

type GraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string }
}

type GraphSuccessBody = { messages?: Array<{ id?: string }> }

function buildBodyParameters(texts: string[]): Array<{ type: "text"; text: string }> {
  return texts.map((text) => ({ type: "text" as const, text }))
}

async function postTemplateMessage(params: {
  toDigits: string
  templateName: string
  languageCode: string
  bodyTexts: string[]
}): Promise<WhatsAppSendResult> {
  const token = readEnv("WHATSAPP_ACCESS_TOKEN")!
  const phoneNumberId = readEnv("WHATSAPP_PHONE_NUMBER_ID")!
  const version = readEnv("WHATSAPP_API_VERSION") ?? "v21.0"

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: params.toDigits,
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.languageCode },
      components: [
        {
          type: "body",
          parameters: buildBodyParameters(params.bodyTexts),
        },
      ],
    },
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      errorCode: "NETWORK_ERROR",
      errorMessage: msg,
      mode: "cloud",
    }
  }

  const json = (await res.json()) as GraphSuccessBody & GraphErrorBody

  if (!res.ok) {
    const err = json.error
    const code =
      err?.code != null
        ? String(err.code)
        : err?.error_subcode != null
          ? String(err.error_subcode)
          : "GRAPH_ERROR"
    const message = err?.message ?? res.statusText
    return {
      ok: false,
      errorCode: code,
      errorMessage: message,
      mode: "cloud",
    }
  }

  const id = json.messages?.[0]?.id
  return {
    ok: true,
    providerMessageId: id,
    mode: "cloud",
  }
}

async function sendCloud(
  phone: string,
  type: WhatsAppNotifyType,
  memberName: string,
  meta?: { expiryDate?: string; dueAmount?: number }
): Promise<WhatsAppSendResult> {
  const defaultCc = readEnv("WHATSAPP_PHONE_DEFAULT_CC")
  const toDigits = normalizeWhatsAppTo(phone, defaultCc)
  if (!toDigits) {
    return {
      ok: false,
      errorCode: "INVALID_PHONE",
      errorMessage:
        "Phone could not be normalized to E.164 digits. Use international format or set WHATSAPP_PHONE_DEFAULT_CC for 10-digit local numbers.",
      mode: "cloud",
    }
  }

  const languageCode = readEnv("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en"
  const expiryDate = meta?.expiryDate ?? ""

  if (type === "INACTIVITY") {
    const templateName = readEnv("WHATSAPP_TEMPLATE_INACTIVITY")!
    return postTemplateMessage({
      toDigits,
      templateName,
      languageCode,
      bodyTexts: [memberName],
    })
  }

  const templateName =
    type === "EXPIRY_5_DAY"
      ? readEnv("WHATSAPP_TEMPLATE_EXPIRY_5_DAY")!
      : readEnv("WHATSAPP_TEMPLATE_EXPIRY_1_DAY")!

  return postTemplateMessage({
    toDigits,
    templateName,
    languageCode,
    bodyTexts: [memberName, expiryDate],
  })
}

async function sendStub(
  phone: string,
  type: WhatsAppNotifyType,
  memberName: string,
  meta?: { expiryDate?: string; dueAmount?: number }
): Promise<WhatsAppSendResult> {
  const exp = meta?.expiryDate ?? ""

  const messages: Record<WhatsAppNotifyType, string> = {
    EXPIRY_5_DAY: `Hi ${memberName}, your plan expires in 5 days on ${exp}. Please renew before it ends. Contact us: ROYAL FITNESS`,
    EXPIRY_1_DAY: `Hi ${memberName}, your plan expires TOMORROW on ${exp}. Please renew now. Contact us: ROYAL FITNESS`,
    INACTIVITY: `Hi ${memberName}, we miss you at the gym! It has been 4 days since your last visit. Come back today! ROYAL FITNESS`,
  }

  const msg = messages[type]
  console.log(`[WhatsApp STUB] TO: ${phone} | MSG: ${msg}`)

  return { ok: true, providerMessageId: `stub-${Date.now()}`, mode: "stub" }
}

export async function sendMemberWhatsAppNotification(
  phone: string,
  type: WhatsAppNotifyType,
  memberName: string,
  meta?: { expiryDate?: string; dueAmount?: number }
): Promise<WhatsAppSendResult> {
  if (isWhatsAppCloudConfigured()) {
    return sendCloud(phone, type, memberName, meta)
  }
  return sendStub(phone, type, memberName, meta)
}
