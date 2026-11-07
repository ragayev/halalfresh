import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { formatImportReport, runCatalogImport } from "../src/server/catalog-import";

// Create-only legacy catalogue import. DRY-RUN BY DEFAULT.
//   npm run catalog:import                       report only
//   npm run catalog:import -- --apply            write (creates missing rows, never modifies existing ones)
//   npm run catalog:import -- --apply --hide-legacy-demo   additionally unpublish the early fictional demo products
const args = new Set(process.argv.slice(2));
const db = new PrismaClient();
runCatalogImport(db, { apply: args.has("--apply"), hideLegacyDemo: args.has("--hide-legacy-demo") })
  .then((r) => {
    console.log(formatImportReport(r));
    if (r.problems.length) process.exitCode = 1;
    else if (!args.has("--apply")) console.log("\nDry-run only. Re-run with --apply to write.");
  })
  .finally(() => db.$disconnect());
