import { execSync } from "node:child_process";
import { seedE2eProducts } from "./fixtures";

export default async function globalSetup() {
  const env = {
    ...process.env,
    DATABASE_URL: "postgresql://raghayev@localhost:5432/halalfresh_test",
    ADMIN_EMAIL: "e2e-admin@example.com",
    ADMIN_PASSWORD: "e2e-password-123",
  };
  execSync(
    `psql ${env.DATABASE_URL} -c 'TRUNCATE "OrderEvent","Notification","Consent","Payment","OrderItem","Order","Address","Customer","Setting","WaitlistEntry","DeliveryBlackoutDate","PostcodeRoute","RouteSchedule","DeliveryRoute","DeliveryZone","ProductImage","SupplierArticle","Product","Category","MerchantSettings","Merchant","AdminUser","AuditLog","ProcessedWebhookEvent","RateLimit" RESTART IDENTITY CASCADE'`,
    { stdio: "ignore" },
  );
  execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
  execSync("npx tsx scripts/catalog-import.ts --apply --hide-legacy-demo", { env, stdio: "inherit" });
  await seedE2eProducts(env.DATABASE_URL);
  execSync(`psql ${env.DATABASE_URL} -c "UPDATE \\"Merchant\\" SET \\"whatsappNumber\\"='4915112345678', name='E2E Butcher'"`, {
    stdio: "ignore",
  });
}
