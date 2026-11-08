import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { formatAuditReport, runCatalogAudit } from "../src/server/catalog-audit";

// Read-only reconciliation report. Usage: npm run catalog:audit [-- --json]
// Point it at staging/production with DATABASE_URL=... npm run catalog:audit
const db = new PrismaClient();
runCatalogAudit(db)
  .then((r) => console.log(process.argv.includes("--json") ? JSON.stringify(r, null, 2) : formatAuditReport(r)))
  .finally(() => db.$disconnect());
