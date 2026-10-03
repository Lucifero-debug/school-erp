// lib/whatsapp.ts
//
// Parent messaging over the WhatsApp Cloud API.
//
// Business-initiated messages must use a pre-approved template — you
// cannot send free text to someone who has not messaged you in the
// last 24 hours. Create the templates in Meta Business Manager first.
//
// Only guardians with messagingConsent are ever contacted. See
// CONTEXT.md §7: this is children's data and the consent is the
// guardian's to give and to withdraw.

const GRAPH_VERSION = "v26.0"; // check your app dashboard for the current one

export type SendResult = { ok: true } | { ok: false; reason: string };

export function isConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

export function feeTemplate(): string | undefined {
  return process.env.WHATSAPP_FEE_TEMPLATE;
}

export function absenceTemplate(): string | undefined {
  return process.env.WHATSAPP_ABSENCE_TEMPLATE;
}

// Indian numbers stored as 10 digits need the country code.
function e164(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;

  return digits;
}

export async function sendTemplate(
  phone: string,
  templateName: string,
  bodyParams: string[]
): Promise<SendResult> {
  if (!isConfigured()) {
    return { ok: false, reason: "WhatsApp is not configured" };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: e164(phone),
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
          components: [
            {
              type: "body",
              // Order must match the {{1}} {{2}} … placeholders in the
              // approved template, exactly.
              parameters: bodyParams.map((text) => ({ type: "text", text })),
            },
          ],
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("whatsapp send failed:", res.status, detail);
      return { ok: false, reason: `WhatsApp returned ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    console.error("whatsapp request failed:", err);
    return { ok: false, reason: "Could not reach WhatsApp" };
  }
}
