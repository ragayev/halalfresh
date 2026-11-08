import { db } from "@/lib/db";

/** Admin-editable settings (key/value). Defaults apply until a value is saved. */
export const SETTING_DEFAULTS = {
  /** Price tolerance in basis points (1000 = 10 %). Snapshotted on every order. */
  toleranceBps: 1000,
  /** WEIGHED PayPal orders unpaid after this many hours are highlighted. */
  paymentOverdueHours: 12,
  /** Public order link stays valid this many days after a terminal state. */
  tokenExpiryDays: 30,
  /** Orders after this Berlin time count as next day. */
  orderCutoffTime: "18:00",
  /** Preferred-delivery windows and how many days ahead the customer may pick. */
  deliveryWindows: ["10:00–14:00", "14:00–18:00", "18:00–21:00"] as string[],
  deliveryDaysAhead: 5,
  /** Only render the halal proof badge when the operator has verified it. */
  halalCertificateVerified: false,
  /** Telegram admin notification target (bot token comes from env). */
  telegramChatId: "",
  /** Wording shown beside the optional checkboxes; the version is stored with each consent. */
  consentWording: {
    terms: { version: "2026-11-draft", de: "Ich akzeptiere die AGB der Kevser Fleischerei und die Nutzungsbedingungen von Halal Fresh.", tr: "Kevser Fleischerei AGB'sini ve Halal Fresh kullanım koşullarını kabul ediyorum." },
    marketing: { version: "2026-11-draft", de: "Ich möchte Angebote und Neuigkeiten per E-Mail/SMS erhalten (jederzeit widerrufbar).", tr: "Kampanya ve haberleri e-posta/SMS ile almak istiyorum (her zaman geri alınabilir)." },
    dataTransfer: { version: "PENDING-LEGAL-REVIEW", required: false, de: "[Wortlaut folgt nach anwaltlicher Prüfung]", tr: "[Hukuki inceleme sonrası eklenecek]" },
  },
  /** Kevser's WhatsApp order template (Turkish), see src/domain/whatsapp.ts. */
  whatsappTemplate: "",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K] extends infer T ? (T extends readonly unknown[] ? T : T) : never;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row ? row.value : SETTING_DEFAULTS[key]) as SettingValue<K>;
}

export async function getSettings(): Promise<typeof SETTING_DEFAULTS> {
  const rows = await db.setting.findMany();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in SETTING_DEFAULTS) out[r.key] = r.value;
  return out as unknown as typeof SETTING_DEFAULTS;
}

export async function setSetting(key: SettingKey, value: unknown) {
  if (!(key in SETTING_DEFAULTS)) throw new Error(`Unknown setting ${key}`);
  await db.setting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
}
