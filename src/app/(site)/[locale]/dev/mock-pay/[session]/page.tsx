import { notFound, redirect } from "next/navigation";
import { gatewayName } from "@/lib/env";
import { simulateMockPayment } from "@/server/payments/mock-actions";
import { db } from "@/lib/db";
import { formatMoney } from "@/domain/money";
import { Button, Card } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

/** Stand-in for Stripe-hosted Checkout. Only reachable when PAYMENT_GATEWAY=mock and never in production. */
export default async function MockPay({
  params,
  searchParams,
}: {
  params: Promise<{ session: string }>;
  searchParams: Promise<{ success?: string; cancel?: string }>;
}) {
  if (gatewayName() !== "mock" || process.env.NODE_ENV === "production") notFound();
  const { session } = await params;
  const { success, cancel } = await searchParams;
  const payment = await db.payment.findUnique({
    where: { stripeCheckoutSessionId: session },
    include: { order: true },
  });
  if (!payment || !success || !cancel || !success.startsWith(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost")) notFound();

  async function pay() {
    "use server";
    await simulateMockPayment(session, "paid");
    redirect(success!);
  }
  async function sepa() {
    "use server";
    await simulateMockPayment(session, "sepa_initiated");
    redirect(success!);
  }
  async function abort() {
    "use server";
    redirect(cancel!);
  }
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="space-y-4 p-6 text-center">
        <p className="rounded-full bg-warn px-3 py-1 text-xs font-bold uppercase text-warn-ink">Mock payment — test only</p>
        <p className="text-sm text-muted">Order #HF-{payment.order.number}</p>
        <p className="text-3xl font-bold">{formatMoney(payment.amountCents, "en")}</p>
        <form action={pay}>
          <Button size="lg" full type="submit" data-testid="mock-pay">
            Pay (simulated)
          </Button>
        </form>
        <form action={sepa}>
          <Button size="lg" full variant="secondary" type="submit" data-testid="mock-sepa">
            Authorize SEPA debit (simulated, not yet collected)
          </Button>
        </form>
        <form action={abort}>
          <Button variant="secondary" full type="submit" data-testid="mock-cancel">
            Cancel
          </Button>
        </form>
      </Card>
    </div>
  );
}
