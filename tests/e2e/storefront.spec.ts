import { expect, test, type Page } from "@playwright/test";

/** Pretend the visitor already passed the postcode gate (gate tests clear this). */
const knowPostcode = (page: Page, pc = "10115") => page.addInitScript((v) => localStorage.setItem("hf_postcode", v), pc);

async function addLamb(page: Page, clicks: number) {
  await page.goto("/en/products/lamb-chops");
  // Product page offers 500 g or 1 kg (default 1 kg); the test's final add-to-cart click adds the last 1 kg.
  for (let i = 0; i < clicks / 2; i++) await page.getByTestId("add-to-cart").click();
}

test.describe.serial("customer journey", () => {
  test.beforeEach(async ({ page }) => knowPostcode(page));

  test("browse catalogue and categories from the database", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fresh Halal Meat, Delivered.");
    await page.goto("/en/shop");
    await expect(page.getByTestId("product-card").first()).toBeVisible();
    await page.goto("/en/shop?category=lamb");
    await expect(page.getByTestId("product-card")).toHaveCount(3);
    await page.getByPlaceholder("Search products").fill("chops");
    await expect(page.getByTestId("product-card")).toHaveCount(1);
    await page.getByPlaceholder("Search products").fill("zzzz");
    await expect(page.getByText("No products found")).toBeVisible();
    await page.goto("/en/shop?category=beef");
    await page.getByRole("link", { name: "Premium Beef Cubes" }).first().click();
    await expect(page.getByTestId("price")).toContainText("€14.99");
  });

  test("first open asks for the postcode: unsupported area gets waitlist + consent, supported shows the next date", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("hf_postcode"));
    await page.goto("/en");
    const gate = page.getByTestId("postcode-gate");
    await expect(gate).toBeVisible();
    await gate.getByLabel("Postcode").fill("1011");
    await gate.getByRole("button", { name: "Check" }).click();
    await expect(gate.getByText("Please enter a valid 5-digit German postcode.")).toBeVisible();

    await gate.getByLabel("Postcode").fill("80331");
    await gate.getByRole("button", { name: "Check" }).click();
    await expect(gate.getByTestId("unsupported")).toContainText("Once 10 people from your area sign up, we'll come.");
    const form = gate.getByTestId("waitlist-form");
    await form.getByLabel("Name", { exact: true }).fill("Aylin Test");
    await form.getByLabel("Phone or email").fill("aylin@example.com");
    await expect(form.getByRole("checkbox")).not.toBeChecked(); // never pre-ticked
    await expect(form.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/en/legal/privacy");
    await form.getByRole("button", { name: "Notify me" }).click();
    await expect(form.getByText("Please confirm your consent.")).toBeVisible();
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Notify me" }).click();
    await expect(gate.getByText("We'll contact you when we start delivering to 80331")).toBeVisible();

    await gate.getByLabel("Postcode").fill("10115");
    await gate.getByRole("button", { name: "Check" }).click();
    await expect(gate.getByTestId("next-slot")).toContainText("14:00–18:00");
    await expect(gate.getByTestId("delivery-info")).toContainText("Minimum order €60.00");
    await expect(gate.getByTestId("delivery-info")).toContainText("Delivery fee €4.90");
    await gate.getByRole("button", { name: "Continue" }).click();
    await expect(gate).toBeHidden();
    await expect(page.getByTestId("postcode-chip")).toContainText("Delivery to 10115");
    await page.reload(); // persisted
    await expect(page.getByTestId("postcode-gate")).toBeHidden();
    await expect(page.getByTestId("postcode-chip")).toContainText("Delivery to 10115");
    // change from the header
    await page.getByTestId("postcode-chip").click();
    await page.getByTestId("postcode-gate").getByLabel("Postcode").fill("03046");
    await page.getByTestId("postcode-gate").getByRole("button", { name: "Check" }).click();
    await expect(page.getByTestId("postcode-gate").getByTestId("delivery-info")).toContainText("Preorder only");
  });

  test("legal pages are never blocked by the gate", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("hf_postcode"));
    await page.goto("/en/legal/privacy");
    await expect(page.getByTestId("postcode-gate")).toBeHidden();
  });

  test("cart enforces the zone minimum (€60 in Berlin), shows free-delivery progress and persists", async ({ page }) => {
    await addLamb(page, 2); // 2 kg = €55.98
    await page.getByTestId("add-to-cart").click();
    await page.goto("/en/cart");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByTestId("min-order-progress")).toContainText("Add €4.02 more to place your order");
    await expect(page.getByTestId("checkout-btn")).toBeDisabled();
    // change quantity in cart: +500 g steps
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await expect(page.getByTestId("subtotal")).toHaveText("€69.98");
    await expect(page.getByTestId("min-order-progress")).toContainText("Minimum order reached");
    await expect(page.getByTestId("free-delivery-progress")).toContainText("Add €50.02 more for free delivery");
    await expect(page.getByTestId("checkout-btn")).toBeEnabled();
    await page.reload();
    await expect(page.getByTestId("cart-line")).toHaveCount(1); // persisted
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Increase quantity" }).click();
    await expect(page.getByTestId("free-delivery-progress")).toContainText("You get free delivery");
    // dropping below the minimum re-blocks checkout
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Decrease quantity" }).click();
    await expect(page.getByTestId("checkout-btn")).toBeDisabled();
    await page.getByRole("button", { name: "Increase quantity" }).click();
  });

  test("checkout validation, payment, and confirmation", async ({ page }) => {
    await addLamb(page, 10); // 6 kg => €167.94
    await page.getByTestId("add-to-cart").click();
    await page.goto("/en/checkout");
    await page.getByTestId("pay-btn").click();
    await expect(page.getByText("Please check the highlighted fields.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();

    await page.getByLabel("Full name").fill("Aylin Test");
    await page.getByLabel("Email address").fill("aylin@example.com");
    await page.getByLabel("Phone number").fill("+49 151 2345678");
    await page.getByLabel("Street and house number").fill("Teststraße 12");
    await page.getByLabel("Postal code").fill("80331");
    await expect(page.getByText("We don't deliver to this postcode yet.").first()).toBeVisible();
    await page.getByLabel("Postal code").fill("10115");
    await expect(page.getByText("Your delivery postcode is now 10115")).toBeVisible();
    await page.getByLabel("City").fill("Berlin");
    await page.getByLabel("Delivery instructions (optional)").fill("Leave with neighbour");
    await expect(page.getByTestId("estimate")).toContainText("Estimated delivery");
    await expect(page.getByTestId("estimate")).not.toContainText("Enter a supported postcode");
    await page.getByRole("checkbox").check();
    await expect(page.getByTestId("grand-total")).toHaveText("€167.94");
    await page.getByTestId("pay-btn").click();

    await expect(page).toHaveURL(/dev\/mock-pay/);
    await page.getByTestId("mock-pay").click();
    await expect(page).toHaveURL(/checkout\/success/);
    await expect(page.getByRole("heading", { name: "Thank you for your order!" })).toBeVisible();
    await expect(page.getByTestId("order-number")).toContainText("#HF-");
    await expect(page.getByText("Lamb Chops")).toBeVisible();
    await expect(page.getByText("Teststraße 12")).toBeVisible();
    // cart is cleared after a confirmed payment
    await page.goto("/en/cart");
    await expect(page.getByText("Your cart is empty")).toBeVisible();
  });

  test("order pages are not reachable by guessable ids", async ({ page }) => {
    await page.goto("/en/order/1");
    await expect(page.getByText("Order not found")).toBeVisible();
  });

  test("cancelled payment keeps the cart", async ({ page }) => {
    await addLamb(page, 10);
    await page.getByTestId("add-to-cart").click();
    await page.goto("/en/checkout");
    await page.getByLabel("Full name").fill("Cancel Test");
    await page.getByLabel("Email address").fill("cancel@example.com");
    await page.getByLabel("Phone number").fill("+49 151 2345678");
    await page.getByLabel("Street and house number").fill("Teststraße 1");
    await page.getByLabel("Postal code").fill("10115");
    await page.getByLabel("City").fill("Berlin");
    await expect(page.getByTestId("estimate")).toContainText("Estimated delivery");
    await expect(page.getByTestId("estimate")).not.toContainText("Enter a supported postcode");
    await page.getByRole("checkbox").check();
    await page.getByTestId("pay-btn").click();
    await page.getByTestId("mock-cancel").click();
    await expect(page.getByRole("heading", { name: "Payment cancelled" })).toBeVisible();
    await page.goto("/en/cart");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
  });

  test("unknown browser languages fall back to German", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "fr-FR", extraHTTPHeaders: { "accept-language": "fr-FR,fr;q=0.9" } });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/de$/);
    await ctx.close();
  });

  test("German and Turkish interfaces", async ({ page }) => {
    await page.goto("/de");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Frisches Halal-Fleisch, geliefert.");
    await page.goto("/de/shop");
    await expect(page.getByText(/14,99\s€/).first()).toBeVisible();
    await page.goto("/tr/products/lamb-chops");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kuzu Pirzola");
  });
});

test.describe("admin", () => {
  test("requires login, shows paid orders, and prepares WhatsApp forwarding", async ({ page, context }) => {
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/admin\/login/);
    await page.getByLabel("Email").fill("e2e-admin@example.com");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password")).toBeVisible();
    await page.getByLabel("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.goto("/admin/orders");
    const row = page.getByTestId("orders-table").getByRole("row").filter({ hasText: "Aylin Test" }).first();
    await expect(row).toContainText("paid");
    await expect(row).toContainText("€167.94");
    await row.getByRole("link").click();
    await expect(page.getByTestId("order-title")).toContainText("#HF-");
    await expect(page.getByText("Leave with neighbour")).toBeVisible();

    await context.route(/wa\.me|whatsapp\.com/, (r) => r.fulfill({ status: 200, body: "stub" })); // never hit WhatsApp from tests
    const popupPromise = context.waitForEvent("page");
    await page.getByTestId("send-whatsapp").click();
    const popup = await popupPromise;
    expect(popup.url()).toContain("wa.me/4915112345678");
    expect(decodeURIComponent(popup.url())).toContain("NEW HALAL FRESH ORDER");
    await popup.close();
    await expect(page.getByText("opened 1× but not marked as forwarded")).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByTestId("mark-forwarded").click();
    await expect(page.getByText("Already marked as forwarded")).toBeVisible();
    await page.getByTestId("status-CONFIRMED_BY_BUTCHER").click();
    await expect(page.getByTestId("status-PREPARING")).toBeVisible();
  });
});
