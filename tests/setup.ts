import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
process.env.PAYMENT_GATEWAY = "mock";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_signature_helpers";
