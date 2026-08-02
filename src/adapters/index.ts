import { EMarathonAdapter } from "./emarathon.js";
/**
 * Adapter registry — exports all source adapters in collection order.
 *
 * Order matters: primary sources first (GoRunning, KorMarathon), then SSR sources,
 * then verification-only, then supplementary. This affects dedup priority.
 */
import { GoRunningAdapter } from "./gorunning.js";
import { KaafAdapter } from "./kaaf.js";
import { KorMarathonAdapter } from "./kormarathon.js";
import { MaedalAdapter } from "./maedal.js";
import { MarathonGoAdapter } from "./marathongo.js";
import { MarathonMateAdapter } from "./marathonmate.js";
import { MarathonMoaAdapter } from "./marathonmoa.js";
import { RunningMapAdapter } from "./runningmap.js";

export const adapters = [
  GoRunningAdapter,
  MarathonGoAdapter,
  KorMarathonAdapter,
  EMarathonAdapter,
  MaedalAdapter,
  KaafAdapter,
  MarathonMoaAdapter,
  RunningMapAdapter,
  MarathonMateAdapter,
] as const;

export type AdapterId = (typeof adapters)[number]["id"];
