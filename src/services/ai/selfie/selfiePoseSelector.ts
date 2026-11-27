import type { OcPosePreset, OcPoseTier } from '../../ocPoseCatalog.js';

// Bounded LRU state for anti-repeat pose rotation per channel/guild scope
const MAX_POSE_ROTATION_SCOPES = 256;
const RECENT_POSE_HISTORY_LIMIT = 8;
const poseRotationHistory = new Map<string, string[]>();
let globalPoseSequence = 0;

export function resetPoseRotationState(): void {
  poseRotationHistory.clear();
  globalPoseSequence = 0;
}

function recordAndPickPoseWithLru(
  candidates: readonly OcPosePreset[],
  scopeKey: string,
): OcPosePreset {
  const history = poseRotationHistory.get(scopeKey) ?? [];
  const historySet = new Set(history);
  const fresh = candidates.filter((c) => !historySet.has(c.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  const chosen = pool[globalPoseSequence % pool.length]!;
  globalPoseSequence = (globalPoseSequence + 1) % 1_000_000;

  const nextHistory = [...history.filter((id) => id !== chosen.id), chosen.id].slice(
    -RECENT_POSE_HISTORY_LIMIT,
  );
  if (!poseRotationHistory.has(scopeKey) && poseRotationHistory.size >= MAX_POSE_ROTATION_SCOPES) {
    const oldestKey = poseRotationHistory.keys().next().value;
    if (oldestKey !== undefined) {
      poseRotationHistory.delete(oldestKey);
    }
  }
  poseRotationHistory.set(scopeKey, nextHistory);
  return chosen;
}

function findKeywordMatchedPoses(
  allowedPool: readonly OcPosePreset[],
  userContent: string,
): OcPosePreset[] {
  const text = userContent.trim();
  if (!text) return [];
  let bestLen = 0;
  let matches: OcPosePreset[] = [];

  for (const pose of allowedPool) {
    let poseBestLen = 0;
    for (const kw of pose.keywordsZh) {
      if (kw.length >= 2 && text.includes(kw) && kw.length > poseBestLen) {
        poseBestLen = kw.length;
      }
    }
    if (poseBestLen === 0) continue;
    if (poseBestLen > bestLen) {
      bestLen = poseBestLen;
      matches = [pose];
    } else if (poseBestLen === bestLen) {
      matches.push(pose);
    }
  }
  return matches;
}

export type PoseMatchKind = 'id' | 'keyword' | 'cluster' | 'default';

export interface SelectedCatalogPose {
  pose: OcPosePreset;
  matchKind: PoseMatchKind;
}

export function selectCatalogPose(params: {
  poses: readonly OcPosePreset[];
  framing: 'portrait' | 'upper' | 'full';
  hasExplicitFraming: boolean;
  requestedPose?: string;
  userContent: string;
  effectiveNsfw: boolean;
  allowDuo: boolean;
  allowSpicy: boolean;
  scopeKey: string;
}): SelectedCatalogPose | undefined {
  const {
    poses,
    framing,
    hasExplicitFraming,
    requestedPose,
    userContent,
    effectiveNsfw,
    allowDuo,
    allowSpicy,
    scopeKey,
  } = params;

  const allowedTiers = new Set<OcPoseTier>();
  if (allowDuo) {
    allowedTiers.add('duo_hug');
    if (effectiveNsfw) {
      allowedTiers.add('duo_nsfw');
    }
  } else {
    allowedTiers.add('sfw');
    if (allowSpicy || effectiveNsfw) {
      allowedTiers.add('spicy');
    }
    if (effectiveNsfw) {
      allowedTiers.add('nsfw');
    }
  }

  const allowedPool = poses.filter((p) => allowedTiers.has(p.tier));
  if (allowedPool.length === 0) return undefined;

  const trimmedReq = requestedPose?.trim().toLowerCase();

  // 1. Exact pose ID match (only if within allowed safety tier!)
  if (trimmedReq) {
    const exactId = allowedPool.find((p) => p.id.toLowerCase() === trimmedReq);
    if (exactId) return { pose: exactId, matchKind: 'id' };
  }

  // 2. Direct Chinese keyword match in userContent (with LRU rotation when multiple poses share a keyword)
  const keywordHits = findKeywordMatchedPoses(allowedPool, userContent);
  if (keywordHits.length === 1) {
    return { pose: keywordHits[0]!, matchKind: 'keyword' };
  }
  if (keywordHits.length > 1) {
    return {
      pose: recordAndPickPoseWithLru(keywordHits, `${scopeKey}:kw:${framing}`),
      matchKind: 'keyword',
    };
  }

  // 3. Semantic cluster match + framing preference + LRU anti-repeat rotation
  if (trimmedReq) {
    const inCluster = allowedPool.filter((p) => p.cluster === trimmedReq);
    if (inCluster.length > 0) {
      const allowMixedFullAndUpper =
        effectiveNsfw && !allowDuo && trimmedReq === 'nsfw_open' && framing !== 'full';
      const framingMatched = allowMixedFullAndUpper
        ? inCluster
        : inCluster.filter(
            (p) =>
              p.framing === framing ||
              (framing === 'portrait' && p.framing === 'upper') ||
              (framing === 'upper' && p.framing === 'portrait'),
          );
      return {
        pose: recordAndPickPoseWithLru(
          framingMatched.length > 0 ? framingMatched : inCluster,
          `${scopeKey}:${trimmedReq}`,
        ),
        matchKind: 'cluster',
      };
    }
  }

  // 4. Default tier/framing rotation when requestedPose was blocked by safety gate or set to 'auto'
  const nsfwSoloOnly = !allowDuo && effectiveNsfw ? allowedPool.filter((p) => p.tier === 'nsfw') : [];
  const preferredTierPool =
    allowDuo && effectiveNsfw
      ? allowedPool.filter((p) => p.tier === 'duo_nsfw')
      : !allowDuo && effectiveNsfw
        ? nsfwSoloOnly.length > 0
          ? nsfwSoloOnly
          : allowedPool.filter((p) => p.tier === 'spicy')
        : allowedPool.filter((p) => p.tier === (allowDuo ? 'duo_hug' : 'sfw'));

  const baseCandidates = preferredTierPool.length > 0 ? preferredTierPool : allowedPool;
  const allowMixedDefaultPool =
    effectiveNsfw && !allowDuo && (!hasExplicitFraming || framing !== 'full');
  const framingMatched = allowMixedDefaultPool
    ? baseCandidates
    : baseCandidates.filter(
        (p) =>
          p.framing === framing ||
          (framing === 'portrait' && p.framing === 'upper') ||
          (framing === 'upper' && p.framing === 'portrait'),
      );
  return {
    pose: recordAndPickPoseWithLru(
      framingMatched.length > 0 ? framingMatched : baseCandidates,
      `${scopeKey}:default:${effectiveNsfw && !allowDuo ? 'nsfw_any' : framing}`,
    ),
    matchKind: 'default',
  };
}
