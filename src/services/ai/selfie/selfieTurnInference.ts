import type { ImageAspectRatio } from '../../../config/defaults.js';
import type { OcCameraAngle, OcPosePreset } from '../../ocPoseCatalog.js';
import { stripBotMention } from '../aiTextAndMentions.js';
import { isSafetyRefusalReply } from '../aiSafetyAndTokens.js';
import type { RawContextMessage } from '../aiTypes.js';
import type {
  AiOcProfile,
  OcOutfitPreset,
  OcSelfieFraming,
  OcSelfieStyle,
  SelfieSkillSpec,
} from './selfieTypesAndDefaults.js';
import {
  inferGarmentModsFromText,
  listOcOutfits,
  matchWardrobeOutfitByKeywords,
} from './selfieOutfitsAndOotd.js';
import { hasExplicitDuoIntent, hasExplicitUserNsfwIntent } from './selfieTagParser.js';

const GARMENT_TRIGGER_NOUN_SOURCE =
  '(?:黑丝|白丝|肉丝|灰丝|网袜|渔网袜|丝袜|吊带袜|过膝袜|连裤袜|长筒袜|光脚|赤足|裸足|高跟鞋?|水手服|JK|jk|校服|学院制服|女仆装?|兔女郎|泳装|泳衣|比基尼|死库水|旗袍|护士服?|OL装?|职业装|包臀裙|体操服|运动服|瑜伽裤|巫女服?|修女服?|晚礼服|礼服裙|睡衣|睡裙|居家服|洋装|夏装|和服|振袖|毛衣|皮裙|百褶裙|吊带裙|衬衫|男友衬衫|猫娘装?|新衣服|别的衣服)';

const SELFIE_NEGATION_RE =
  /(?:不用|不要|不必|别|无需|甭|禁止|不准|不能|无法|没法)(?:拍照?|发图|发照|发张|生图|出图|画)|口头说|文字说就行|(?:怎么|咋|如何|为什么|为啥)(?:才能|要|让|叫|不|没)?[\p{L}\p{N}]{0,8}(?:生图|发图|出图|拍照|发照|生成[\p{L}]{0,3}图)|(?:生|发|出|拍|生成)不了[\p{L}]{0,2}(?:图|照)/u;

const USER_SHARING_OWN_IMAGE_RE =
  /(?:我|刚)?(?:发|拍|截|传)了?一?[张套幅个点]?(?:图|截图|照片|图片)?给你(?:看|瞅|鉴|分析)|这[张幅个](?:图|截图|照片|图片)/u;

const DIRECT_SELFIE_NOUN_RE =
  /(?:自拍|合照|情侣照|双人照|单人照|私房照|福利照|福利图|床照|全身照|半身照|特写照|大头照|穿搭照|生活照|近照|美照|靓照|果照|裸照|涩图|色图|黄图|无码图|无码大图|内衣照|泳装照|女仆照|兔女郎照|表情包|四格(?:漫画|图|表情)?)/i;

const DIRECT_SELFIE_SHOOT_RE =
  /(?:俯拍|仰拍|侧拍|合拍|拍)(?:一?[张套组幅个点]|几张|给我|来看看|发来|发我|看看|下|张照|照片)/;

const DIRECT_SELFIE_VIEW_RE = new RegExp(
  `(?:看看|看下|看一眼|瞅瞅|瞧瞧|欣赏下?)(?:你的|你今天?的?|今日|这身|那套)?(?:照片|写真|立绘|穿搭|新衣服|${GARMENT_TRIGGER_NOUN_SOURCE})|(?<![多好难偷翻查])看(?:你的)?(?:照片|写真)|(?:换|穿|套|脱)[\\p{L}\\p{N}\\s，,、的]{0,14}${GARMENT_TRIGGER_NOUN_SOURCE}[\\p{L}\\p{N}\\s，,、的]{0,10}(?:给我|让我|帮我|发来|发我)?(?:看看|看下|看一眼|瞅瞅|瞧瞧|欣赏|拍)`,
  'u',
);

const DIRECT_SELFIE_SEND_RE =
  /(?:发|来|赏|给|晒|求|整|生|出|画)(?:我|给我|帮我)?(?:一?[张套份组幅个点些])[\p{L}\p{N}\s，,、的]{0,12}(?:照片|写真|立绘|Q版|q版|二头身|(?<!截|地|蓝|草|脑|导|修|改|拼|插|贴|搜|识)图(?!标|鉴|表|层|纸|书|库|床|片软件))|(?:发|来|赏|给|晒|求|生|出)(?:我|给我|帮我)?(?:你的|你自己的|今日)?(?:照片|写真|立绘)|(?:(?<!开|转|沙|批|首)发图|(?<!逃|求|原|派|卫|学|人|野|仿|写)生图|(?<!演|输|导|提|退|杰)出图)(?!标|鉴|表|层|纸|书|库|床)/u;

const DIRECT_SELFIE_DRAW_RE = /画一?[张幅个][\p{L}\p{N}\s，,、的]{0,10}(?:你|照片|写真|立绘|(?<!截|地|蓝|草)图)/u;

const FOLLOWUP_SELFIE_RE = new RegExp(
  `(?:再来一?[张套份组个]|再拍一?[张套个]?|再发一?[张套个]?|再生一?[张套个]?|换个(?:角度|姿势|动作|衣服|穿搭|造型|风格)|换一?[套身](?:衣服|再来|拍)?|重新拍|(?:换|穿)(?:成|上|条|双|件|身|套)?${GARMENT_TRIGGER_NOUN_SOURCE}|脱掉?(?:袜子|丝袜|黑丝|白丝|鞋袜)|光脚|赤足)`,
  'u',
);

const SOLO_GRANT_OVERRIDE_RE =
  /(?:单人照|只(?:拍|给|发)[\s\S]{0,6}(?:单人|我自己)|赏你一?[张套]|拍给你|发给你|拿去(?:看|用)|给你看一眼|偷偷看一眼|换给你看)/;

const FULL_PHOTO_REFUSAL_RE =
  /(?:不拍给你|才不拍|不给[\s\S]{0,6}拍|不发[\s\S]{0,6}(?:照|图|自拍)|才不发|想得美[\s\S]{0,12}不(?:拍|发|给)|没门[\s\S]{0,10}不(?:拍|发)|拒绝发照)/;

const DUO_REFUSAL_RE =
  /(?:谁要跟你(?:拍|合)|才不跟你(?:拍|合|抱)|不跟你(?:拍|合)|只(?:给|肯|能)[\s\S]{0,8}单人|单人照|自己一个人拍|别想[\s\S]{0,8}合照)/;

function matchesDirectSelfieRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (SELFIE_NEGATION_RE.test(trimmed)) return false;
  if (USER_SHARING_OWN_IMAGE_RE.test(trimmed) && !/(?:自拍|你的|你自己的)/.test(trimmed)) {
    return false;
  }
  return (
    DIRECT_SELFIE_NOUN_RE.test(trimmed) ||
    DIRECT_SELFIE_SHOOT_RE.test(trimmed) ||
    DIRECT_SELFIE_VIEW_RE.test(trimmed) ||
    DIRECT_SELFIE_SEND_RE.test(trimmed) ||
    DIRECT_SELFIE_DRAW_RE.test(trimmed)
  );
}

export function hasExplicitSelfieRequest(
  userContent: string,
  previousSameUserTurn?: string,
): boolean {
  const trimmed = userContent.trim();
  if (!trimmed) return false;
  if (SELFIE_NEGATION_RE.test(trimmed)) return false;
  if (matchesDirectSelfieRequest(trimmed)) return true;
  if (FOLLOWUP_SELFIE_RE.test(trimmed) && previousSameUserTurn?.trim()) {
    return matchesDirectSelfieRequest(previousSameUserTurn);
  }
  return false;
}

export function didAssistantRefuseAllPhoto(replyText: string): boolean {
  const trimmed = replyText.trim();
  if (!trimmed) return false;
  if (
    SOLO_GRANT_OVERRIDE_RE.test(trimmed) &&
    !/(?:不拍给你|才不拍给你|不发给你|才不发给你)/.test(trimmed)
  ) {
    return false;
  }
  return FULL_PHOTO_REFUSAL_RE.test(trimmed);
}

export function didAssistantRefuseDuo(replyText: string): boolean {
  const trimmed = replyText.trim();
  if (!trimmed) return false;
  return DUO_REFUSAL_RE.test(trimmed);
}

function inferThemeCostumeFallback(userContent: string, nsfw: boolean): string | undefined {
  if (/兔女郎/.test(userContent)) {
    return nsfw
      ? 'playboy bunny, bunny ears headband, bowtie collar, wrist cuffs, fishnet pantyhose, micro bunny leotard pulled down, topless, bare breasts, nipples'
      : 'playboy bunny, bunny ears headband, strapless velvet bunny leotard, bowtie collar, wrist cuffs, sheer pantyhose';
  }
  if (/女仆/.test(userContent)) {
    return nsfw
      ? 'french maid, maid headdress, ribbon choker, open frilly apron, topless, bare breasts, nipples, garter stockings'
      : 'classic maid dress, white frilly apron, maid headdress, ribbon choker, thighhighs';
  }
  if (/死库水/.test(userContent)) {
    return nsfw
      ? 'school swimsuit pulled aside, topless, bare breasts, nipples, wet skin'
      : 'navy one-piece school swimsuit, bare shoulders, wet skin';
  }
  if (/比基尼|泳装|泳衣/.test(userContent)) {
    return nsfw
      ? 'micro bikini untied, topless, bare breasts, nipples'
      : 'halter bikini swimsuit, bare shoulders, midriff';
  }
  if (/旗袍/.test(userContent)) {
    return nsfw
      ? 'unbuttoned high-slit qipao, topless, bare breasts, nipples, pelvic curtain'
      : 'fitted floral brocade qipao, mandarin collar, high side slit';
  }
  if (/护士/.test(userContent)) {
    return nsfw
      ? 'unbuttoned nurse dress, nurse cap, topless, bare breasts, nipples, white stockings'
      : 'fitted white nurse uniform, nurse cap, white thighhighs';
  }
  if (/(?<![a-zA-Z])ol(?:装|制服)?|职业装|秘书装|包臀裙|西装套裙/i.test(userContent)) {
    return nsfw
      ? 'unbuttoned white dress shirt open, black pencil mini skirt pushed up, sheer black pantyhose, topless, bare breasts, nipples'
      : 'fitted white collared dress shirt, black pencil mini skirt, sheer black pantyhose, black stiletto heels';
  }
  if (/体操服|运动服|瑜伽裤|健身服/.test(userContent)) {
    return nsfw
      ? 'pulled-up athletic crop top, topless, bare breasts, nipples, tight yoga shorts'
      : 'sleeveless athletic crop top, high-waisted fitted yoga shorts, toned midriff, sneakers';
  }
  if (/巫女/.test(userContent)) {
    return nsfw
      ? 'loosened white miko kosode off shoulders, crimson hakama untied, topless, bare breasts, nipples'
      : 'traditional red and white miko shrine maiden attire, detached white sleeves, crimson hakama skirt, white tabi socks';
  }
  if (/修女/.test(userContent)) {
    return nsfw
      ? 'open black nun habit, nun veil, topless, bare breasts, nipples, garter thighhigh stockings'
      : 'black and white gothic nun habit, nun veil, gold cross necklace, high side slit skirt, sheer thighhighs';
  }
  if (/晚礼服|礼服裙|抹胸裙/.test(userContent)) {
    return nsfw
      ? 'strapless satin evening dress pulled down to waist, topless, bare breasts, nipples'
      : 'elegant strapless satin evening dress, bare shoulders, high side slit, long gloves';
  }
  if (/情趣内衣|蕾丝内衣|黑蕾丝内衣|白蕾丝内衣|内衣秀/.test(userContent)) {
    return nsfw
      ? 'unfastened sheer black lace lingerie, open bra, topless, bare breasts, nipples, garter straps, sheer black stockings'
      : 'delicate black floral lace bralette and matching lace trim shorts, sheer silk robe draped over shoulders, garter stockings';
  }
  if (/男友衬衫|大衬衫/.test(userContent)) {
    return nsfw
      ? 'unbuttoned oversized white dress shirt completely open, topless, bare breasts, nipples, no bra, no panties'
      : 'oversized white button-up boyfriend shirt, bare shoulders, shirt hem covering hips, bare legs';
  }
  if (/猫娘/.test(userContent)) {
    return nsfw
      ? 'black cat ears headband, bell ribbon choker, topless, bare breasts, nipples, cat tail ornament, thighhighs'
      : 'black cat ears headband, bell ribbon choker, frilly off-shoulder crop top, pleated mini skirt, cat tail ornament, thighhighs';
  }
  return undefined;
}

const RESET_TO_OOTD_RE =
  /(?:换回|穿回)(?:今天?的?|今日|原来?的?|日常)(?:衣服|穿搭|那套)/u;
const EXPLICIT_OUTFIT_CHANGE_ACTION_RE =
  /(?:换上?|穿上?|套上?|脱掉?|扒下?|褪下?|穿好|换好|换成)/u;
const REPLY_OUTFIT_REFUSAL_CLAUSE_RE =
  /(?:才不|不给你|想得美|别想|不肯|拒绝)[^，。！？!?,;\n]{0,18}/gu;

export function extractRecentSelfieContextTurns(params: {
  currentMessageId: string;
  botId: string;
  resetAt: number;
  replyChain?: ReadonlyArray<RawContextMessage>;
  channelWindow?: ReadonlyArray<RawContextMessage>;
  maxTurns?: number;
}): string[] {
  const {
    currentMessageId,
    botId,
    resetAt,
    replyChain = [],
    channelWindow = [],
    maxTurns = 6,
  } = params;
  const byId = new Map<string, RawContextMessage>();
  for (const m of [...channelWindow, ...replyChain]) {
    if (m.id === currentMessageId || m.createdTimestamp <= resetAt) continue;
    if ((m.isBot || m.authorId === botId) && m.hasEmbeds) continue;
    byId.set(m.id, m);
  }
  const sortedDesc = [...byId.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  const out: string[] = [];
  for (const m of sortedDesc) {
    const stripped = stripBotMention(m.content, botId).trim();
    if (!stripped || stripped.startsWith('⚠️') || isSafetyRefusalReply(stripped)) continue;
    out.push(stripped);
    if (out.length >= maxTurns) break;
  }
  return out;
}

function inferAnimalCompanion(userContent: string): string | undefined {
  if (/(?:抱|撸|摸|陪|同框|一只)[\s\S]{0,6}(?:小?猫咪?|橘猫|白猫|黑猫)/.test(userContent)) {
    return 'cat';
  }
  if (/(?:抱|撸|摸|陪|同框|一只)[\s\S]{0,6}(?:柴犬|小?狗|狗狗|金毛)/.test(userContent)) {
    return 'dog';
  }
  if (/(?:抱|撸|摸|陪|同框|一只)[\s\S]{0,6}(?:小?白兔|兔子)/.test(userContent)) {
    return 'rabbit';
  }
  if (/(?:抱|撸|摸|陪|同框|一只)[\s\S]{0,6}(?:小?狐狸)/.test(userContent)) {
    return 'fox';
  }
  return undefined;
}

function inferSceneTags(userContent: string, nsfw: boolean): string {
  if (/卧室|床上|被窝|枕头|床照|私房/.test(userContent)) {
    return 'cozy bedroom interior, warm bedside lamp light, soft rumpled sheets';
  }
  if (/浴室|洗澡|泡澡|温泉|浴缸/.test(userContent)) {
    return 'steamy bathroom, warm soft ambient lighting, water droplets';
  }
  if (/教室|课桌|学校|走廊/.test(userContent)) {
    return 'sunlit school corridor, warm afternoon window light';
  }
  if (/海边|沙滩|大海|泳池/.test(userContent)) {
    return 'sunny beach shoreline, sparkling ocean waves, bright daylight';
  }
  if (/咖啡|下午茶|甜品/.test(userContent)) {
    return 'cozy cafe interior, warm sunlight, wooden table';
  }
  if (/阳台|天台|夜色|夜景/.test(userContent)) {
    return 'night balcony, soft city bokeh lights, gentle evening breeze';
  }
  return nsfw
    ? 'dim cozy bedroom, warm soft ambient lamp light, shallow depth of field'
    : 'soft natural indoor window light, cozy room background, shallow depth of field';
}

export function inferOcSelfieSpecFromTurn(params: {
  oc: AiOcProfile;
  activeOutfit?: OcOutfitPreset;
  poses?: readonly OcPosePreset[];
  userContent: string;
  previousSameUserTurn?: string;
  recentContextTurns?: readonly string[];
  assistantReply: string;
  allowNsfw: boolean;
}): SelfieSkillSpec | null {
  const {
    oc,
    activeOutfit,
    userContent,
    previousSameUserTurn,
    recentContextTurns = [],
    assistantReply,
    allowNsfw,
  } = params;
  if (!hasExplicitSelfieRequest(userContent, previousSameUserTurn)) {
    return null;
  }
  if (didAssistantRefuseAllPhoto(assistantReply)) {
    return null;
  }

  const intentText = previousSameUserTurn?.trim()
    ? `${previousSameUserTurn.trim()}\n${userContent}`
    : userContent;

  let framing: OcSelfieFraming | undefined;
  let aspect: ImageAspectRatio | undefined;
  if (/四格|表情包|\bsticker\b/i.test(userContent)) {
    framing = 'sticker_pack';
    aspect = '1:1';
  } else if (/\bchibi\b|q版|二头身/i.test(userContent)) {
    framing = 'chibi';
    aspect = '1:1';
  } else if (/全身|立绘|从头到脚|全身照/.test(userContent)) {
    framing = 'full';
    aspect = '2:3';
  } else if (/大头|脸部特写|特写照|怼脸/.test(userContent)) {
    framing = 'portrait';
    aspect = '1:1';
  } else if (/半身/.test(userContent)) {
    framing = 'upper';
    aspect = '2:3';
  }

  let style: OcSelfieStyle = 'anime';
  if (/水彩/.test(userContent)) style = 'watercolor';
  else if (/厚涂|油画/.test(userContent)) style = 'impasto';
  else if (/岩彩|金箔/.test(userContent)) style = 'nihonga';
  else if (/平面|海报/.test(userContent)) style = 'graphic';

  let angle: OcCameraAngle | undefined;
  if (/俯拍|从上往下|高角度/.test(userContent)) angle = 'high';
  else if (/仰拍|从下往上|低角度/.test(userContent)) angle = 'low';
  else if (/侧脸|侧面|侧拍/.test(userContent)) angle = 'side';
  else if (/正脸|正面/.test(userContent)) angle = 'front';

  const isChibiOrSticker = framing === 'chibi' || framing === 'sticker_pack';
  const nsfw = Boolean(allowNsfw && !isChibiOrSticker && hasExplicitUserNsfwIntent(intentText));
  const duo = Boolean(
    !isChibiOrSticker &&
      hasExplicitDuoIntent(intentText) &&
      !didAssistantRefuseDuo(assistantReply),
  );

  // Resolve full outfit + partial legwear/footwear overrides across current turn, previous turn, Bot confirmation, and recent context
  let resolvedOutfitId: string | undefined;
  let fallbackThemeOutfit: string | undefined;
  let garmentMods: { legwear?: string; footwear?: string; barefoot?: boolean } = {};

  if (!RESET_TO_OOTD_RE.test(userContent)) {
    const cleanedReplyForOutfit = assistantReply.replace(REPLY_OUTFIT_REFUSAL_CLAUSE_RE, ' ');
    const candidates: Array<{ text: string; source: 'user' | 'prev' | 'reply' | 'history' }> = [
      { text: userContent, source: 'user' },
      ...(previousSameUserTurn?.trim()
        ? [{ text: previousSameUserTurn.trim(), source: 'prev' as const }]
        : []),
      ...(cleanedReplyForOutfit.trim()
        ? [{ text: cleanedReplyForOutfit.trim(), source: 'reply' as const }]
        : []),
      ...recentContextTurns.map((t) => ({ text: t, source: 'history' as const })),
    ];

    for (const cand of candidates) {
      if (cand.source === 'history' && !EXPLICIT_OUTFIT_CHANGE_ACTION_RE.test(cand.text)) {
        continue;
      }
      if (!resolvedOutfitId && !fallbackThemeOutfit) {
        const matchedWardrobe = matchWardrobeOutfitByKeywords(oc, cand.text);
        if (matchedWardrobe) {
          if (
            cand.source !== 'reply' ||
            (matchedWardrobe.id !== activeOutfit?.id &&
              EXPLICIT_OUTFIT_CHANGE_ACTION_RE.test(cand.text))
          ) {
            resolvedOutfitId = matchedWardrobe.id;
          }
        } else if (
          cand.source !== 'reply' ||
          EXPLICIT_OUTFIT_CHANGE_ACTION_RE.test(cand.text)
        ) {
          const themeHit = inferThemeCostumeFallback(cand.text, nsfw);
          if (themeHit) {
            fallbackThemeOutfit = themeHit;
          }
        }
      }
      if (!garmentMods.legwear && !garmentMods.footwear && !garmentMods.barefoot) {
        const mods = inferGarmentModsFromText(cand.text);
        if (mods.legwear || mods.footwear || mods.barefoot) {
          garmentMods = mods;
        }
      }
    }
  }

  const hasLowerBodyGarmentSwap = Boolean(
    garmentMods.legwear || garmentMods.footwear || garmentMods.barefoot,
  );
  if (!framing) {
    framing = duo || hasLowerBodyGarmentSwap ? 'full' : 'upper';
    aspect = '2:3';
  }

  const pose: string | undefined = duo
    ? nsfw
      ? 'duo_intimate'
      : 'duo_cuddle'
    : nsfw
      ? 'nsfw_open'
      : undefined;

  const animal = inferAnimalCompanion(userContent);
  const scene = inferSceneTags(userContent, nsfw);

  return {
    ...(framing ? { framing } : {}),
    ...(aspect ? { aspect } : {}),
    style,
    ...(pose ? { pose } : {}),
    ...(angle ? { angle } : {}),
    ...(resolvedOutfitId ? { outfitId: resolvedOutfitId } : {}),
    scene,
    ...(fallbackThemeOutfit ? { outfit: fallbackThemeOutfit } : {}),
    ...(garmentMods.legwear ? { legwear: garmentMods.legwear } : {}),
    ...(garmentMods.footwear ? { footwear: garmentMods.footwear } : {}),
    ...(garmentMods.barefoot ? { barefoot: true } : {}),
    ...(animal ? { animal } : {}),
    ...(duo ? { duo: true } : {}),
    nsfw,
  };
}

export function buildOcChatStatusPrompt(params: {
  oc: AiOcProfile;
  activeOutfit?: OcOutfitPreset;
  photoRequested?: boolean;
}): string {
  const { oc, activeOutfit, photoRequested = false } = params;
  const outfits = listOcOutfits(oc);
  const currentOutfit = activeOutfit ?? outfits[0]!;
  const coreAppearanceText = oc.baseAppearanceZh ?? oc.visualSummaryZh;
  const lines = [
    '## 今日外貌与穿搭状态（供日常聊天自然参考）',
    `- 固定外貌特征：${coreAppearanceText}。`,
    `- 今日初始穿搭（OOTD）：**${currentOutfit.name}**（${currentOutfit.summaryZh}）。群友平时问你今天穿什么按这套回答；若近期对话中你已应群友要求临时换装或更换丝袜/鞋袜（如换黑丝、白丝、水手服等），请顺承最新换装状态自然接话。`,
  ];
  if (photoRequested) {
    lines.push(
      '- 当前群友正在向你索要照片或表情包（你的相机与独立生图模块当前已完全就绪，并会自动同步群友点名或上下文刚换好的服装/丝袜出图）：请按你的人设与对该群友的态度自然回复 1~3 句中文（愿意配合就自然答应，拒绝发照或只肯发单人照不肯拍双人照就直接口头表明；无需输出任何英文提示词或生图标签，照片由独立生图模块自动生成附上）。',
    );
  }
  return lines.join('\n');
}
