// tl;dv 統合の公開 API。 webhook / sync route + scripts/run-tldv-sync.ts の 2 つを支える最小バレル。
// 内部のみで使われるシンボル (TldvClient / TldvApiError / linkSpeakerToUser / 各レスポンス型) は
// 直接 ./client や ./link-speaker から import するため、再エクスポートしない。
export { createTldvClient } from "./client";
export { processTldvMeeting } from "./process-meeting";
