import { expect, test, type Page } from "@playwright/test";

async function addLamb(page: Page, clicks: number) {
  await page.goto("/en/products/lamb-chops");
  // Product page offers 500 g or 1 kg (default 1 kg); the test's final add-to-cart click adds the last 1 kg.
  for (let i = 0; i < clicks / 2; i++) await page.getByTestId("add-to-cart").click();
}

test.describe.serial("customer journey", () => {
  test("browse catalogue and categories from the database", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trusted Halal Meat, Ready to Order.");
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

  test("postcode verification", async ({ page }) => {
    await page.goto("/en");
    await page.getByLabel("Enter your postcode").fill("80331");
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByRole("status").filter({ hasText: "don't deliver" })).toBeVisible();
    await page.getByLabel("Enter your postcode").fill("10115");
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByRole("status").filter({ hasText: "we deliver to 10115" })).toBeVisible();
  });

  test("cart enforces the €150 minimum and persists", async ({ page }) => {
    await addLamb(page, 2); // 2 kg = €55.98
    await page.getByTestId("add-to-cart").click();
    await page.goto("/en/cart");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByTestId("min-order-progress")).toContainText("Add €94.02 more to place your order");
    await expect(page.getByTestId("checkout-btn")).toBeDisabled();
    // change quantity in cart: +500 g steps
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await expect(page.getByTestId("subtotal")).toHaveText("€69.98");
    await page.reload();
    await expect(page.getByTestId("cart-line")).toHaveCount(1); // persisted
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Increase quantity" }).click();
    await expect(page.getByTestId("min-order-progress")).toContainText("Minimum order reached");
    await expect(page.getByTestId("checkout-btn")).toBeEnabled();
    // dropping below again re-blocks checkout
    await page.getByRole("button", { name: "Decrease quantity" }).click();
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

  test("German and Turkish interfaces", async ({ page }) => {
    await page.goto("/de");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vertrauenswürdiges Halal-Fleisch, bereit zur Bestellung.");
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
