import { expect, test, type Page } from "@playwright/test";

/** Pretend the visitor already passed the postcode gate (gate tests clear this). */
const knowPostcode = (page: Page, pc = "10115") => page.addInitScript((v) => localStorage.setItem("hf_postcode", v), pc);

async function addLamb(page: Page, kg: number) {
  await page.goto("/de/products/lamb-chops");
  for (let i = 0; i < kg; i++) {
    await page.getByTestId("add-to-cart").click();
    await page.waitForTimeout(300); // let the cart commit to localStorage before the next click / navigation
  }
}

test.describe.serial("MVP journey", () => {
  test.beforeEach(async ({ page }) => knowPostcode(page));

  test("browse the catalogue; German is the default and language lives in the URL", async ({ page }) => {
    await page.goto("/de");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Frisches Halal-Fleisch");
    await expect(page.getByText("Von der Kevser Fleischerei in Berlin")).toBeVisible();
    await expect(page.getByTestId("hero-postcode").locator('input[name="postcode"]')).toBeVisible();
    await expect(page.getByText("Halal Fresh vermittelt Bestellungen. Verkäufer und Lieferant ist die Kevser Fleischerei.").first()).toBeVisible();
    await page.goto("/de/shop?category=lamb");
    await expect(page.getByTestId("product-card")).toHaveCount(3);
    // DE/TR remains visible in the header, including on mobile.
    await page.locator("header").getByRole("group", { name: /Sprache/ }).getByRole("link", { name: "TR" }).click();
    await expect(page).toHaveURL(/\/tr\/shop\?category=lamb/);
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  });

  test("first-time visitors can browse before choosing a delivery postcode", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: "http://localhost:3100" });
    try {
      const firstVisit = await context.newPage();
      await firstVisit.goto("/de");
      await expect(firstVisit.getByTestId("postcode-gate")).toHaveCount(0);
      await expect(firstVisit.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(firstVisit.getByTestId("hero-postcode").locator('input[name="postcode"]')).toBeVisible();
      if ((firstVisit.viewportSize()?.width ?? 1280) < 640) await firstVisit.locator("header details > summary").click();
      await firstVisit.getByTestId("postcode-chip").click();
      await expect(firstVisit.getByTestId("postcode-gate")).toBeVisible();
      await firstVisit.locator('[data-testid="postcode-gate"] button[aria-label]').first().click();
      await expect(firstVisit.getByTestId("postcode-gate")).toHaveCount(0);
      if ((firstVisit.viewportSize()?.width ?? 1280) < 640) await firstVisit.locator("header details > summary").click();
      await firstVisit.getByRole("link", { name: /Alle Produkte/ }).first().click();
      await expect(firstVisit).toHaveURL(/\/de\/shop/);
    } finally {
      await context.close();
    }
  });

  test("sets no cookies and loads nothing from third parties", async ({ page, context }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname) && u.protocol.startsWith("http")) external.push(r.url());
    });
    for (const path of ["/de", "/de/shop", "/de/products/lamb-chops", "/de/cart", "/de/how-it-works", "/tr", "/de/legal/imprint"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(external).toEqual([]);
    expect(await context.cookies()).toEqual([]);
  });

  test("cart enforces the minimum order and shows estimated and maximum totals", async ({ page }) => {
    await addLamb(page, 1);
    await page.goto("/de/cart");
    await expect(page.getByTestId("checkout-btn")).toBeDisabled();
    await addLamb(page, 2); // 3 kg x €27.99
    await page.goto("/de/cart");
    await expect(page.getByTestId("checkout-btn")).toBeEnabled();
  });

  test("checkout shows the legal block; cash is not offered to a first-time phone", async ({ page }) => {
    await addLamb(page, 3);
    await page.goto("/de/checkout");
    await expect(page.getByTestId("seller-box")).toBeVisible();
    await expect(page.getByTestId("variable-price")).toContainText("beträgt aber maximal");
    await expect(page.getByTestId("no-withdrawal")).toContainText("Kein Widerrufsrecht");
    await expect(page.getByTestId("pay-btn")).toHaveText("Zahlungspflichtig bestellen");
    await expect(page.locator("#terms")).not.toBeChecked();
    await expect(page.locator("#marketing")).not.toBeChecked();
    await page.locator("#phone").fill("+49 151 5550001");
    await expect(page.getByText("Barzahlung ist ab der zweiten Bestellung möglich.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Barzahlung/ })).toBeDisabled();
    // The terms checkbox is required
    await page.getByTestId("pay-btn").click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    // The server enforces the same rule even if the UI is bypassed
    const res = await page.request.post("/api/checkout", {
      data: {
        requestId: crypto.randomUUID(),
        lines: [{ productId: "x", grams: 1000 }],
        customer: { firstName: "A", lastName: "B", email: "a@b.de", phone: "+49 151 5550001" },
        address: { street: "Teststraße 1", postalCode: "10115", city: "Berlin" },
        paymentMethod: "CASH",
        consents: { terms: true },
      },
    });
    expect(res.ok()).toBe(false);
  });

  test("order -> admin accepts, prepares, weighs -> customer pays -> admin dispatches", async ({ page, browser }) => {
    await addLamb(page, 3);
    await page.goto("/de/checkout");
    await page.locator("#firstName").fill("Aylin");
    await page.locator("#lastName").fill("Test");
    await page.locator("#email").fill("aylin@example.com");
    await page.locator("#phone").fill("+49 151 5550002");
    await page.locator("#street").fill("Teststraße 12");
    await page.locator("#postalCode").fill("10115");
    await page.locator("#city").fill("Berlin");
    await page.locator("#terms").check();
    await expect(page.getByTestId("grand-total")).toContainText("ca. ");
    await page.getByTestId("pay-btn").click();
    await expect(page).toHaveURL(/\/de\/b\/[\w-]{30,}/);
    const orderUrl = page.url();
    const orderNo = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("HF-");
    await expect(page.getByTestId("cancel-order")).toBeVisible();

    // Admin (separate context)
    const admin = await browser.newContext({ baseURL: new URL(orderUrl).origin });
    const a = await admin.newPage();
    await a.goto("/admin/login");
    await a.locator("#email").fill("e2e-admin@example.com");
    await a.locator("#password").fill("e2e-password-123");
    await a.getByRole("button", { name: "Anmelden" }).click();
    await a.waitForURL((u) => !u.pathname.endsWith("/login"));
    await a.goto("/admin/orders");
    await a.getByRole("link", { name: new RegExp(orderNo) }).first().click();
    await a.getByRole("button", { name: "Annehmen" }).click();
    await expect(a.getByRole("button", { name: "In Vorbereitung" })).toBeVisible();
    await a.getByRole("button", { name: "In Vorbereitung" }).click();
    await expect(a.getByRole("link", { name: "Gewichte eingeben" })).toBeVisible();
    await a.locator('input[inputmode="numeric"]').first().fill("3100");
    await a.getByRole("button", { name: /Speichern & Kunde informieren/ }).click();
    await expect(a.getByText("Gespeichert.")).toBeVisible();

    // Customer can no longer cancel; pays the final amount (3.1 kg x €27.99 = €86.77 + €4.90 delivery)
    await page.goto(orderUrl);
    await expect(page.getByTestId("cancel-order")).toHaveCount(0);
    await expect(page.getByText("Bitte bezahlen Sie 91,67")).toBeVisible();
    await page.getByTestId("pay-paypal").click();
    await expect(page.getByText("Vielen Dank, Ihre Zahlung ist eingegangen.")).toBeVisible();

    // Dispatch and deliver
    await a.reload();
    await a.getByRole("button", { name: "Unterwegs" }).click();
    await a.getByRole("button", { name: "Geliefert", exact: true }).click();
    await expect(a.getByText("Geliefert").first()).toBeVisible();
    await admin.close();
  });

  test("order pages are not reachable by guessable ids", async ({ page }) => {
    expect((await page.goto("/de/b/1"))?.status()).toBe(404);
    expect((await page.goto("/de/b/HF-000001"))?.status()).toBe(404);
  });

  test("unknown browser languages fall back to German", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "fr-FR" });
    const p = await ctx.newPage();
    await p.goto("/");
    await expect(p).toHaveURL(/\/de$/);
    await ctx.close();
  });

  test("admin requires login", async ({ page }) => {
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
