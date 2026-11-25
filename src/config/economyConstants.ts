export const MAX_COIN_AMOUNT = 1_000_000_000;

// Pocket rob constants
export const ROB_TARGET_MIN_COINS = 100;
export const ROB_ATTACKER_MIN_ASSETS = 100;
export const ROB_STEAL_MIN_RATE = 0.01;
export const ROB_STEAL_MAX_RATE = 0.5;
export const ROB_FINE_RATE = 0.15;
export const ROB_TRAP_FINE_RATE = 0.3;
export const ROB_LOCKPICK_BONUS = 0.25;
export const ROB_LOCKPICK_CAP = 0.85;

// Hidden counter-fine for protected targets & slots VIP players (zero hardcoded Discord IDs)
export const ROB_EASTER_EGG_FINE_RATE = 0.1;
export const DEFAULT_SLOTS_VIP_KEYWORDS = [
  'icebear',
  '冰吊王',
  '冰冰冰',
  '草莓布丁酱',
  '黑吊王',
] as const;
export const SLOTS_VIP_ICE_JACKPOT_CHANCE = 0.5;

export type RobAdminPersonaKey = 'ice' | 'boss' | 'senpai' | 'generic';

export interface RobAdminPersonaStories {
  readonly pocket: readonly string[];
  readonly bank: readonly string[];
}

export interface RobAdminPersonaRule {
  readonly key: Exclude<RobAdminPersonaKey, 'generic'>;
  readonly keywords: readonly string[];
}

export const ROB_ADMIN_PERSONA_RULES: readonly RobAdminPersonaRule[] = [
  { key: 'ice', keywords: ['icebear', '冰吊王', '冰冰冰'] },
  { key: 'boss', keywords: ['黑吊王', '草莓布丁', '布丁酱'] },
  { key: 'senpai', keywords: ['114514'] },
] as const;

export const ROB_ADMIN_PERSONA_STORIES: Readonly<
  Record<RobAdminPersonaKey, RobAdminPersonaStories>
> = {
  ice: {
    pocket: [
      '❄️ {attacker} 刚把手伸进 {target} 口袋，指尖当场冻成冰棍，拔手时把自家 {fine} {currency} 全震在雪地上当医药费！',
      '🧊 {attacker} 鬼鬼祟祟贴近 {target}，没防住脚底突然结出十厘米黑冰，一个劈叉滑出五米，摔掉 {fine} {currency} 跌跌撞撞跑了！',
      '🥶 {attacker} 刚撬到一半，{target} 兜里忽然冒出一股北极寒流，直接把 {attacker} 冻成了带坐标的路边冰雕，破冰倒贴了 {fine} {currency}！',
      '🌨️ {attacker} 试图摸走 {target} 的钱包，结果连着棉手套一起粘在对方冰凉的拉链头上，含泪赔了 {fine} {currency} 买热水解冻才脱身！',
      '🧊 {attacker} 还没碰到 {target} 的衣角，就被一股零下四十度的冷气冻得直哆嗦，手抖得连自己兜里的 {fine} {currency} 都掉进了对方怀里！',
    ],
    bank: [
      '❄️ {attacker} 溜进 {target} 的金库想撬锁，谁知金属锁头零下三十度，嘴唇和撬棍一块粘在上面，请人除冰花了 {fine} {currency}！',
      '🥶 {attacker} 刚钻进 {target} 的保险柜室就被暴风雪级冷气吹了个透心凉，冻得直打喷嚏触发了热感应警报，倒赔 {fine} {currency}！',
      '🧊 {attacker} 在 {target} 的金库门口踩中一层隐形薄冰，连人带麻袋直接铲进保安怀里，现场扣下 {fine} {currency} 除冰维修费！',
      '🌨️ {attacker} 刚锯开 {target} 保险箱外层，里面喷出的急冻雾气瞬间给手电筒封上冰壳，摸黑撞上防盗门被迫赔付 {fine} {currency}！',
    ],
  },
  boss: {
    pocket: [
      '🕶️ {attacker} 刚靠近 {target} 还没伸手，对方头都没回只轻瞥了一眼，{attacker} 当场腿软跪地，抖着留下 {fine} {currency} 认栽撤退！',
      '🕴️ {attacker} 鬼祟摸向 {target} 的外套，草丛里瞬间冒出四名黑衣保镖把路堵死，只好乖乖交出 {fine} {currency} 压惊费才走掉！',
      '🤨 {attacker} 企图从背后偷袭 {target}，结果被对方顺手一把反拧手腕并完成反搜身，含泪递上 {fine} {currency} 赔礼道歉！',
      '💼 {attacker} 刚掀开 {target} 的背包拉链，就被对方一声冷笑吓得三魂丢了七魄，拔腿逃跑时把 {fine} {currency} 落在了原地！',
      '☕ {target} 甚至没放下手里的茶杯，只是慢慢抬起眼皮，气场直接把 {attacker} 压得当场掏出 {fine} {currency} 赔笑退场！',
    ],
    bank: [
      '🕴️ {attacker} 费劲撬开 {target} 的金库大门，定睛一看 {target} 正坐在沙发上喝茶等他，吓得当场交出 {fine} {currency} 保平安！',
      '🔒 {attacker} 刚靠近 {target} 的私密金库，感应器还没响就被蹲点保镖一记过肩摔按在墙上，当场刷走 {fine} {currency} 赔偿损失！',
      '🕶️ {attacker} 想顺走 {target} 保险柜里的现金，反被对方反锁在金库走廊里吹了半小时冷风，签字赔偿 {fine} {currency} 才放出来！',
      '💼 {target} 的金库看似毫无防备，{attacker} 刚踏进去就被暗门收押，连人带背包交出 {fine} {currency} 才准走出银行！',
    ],
  },
  senpai: {
    pocket: [
      '🍵 {attacker} 刚凑近 {target} 准备下手，突然闻到一股浓烈的红茶味，迷迷糊糊自己掏出 {fine} {currency} 塞进了对方手里！',
      '📣 {attacker} 刚把手伸进 {target} 兜里，耳边骤然炸响一声「哼哼啊啊啊——」，吓得手一滑把自己 {fine} {currency} 全抖落在地！',
      '👀 {attacker} 鬼鬼祟祟贴近 {target}，不料正对上对方意味深长的眼神锁定，瞬间血压拉满，主动献上 {fine} {currency} 封口费逃跑！',
      '🏠 {attacker} 想趁夜偷 {target} 的现金，莫名其妙跟着走了半条巷子昏昏欲睡，醒来发现口袋正好少了 {fine} {currency}！',
      '🔢 {attacker} 刚碰到 {target} 的手机想转走零钱，解锁界面赫然要求输入 114514 位密码，当场卡死并被反扣 {fine} {currency}！',
    ],
    bank: [
      '🍵 {attacker} 撬开 {target} 的金库防盗门，迎面飘来一阵诡异的红茶香气，当场迷糊按错了自我举报键，赔偿了 {fine} {currency}！',
      '📣 {attacker} 刚潜入 {target} 的保险库，音箱突然以最高分贝循环播放魔性鬼畜，直接引来保安当场罚款 {fine} {currency}！',
      '🔢 {attacker} 对着 {target} 的保险柜折腾半天，发现安全密码竟然真是 114514，震惊发呆时被巡逻按倒赔了 {fine} {currency}！',
      '👀 {attacker} 刚把麻袋套上 {target} 的金库铁箱，回头看见门缝里正有一双微笑的双眼盯着自己，含泪留下 {fine} {currency} 跑路！',
    ],
  },
  generic: {
    pocket: [
      '🍌 {attacker} 冲向 {target} 时一脚踩中路边香蕉皮原地起飞，落地后裤兜甩飞，正好把 {fine} {currency} 甩进了 {target} 手里！',
      '🕳️ {attacker} 蹑手蹑脚凑近 {target} 准备偷钱，没留意自己裤兜先破了个大洞，叮铃哐啷给对方送去 {fine} {currency}！',
      '🔦 {attacker} 企图趁黑偷 {target} 的钱包，结果手机手电筒自动误触还连上了蓝牙音箱，当场社死赔了 {fine} {currency}！',
      '💨 {attacker} 伸手去摸 {target} 口袋时突然抽筋，把对方的假钞道具当宝贝抢走，结果赔偿了 {fine} {currency} 误工费！',
    ],
    bank: [
      '🧱 {attacker} 刚举起撬棍想砸 {target} 的金库，手滑先砸到了自己脚背，痛呼声直接引来安保当场罚款 {fine} {currency}！',
      '🔦 {attacker} 潜入 {target} 金库时手电筒突然没电，摸黑一头撞上防盗感应玻璃门，不仅没偷到还倒赔 {fine} {currency} 医药费！',
      '🚨 {attacker} 试图黑进 {target} 的保险柜系统，结果输错验证码三次触发自带唢呐警报，被迫赔偿 {fine} {currency} 噪音罚金！',
      '🍌 {attacker} 顺着通风管道溜进 {target} 金库，落地正巧踩中保洁刚打的蜡，滑跪到经理脚边交出了 {fine} {currency}！',
    ],
  },
};

// Bank vault rob constants
export const BANK_ROB_TARGET_MIN = 100;
export const BANK_ROB_ATTACKER_MIN_ASSETS = 100;
export const BANK_ROB_STEAL_MIN_RATE = 0.01;
export const BANK_ROB_STEAL_MAX_RATE = 0.5;
export const BANK_ROB_FINE_RATE = 0.3;
export const BANK_ROB_TRAP_FINE_RATE = 0.5;
export const BANK_ROB_LOCKPICK_BONUS = 0.1;
export const BANK_ROB_LOCKPICK_CAP = 0.5;

// Gambling & duels
export const MAX_SOLO_GAMBLE_BET = 1_000_000;
export const BLACKJACK_TTL_MS = 15 * 60_000;
export const DUEL_TTL_MS = 180_000;
export const DUEL_BOUNTY_MIN_BET_RATIO = 0.2;
export const DUEL_BOUNTY_MIN_BET = 100;

// Pets & Boss
export const PET_MAX_LEVEL = 50;
export const PET_WORK_COOLDOWN_MS = 2 * 3600_000;
export const PET_WORK_LEVEL_BONUS_CAP = 300;
export const PET_BOSS_BONUS_CAP = 80;
export const PET_PVP_DAILY_XP_CAP = 120;
export const PET_PVP_COOLDOWN_MS = 60_000;
export const BOSS_LIGHT_ATTACK_COOLDOWN_MS = 12_000;
export const BOSS_HEAVY_ATTACK_COOLDOWN_MS = 25_000;

// Shop, predictions & monitoring
export const SHOP_MYSTERY_BOX_MIN_PRICE = 100;
export const PREDICTION_MAX_BET = 1_000_000;
export const PREDICTION_LOCKED_EXPIRE_MS = 72 * 3600_000;
export const MONITOR_RETENTION_MS = 14 * 86_400_000;

export const ECONOMY_CONSTANTS = {
  MAX_COIN_AMOUNT,
  ROB_TARGET_MIN_COINS,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_STEAL_MIN_RATE,
  ROB_STEAL_MAX_RATE,
  ROB_FINE_RATE,
  ROB_TRAP_FINE_RATE,
  ROB_LOCKPICK_BONUS,
  ROB_LOCKPICK_CAP,
  ROB_EASTER_EGG_FINE_RATE,
  DEFAULT_SLOTS_VIP_KEYWORDS,
  SLOTS_VIP_ICE_JACKPOT_CHANCE,
  ROB_ADMIN_PERSONA_RULES,
  ROB_ADMIN_PERSONA_STORIES,
  BANK_ROB_TARGET_MIN,
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_STEAL_MIN_RATE,
  BANK_ROB_STEAL_MAX_RATE,
  BANK_ROB_FINE_RATE,
  BANK_ROB_TRAP_FINE_RATE,
  BANK_ROB_LOCKPICK_BONUS,
  BANK_ROB_LOCKPICK_CAP,
  MAX_SOLO_GAMBLE_BET,
  BLACKJACK_TTL_MS,
  DUEL_TTL_MS,
  DUEL_BOUNTY_MIN_BET_RATIO,
  DUEL_BOUNTY_MIN_BET,
  PET_MAX_LEVEL,
  PET_WORK_COOLDOWN_MS,
  PET_WORK_LEVEL_BONUS_CAP,
  PET_BOSS_BONUS_CAP,
  PET_PVP_DAILY_XP_CAP,
  PET_PVP_COOLDOWN_MS,
  BOSS_LIGHT_ATTACK_COOLDOWN_MS,
  BOSS_HEAVY_ATTACK_COOLDOWN_MS,
  SHOP_MYSTERY_BOX_MIN_PRICE,
  PREDICTION_MAX_BET,
  PREDICTION_LOCKED_EXPIRE_MS,
  MONITOR_RETENTION_MS,
} as const;
