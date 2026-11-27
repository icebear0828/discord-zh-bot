import type { ImageAspectRatio } from '../../../config/defaults.js';
import type { OcCameraAngle, OcPosePreset } from '../../ocPoseCatalog.js';
import type {
  AiOcProfile,
  OcOutfitPreset,
  OcSelfieFraming,
  OcSelfieStyle,
  SelfieSkillSpec,
} from './selfieTypesAndDefaults.js';
import { hasWardrobeKeywordHit, listOcOutfits } from './selfieOutfitsAndOotd.js';
import { hasExplicitDuoIntent, hasExplicitUserNsfwIntent } from './selfieTagParser.js';

const SELFIE_NEGATION_RE =
  /(?:不用|不要|不必|别|无需|甭)(?:拍照?|发图|发照|发张|生图|画)|口头说|文字说就行/;

const USER_SHARING_OWN_IMAGE_RE =
  /(?:我|刚)?(?:发|拍|截)了?一?[张套幅个]?(?:图|截图|照片|图片)?给你(?:看|瞅|鉴|分析)/;

const DIRECT_SELFIE_NOUN_RE =
  /(?:自拍|合照|情侣照|双人照|单人照|私房照|福利照|福利图|床照|全身照|半身照|特写照|大头照|穿搭照|生活照|近照|美照|靓照|果照|裸照|涩图|色图|黄图|无码图|无码大图|内衣照|泳装照|女仆照|兔女郎照|表情包|四格(?:漫画|图|表情)?)/i;

const DIRECT_SELFIE_SHOOT_RE =
  /(?:俯拍|仰拍|侧拍|合拍|拍)(?:一?[张套组幅个]|几张|给我|来看看|发来|发我|看看|张照|照片)/;

const DIRECT_SELFIE_SEND_RE =
  /(?:发|来|赏|给|晒|求|整)(?:我|给我)?一?[张套份组幅](?:你的|你自己的|今日穿搭|Q版|q版|二头身|水彩|厚涂|岩彩|大尺度|无码|性感)?[\p{L}\p{N}\s，,、的]{0,12}(?:照片|写真|立绘|Q版|q版|二头身|图(?!标|鉴|表|层|纸|书))/u;

const DIRECT_SELFIE_DRAW_RE = /画一?[张幅][\p{L}\p{N}\s，,、的]{0,10}你/u;

const FOLLOWUP_SELFIE_RE =
  /(?:再来一?[张套份组]|再拍一?[张套]|再发一?[张套]|换个(?:角度|姿势|动作|衣服|穿搭|造型|风格)|换一?套(?:衣服|再来|拍)|重新拍)/;

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
  return undefined;
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
  assistantReply: string;
  allowNsfw: boolean;
}): SelfieSkillSpec | null {
  const { oc, userContent, previousSameUserTurn, assistantReply, allowNsfw } = params;
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

  if (!framing) {
    framing = duo ? 'full' : 'upper';
    aspect = '2:3';
  }

  const pose: string | undefined = duo
    ? nsfw
      ? 'duo_intimate'
      : 'duo_cuddle'
    : nsfw
      ? 'nsfw_open'
      : undefined;

  const fallbackThemeOutfit = hasWardrobeKeywordHit(oc, userContent)
    ? undefined
    : inferThemeCostumeFallback(userContent, nsfw);
  const animal = inferAnimalCompanion(userContent);
  const scene = inferSceneTags(userContent, nsfw);

  return {
    ...(framing ? { framing } : {}),
    ...(aspect ? { aspect } : {}),
    style,
    ...(pose ? { pose } : {}),
    ...(angle ? { angle } : {}),
    scene,
    ...(fallbackThemeOutfit ? { outfit: fallbackThemeOutfit } : {}),
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
    `- 今日当前穿搭（OOTD）：**${currentOutfit.name}**（${currentOutfit.summaryZh}）。群友平时问你今天穿什么，按这套自然回答。`,
  ];
  if (photoRequested) {
    lines.push(
      '- 当前群友正在向你索要照片或表情包：请按你的人设与对该群友的态度自然回复 1~3 句中文（愿意配合就自然答应，拒绝发照或只肯发单人照不肯拍双人照就直接口头表明；无需输出任何英文提示词或生图标签，照片由独立生图模块自动生成附上）。',
    );
  }
  return lines.join('\n');
}

export function buildOcSelfieSkillPrompt(params: {
  oc: AiOcProfile;
  activeOutfit?: OcOutfitPreset;
  allowNsfw: boolean;
}): string {
  const { oc, activeOutfit, allowNsfw } = params;
  const outfits = listOcOutfits(oc);
  const currentOutfit = activeOutfit ?? outfits[0]!;
  const coreAppearanceText = oc.baseAppearanceZh ?? oc.visualSummaryZh;

  const otherOutfitsSummary =
    outfits.length > 1
      ? outfits
          .map((o) => `${o.id}(${o.name}${o.ootdEligible === false ? '·隐藏款仅点名穿' : ''})`)
          .join(' / ')
      : '';

  const poseClustersLine = allowNsfw
    ? '- 姿势库（288组全量分级，`pose` 填簇名自动防重轮换）：日常特写上半身选 `cute_heart`(比心) / `cute_peace`(比耶敬礼) / `cute_face`(托腮捧脸挽发) / `cute_playful`(猫爪兔耳飞吻嘘) / `cute_shy`(捂嘴害羞伸懒腰)；全身选 `stand_casual`(站姿) / `stand_lookback`(回眸探身) / `sit_relaxed`(休闲坐晃腿) / `sit_girl`(女孩坐侧坐) / `squat_kneel`(蹲姿单膝跪) / `lie_casual`(趴卧侧躺)；魅力曲线选 `spicy_upper` / `spicy_curve`；私密单人档选 `nsfw_tease` / `nsfw_open`；当群友明确要双人合照且你愿意拍双人照时选 `duo_cuddle`（亲密双人档选 `duo_intimate`；若你拒绝双人互动只肯发单人照则选单人簇）。镜头 `angle` 可选 `front`/`three_quarter`/`high`(俯拍)/`low`(仰拍)/`side`。优先直接填 `pose` 簇名由系统自动展开；仅在需要覆盖库外细节时才可选填简洁英文 `"action"`、`"sentence"` 或双人 `"partnerOutfit"` / `"partnerAction"`。'
    : '- 姿势库（`pose` 填簇名自动防重轮换）：上半身特写选 `cute_heart`(比心) / `cute_peace`(比耶敬礼) / `cute_face`(托腮捧脸挽发) / `cute_playful`(猫爪兔耳飞吻嘘) / `cute_shy`(捂嘴害羞伸懒腰)；全身选 `stand_casual`(站姿) / `stand_lookback`(回眸探身) / `sit_relaxed`(休闲坐晃腿) / `sit_girl`(女孩坐侧坐) / `squat_kneel`(蹲姿单膝跪) / `lie_casual`(趴卧侧躺)；当群友明确要双人拥抱合照且你愿意配合时选 `duo_cuddle`（若拒绝双人互动只发单人照则选单人簇）。镜头 `angle` 可选 `front`/`three_quarter`/`high`/`low`/`side`。仅当群友指定库外动作时填英文 `action` 与 `sentence`（双人可用 `partnerOutfit`/`partnerAction`）。';

  const nsfwLine = allowNsfw
    ? '- 分级与衣着参数：日常拍照一律保持 `"nsfw": false`；仅当群友明确要求私密/成熟分级画面且符合你当前态度愿意配合时，才设 `"nsfw": true`（开启客户端模糊遮罩）。当 `"nsfw": true` 时**默认省略 `"outfit"`**（由底层编译器自动匹配预设样式，仅当群友明确点名泳装、女仆、兔女郎等特定主题装扮时才传 `"outfit"`）；其余画面参数仍可通过 `"action"`、`"sentence"` 及 `"partnerOutfit"` / `"partnerAction"` 按需微调。'
    : '- 分级规则：仅支持健康日常向画面，固定 `"nsfw": false`，严禁输出敏感分级标签。';

  return [
    '## 自设穿搭状态与拍照生图技能（文字闲聊也同步知晓今日穿搭；仅在群友要图时附 `[SELFIE:]`）',
    `- 你的固定外貌特征：${coreAppearanceText}。`,
    `- 你今天的当前穿搭（OOTD）：**${currentOutfit.name}**（${currentOutfit.summaryZh}）。群友平时问你今天穿什么，按这套自然回答；日常拍照无需填换装参数，默认即穿这套。`,
    ...(otherOutfitsSummary
      ? [
          `- 你的衣柜备选套装（仅当群友明确要求换某套拍照时，在标签填 \`"outfitId":"套装ID"\`，仅当次拍照生效；若点名衣柜外服装再填 \`"outfit":"英文服装tag"\`）：${otherOutfitsSummary}。`,
        ]
      : []),
    '- 触发条件：仅当群友明确让你发自拍、拍张照、看看你在干嘛、看你的穿搭、发Q版表情包，或画一张你的图时调用；普通文字闲聊、问答时**严禁**输出 `[SELFIE:]`。',
    '- 调用方式：先用符合人设的中文自然回复 1~3 句（严禁念出英文提示词），在回复**最末尾另起一行**附上单行 JSON 标签：',
    '  `[SELFIE: {"framing":"full","aspect":"2:3","style":"anime","pose":"stand_casual","angle":"three_quarter","scene":"英文环境背景与光影tag","nsfw":false}]`',
    '- 取景与画风：`framing` 选 `full`(全身与大动态姿势,2:3；凡选 `stand_casual`/`stand_lookback`/`sit_relaxed`/`sit_girl`/`squat_kneel`/`lie_casual`/`spicy_curve`/`nsfw_open`/`duo_cuddle`/`duo_intimate` 等全身簇时优先用 `"framing":"full","aspect":"2:3"`) / `upper`(半身,3:2或2:3) / `portrait`(大头特写,1:1) / `chibi`(单张Q版,1:1) / `sticker_pack`(2x2四格表情包,1:1)；`style` 默认 `anime`（可选 `watercolor`/`graphic`/`impasto`/`nihonga`）；有动物同框加 `"animal":"英文动物词"`。',
    poseClustersLine,
    nsfwLine,
  ].join('\n');
}
