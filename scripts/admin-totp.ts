import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { generateTotpSecret, otpauthUrl } from "../src/lib/totp";

// Usage: npm run admin:totp -- admin@example.com   (enrols or rotates the admin's authenticator secret)
const email = (process.argv[2] ?? "").toLowerCase();
if (!email) {
  console.error("Usage: npm run admin:totp -- <admin email>");
  process.exit(1);
}
const db = new PrismaClient();
const secret = generateTotpSecret();
db.adminUser
  .update({ where: { email }, data: { totpSecret: secret } })
  .then(() => {
    console.log(`TOTP enabled for ${email}.\nAdd this to your authenticator app:\n  ${otpauthUrl(email, secret)}\nSecret: ${secret}`);
  })
  .catch(() => {
    console.error(`No admin user ${email}. Run npm run db:seed first.`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
