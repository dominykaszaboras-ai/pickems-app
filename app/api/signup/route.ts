import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { clientIp, isSameOrigin, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(40),
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  // CSRF gate: signup is a state-changing endpoint; only accept requests
  // whose Origin/Referer point at our own host.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Per-IP throttle to stop signup spam + email enumeration brute force.
  const ip = clientIp(req);
  const ipLimit = rateLimit({
    key: `signup:ip:${ip}`,
    limit: 5,
    windowMs: 60 * 60 * 1000, // 5 signups / hour / IP
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(ipLimit.retryAfterSec) } },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const { email, name, password } = parsed.data;
  const lowerEmail = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
  if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email: lowerEmail, name, passwordHash },
    select: { id: true, email: true, name: true },
  });
  return NextResponse.json({ user });
}
