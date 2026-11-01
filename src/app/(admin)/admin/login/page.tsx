import { redirect } from "next/navigation";
import { getAdmin } from "@/server/auth";
import { loginAction } from "../actions";
import { LoginForm } from "@/components/admin/forms";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Login() {
  if (await getAdmin()) redirect("/admin");
  return (
    <div className="mx-auto max-w-sm py-16">
      <Card className="space-y-5 p-6">
        <h1 className="font-display text-2xl font-normal">Admin sign in</h1>
        <LoginForm action={loginAction} />
      </Card>
    </div>
  );
}
