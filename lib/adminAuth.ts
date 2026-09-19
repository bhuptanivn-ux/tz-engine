import { NextRequest } from "next/server";

export function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false; // fail closed if not configured
  const supplied = req.headers.get("x-admin-password") ?? "";
  return supplied === expected;
}
