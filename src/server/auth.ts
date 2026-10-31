import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { compare } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { AppError } from "./errors";

export const SESSION_COOKIE = "hf_admin";
const TTL_SECONDS = 60 * 60 * 8;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(s);
}

export async function signSession(adminId: string, email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    return payload.sub && typeof payload.email === "string" ? { id: payload.sub, email: payload.email } : null;
  } catch {
    return null;
  }
}

export async function getAdmin() {
  const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  // Re-check existence so deleting an admin revokes access immediately.
  const user = await db.adminUser.findUnique({
    where: { id: s.id },
    select: { id: true, email: true },
  });
  return user;
}

/** Call at the top of every admin page, server action and route handler. */
export async function requireAdmin() {
  const a = await getAdmin();
  if (!a) redirect("/admin/login");
  return a;
}

export async function requireAdminApi() {
  const a = await getAdmin();
  if (!a) throw new AppError("UNAUTHORIZED", "Unauthorized", 401);
  return a;
}

export async function login(email: string, password: string): Promise<boolean> {
  const ip = clientIp(await headers());
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`login:ip:${ip}`, 10, 900),
    rateLimit(`login:email:${email.toLowerCase()}`, 5, 900),
  ]);
  if (!byIp.ok || !byEmail.ok) throw new AppError("RATE_LIMITED", "Too many attempts. Try again in 15 minutes.", 429);
  const user = await db.adminUser.findUnique({
    where: { email: email.toLowerCase() },
  });
  // Compare against a dummy hash when the user is unknown to keep timing similar.
  const ok = await compare(password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  if (!user || !ok) return false;
  const token = await signSession(user.id, user.email);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return true;
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
}
