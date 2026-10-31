import { execSync } from "node:child_process";

export default async function globalSetup() {
  const env = {
    ...process.env,
    DATABASE_URL: "postgresql://raghayev@localhost:5432/halalfresh_test",
    ADMIN_EMAIL: "e2e-admin@example.com",
    ADMIN_PASSWORD: "e2e-password-123",
  };
  execSync(
    `psql ${env.DATABASE_URL} -c 'TRUNCATE "OrderEvent","Refund","Payment","CommissionRecord","OrderItem","Order","Address","Customer","DeliverySlot","DeliveryPostcode","DeliveryZone","ProductImage","Product","Category","MerchantSettings","Merchant","AdminUser","AuditLog","ProcessedWebhookEvent","RateLimit" RESTART IDENTITY CASCADE'`,
    { stdio: "ignore" },
  );
  execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
  execSync(`psql ${env.DATABASE_URL} -c "UPDATE \\"Merchant\\" SET \\"whatsappNumber\\"='4915112345678', name='E2E Butcher'"`, {
    stdio: "ignore",
  });
  // Make every weekday bookable so the suite is date-independent.
  execSync(
    `psql ${env.DATABASE_URL} -c "INSERT INTO \\"DeliverySlot\\" (id,\\"zoneId\\",weekday,\\"startTime\\",\\"endTime\\",\\"isActive\\") SELECT 'e2e'||g, z.id, g, '09:00','12:00', true FROM generate_series(0,6) g, \\"DeliveryZone\\" z ON CONFLICT DO NOTHING"`,
    { stdio: "ignore" },
  );
}
