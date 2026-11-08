import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
process.env.PAYMENT_PROVIDER = "mock";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
delete process.env.SMTP_URL;
delete process.env.SEVEN_API_KEY;
delete process.env.TELEGRAM_BOT_TOKEN;
