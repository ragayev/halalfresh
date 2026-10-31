import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { signSession, verifySession } from "@/server/auth";
import { proxy } from "@/proxy";

describe("admin session", () => {
  it("accepts a valid token and rejects missing, tampered, wrong-key and expired ones", async () => {
    const good = await signSession("id1", "a@b.c");
    expect(await verifySession(good)).toEqual({ id: "id1", email: "a@b.c" });
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession(good.slice(0, -2) + "xx")).toBeNull();
    const forged = await new SignJWT({ email: "a@b.c" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("id1")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("another-secret-another-secret-another"));
    expect(await verifySession(forged)).toBeNull();
    const expired = await new SignJWT({ email: "a@b.c" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("id1")
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
    expect(await verifySession(expired)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"id1","email":"a@b.c"}').toString("base64url")}.`;
    expect(await verifySession(none)).toBeNull();
  });
});

describe("proxy gate", () => {
  it("redirects anonymous admin requests to login and marks admin noindex", () => {
    const res = proxy(new NextRequest("http://localhost:3000/admin/orders"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/admin/login");
    const login = proxy(new NextRequest("http://localhost:3000/admin/login"));
    expect(login.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("redirects locale-less storefront paths using Accept-Language", () => {
    const res = proxy(
      new NextRequest("http://localhost:3000/shop", {
        headers: { "accept-language": "tr-TR,tr;q=0.9" },
      }),
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/tr/shop");
    expect(
      proxy(
        new NextRequest("http://localhost:3000/", {
          headers: { "accept-language": "fr" },
        }),
      ).headers.get("location"),
    ).toBe("http://localhost:3000/en");
  });
});
