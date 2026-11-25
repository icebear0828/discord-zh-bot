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

// Easter egg: robbing protected admins (10% total-asset counter-fine) & slots VIP players (zero hardcoded Discord IDs)
export const ROB_EASTER_EGG_FINE_RATE = 0.1;
export const DEFAULT_SLOTS_VIP_KEYWORDS = [
  'icebear',
  '冰吊王',
  '冰冰冰',
  '草莓布丁酱',
  '黑吊王',
] as const;
export const SLOTS_VIP_ICE_JACKPOT_CHANCE = 0.5;
export const ROB_ADMIN_EASTER_EGG_STORIES = [
  '🛡️ {attacker} 刚把手伸向管理员 {target}，瞬间被管理权限气场震慑到双膝跪地，颤抖着奉上 10% 家当（{fine} {currency}）求饶！',
  '🚔 放肆！{attacker} 企图对管理员 {target} 下手，当场触发全服治安警报，巡逻机器人将其按倒罚没 {fine} {currency} 充公！',
  '⚡ 轰隆！{attacker} 竟然敢打管理员 {target} 的主意，晴空骤降系统雷罚把钱包劈开，掉落的 {fine} {currency} 直接飞进了 {target} 兜里！',
  '🥷 {attacker} 鬼鬼祟祟贴近管理员 {target}，反被对方开启审计权限反手搜身，连口袋带银行卡一共交出 {fine} {currency} 才得以脱身！',
  '🔒 {target} 淡定喝了一口冰美式，随手按下管理员防盗熔断键，笑纳敢以下犯上的 {attacker} 献上的 {fine} {currency} 治安处罚金！',
  '📜 {attacker} 还没摸到 {target} 的边，当场触发「服务器最高管理防盗警报」，系统审计官连夜查账划扣了 10% 总资产（{fine} {currency}）！',
  '💥 防盗反噬发动！{attacker} 刚靠近管理员 {target} 就被防火墙弹飞十米，浑身上下抖落出 {fine} {currency}，全群围观笑疯了！',
  '⚖️ 胆大包天！{attacker} 竟敢劫掠管理员 {target}，被现场贴上「冒犯管理组」鎏金罚单，含泪上缴 {fine} {currency} 赎身费！',
  '🚨 {attacker} 试图撬动管理员 {target} 的家底，结果惊动全服守卫团团围住，被迫当场扫码赔偿 {fine} {currency}！',
  '🪪 管理员威严岂容侵犯！{target} 甚至没动一根手指，{attacker} 就被管理光环压得腿软，乖乖上供 {fine} {currency} 退下！',
] as const;

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
  ROB_ADMIN_EASTER_EGG_STORIES,
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
