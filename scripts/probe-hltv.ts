// Dump the actual shape of one HLTV results object so we can see why
// normalizeResult is missing team ids.
import HLTV from "hltv";

async function main() {
  console.log("getResults(eventIds=[9028]) — first 2 items:");
  try {
    const r = (await HLTV.getResults({ eventIds: [9028] } as any)) as any[];
    console.log(JSON.stringify(r?.slice(0, 2), null, 2));
    console.log("count:", r?.length);
  } catch (e) {
    console.error("getResults failed:", (e as Error).message);
  }

  console.log("\ngetMatches() — total count + first 2 raw:");
  try {
    const m = (await HLTV.getMatches()) as any[];
    console.log("total upcoming:", m?.length);
    console.log(JSON.stringify(m?.slice(0, 2), null, 2));
    console.log("\nunique event-ish fields seen:");
    const sample = new Set<string>();
    for (const x of m ?? []) {
      sample.add(`event=${JSON.stringify(x?.event)}`);
      if (sample.size >= 4) break;
    }
    for (const s of sample) console.log("  ", s);
  } catch (e) {
    console.error("getMatches failed:", (e as Error).message);
  }
}
main();
