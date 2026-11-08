/**
 * EDITABLE LEGAL PLACEHOLDERS. These are structure-only drafts, not legal advice and not legally approved.
 * Replace with counsel-reviewed text before launch (Impressum per §5 DDG, GDPR Art. 13 information,
 * consumer information per BGB/EGBGB, withdrawal rules for perishable food, LMIV food information).
 */
export type LegalSlug = "privacy" | "imprint" | "terms" | "agb";

export const legalContent: Record<LegalSlug, { heading: string; body: string[] }[]> = {
  agb: [
    {
      heading: "AGB & Widerruf der Kevser Fleischerei",
      body: ["Halal Fresh vermittelt Bestellungen. Verkäufer und Lieferant ist die Kevser Fleischerei (Hermannstraße 64, 12049 Berlin).", "[PLATZHALTER: Die AGB und Widerrufsbelehrung der Kevser Fleischerei werden vom Inhaber geliefert und hier im Volltext angezeigt. Die PDF-Fassung wird jeder Bestellbestätigung beigefügt.]"],
    },
  ],
  privacy: [
    {
      heading: "1. Controller",
      body: ["[TODO: Operator of Halal Fresh — legal name, address, contact email.]"],
    },
    {
      heading: "2. Data we process",
      body: [
        "Order data (name, email, phone, delivery address, delivery instructions, order contents) to fulfil your order. Payment is handled by PayPal; we do not receive or store card details.",
        "[TODO: Server logs, retention periods, legal bases (Art. 6 GDPR).]",
      ],
    },
    {
      heading: "3. Recipients",
      body: [
        "The partner butcher receives your name, address, phone number and order contents to prepare and deliver your order. PayPal processes payments. [TODO: hosting, email provider.]",
      ],
    },
    {
      heading: "4. Your rights",
      body: ["[TODO: Access, rectification, erasure, restriction, portability, objection, complaint to a supervisory authority.]"],
    },
    {
      heading: "5. Cookies & local storage",
      body: [
        "We store only what is needed to run the shop: your cart and language preference in your browser. No analytics or advertising cookies are used. If this changes, a consent mechanism must be added first.",
      ],
    },
  ],
  imprint: [
    {
      heading: "Provider of the platform",
      body: [
        "[TODO: Legal name, legal form, address, representative, contact email and phone, commercial register and number, VAT ID if applicable.]",
      ],
    },
    {
      heading: "Seller of the goods",
      body: [
        "Halal Fresh vermittelt Bestellungen. Verkäufer und Lieferant ist die Kevser Fleischerei (Hermannstraße 64, 12049 Berlin).",
        "Goods are sold and fulfilled by the partner butcher named at checkout. [TODO: Butcher legal name, address, register data, food-business registration / supervisory authority.]",
      ],
    },
  ],
  terms: [
    {
      heading: "0. Data sources",
      body: ["Postcode coordinates used for delivery areas: contains data from GeoNames (https://www.geonames.org), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)."],
    },
    {
      heading: "1. Scope & roles",
      body: [
        "Halal Fresh vermittelt Bestellungen. Verkäufer und Lieferant ist die Kevser Fleischerei (Hermannstraße 64, 12049 Berlin).",
        "Halal Fresh operates the online marketplace and order handling. The contract of sale is concluded with the partner butcher named at checkout. [TODO: confirm contractual structure with counsel.]",
      ],
    },
    {
      heading: "2. Minimum order & delivery",
      body: [
        "A minimum merchandise value applies per delivery address, depending on the postcode (shown in the cart). Delivery is free. Delivery is available only in the delivery area and on the dates and in the slots offered at checkout.",
      ],
    },
    {
      heading: "3. Prices & payment",
      body: [
        "Prices are the shop prices of Kevser Fleischerei in euro per kilogram, without a delivery fee. Meat is weighed before delivery; you pay the weighed amount, at most the maximum announced at checkout. [TODO: VAT statement per applicable law.]",
      ],
    },
    {
      heading: "4. Withdrawal & perishable goods",
      body: [
        "[TODO: Counsel to confirm the exclusion of the right of withdrawal for quickly perishable goods (§312g BGB) and required wording.]",
      ],
    },
    {
      heading: "5. Liability & complaints",
      body: ["[TODO: Statutory warranty information, contact for complaints, dispute resolution notice (VSBG).]"],
    },
  ],
};
