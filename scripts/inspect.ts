// Tiny diagnostic — prints match counts per stage for whatever's active.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const stages = await p.stage.findMany({
    where: { tournament: { hltvEventId: Number(process.env.HLTV_EVENT_ID ?? 8301) } },
    include: {
      _count: { select: { matches: true } },
      matches: { select: { status: true } },
    },
    orderBy: { kind: "asc" },
  });
  for (const s of stages) {
    const finished = s.matches.filter((m) => m.status === "FINISHED").length;
    const live = s.matches.filter((m) => m.status === "LIVE").length;
    const pending = s.matches.filter((m) => m.status === "PENDING").length;
    console.log(
      `${s.kind.padEnd(10)} total=${s._count.matches}  finished=${finished}  live=${live}  pending=${pending}`,
    );
  }
}

main().finally(() => p.$disconnect());
