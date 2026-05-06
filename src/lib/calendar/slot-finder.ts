/**
 * src/lib/calendar/slot-finder.ts
 *
 * 双方の availability_rules / availability_overrides と Google freebusy を
 * 突き合わせて、共通空き時間 (15分粒度) を抽出。
 *
 * Asia/Tokyo 固定。
 */

export interface AvailRule {
  day_of_week: number; // 0=Sun
  start_time: string; // "HH:MM" or "HH:MM:SS"
  end_time: string;
  is_active: boolean;
}

export interface AvailOverride {
  target_date: string; // "YYYY-MM-DD"
  override_type: "block" | "open";
  start_time: string | null;
  end_time: string | null;
}

export interface BusyRange {
  start: string; // ISO
  end: string;
}

export interface Slot {
  start: string; // ISO
  end: string;
}

const SLOT_MIN = 15;
const TZ = "Asia/Tokyo";

/**
 * 指定期間の自分のフリー時間を時間枠 (Date) で返す。
 * - rules で曜日別営業時間
 * - overrides で個別 block / open
 * - busy で予定済範囲を除く
 */
export function findSelfFreeSlots(opts: {
  windowStart: Date;
  windowEnd: Date;
  rules: AvailRule[];
  overrides: AvailOverride[];
  busy: BusyRange[];
  durationMin: number;
}): Slot[] {
  const slots: Slot[] = [];
  const { windowStart, windowEnd, rules, overrides, busy, durationMin } = opts;
  const dayMs = 86_400_000;

  // 各日について available 帯を計算
  for (
    let day = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate());
    day < windowEnd;
    day = new Date(day.getTime() + dayMs)
  ) {
    const ymd = formatYMD(day);
    const dow = day.getDay();

    // override 優先
    const dayOverride = overrides.find((o) => o.target_date === ymd);
    let availIntervals: Array<[Date, Date]>;
    if (dayOverride) {
      if (dayOverride.override_type === "block") {
        continue; // 全日ブロック
      }
      availIntervals = [
        [
          combineDateTime(day, dayOverride.start_time ?? "09:00"),
          combineDateTime(day, dayOverride.end_time ?? "18:00"),
        ],
      ];
    } else {
      availIntervals = rules
        .filter((r) => r.is_active && r.day_of_week === dow)
        .map((r) => [
          combineDateTime(day, r.start_time),
          combineDateTime(day, r.end_time),
        ]);
    }
    if (availIntervals.length === 0) continue;

    for (const [aStart, aEnd] of availIntervals) {
      // window と交差させる
      const start = aStart < windowStart ? windowStart : aStart;
      const end = aEnd > windowEnd ? windowEnd : aEnd;
      if (start >= end) continue;

      // busy で除外し、durationMin 連続範囲を 15 分粒度で列挙
      const subSlots = enumerateSlots(start, end, busy, durationMin);
      slots.push(...subSlots);
    }
  }

  return slots;
}

/**
 * 自分の slot と相手の slot を交差させる (両者で空いてる時間)。
 */
export function intersectSlots(
  a: Slot[],
  b: Slot[],
  durationMin: number,
): Slot[] {
  const out: Slot[] = [];
  const aRanges = a.map((s) => [+new Date(s.start), +new Date(s.end)] as const);
  const bRanges = b.map((s) => [+new Date(s.start), +new Date(s.end)] as const);
  const durMs = durationMin * 60_000;

  for (const [aS, aE] of aRanges) {
    for (const [bS, bE] of bRanges) {
      const s = Math.max(aS, bS);
      const e = Math.min(aE, bE);
      if (e - s >= durMs) {
        out.push({
          start: new Date(s).toISOString(),
          end: new Date(s + durMs).toISOString(),
        });
      }
    }
  }
  // 重複除去 (同 start)
  const seen = new Set<string>();
  return out.filter((s) => {
    if (seen.has(s.start)) return false;
    seen.add(s.start);
    return true;
  });
}

// ─── helpers ───
function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function combineDateTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":");
  const out = new Date(date);
  out.setHours(parseInt(h ?? "0", 10), parseInt(m ?? "0", 10), 0, 0);
  return out;
}

function enumerateSlots(
  start: Date,
  end: Date,
  busy: BusyRange[],
  durationMin: number,
): Slot[] {
  const out: Slot[] = [];
  const stepMs = SLOT_MIN * 60_000;
  const durMs = durationMin * 60_000;

  // start を 15 分粒度に切り上げ
  const startMs = Math.ceil(start.getTime() / stepMs) * stepMs;
  const endMs = end.getTime();

  const busyRanges = busy.map(
    (b) => [+new Date(b.start), +new Date(b.end)] as const,
  );

  for (let cur = startMs; cur + durMs <= endMs; cur += stepMs) {
    const slotEnd = cur + durMs;
    const conflict = busyRanges.some(([bS, bE]) => bS < slotEnd && bE > cur);
    if (!conflict) {
      out.push({
        start: new Date(cur).toISOString(),
        end: new Date(slotEnd).toISOString(),
      });
    }
  }
  return out;
}

// 一旦 TZ は固定 (Asia/Tokyo)、export 用
export const SCHEDULER_TZ = TZ;
