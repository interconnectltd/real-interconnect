// tldv API で最近のミーティング一覧を表示 (どの meeting ID がサンプル mp4 に対応するか特定するため)
//
// Usage: npx tsx scripts/tldv-speaker-fix/3-list-meetings.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { createTldvClient } from "../../src/lib/tldv";

async function main() {
  const tldv = createTldvClient();
  const list = await tldv.listMeetings(1);
  console.log(`total=${list.total}, page=${list.page}/${list.pages}\n`);
  console.log("idx  id                        happenedAt          duration  title");
  console.log("─".repeat(110));
  list.results.forEach((m, i) => {
    const dur = Math.floor(m.duration / 60) + "min";
    const date = m.happenedAt.slice(0, 16);
    console.log(`${String(i).padStart(3)}  ${m.id}  ${date}  ${dur.padStart(6)}    ${m.name?.slice(0, 50) ?? ""}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
