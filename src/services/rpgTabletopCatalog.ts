import type { RpgClassKey } from '../db/repositories/rpgRepo.js';

export type TabletopStatKey = 'might' | 'arcana' | 'agility' | 'charm';

export interface TabletopStatMeta {
  key: TabletopStatKey;
  label: string;
  emoji: string;
  shortDesc: string;
}

export type TabletopCreditPerk = 'high_free' | 'deadbeat_intimidate';

export interface TabletopChoiceDef {
  id: string;
  label: string;
  detail: string;
  stat?: TabletopStatKey;
  dc?: number;
  coinCost?: number;
  requiredClass?: RpgClassKey;
  creditPerk?: TabletopCreditPerk;
  rewardCoinsMult: number;
  rewardXpMult: number;
  dropChance: number;
  failHpPct: number;
  critFailHpPct: number;
  healPctOnSuccess?: number;
  weakenBoss?: boolean;
  successText: string;
  critSuccessText: string;
  failText: string;
  critFailText: string;
}

export interface TabletopSceneDef {
  id: string;
  chapter: number | 'shared';
  title: string;
  emoji: string;
  narrative: string;
  choices: readonly TabletopChoiceDef[];
}

export interface TabletopBossActDef {
  chapter: number;
  bossName: string;
  bossEmoji: string;
  phase1Title: string;
  phase1Narrative: string;
  phase1Choices: readonly TabletopChoiceDef[];
  phase2Title: string;
  phase2Narrative: string;
  phase2Choices: readonly TabletopChoiceDef[];
  victoryEpilogue: string;
}

export const TABLETOP_STAT_META: Readonly<Record<TabletopStatKey, TabletopStatMeta>> = {
  might: {
    key: 'might',
    label: '武力',
    emoji: '⚔️',
    shortDesc: '蛮力破阵、正面碾压与重甲硬扛',
  },
  arcana: {
    key: 'arcana',
    label: '奥术',
    emoji: '🔮',
    shortDesc: '元素魔纹、禁忌学识与秘仪解咒',
  },
  agility: {
    key: 'agility',
    label: '灵巧',
    emoji: '🗡️',
    shortDesc: '暗影潜行、精准偷袭与机关拆解',
  },
  charm: {
    key: 'charm',
    label: '魅力意志',
    emoji: '🛡️',
    shortDesc: '圣光威压、三寸不烂之舌与信誉气场',
  },
};

const CHAPTER_1_TO_3_SCENES: readonly TabletopSceneDef[] = [
  // =========================================================================
  // Chapter 1: 哥布林密林 (🌲)
  // =========================================================================
  {
    id: 'ch1_goblin_toll',
    chapter: 1,
    title: '腐木哨卡的哥布林收税官',
    emoji: '🪵',
    narrative:
      '潮湿的松针林道尽头，几根涂满泥浆的尖木栅栏横在路中央。三名戴着破铁锅当头盔的哥布林哨兵摇着生锈铜铃，领头那只还煞有介事地挂了块“黑吊国森林特区收费站”的歪木牌。火把在雾气里噼啪作响，他们一边磨着缺口短刀，一边朝你伸出沾满树汁的绿爪子。',
    choices: [
      {
        id: 'ch1_toll_warrior',
        label: '圣殿重甲直接撞碎木栅',
        detail: '用最不讲道理的物理方式告诉绿皮什么叫免检通行。',
        stat: 'might',
        dc: 10,
        requiredClass: 'warrior',
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.25,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.24,
        successText:
          '你沉肩前冲，整排腐木栅栏轰然炸成满天木屑。领头哥布林连锅带人飞进灌木丛，留下一袋叮当作响的过路私房钱。',
        critSuccessText:
          '你的冲锋气势宛如失控攻城锤，不仅撞塌了哨卡，还震落树梢上藏匿的战利品暗箱。三只哥布林当场跪成一排高喊“大哥以后我们给你交保护费”！',
        failText:
          '腐木比看上去结实得多，你一头撞在藏着铁芯的主桩上，震得虎口发麻。哥布林趁机用弹弓朝你屁股招呼了两颗松果。',
        critFailText:
          '你脚下踩到一坨陈年苔藓，整个人像保龄球一样滑进哥布林的泥坑陷阱。那群绿皮一边拍手叫好，一边把你的靴子笑出了回音。',
      },
      {
        id: 'ch1_toll_charm',
        label: '亮出黑吊国贵族金卡唬人',
        detail: '假装自己是巡查森林税账的钦差大臣，让他们把账本交出来。',
        stat: 'charm',
        dc: 11,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.1,
        dropChance: 0.35,
        failHpPct: 0.1,
        critFailHpPct: 0.22,
        successText:
          '你负手冷哼一声，随手晃了晃闪亮的信誉徽记。哥布林收税官瞬间吓出冷汗，生怕查出偷税漏税，麻利地奉上一笔“孝敬费”放你过关。',
        critSuccessText:
          '你的官威大到连树上的乌鸦都立正敬礼。哥布林不仅免了过路费，还把过去三天搜刮来的财宝打包成“季度纳税报表”双手呈上！',
        failText:
          '领头哥布林眯起黄眼珠端详半天，冷笑说：“钦差大人会穿打补丁的袜子？”话音未落，几支削尖木箭便擦着你耳畔飞过。',
        critFailText:
          '你一本正经念完开场白，结果掏错口袋拿出一张过期的酒馆欠条。哥布林全员笑到打滚，顺手把滚烫的松脂泼在了你斗篷上。',
      },
      {
        id: 'ch1_toll_agility',
        label: '翻越树冠绕后偷袭哨塔',
        detail: '借浓雾掩护踩枝潜行，在他们反应过来前先缴了械。',
        stat: 'agility',
        dc: 11,
        rewardCoinsMult: 1.2,
        rewardXpMult: 1.3,
        dropChance: 0.4,
        failHpPct: 0.12,
        critFailHpPct: 0.24,
        successText:
          '你轻盈地掠过潮湿树枝，像黑影般落到哨塔后方。三声闷响过后，这支绿皮武装还没来得及吹哨就整齐地数起了星星。',
        critSuccessText:
          '你如幽灵般无声落地，顺手把三只哥布林的腰带系在一起，再轻敲铁锅引发踩踏事故。你优雅拍灰离场，还顺走了哨塔里的精良战利品！',
        failText:
          '一根枯枝在最不该响的瞬间脆生生折断。哨塔上的投矛手立刻掉转枪头，你在乱箭掩护下狼狈翻滚脱身。',
        critFailText:
          '你一脚踏空，直直挂在哥布林晒腊肉的麻绳上荡起了秋千。下面三只绿皮拿长矛把你当皮纳塔戳了好几下才让你摔进草堆。',
      },
      {
        id: 'ch1_toll_bribe',
        label: '扔一把金币打发绿皮让路',
        detail: '能用黑吊币解决的事，何必弄脏刚擦亮的靴子。',
        coinCost: 450,
        rewardCoinsMult: 0.85,
        rewardXpMult: 0.95,
        dropChance: 0.2,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '金币在泥地上弹跳出清脆乐声，哥布林的眼睛瞬间亮成两排绿灯笼。他们一边抢着舔币，一边殷勤地为你拉开木栅栏，甚至还鞠了个歪躬。',
        critSuccessText:
          '金币光芒晃瞎了哨兵的双眼，他们不仅痛快放行，还热情指明了密林深处的捷径。',
        failText: '交易完成，你径直穿过了哨卡。',
        critFailText: '交易完成，你径直穿过了哨卡。',
      },
    ],
  },
  {
    id: 'ch1_shaman_cauldron',
    chapter: 1,
    title: '绿皮萨满的沸腾诡锅',
    emoji: '🫕',
    narrative:
      '林间空地中央架着一口比马车还宽的黑铁大锅，紫绿色的浓汤正冒着诡异气泡，漂浮着发光蘑菇与不知名的骨头。一名满脸涂满白灰的哥布林萨满绕着火堆跳大神，嘴里念叨着走调的祈福咒语。铁锅旁堆着不少被它当成“施法材料”的冒险者遗物，在火光下泛着诱人的金属光泽。',
    choices: [
      {
        id: 'ch1_cauldron_mage',
        label: '篡改咒文引爆萨满魔锅',
        detail: '悄悄往锅里弹一缕逆向奥术火花，让仪式替你清场。',
        stat: 'arcana',
        dc: 10,
        requiredClass: 'mage',
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.5,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你指尖轻弹，一缕冰蓝魔纹滑入沸汤。大锅瞬间喷出十尺高的紫雾烟花，萨满被掀翻进树丛，你从容挑走了最值钱的遗物。',
        critSuccessText:
          '逆向咒文完美重构了整锅魔药，爆炸气浪把萨满吹成一只焦黑的蒲公英，锅底反而凝结出晶莹的奥术精华与亮闪闪的战利品！',
        failText:
          '锅里的杂牌药材毫无逻辑可言，你的法术刚碰上去就炸出漫天酸液泡沫，溅得你衣角滋滋冒烟。',
        critFailText:
          '你的魔纹意外把汤变成了超级兴奋剂！萨满闻了一口双眼通红，举着木杖追着你绕火堆跑了整整三圈。',
      },
      {
        id: 'ch1_cauldron_might',
        label: '一脚踹翻大锅趁乱抢宝',
        detail: '热汤淋头比任何战术都管用，先掀桌子再说话。',
        stat: 'might',
        dc: 12,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.2,
        dropChance: 0.4,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你助跑飞踹，沉重铁锅轰然倾覆，滚烫绿汤泼了萨满满脸。趁它捂着眼睛满地打滚，你迅速将战利品横扫入袋。',
        critSuccessText:
          '那一脚力道精准到离谱，大锅在空中转体三百六十度后正好倒扣把萨满罩在里面！你敲了敲锅底问它暖不暖和，然后满载而归。',
        failText:
          '铁锅底早已烧得通红，你这一脚踹上去差点没把鞋底焊在锅壁上，烫得你单脚跳着挨了一记法杖闷棍。',
        critFailText:
          '铁锅纹丝不动，反震力把你弹进了火堆边。萨满顺手舀起一勺滚烫的蛙眼汤浇在你头上，并宣称你现在已经是汤料的一部分了。',
      },
      {
        id: 'ch1_cauldron_charm',
        label: '装作食神品尝并指点配方',
        detail: '用严肃的美食家态度喝一口，顺便骗它奉上祭品。',
        stat: 'charm',
        dc: 12,
        rewardCoinsMult: 1.25,
        rewardXpMult: 1.15,
        dropChance: 0.35,
        healPctOnSuccess: 0.18,
        failHpPct: 0.15,
        critFailHpPct: 0.28,
        successText:
          '你强忍着像袜子煮青蛙的味道喝下一勺，面不改色点评“欠缺灵魂火候”。萨满瞬间把你奉为大厨先知，不仅献上供品，这碗奇汤竟还意外滋补了你的气血！',
        critSuccessText:
          '你连喝三碗并即兴编了一套“密林米其林三星评定标准”。萨满感动涕零，当场磕头拜师，把压箱底的珍宝全塞进你怀里，你的体力也随之恢复如初！',
        failText:
          '刚抿一口你就忍不住当场干呕，脸色比萨满还绿。被冒犯的萨满气得嗷嗷乱叫，挥舞骨杖朝你劈头盖脸砸来。',
        critFailText:
          '那一口汤直接把你的味蕾送去了冥界旅游，你眼前出现会跳踢踏舞的蘑菇幻觉，晕头转向撞在了大树干上。',
      },
      {
        id: 'ch1_cauldron_agility',
        label: '趁萨满转圈时顺走祭坛装备',
        detail: '它背过身念咒的那三秒，足够你搬空半个祭坛。',
        stat: 'agility',
        dc: 11,
        rewardCoinsMult: 1.2,
        rewardXpMult: 1.15,
        dropChance: 0.45,
        failHpPct: 0.11,
        critFailHpPct: 0.22,
        successText:
          '卡准鼓点节奏，你像狸猫般滑过草丛，悄无声息地卷走了祭坛上的钱袋与装备，临走还顺手放了块石头充数。',
        critSuccessText:
          '你的手速快出残影，不仅搬空了整个祭坛，连萨满腰间挂着的幸运金币串都被你解了下来，它直到念完咒还在困惑神灵今天胃口真大！',
        failText:
          '你刚拎起一把短剑，上面系着的骨头风铃就叮当大作。萨满回头丢来一发绿火球，燎焦了你的袖口。',
        critFailText:
          '你的袖子勾住了祭坛上的干尸手臂，整张木桌轰然倒塌。萨满以为先祖显灵发怒，吓得把整罐辣椒粉全撒你脸上了。',
      },
    ],
  },
  {
    id: 'ch1_wolf_ambush',
    chapter: 1,
    title: '迷雾林道的毒牙狼群',
    emoji: '🐺',
    narrative:
      '幽暗杉木间飘来浓烈的腥风，七八双琥珀色的兽瞳在雾气中缓缓亮起。为首的银背毒牙狼压低前爪，嘴角滴落的涎水把枯叶腐蚀出滋滋白烟。它们显然把你当成了误入猎场的加餐，正沿着半圆形包抄过来，连退路上的枯枝都被暗哨堵死。',
    choices: [
      {
        id: 'ch1_wolf_ranger',
        label: '暗影游侠箭矢点射头狼',
        detail: '擒贼先擒王，一箭钉穿银背头狼的傲气。',
        stat: 'agility',
        dc: 10,
        requiredClass: 'ranger',
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.13,
        critFailHpPct: 0.25,
        successText:
          '弓弦轻颤，破风箭矢精准划破头狼耳尖，钉入它身后的古木。银背狼夹着尾巴哀嚎撤退，狼群顷刻作鸟兽散，留下一具被拖回巢穴的商旅包裹。',
        critSuccessText:
          '两箭连发在雾中织出死亡弧线，头狼吓得四脚朝天翻进沟里，余下群狼甚至以为林间降临了狩猎之神，丢下巢穴秘宝仓皇逃命！',
        failText:
          '林雾折射了视线，箭矢偏了一寸擦过狼毛。被激怒的毒牙狼猛扑上来，在你臂甲上留下几道带毒血痕。',
        critFailText:
          '你拉满弓弦的瞬间，弓梢挂住了头顶藤蔓，整支箭斜着扎进你脚边的泥土，反倒帮狼群标出了你的准确坐标。',
      },
      {
        id: 'ch1_wolf_might',
        label: '挥舞火把正面硬刚狼王',
        detail: '野兽终究怕火与更凶的野兽，比比谁更像食物链顶端。',
        stat: 'might',
        dc: 12,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.3,
        dropChance: 0.4,
        failHpPct: 0.15,
        critFailHpPct: 0.28,
        successText:
          '你怒喝一声抡起燃木横扫，烈焰呼啸着逼退狼群。一记重击砸在扑来的头狼鼻梁上，群狼立刻溃散逃入密林深处。',
        critSuccessText:
          '你浑身迸发出堪比熊罴的威势，空手掐住扑来的头狼后颈甩了出去！狼群目瞪口呆，仿佛怀疑今天究竟是谁在狩猎谁。',
        failText:
          '火把被潮湿的雾气呛熄了一半，两头幼狼趁机从侧翼咬住你的护腿，你费了好大劲才将它们甩开。',
        critFailText:
          '你用力过猛，燃烧的火把脱手飞出，精准点燃了自己的披风下摆。狼群甚至停下来围观你满地打滚灭火。',
      },
      {
        id: 'ch1_wolf_arcana',
        label: '拟造巨龙低吼的幻音结界',
        detail: '用奥术回声模拟古龙吐息，让这群林间土狗认清现实。',
        stat: 'arcana',
        dc: 11,
        rewardCoinsMult: 1.25,
        rewardXpMult: 1.25,
        dropChance: 0.35,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '低沉恐怖的龙吟震得落叶簌簌坠落，毒牙狼群瞬间炸毛，连滚带爬逃得无影无踪，连叼着的战利品都顾不上带走。',
        critSuccessText:
          '你的幻音逼真到连空气都泛起灼热涟漪，头狼当场吓尿，临逃前还把藏在树洞里的精良战利品拱出来当贡品！',
        failText:
          '咒文收尾时走了一点音，龙吟听起来更像一只卡了鱼刺的大猫。狼群短暂迷惑两秒后，恼羞成怒地一拥而上。',
        critFailText:
          '幻音结界发生回声啸叫，刺耳尖鸣先震晕了你自己。等你捂着耳朵站起来，肩头已经被狼群啃出了牙印。',
      },
      {
        id: 'ch1_wolf_deadbeat',
        label: '老赖死猪不怕开水烫式逼视',
        detail: '连催债高利贷都不怕的人，还会怕几条森林土狗？',
        stat: 'charm',
        dc: 13,
        creditPerk: 'deadbeat_intimidate',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.2,
        dropChance: 0.4,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你露出黑吊国老赖特有的亡命徒微笑，一步步反朝狼王走去，嘴里还念叨着“今晚加餐红烧狼肉”。头狼被你的精神状态彻底震慑，夹尾而逃。',
        critSuccessText:
          '你身上散发出的“身无分文、烂命一条”绝望气场让狼王本能发颤！它不仅放弃狩猎，还同情地把刚偷来的钱袋推到你脚边。',
        failText:
          '野兽显然听不懂你关于“要钱没有要命一条”的深情演说，银背狼果断扑上来检验你的肉质。',
        critFailText:
          '你气势汹汹大吼一声，结果嗓子破音呛了口冷风，当场蹲地咳嗽，狼群愉快地把你当成自助餐围了上来。',
      },
    ],
  },

  // =========================================================================
  // Chapter 2: 亡灵墓穴 (💀)
  // =========================================================================
  {
    id: 'ch2_bone_choir',
    chapter: 2,
    title: '吟唱挽歌的白骨唱诗班',
    emoji: '🎻',
    narrative:
      '阴冷的哥特式地穴教堂内，幽绿魂火在百盏铁吊灯上摇曳。祭坛前整齐排着十二具披着破烂丝绒袍的骷髅乐手，正用肋骨当琴弓、胫骨当长笛，演奏一曲令人头皮发麻的《安魂变奏曲》。乐谱架下方压着一枚散发圣洁微光的封印徽章，但只要旋律不断，四周的石棺就在咯吱作响。',
    choices: [
      {
        id: 'ch2_choir_paladin',
        label: '辉光圣歌强行接管合唱团',
        detail: '用正统圣殿赞美诗超度这群跑调的亡灵乐手。',
        stat: 'charm',
        dc: 11,
        requiredClass: 'paladin',
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        healPctOnSuccess: 0.16,
        failHpPct: 0.12,
        critFailHpPct: 0.24,
        successText:
          '炽白圣光随你的咏唱铺满穹顶，亡灵乐手眼眶中的绿火化作金色尘埃。它们躬身谢幕后安详散架，留下一地闪亮的祭坛贡品与温暖圣愈。',
        critSuccessText:
          '你的圣歌庄严到让墓穴穹顶落下金色光雨！白骨唱诗班感动得齐刷刷丢掉乐器鼓掌，最后集体升天并把指挥棒里的珍稀宝藏留给了你！',
        failText:
          '亡灵乐手们显然是重金属摇滚派，他们直接把音量拉满盖过了你的圣歌，音波震得你耳膜嗡嗡作响。',
        critFailText:
          '你唱到高音处突然破音，圣光闪了两下熄灭了。骷髅首席小提琴手怒不可遏，拆下自己的大腿骨把你当节拍器敲了一顿。',
      },
      {
        id: 'ch2_choir_arcana',
        label: '解析死灵乐谱反向拆解阵眼',
        detail: '这首曲子其实是聚魂法阵，改掉两个音符就能让它们集体宕机。',
        stat: 'arcana',
        dc: 12,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.3,
        dropChance: 0.45,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你一眼看破乐谱里的死灵律动，隔空抹去关键休止符。唱诗班瞬间节奏大乱，互相磕成一地骨牌，你轻松摘走封印徽章与战利品。',
        critSuccessText:
          '你顺手将安魂曲改成了欢快酒馆小调！十二具骷髅不受控制地跳起康康舞直到全身散架，还把藏在风琴里的秘宝震了出来！',
        failText:
          '改谱时算错了一个半音，反倒触发了石棺里的合唱替补席，阴冷怨气顺着你的脚踝缠了上来。',
        critFailText:
          '你的魔力与死灵乐谱发生剧烈共鸣，你自己也忍不住跟着节奏跳了两步踢踏舞，趁机挨了好几记骨笛闷击。',
      },
      {
        id: 'ch2_choir_might',
        label: '掀翻管风琴砸散整排骷髅',
        detail: '音乐鉴赏太费脑子，物理静音才是永恒真理。',
        stat: 'might',
        dc: 12,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.25,
        dropChance: 0.4,
        failHpPct: 0.14,
        critFailHpPct: 0.27,
        successText:
          '你怒吼着推倒沉重的铅管风琴，轰隆巨响终结了这场阴间音乐会。漫天白骨碎片里滚出几只镶金献金盒。',
        critSuccessText:
          '风琴倒下时奏出震撼地穴的终结和弦，气浪把整排骷髅震成骨粉，连隐藏在墙砖后的墓室暗格都顺带震开了！',
        failText:
          '百年石基焊死了风琴底座，你推得青筋暴起也没挪动半寸，反倒被醒来的骷髅卫兵围着敲了记闷棍。',
        critFailText:
          '一根锈蚀风琴管断落下来正好套在你头上，你像戴了口铜钟一样嗡嗡乱转，被亡灵乐手们当成打击乐器敲了半天。',
      },
      {
        id: 'ch2_choir_agility',
        label: '贴墙潜行偷换指挥乐谱',
        detail: '只要摸到祭坛把徽章顺走，谁爱听它们唱就听吧。',
        stat: 'agility',
        dc: 12,
        rewardCoinsMult: 1.25,
        rewardXpMult: 1.2,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.24,
        successText:
          '你借着石柱阴影无声滑到祭坛边，趁指挥骷髅闭眼陶醉的刹那抽走封印徽章和金币匣，悄然脱身。',
        critSuccessText:
          '你不仅神不知鬼不觉卷走所有珍宝，还把指挥手里的木棒换成了一根发霉面包棒。骷髅们毫无察觉地继续演奏，你已笑着远去！',
        failText:
          '你踩碎了地板上一块空心趾骨，清脆咔嚓声瞬间让全场演奏戛然而止。十二双绿油油的眼眶齐刷刷转向了你。',
        critFailText:
          '你伸手去摸徽章时不小心碰到了风琴踏板，一声震耳欲聋的怪响惊醒了整座教堂的亡灵观众。',
      },
    ],
  },
  {
    id: 'ch2_ghoul_feast',
    chapter: 2,
    title: '墓室长桌的腐朽晚宴',
    emoji: '🕯️',
    narrative:
      '推开厚重的青铜墓门，映入眼帘的竟是一场荒诞的地下贵族晚宴。惨白烛火下，几名穿着发霉礼服的食尸鬼正优雅地挥舞银叉，面前银盘里盛着黑漆漆的“墓地特供浓汤”。餐桌主位摆着一只镶满红宝石的鎏金高脚杯，散发着令你心跳加速的财宝气息。',
    choices: [
      {
        id: 'ch2_feast_charm',
        label: '盛装入席假扮巡视的死灵贵族',
        detail: '端起贵族架子批评红酒年份，让食尸鬼管家乖乖上供。',
        stat: 'charm',
        dc: 12,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.15,
        dropChance: 0.4,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你优雅甩开披风落座，用挑剔语气点评烛台摆放不够对称。食尸鬼管家诚惶诚恐，连连鞠躬将鎏金酒杯与银餐具打包奉上。',
        critSuccessText:
          '你的高贵气场令这群生前曾是破产男爵的食尸鬼热泪盈眶！它们尊你为晚宴主宾，不仅奉上全部传家宝，还派侍者替你清扫了前方暗道！',
        failText:
          '你刚开口，一口活人温热的呼吸就在冷空气里凝成白雾。食尸鬼们缓缓放下银叉，盯着你的脖子露出热情笑容。',
        critFailText:
          '你想优雅行个屈膝礼，结果椅子腿腐朽断裂，你仰面摔进装满腐肉汤的银盆里，正式升级成了今晚的主菜。',
      },
      {
        id: 'ch2_feast_might',
        label: '掀翻长桌砸断它们的餐桌礼仪',
        detail: '跟食尸鬼讲什么礼仪，直接把整张橡木桌扣它们头上。',
        stat: 'might',
        dc: 12,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.3,
        dropChance: 0.4,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你双手抠住桌沿一声爆喝，沉重橡木桌掀飞而起，银盘蜡烛砸得食尸鬼人仰马翻。你趁乱抢走鎏金酒杯扬长而去。',
        critSuccessText:
          '整张宴会桌如攻城盾般横扫全场，把五只食尸鬼钉在墙上动弹不得！漫天飞舞的纯银餐具全被你潇洒兜进背包。',
        failText:
          '橡木桌浸满百年湿气重若千钧，你刚抬起一角就被扑上来的食尸鬼挠破了肩甲。',
        critFailText:
          '你用力太猛拉伤了腰，食尸鬼们不仅没被吓到，反而贴心地拿银叉替你“松松筋骨”。',
      },
      {
        id: 'ch2_feast_arcana',
        label: '点燃烛火引爆墓室沼气',
        detail: '这间密室里飘着浓重尸气与乙醇味，一颗小火星就够盛大谢幕。',
        stat: 'arcana',
        dc: 13,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你退至门廊轻弹火矢，幽蓝爆燃瞬间席卷长桌，把食尸鬼晚宴烤成露天烧烤。待烟尘散去，鎏金高脚杯完好无损地躺在灰烬里。',
        critSuccessText:
          '你精准操控爆燃范围，火焰宛如礼花般只焚尽亡灵却分毫未伤珍宝！你踏着余烬优雅拾起战利品，颇有电影主角不回头看爆炸的风范。',
        failText:
          '沼气浓度比预想更高，气浪掀翻门扉将你震飞出去，眉毛差点全交给这顿晚宴当调料。',
        critFailText:
          '火焰顺着地板油脂倒灌回你脚下，你成了整场晚宴唯一一颗冒着黑烟的火焰布丁。',
      },
      {
        id: 'ch2_feast_bribe',
        label: '留下金币假装结账体面退场',
        detail: '在餐桌留下一笔慷慨小费，然后顺理成章打包纪念品。',
        coinCost: 650,
        rewardCoinsMult: 0.9,
        rewardXpMult: 0.95,
        dropChance: 0.25,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '食尸鬼管家见到闪亮金币立刻恢复了生前的职业素养，优雅收下小费并为你打包了一份精致的镀金餐具伴手礼。',
        critSuccessText: '金币的光芒让管家欢欣鼓舞，甚至还附赠了通往下层的暗门钥匙。',
        failText: '交易完成，你体面地离开了宴会厅。',
        critFailText: '交易完成，你体面地离开了宴会厅。',
      },
    ],
  },
  {
    id: 'ch2_wraith_mirror',
    chapter: 2,
    title: '铭刻诅咒的银霜古镜',
    emoji: '🪞',
    narrative:
      '墓道转角矗立着一面两人高的黑银古镜，镜面蒙着永不融化的冰霜，倒映出的却不是你的脸，而是一名戴着荆棘王冠的苍白怨灵。它用指甲缓缓刮擦镜面，发出令人牙酸的尖啸，低语着愿用镜后暗室的秘宝，交换你心中最执着的一段欲望。',
    choices: [
      {
        id: 'ch2_mirror_mage',
        label: '奥术镜面折射反噬怨灵',
        detail: '用棱镜法阵把它的精神诅咒原封不动弹回镜中。',
        stat: 'arcana',
        dc: 11,
        requiredClass: 'mage',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.35,
        dropChance: 0.5,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你在虚空勾勒出三层折射符文，诅咒寒光瞬间倒卷入镜。怨灵在尖叫中碎成银沙，镜框轰然弹开露出藏宝暗室。',
        critSuccessText:
          '你的折射法阵形成了无限镜像回廊！怨灵被自己的丑脸吓得魂飞魄散，暗室里所有尘封珍宝齐刷刷滚落到你脚边！',
        failText:
          '镜面寒气顺着魔力回路逆流而上，你的指尖瞬间结出一层白霜，不得不挥拳震断施法。',
        critFailText:
          '折射角度算歪了半度，诅咒原样反弹到你自己眉心，你的脑海里被迫循环播放了十分钟阴间情歌。',
      },
      {
        id: 'ch2_mirror_charm',
        label: '疯狂吐槽它审美品位破防怨灵',
        detail: '用黑吊国嘴臭艺术摧毁亡灵自尊，看谁先道心破碎。',
        stat: 'charm',
        dc: 12,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.25,
        dropChance: 0.4,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你指着镜子从它的黑眼圈点评到过时三百年的荆棘头饰。怨灵气得魂火乱颤，当场破防自爆，镜后财宝归你所有。',
        critSuccessText:
          '你的毒舌精准戳中了怨灵生前被退婚的痛处！它蹲在镜子里抱头痛哭，边哭边把密室钥匙丢出来求你赶紧滚。',
        failText:
          '怨灵反手把你上次赌博输光底裤的尴尬回忆投射在镜面上，精神暴击让你眼前一黑。',
        critFailText:
          '你嘴瓢骂错了一句，怨灵恼羞成怒直接从镜子里伸出两只冰爪把你按在地上搓了顿冷水澡。',
      },
      {
        id: 'ch2_mirror_agility',
        label: '避开视线盲区撬开镜后机关',
        detail: '不看镜面就不算对视，直接拆了它的后盖拿东西。',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.25,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你低头贴墙绕到古镜侧面，用匕首精准拨开生锈卡榫。怨灵还没转过头来，暗格里的秘宝已经被你打包带走。',
        critSuccessText:
          '你顺手在镜框上盖了块破抹布，怨灵瞬间变成瞎子在镜子里撞来撞去，你优哉游哉清空了整间密室！',
        failText:
          '撬锁时余光扫到了镜框反光，一股刺骨寒流瞬间贯穿脊背，冻得你动作一僵。',
        critFailText:
          '你的匕首卡死在镜框机关里，暗箭擦着你鼻尖飞过，怨灵在镜子里发出了极不礼貌的嘲笑。',
      },
      {
        id: 'ch2_mirror_might',
        label: '一锤砸碎银镜粉碎七年霉运',
        detail: '只要锤子够重，没有什么玄学镜子是碎不了的。',
        stat: 'might',
        dc: 13,
        rewardCoinsMult: 1.25,
        rewardXpMult: 1.3,
        dropChance: 0.38,
        failHpPct: 0.15,
        critFailHpPct: 0.29,
        successText:
          '伴随一声清脆爆响，黑银镜面寸寸龟裂，怨灵连句狠话都没说完就随碎渣消散。你踏过玻璃渣轻松收走暗格战利品。',
        critSuccessText:
          '这一击力透石壁，不仅震碎了怨灵本体，还顺手砸穿了后面的藏金夹层，金银珠宝像瀑布般哗啦啦倾泻而出！',
        failText:
          '镜面爆裂时溅射出无数诅咒银片，划破你的面颊并带来一阵钻心阴寒。',
        critFailText:
          '古镜竟带着弹性反震结界！你的武器被弹回砸在自己脑门上，眼前冒出的星星比镜框上的宝石还多。',
      },
    ],
  },

  // =========================================================================
  // Chapter 3: 猩红血堡 (🏰)
  // =========================================================================
  {
    id: 'ch3_blood_ballroom',
    chapter: 3,
    title: '血月舞厅的假面贵族',
    emoji: '🍷',
    narrative:
      '绯红月光透过彩绘玻璃窗洒满大理石舞厅，水晶吊灯下数十名戴着鸟嘴与白骨面具的血族贵族正翩翩起舞。长桌上陈列着晶莹剔透的“猩红珍酿”，侍从端着纯金托盘穿梭其间。大厅中央的丝绒靠垫上，正安静躺着开启堡垒内殿的秘银纹章，只是每一位宾客都在用饥渴眼神打量你跳动的颈动脉。',
    choices: [
      {
        id: 'ch3_ball_charm',
        label: '大摇大摆刷金卡冒充血族投资人',
        detail: '谈吐间流露十亿资产的从容，连伯爵侍从都要敬你三分。',
        stat: 'charm',
        dc: 13,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.25,
        dropChance: 0.45,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你端起酒杯轻嗅，随口抛出“黑吊国血堡文旅开发计划”。几名缺钱修屋顶的吸血鬼男爵瞬间眼睛放光，恭敬奉上秘银纹章与赞助回扣。',
        critSuccessText:
          '你的财阀气质彻底折服了全场血族！宾客们争相递名片求合作，甚至把伯爵私藏的珍稀宝盒当成“见面诚意礼”硬塞进你怀里！',
        failText:
          '一位老辣的女伯爵凑近闻了闻，轻笑：“阁下身上的大蒜烧烤味，可不像纯血贵族呢。”瞬间几把细剑抵住了你的后腰。',
        critFailText:
          '你自信敬酒却忘了面具没开嘴洞，整杯猩红液体顺着脸颊浇了一身。全场吸血鬼欢呼着以为你自带蘸料上门。',
      },
      {
        id: 'ch3_ball_agility',
        label: '借华尔兹舞步顺走秘银纹章',
        detail: '跳进舞池旋转三圈，等乐曲结束时宝物早已易主。',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.3,
        dropChance: 0.5,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你踏着优雅拍点切入舞池，一个漂亮的托举转身间顺手摘下纹章，还将顺路的纯金酒壶揣入怀中，潇洒退入廊柱阴影。',
        critSuccessText:
          '你的舞步惊艳四座，连血族侍卫都忘了盯梢忍不住鼓掌！你在谢幕鞠躬的刹那把中央供桌上的珍宝打包一空，留下一朵玫瑰扬长而去。',
        failText:
          '转身时你一脚踩在旁边吸血鬼伯爵的漆皮鞋上，优雅舞会瞬间演变成全武行群殴。',
        critFailText:
          '你旋转过猛一头撞翻了香槟塔，玻璃碎裂声让所有假面宾客同时露出了森白尖牙。',
      },
      {
        id: 'ch3_ball_paladin',
        label: '掀开圣徽释放耀眼日光闪爆',
        detail: '血族最怕什么？给这场午夜舞会提前送上正午阳光！',
        stat: 'charm',
        dc: 11,
        requiredClass: 'paladin',
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.4,
        dropChance: 0.45,
        healPctOnSuccess: 0.15,
        failHpPct: 0.13,
        critFailHpPct: 0.25,
        successText:
          '璀璨圣光如烈日炸裂，舞厅顿时响起一片捂眼惨叫，血族贵族化作漫天惊慌蝙蝠四散逃窜。你从容拾起秘银纹章与满地掉落珠宝。',
        critSuccessText:
          '圣光炽烈到仿佛把太阳搬进了舞厅！整座大厅的血裔瞬间灰飞烟灭，只留下整齐码放的贵族钱袋与沐浴在圣辉中的你！',
        failText:
          '血堡的猩红穹顶压制了圣光强度，只闪出类似廉价闪光灯的微光，反倒把满厅贵族的仇恨全吸引到了你身上。',
        critFailText:
          '圣徽反光正好晃进你自己眼睛里，你闭着眼胡乱挥舞武器，结果精准劈碎了最贵的酒桶，被愤怒侍卫按着摩擦。',
      },
      {
        id: 'ch3_ball_arcana',
        label: '往血酒池注入大蒜提纯炼金剂',
        detail: '既然他们爱喝红酒，那就请全场品尝蒜香风味特调。',
        stat: 'arcana',
        dc: 13,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.3,
        dropChance: 0.42,
        failHpPct: 0.14,
        critFailHpPct: 0.27,
        successText:
          '浓郁的辛辣蒜香随魔力雾化弥漫舞厅，血族贵族们如遭雷击般捂喉溃逃。你捏着鼻子收走桌上所有战利品。',
        critSuccessText:
          '炼金蒸汽精准引爆了血族的生理克星，舞厅瞬间变成大型翻车现场！一位侯爵甚至哭着把家族戒指丢下换你赶紧关掉香水瓶！',
        failText:
          '法阵调配失误，大蒜味变成了烤肉香味，非但没吓退吸血鬼，反倒把整栋楼的蝙蝠都馋过来了。',
        critFailText:
          '炼金瓶在你手里提前炸开，辛辣汁液糊了你满脸。你辣得眼泪横流，还没看清路就撞进血裔侍卫的怀里。',
      },
    ],
  },
  {
    id: 'ch3_gargoyle_bridge',
    chapter: 3,
    title: '猩红魔偶镇守的内庭长桥',
    emoji: '🗿',
    narrative:
      '连接内堡的石桥悬在无底血雾深渊之上，桥栏两侧蹲踞着八尊黑曜石雕成的猩红魔偶。风声穿过桥洞发出呜咽，当你踏上第三块石板时，离你最近的两尊魔偶骤然亮起血红石眼，沉重石斧摩擦桥面迸出火星，低沉的石质嗓音在夜空回荡：“无血契者，止步或粉身碎骨！”',
    choices: [
      {
        id: 'ch3_bridge_warrior',
        label: '重剑蓄力直劈魔偶关节裂隙',
        detail: '石头再硬也有接缝，一剑崩碎它们的魔力核心。',
        stat: 'might',
        dc: 11,
        requiredClass: 'warrior',
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.4,
        dropChance: 0.48,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你的剑锋精准切入黑曜石膝盖缝隙，伴随巨响，魔偶轰然跪碎成满地滚石，胸腔里滚出两颗价值连城的猩红晶核。',
        critSuccessText:
          '你一剑斩断魔偶石斧并顺势横扫，余波震塌了半排雕像的底座！剩余魔偶竟自觉地缩回底座装死，乖乖为你让出大道！',
        failText:
          '黑曜石外壳比精钢更硬，你这一剑只砍出一串火星，震得双臂发麻，紧接着被石肘顶得连退数步。',
        critFailText:
          '你的武器卡死在魔偶石缝里拔不出来，魔偶干脆拎着你的武器顺带把你当成挂件甩到了桥栏上。',
      },
      {
        id: 'ch3_bridge_arcana',
        label: '改写石桥符文夺取魔偶控制权',
        detail: '魔偶只是听指令的石块，只要篡改桥面法阵就能让它们敬礼。',
        stat: 'arcana',
        dc: 13,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你迅速勾勒出覆写咒文，血红石眼闪烁两下转为顺从的幽蓝。两尊魔偶不仅收起巨斧，还主动敲开桥柱暗格递给你一批秘藏。',
        critSuccessText:
          '你彻底接管了整座石桥的安保协议！八尊魔偶整齐划一地朝你单膝下跪，并把前几批闯关者留下的精品装备毕恭毕敬献上！',
        failText:
          '古代血族的加密符文极其刁钻，你的覆写触发了防篡改警报，魔偶抡斧速度瞬间加快了一倍。',
        critFailText:
          '魔力反噬震得你踉跄后退，符文把你标记成了“最高优先级维修废料”，魔偶热情地举起大锤准备帮你整形。',
      },
      {
        id: 'ch3_bridge_agility',
        label: '踩着石斧借力翻越魔偶头顶',
        detail: '它们转身太慢，用轻功从头顶掠过还能顺手抠宝石。',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.3,
        dropChance: 0.45,
        failHpPct: 0.13,
        critFailHpPct: 0.27,
        successText:
          '石斧劈落的瞬间你轻点斧背腾空跃起，在空中顺手抠下魔偶额头的红宝石，稳稳落在桥对面扬长而去。',
        critSuccessText:
          '你的身法如夜燕穿林，两尊魔偶挥斧互砍把彼此劈成了碎石堆，你不仅毫发无伤，还捡走了两颗完整的魔偶核心！',
        failText:
          '桥面血雾湿滑，你起跳慢了半拍，被石斧带起的劲风扫中肋部，险些跌下栏杆。',
        critFailText:
          '你跃到一半斗篷被魔偶石角勾住，像面迎风招展的旗帜在深渊上方晃荡了半天，摔回桥面时灰头土脸。',
      },
      {
        id: 'ch3_bridge_deadbeat',
        label: '高喊“弗拉德欠我债”强闯内桥',
        detail: '声称自己是来替黑吊国催收血堡房贷的，看石头人敢不敢拦。',
        stat: 'charm',
        dc: 14,
        creditPerk: 'deadbeat_intimidate',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.2,
        dropChance: 0.4,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你把催收公文拍在魔偶鼻梁上，义正辞严斥责伯爵拖欠物业费三百年。僵化的魔偶核心瞬间逻辑死机，呆立原地任你搜刮过桥。',
        critSuccessText:
          '你连珠炮般的催债黑话直接烧穿了魔偶的逻辑铭文！两尊雕像冒出黑烟原地解体，肚子里还震出伯爵藏匿的应急金库！',
        failText:
          '魔偶显然只认血契不认账单，冰冷地回复“本桥不接受口头讨债”后便挥斧劈下。',
        critFailText:
          '你喊得太入戏，一巴掌拍在魔偶坚硬的胸口，震得自己手掌发麻，魔偶顺势回敬了你一记友善的石拳。',
      },
    ],
  },
  {
    id: 'ch3_crimson_cellar',
    chapter: 3,
    title: '封存千年的血酒地窖',
    emoji: '🦇',
    narrative:
      '螺旋石阶通往阴凉潮湿的堡垒酒窖，数百只贴着羊皮年份签的橡木桶沿墙排开，空气中浮动着葡萄发酵与铁锈交织的奇异甜香。穹顶倒挂着密密麻麻的嗜血蝙蝠，正发出细碎不安的吱吱声。酒窖尽头的铁笼里锁着一瓶流光溢彩的“黎明圣露”，传说既能疗伤又价值千金。',
    choices: [
      {
        id: 'ch3_cellar_ranger',
        label: '屏息穿行铁索无声取走圣露',
        detail: '只要脚步比蝙蝠心跳还轻，就能不惊动一片翅膀。',
        stat: 'agility',
        dc: 11,
        requiredClass: 'ranger',
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.3,
        dropChance: 0.48,
        healPctOnSuccess: 0.2,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你如影随形掠过酒桶间隙，两下挑开铁笼锁芯，喝下半口圣露顿觉神清气爽，剩余半瓶连同几枚古董酒窖金币一并入袋。',
        critSuccessText:
          '你的潜行宛如鬼魅，不仅完好取走黎明圣露恢复杂伤，还顺手从酒窖暗槽摸出一套伯爵珍藏的精良装备，头顶蝙蝠连眼皮都没睁开！',
        failText:
          '开锁时铁丝崩断发出脆响，穹顶瞬间炸开一片黑压压的蝙蝠风暴，你在利爪扑咬中狼狈冲出地窖。',
        critFailText:
          '你脚下踢翻一只空酒桶，轰隆回声惊醒了整座酒窖的蝙蝠群，它们把你当成会移动的血包围殴了整整一分钟。',
      },
      {
        id: 'ch3_cellar_arcana',
        label: '用静音与冰霜结界冻结蝙蝠群',
        detail: '给这群夜行动物来个提前冬眠，酒窖就归你慢慢逛了。',
        stat: 'arcana',
        dc: 13,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        healPctOnSuccess: 0.16,
        failHpPct: 0.14,
        critFailHpPct: 0.27,
        successText:
          '一层晶莹霜雾无声爬上穹顶，数百只蝙蝠瞬间安静地进入深度冬眠。你惬意打开铁笼，饮用圣露并收刮酒窖藏品。',
        critSuccessText:
          '冰霜法阵完美冻住了所有蝙蝠，顺便把橡木桶里的陈酿凝结成了极品冰酒精华！你气血大振，满载战利品离开。',
        failText:
          '冰霜只冻住了半边天花板，另一半惊醒的蝙蝠像黑云般俯冲而下，咬得你抱头鼠窜。',
        critFailText:
          '你手滑把冰霜结界放歪了，反倒把自己鞋底冻在石板上，成了蝙蝠群眼中无比体贴的定点投喂台。',
      },
      {
        id: 'ch3_cellar_might',
        label: '砸破酒桶制造烈酒火墙逼退蝙蝠',
        detail: '先砸开高度陈酿再借火光开路，简单粗暴。',
        stat: 'might',
        dc: 13,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.3,
        dropChance: 0.4,
        failHpPct: 0.15,
        critFailHpPct: 0.29,
        successText:
          '你砸碎两桶烈性陈酿点燃火线，滚滚热浪把蝙蝠逼回通风井。你强拆铁笼，抢走圣露与藏匿的金币匣。',
        critSuccessText:
          '酒香伴随烈焰冲天，不仅清空了蝙蝠群，还烧融了铁笼上的暗金封印，让你不费吹灰之力收入整套珍稀战利品！',
        failText:
          '那桶陈酿其实是货真价实的百年血酒，根本点不着！反倒浓烈血腥味把蝙蝠刺激得更加狂躁。',
        critFailText:
          '火苗窜得太快，酒窖瞬间变成桑拿房，你一边被浓烟呛得眼泪直流，一边还挨了蝙蝠几口。',
      },
      {
        id: 'ch3_cellar_bribe',
        label: '扔下一袋金币向看守酒窖的血仆买酒',
        detail: '阴暗角落里其实躲着个想赚外快的血族酒保，直接交易最省心。',
        coinCost: 850,
        rewardCoinsMult: 0.9,
        rewardXpMult: 1.0,
        dropChance: 0.3,
        healPctOnSuccess: 0.22,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '阴影里的酒保见钱眼开，熟练地敲了敲木勺安抚蝙蝠群，悄悄递给你一瓶黎明圣露和半袋私藏金币，还提醒你小心伯爵的脾气。',
        critSuccessText: '酒保被你的阔绰打动，直接多塞了两瓶疗伤佳酿与一张堡垒秘图。',
        failText: '交易完成，你恢复了状态并离开了酒窖。',
        critFailText: '交易完成，你恢复了状态并离开了酒窖。',
      },
    ],
  },
];

const CHAPTER_4_TO_6_SCENES: readonly TabletopSceneDef[] = [
  // =========================================================================
  // Chapter 4: 矮人熔炉 (🌋)
  // =========================================================================
  {
    id: 'ch4_rune_conveyor',
    chapter: 4,
    title: '暴走的符文矿车铁轨',
    emoji: '⛏️',
    narrative:
      '炽热的地下铁轨悬架在翻涌的熔岩河上方，齿轮与蒸汽管喷出刺耳白雾。三辆满载秘银原矿的符文矿车突然挣脱制动，像三头喷火的铁牛沿着下坡朝你直冲而来！铁轨旁的扳道房里闪烁着失控红光，如果动作够快，你甚至能把整车秘银顺进自己的口袋。',
    choices: [
      {
        id: 'ch4_cart_agility',
        label: '凌空翻上矿车紧急拉闸',
        detail: '像动作片主角一样跳上失控车厢，顺便截胡整车秘银。',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.35,
        dropChance: 0.5,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你在铁轨火花间腾空一跃稳稳落入车厢，反手扳下铜闸。刺耳刹车声后矿车停在断轨前两寸，满车秘银原矿全归你笑纳。',
        critSuccessText:
          '你单手倒立稳住车头，顺脚把三节车厢精准停靠在藏宝台前！连旁边巡逻的黑铁傀儡都发出赞许的蒸汽哨声，掉落一块稀有符文核！',
        failText:
          '车厢颠簸得像醉酒野牛，你没抓稳铁栏杆，膝盖狠狠磕在车帮上，狼狈滚落到碎石堆里。',
        critFailText:
          '你英勇起跳却精准撞上了隧道限高牌，“咣当”一声像煎饼般贴在车头被拖行了五十码。',
      },
      {
        id: 'ch4_cart_warrior',
        label: '重甲抵柱硬生生顶停矿车',
        detail: '只要肌肉和护甲够硬，火车头也得给你让道。',
        stat: 'might',
        dc: 12,
        requiredClass: 'warrior',
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.4,
        dropChance: 0.45,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你双脚死死楔进铁轨枕木，怒吼着双肩顶住车头！火星四溅间矿车硬生生被你逼停，震落的秘银与锻造宝箱滚了满地。',
        critSuccessText:
          '你的双臂仿佛矮人山神附体，不仅单手截停三节重载矿车，还顺手把车厢掀翻抖出一整堆绝版精锻秘宝，铁轨都被你踩出两个脚印！',
        failText:
          '矿车惯性远超预期，你被顶着在铁轨上滑出十几步，虎口震裂、胸甲凹陷了一大块。',
        critFailText:
          '你刚摆出霸气起手式，铁轨震动把头顶一桶润滑油扣你头上。你脚底一滑直接表演了一段熔炉冰上芭蕾。',
      },
      {
        id: 'ch4_cart_arcana',
        label: '改写磁轨符文让矿车凌空悬浮',
        detail: '用奥术反磁力把暴走矿车定在半空，安全又优雅。',
        stat: 'arcana',
        dc: 14,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '蔚蓝奥术电弧瞬间覆盖轨道，狂奔的矿车像被无形大手托住般缓缓悬停。你优哉游哉挑走最纯的秘银矿与战利品。',
        critSuccessText:
          '你的磁悬浮法阵完美逆转了矿车动能，把整车原矿直接隔空提纯成闪耀金锭落进你的行囊，矮人工程师看了都要流泪！',
        failText:
          '熔炉高热干扰了魔力流向，矿车不仅没停反而被加速弹飞，擦过你的披风带起一股灼热气浪。',
        critFailText:
          '你的磁力符文极性画反了！不仅没拦住矿车，反而把你腰间的金属皮带扣吸得死死贴在扳道杆上挨了一顿铁皮摩擦。',
      },
      {
        id: 'ch4_cart_charm',
        label: '用矮人行话大喊紧急安全条例',
        detail: '唤醒矮人蒸汽中控的语音指令，看它认不认你的工头气势。',
        stat: 'charm',
        dc: 14,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.2,
        dropChance: 0.4,
        failHpPct: 0.13,
        critFailHpPct: 0.27,
        successText:
          '你捏着嗓子用粗犷的矮人方言暴喝“三号轨道立刻刹车否则扣光麦酒补贴”！蒸汽中控奇迹般响起确认铃声，全线稳稳刹停。',
        critSuccessText:
          '你的工头怒吼极具穿透力，不仅触发了全矿区紧急制动，中控室还贴心吐出一袋“本周安全生产模范奖金”！',
        failText:
          '语音中控冷冰冰回复“口音不纯，拒绝受理”，紧接着把你当违规闯入者喷了一脸高压蒸汽。',
        critFailText:
          '你喊错了一个矮人粗口词汇，直接把矿车切换成了“狂欢加速模式”，车头擦着你鞋尖呼啸而过把你掀翻进煤堆。',
      },
    ],
  },
  {
    id: 'ch4_lava_forge',
    chapter: 4,
    title: '狂化锻造者的地心铁砧',
    emoji: '⚒️',
    narrative:
      '熔岩瀑布照亮了穹顶巨厅，一座刻满火神铭文的玄铁巨砧正吞吐着橘红火舌。一名胡子燃着火星的狂化矮人锻造大师抡着百斤战锤，正对着一把半成品神兵疯狂敲打，每落下一锤就震落一片天花板碎石。铁砧旁的冷却池里泡着数件刚出炉的奇珍，只是大师显然把任何打扰他灵感的人都当成待锤的生铁。',
    choices: [
      {
        id: 'ch4_forge_might',
        label: '接过副锤陪他合奏一段打铁二重唱',
        detail: '没有什么比用绝对力量帮矮人把刀打成更赚好感度的事了。',
        stat: 'might',
        dc: 14,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.35,
        dropChance: 0.55,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你拎起旁边的重锤卡准节拍砸下，金铁交鸣声震彻熔炉！锻造者眼中的狂躁化为敬佩，爽快将池里的几件成品与金币推给你当工钱。',
        critSuccessText:
          '你一锤砸出传说中的星火共鸣，整块神铁瞬间淬炼成型！矮人大师激动得把胡子里的火星都哭灭了，硬塞给你一套顶级工坊珍藏！',
        failText:
          '你落锤慢了半拍，直接砸歪了大师最心爱的剑胚。暴怒的矮人当场把你的脑袋当成下一块生铁招呼过来。',
        critFailText:
          '重锤在玄铁砧上反弹，震得你虎口发麻脱手飞出，锤头精准砸翻了大师珍藏百年的烈酒桶。一场单方面的铁匠教学就此展开。',
      },
      {
        id: 'ch4_forge_charm',
        label: '掏出黑吊国金卡谈一笔军火大单',
        detail: '用甲方爸爸的钞能力瞬间治好疯铁匠的精神内耗。',
        stat: 'charm',
        dc: 13,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.2,
        dropChance: 0.5,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你淡定展示顶级信用额度，提出包圆他下一季度的全套铠甲订单。狂化矮人瞬间眉开眼笑，热情塞给你一批“样品装备”与回扣。',
        critSuccessText:
          '听说黑吊国金卡大佬要投资重建矮人酒厂兼军工厂，大师立刻恢复理智并把你奉为终身荣誉股东，把最好的货全塞进你背包！',
        failText:
          '矮人冷哼一声：“空口画饼的甲方我锤死过八个！”说完抡起炽热铁钳朝你夹了过来。',
        critFailText:
          '你顺口问了一句“能不能先打三折试用”，矮人大师血压飙升，直接用烧红的钳子追着你烫起了卷发。',
      },
      {
        id: 'ch4_forge_mage',
        label: '注入极寒奥术替神兵完美淬火',
        detail: '用精准温控法术取代粗糙的冷水池，让大师见识现代炼金科技。',
        stat: 'arcana',
        dc: 12,
        requiredClass: 'mage',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.4,
        dropChance: 0.55,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '冰蓝符文缠绕炙热剑胚，瞬间完成无裂纹完美淬火。锻造大师震撼失语，恭敬奉上工坊珍藏作为请教魔纹的学费。',
        critSuccessText:
          '你的冰火相济之术引动了熔炉圣火共鸣！剑胚竟自动浮现史诗光辉，大师跪求拜师并把整座冷却池的珍宝悉数赠予你！',
        failText:
          '冰火温差失控，冷却池炸出滚烫水汽把你掀翻在地，矮人大师痛心疾首地朝你扔来一串炽热煤块。',
        critFailText:
          '法术反噬把剑胚冻成了脆冰棍，大师轻轻一敲就碎成八瓣。他缓缓转过头，眼睛里烧起了比地心更旺的火。',
      },
      {
        id: 'ch4_forge_bribe',
        label: '直接付金币买下冷却池里的现货',
        detail: '铁匠最讲信用，钱给够了他连自己的围裙都肯卖。',
        coinCost: 1100,
        rewardCoinsMult: 0.9,
        rewardXpMult: 1.0,
        dropChance: 0.4,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '沉甸甸的金币砸在铁砧上，矮人大师哼了一声，用铁钳从池里捞出一件闪闪发亮的锻造精品丢进你怀里，继续埋头敲铁。',
        critSuccessText: '大师看你给钱痛快，顺手多赠送了一包矮人精炼火油与金币找零。',
        failText: '交易完成，你带着战利品离开了铁砧大厅。',
        critFailText: '交易完成，你带着战利品离开了铁砧大厅。',
      },
    ],
  },
  {
    id: 'ch4_golem_gate',
    chapter: 4,
    title: '黑铁傀儡守卫的蒸汽闸门',
    emoji: '⚙️',
    narrative:
      '通往熔炉核心的青铜巨门紧闭，门前并排站着两具三丈高的黑铁蒸汽傀儡。它们胸口的玻璃视窗里跳动着炽烈火元素核心，每隔三秒就从肩部烟囱喷出一股白汽。门柱上刻着古老矮人谜语铭牌，但左边的傀儡似乎因为齿轮生锈，正发出卡壳般的咔哒异响。',
    choices: [
      {
        id: 'ch4_gate_agility',
        label: '趁喷汽盲区拆掉左傀儡泄压阀',
        detail: '只要把那颗松动的铜螺丝拧下来，三丈铁人就会原地瘫痪。',
        stat: 'agility',
        dc: 14,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.48,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你贴着滚烫蒸汽滑至傀儡背后，匕首一撬拧飞泄压阀。伴随一声漏气长啸，黑铁傀儡轰然跪倒并撞开了青铜门锁！',
        critSuccessText:
          '你连拧三颗主阀螺栓，两具傀儡失控互撞成一堆废铁零件，滚落出两枚完美无瑕的火元素核心与满地金币！',
        failText:
          '滚烫的铜螺丝烫得你手指一缩，刚发出痛呼，傀儡铁拳就带着蒸汽啸叫砸向你的肩头。',
        critFailText:
          '你拧错阀门直接对准了自己脸部，高压白汽把你像保龄球一样吹飞出去十米远。',
      },
      {
        id: 'ch4_gate_might',
        label: '硬掰生锈齿轮强行顶开蒸汽闸门',
        detail: '蒸汽机讲究压强，而你讲究纯物理破防。',
        stat: 'might',
        dc: 14,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.4,
        dropChance: 0.45,
        failHpPct: 0.16,
        critFailHpPct: 0.31,
        successText:
          '你抓住傀儡挥来的铁臂借力一折，生锈齿轮发出崩裂哀鸣。大门在震动中缓缓升起，你趁机撬走了傀儡胸口的能量晶石。',
        critSuccessText:
          '你暴喝一声生生把左傀儡的铁臂扯了下来，拿它当撬棍直接把整扇青铜巨门连框掀翻！右傀儡默默给自己拉下了休眠电闸。',
        failText:
          '黑铁外壳滚烫沉重，你不仅没掰动齿轮，反而被回摆的蒸汽活塞撞得胸口发闷。',
        critFailText:
          '你的披风卷进了外露传动齿轮里，硬生生被拖着在半空转了两圈半才扯断布料摔下来。',
      },
      {
        id: 'ch4_gate_arcana',
        label: '向火元素核心灌入逆相冰霜魔力',
        detail: '热胀冷缩是矮人最讨厌的物理课，但对付锅炉傀儡屡试不爽。',
        stat: 'arcana',
        dc: 14,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '寒霜魔线穿透玻璃视窗，炽红锅炉瞬间急冷脆裂。两具傀儡咔嚓停机，青铜闸门随之自动解锁并弹出一箱维修基金。',
        critSuccessText:
          '完美的冰火相冲让锅炉凝结出稀有的黑曜晶核！闸门大开的同时，门内警报还把你误判成了首席维修长老，奉上全套补给！',
        failText:
          '火元素核心温度高得离谱，你的冰霜魔力瞬间蒸腾成滚烫白雾，反倒烫伤了你的手背。',
        critFailText:
          '温差引发局部小爆炸，一颗飞出的黄铜铆钉精准敲中你额头，鼓起一个完美的蒸汽大包。',
      },
      {
        id: 'ch4_gate_deadbeat',
        label: '掏出欠债封条假装法院查封熔炉',
        detail: '告诉守门傀儡这座工厂因欠薪已被黑吊国强制接管。',
        stat: 'charm',
        dc: 15,
        creditPerk: 'deadbeat_intimidate',
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.25,
        dropChance: 0.42,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你把盖满红章的催债传票贴在傀儡视窗上，声称再不开门就要拆了它们抵债。傀儡内置的矮人法务模块瞬间死机，乖乖升起闸门。',
        critSuccessText:
          '你熟练背诵《黑吊国破产清算条例》吓瘫了两具机械守卫！它们不仅立刻放行，还自动吐出了财务室保险箱里的压箱金币！',
        failText:
          '傀儡机械音轰鸣：“本厂已缴清三百年税务，判定为诈骗犯，启动粉碎程序！”',
        critFailText:
          '你掏封条时把一张高利贷催款单掉在地上，傀儡扫描完立刻把你标记成“高风险偷铁贼”，双双举起蒸汽重拳。',
      },
    ],
  },

  // =========================================================================
  // Chapter 5: 霜火龙巢 (🐉)
  // =========================================================================
  {
    id: 'ch5_frost_spire',
    chapter: 5,
    title: '寒冰龙裔盘踞的晶霜悬桥',
    emoji: '❄️',
    narrative:
      '千米绝壁之间架着一座由万年玄冰凝结的弧形悬桥，下方是翻涌着地心熔岩的深谷，冷热气流交汇出漫天冰晶雪雾。桥心处，三名身披龙鳞重甲的寒冰龙裔战士交叉战戟，冰蓝吐息在空中结成锋利霜刺。在他们身后的冰座上，封存着一枚被龙血浸润的古老护符。',
    choices: [
      {
        id: 'ch5_spire_ranger',
        label: '借上升热气流箭射头顶冰锥群',
        detail: '大自然才是最狠的弓箭手，让冰窟穹顶帮自己清场。',
        stat: 'agility',
        dc: 13,
        requiredClass: 'ranger',
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.4,
        dropChance: 0.52,
        failHpPct: 0.15,
        critFailHpPct: 0.29,
        successText:
          '三支连珠箭精准切裂悬桥上方的巨型冰棱，暴雨般的冰锥瞬间把龙裔小队砸得人仰马翻。你轻点冰面掠过桥心，顺手摘走龙血护符。',
        critSuccessText:
          '一箭引动整片冰穹雪崩，三名寒冰龙裔连同战戟一起被冻成精美冰雕！你在冰雕旁悠闲打卡，顺带搬空了他们的龙巢补给箱！',
        failText:
          '桥面狂风吹偏了箭道，冰棱擦着龙裔头盔坠入熔岩谷。龙裔战士冷笑举戟，一记霜浪斩逼得你险象环生。',
        critFailText:
          '你脚下冰面骤然打滑，射出的箭矢弹在冰柱上差点飞回自己脸上，龙裔战士趁机用戟柄把你扫了个跟头。',
      },
      {
        id: 'ch5_spire_arcana',
        label: '引导谷底熔岩热流融化龙裔冰甲',
        detail: '脚下就是天然火山口，用元素共振给这群冰疙瘩蒸个桑拿。',
        stat: 'arcana',
        dc: 15,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.4,
        dropChance: 0.5,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你吟唱火系引导咒文，炽热上升气柱卷起熔岩星火冲刷悬桥。龙裔冰甲瞬间咔咔裂解，他们狼狈退守，你顺利收走战利品。',
        critSuccessText:
          '冰火两股元素在你掌心完美失衡炸裂，漫天蒸汽化作璀璨彩虹！龙裔守卫以为古龙发怒直接跪地请罪，奉上龙血珍宝！',
        failText:
          '谷底热流比预想狂暴得多，你险些连自己站立的冰桥一并融穿，被烫得手忙脚乱还挨了一记冰霜标枪。',
        critFailText:
          '热流卷起一团飞溅岩浆正好掉进你的领口，你在冰桥上跳起了热烈迪斯科，连寒冰龙裔都看傻了眼。',
      },
      {
        id: 'ch5_spire_might',
        label: '战吼踏碎桥面逼龙裔正面拼刀',
        detail: '在百米冰桥上拼硬实力，谁先退半步谁就掉进岩浆泡澡。',
        stat: 'might',
        dc: 15,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.45,
        dropChance: 0.48,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你重踏冰桥震起裂纹，顶着霜气硬架开三柄战戟，反手一记横扫将领头龙裔轰下冰座。余众见势不妙撤回内巢，你傲然收割战利品。',
        critSuccessText:
          '你的蛮力让龙裔引以为傲的鳞甲像蛋壳般碎裂！三名精锐被一击震飞进雪堆，冰座上的古老护符竟主动飞入你掌心！',
        failText:
          '龙裔的寒霜战戟沉重而滑溜，你的武器在冰面失力，被对方反手霜拳震得气血翻涌。',
        critFailText:
          '你全力跺脚想震慑敌人，结果真把脚下那块冰踩塌了！你在桥边吊了半天臂力才狼狈爬上来。',
      },
      {
        id: 'ch5_spire_paladin',
        label: '以辉光神誓宣告古龙的堕落审判',
        detail: '用圣骑士无畏神威瓦解龙裔的荣耀信念。',
        stat: 'charm',
        dc: 13,
        requiredClass: 'paladin',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.4,
        dropChance: 0.5,
        healPctOnSuccess: 0.16,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '耀眼辉光驱散了悬桥刺骨寒雾，你凛然宣告正义裁决。崇尚荣誉的龙裔守卫心神剧震，纷纷垂戟致敬并让开圣道，圣光也疗愈了你的伤势。',
        critSuccessText:
          '你的誓言化作金色羽翼在冰桥上空舒展！领头龙裔感念古老骑士道，主动脱下精良龙鳞珍宝赠予你，并祝你终结古龙的疯狂！',
        failText:
          '狂热龙裔嗤笑圣光不过是伪神的把戏，齐声发出寒冰龙吼，凛冽霜风刺痛了你的肺腑。',
        critFailText:
          '冷风灌进嘴里让你在念诵誓词时猛打了个响亮喷嚏，庄严气氛瞬间清零，龙裔们毫不留情地挥戟冲来。',
      },
    ],
  },
  {
    id: 'ch5_wyvern_hoard',
    chapter: 5,
    title: '炽炎飞龙打盹的金币山谷',
    emoji: '💰',
    narrative:
      '岩浆照耀的洞窟大厅堆着一座闪瞎双眼的小金山——金币、王冠、镶嵌宝石的圣杯层层叠叠。一头翼展二十尺的炽炎飞龙正四仰八叉地趴在金堆顶上打鼾，每呼出一口气，鼻孔就喷出两团蓝紫火苗。在它尾巴卷着的位置，隐约露出一个泛着史诗光晕的古代秘匣。',
    choices: [
      {
        id: 'ch5_hoard_agility',
        label: '屏息摸走秘匣顺带薅一把金币',
        detail: '在恶龙打鼾的间隙玩一场史上最刺激的抽积木游戏。',
        stat: 'agility',
        dc: 15,
        rewardCoinsMult: 1.75,
        rewardXpMult: 1.35,
        dropChance: 0.6,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你踩着最软的丝绒毯悄然靠近，趁飞龙翻身打鼾的瞬间精准抽走秘匣与两大把宝石金币，悄无声息退入洞影。',
        critSuccessText:
          '你的手法堪比神偷降世！你不仅搬空了秘匣和顶级金币，还顺手塞了块鹅卵石在它尾巴下充数，飞龙甚至满意地吧唧了两下嘴！',
        failText:
          '一枚金币不小心滚落发出清脆叮当声！飞龙猛然睁开竖瞳，一口滚烫龙息擦着你后背轰穿了岩壁。',
        critFailText:
          '你贪心多抓了一把宝石引发金币山小规模滑坡，自己直接滑进飞龙怀里和它来了个深情对视。结果当然是热情的火焰洗礼。',
      },
      {
        id: 'ch5_hoard_charm',
        label: '掏出黑吊国财报跟飞龙聊金币理财',
        detail: '告诉它死囤黄金跑不赢通胀，黑吊国高息金库了解一下？',
        stat: 'charm',
        dc: 15,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.65,
        rewardXpMult: 1.3,
        dropChance: 0.55,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你轻咳唤醒飞龙，用金卡贵宾身份向它科普复利奇迹。爱财如命的飞龙听得频频点头，爽快把秘匣与一笔金币托付给你“代为投资”！',
        critSuccessText:
          '你的金融话术彻底征服了这头大蜥蜴！它热泪盈眶感慨自己白白趴了三百年死钱，当场塞给你双倍佣金加压箱珍宝求带飞！',
        failText:
          '飞龙听完冷笑喷出一团黑烟：“上个跟我聊理财的吟游诗人，现在骨头还在那边堆着呢。”',
        critFailText:
          '你脱口而出“不如借点高利贷加杠杆”，踩中了巨龙最痛恨的雷区，它气得把尾巴当苍蝇拍抽了你一下。',
      },
      {
        id: 'ch5_hoard_arcana',
        label: '用催眠星尘让飞龙沉入美梦',
        detail: '给喷火大蜥蜴讲个奥术睡前故事，梦里全是会下金蛋的绵羊。',
        stat: 'arcana',
        dc: 15,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.4,
        dropChance: 0.52,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '紫色星尘缓缓落入龙鼻，飞龙发出满足的呼噜声彻底睡死过去。你如逛自家仓库般收走了古代秘匣和闪亮战利品。',
        critSuccessText:
          '催眠咒文不仅让飞龙睡得像婴儿一样香甜，它说梦话时还主动松开龙爪把最珍贵的秘宝推到了你面前！',
        failText:
          '龙类天生的魔法抗性弹开了星尘，飞龙被呛得连打三个喷火喷嚏，差点把你烤成焦糖布丁。',
        critFailText:
          '催眠粉不小心逆风飘回你自己鼻子里，你打着哈欠一脚踩在龙尾巴尖上，场面一度十分尴尬且炙热。',
      },
      {
        id: 'ch5_hoard_might',
        label: '一记重击敲晕飞龙强行收税',
        detail: '什么潜行什么话术，真正的屠龙勇士都是正面叫它起床。',
        stat: 'might',
        dc: 16,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.5,
        dropChance: 0.55,
        failHpPct: 0.18,
        critFailHpPct: 0.34,
        successText:
          '你高跃而起，趁飞龙半梦半醒一记重锤狠砸龙吻！晕头转向的飞龙悲鸣着撞破洞顶逃走，整座金山秘匣全归你所有。',
        critSuccessText:
          '这一击宛如天降陨石，飞龙连眼睛都没睁全就被震晕在金币堆里！你潇洒踩在龙头上挑走了最耀眼的秘宝与海量金币！',
        failText:
          '龙鳞坚硬如铁砧，你的偷袭反而替它挠了痒痒。起床气爆棚的飞龙一爪把你拍进岩壁里。',
        critFailText:
          '你起跳太猛一脚踩滑，武器飞出去砸在墙上，自己正好一屁股坐在飞龙喷火的鼻孔正上方。',
      },
    ],
  },
  {
    id: 'ch5_dragon_altar',
    chapter: 5,
    title: '古龙祭司的冰火裂隙祭坛',
    emoji: '🌋',
    narrative:
      '龙巢深处的黑曜石祭坛被一分为二：左侧凝结着永冬冰晶，右侧翻涌着赤红熔浆。一名身披双色鳞袍的古龙祭司高举龙骨法杖，正吟唱着唤醒古龙怒火的献祭仪轨。半空中悬浮着一颗剧烈脉动的霜火龙珠，一旦仪轨完成，整座巢穴的守卫都会获得狂暴加持。',
    choices: [
      {
        id: 'ch5_altar_mage',
        label: '以奥术虹吸强行截胡霜火龙珠',
        detail: '这么好的元素核心给龙祭司太浪费了，不如归你吸收！',
        stat: 'arcana',
        dc: 14,
        requiredClass: 'mage',
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.5,
        dropChance: 0.55,
        healPctOnSuccess: 0.15,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你双手撕开祭坛魔力回路，将霜火龙珠的狂暴魔流硬生生导入自己掌控。祭司吐血倒地，澎湃龙力反而温润修复了你的体魄！',
        critSuccessText:
          '你的奥术造诣令古老仪轨倒戈相向！霜火龙珠轰然绽放双色极光，不仅瞬间蒸发了祭司，还为你凝炼出罕见珍宝与丰厚赏金！',
        failText:
          '冰火双系魔力在接触瞬间发生剧烈排斥，狂暴电弧把你弹飞出去，五脏六腑像被冰火轮番洗礼。',
        critFailText:
          '你一不小心把冰火能量同时导进了自己袖子里，左手结冰右手冒烟，古龙祭司看得甚至忘记念咒忍不住笑出声。',
      },
      {
        id: 'ch5_altar_might',
        label: '冲上祭坛一斧劈碎龙骨法杖',
        detail: '法爷最怕贴脸莽夫，打断施法只需一记简单直拳。',
        stat: 'might',
        dc: 15,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.45,
        dropChance: 0.5,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你顶着灼热气浪悍然突进，势大力沉的一击将龙骨法杖拦腰斩断！失去引导的祭坛瞬间崩塌，祭司连同珍宝一并成了你的战利品。',
        critSuccessText:
          '你的气势压得祭坛烈焰倒卷！一击不仅粉碎了法杖，还顺手接住了坠落的霜火龙珠与整匣古龙贡品！',
        failText:
          '祭坛边缘的冰霜符文突然暴起，把你冻得脚步一滞，祭司趁机赏了你一发滚烫火球。',
        critFailText:
          '你冲得太猛，脚下一滑直接从冰侧滑到了熔岩侧，幸亏反应快扒住石沿才没变成烤全英雄。',
      },
      {
        id: 'ch5_altar_agility',
        label: '掷出暗器切断祭坛两侧导流石柱',
        detail: '破坏对称结构，让失衡的冰火能量自己炸飞祭司。',
        stat: 'agility',
        dc: 15,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.4,
        dropChance: 0.5,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '双刃破空而出，精准削断导流石柱上的秘银锁链。祭坛失衡爆发出璀璨冲击波，把祭司掀翻出局，你稳稳收入战利品。',
        critSuccessText:
          '完美精准的双重破坏让祭坛发生定点内爆，祭司像礼花一样升空，而所有昂贵的祭坛供品竟然分毫不差落进你脚边！',
        failText:
          '只打断了冰侧石柱，失衡的火焰能量反而朝你的藏身之处呼啸席卷而来。',
        critFailText:
          '你的暗器被旋转的龙珠弹飞，擦着自己头皮钉进了身后的石壁，直接暴露了藏身位置。',
      },
      {
        id: 'ch5_altar_bribe',
        label: '抛出一大袋高纯金币破坏献祭纯度',
        detail: '世俗的铜臭味最能污染神圣仪轨，顺便把贪婪祭司砸晕。',
        coinCost: 1450,
        rewardCoinsMult: 0.95,
        rewardXpMult: 1.05,
        dropChance: 0.4,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '满袋世俗金币哗啦砸进祭坛中心，神圣仪式瞬间被铜臭味搅得烟消云散。古龙祭司气急败坏地去捡币，你趁机抱走祭坛上的珍宝扬长而去。',
        critSuccessText: '沉甸甸的金币直接把祭坛符文砸短路了，祭司忙着清点金币完全顾不上管你。',
        failText: '仪轨被打断，你趁乱拿走了战利品。',
        critFailText: '仪轨被打断，你趁乱拿走了战利品。',
      },
    ],
  },

  // =========================================================================
  // Chapter 6: 深渊王座 (🌌)
  // =========================================================================
  {
    id: 'ch6_void_library',
    chapter: 6,
    title: '低语不止的虚空禁书回廊',
    emoji: '📜',
    narrative:
      '星云与暗紫裂隙在无尽书架间缓缓流淌，数千卷长着眼睛的羊皮禁书正扑棱着书页在半空盘旋。低沉的深渊耳语直接钻进你的脑海，试图用“全知全能的真理”引诱你献出理智。回廊尽头的悬浮讲台上，一本锁着星辰扣环的《原初黑典》正散发着足以扭曲现实的璀璨魔光。',
    choices: [
      {
        id: 'ch6_lib_mage',
        label: '以绝对理性解析《原初黑典》真名',
        detail: '疯子才会被禁书支配，真正的奥术大师只把它当参考书抄笔记。',
        stat: 'arcana',
        dc: 15,
        requiredClass: 'mage',
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.55,
        dropChance: 0.58,
        failHpPct: 0.16,
        critFailHpPct: 0.33,
        successText:
          '你心如止水，在三息内拆解了书页上扭曲的非欧几何符文。黑典发出臣服的微鸣，自动为你吐出封存其中的星辰财宝与奥术领悟。',
        critSuccessText:
          '你不仅读懂了《原初黑典》，还用红笔顺手批改了上面三处语法错别字！虚空禁书羞愧得合上书页，把压箱底的神话珍宝双手奉上！',
        failText:
          '书页上的眼球突然齐刷刷眨动，一股混杂着星海嘶吼的精神冲击轰进你脑海，让你头痛欲裂。',
        critFailText:
          '你多看了一眼插图，脑海里瞬间响起一万只鸭子用古神语念经，晕头转向撞塌了三排虚空书架。',
      },
      {
        id: 'ch6_lib_charm',
        label: '用黑吊国精神状态反过来污染深渊',
        detail: '比疯狂？你连高利贷和群友抽象聊天记录都顶得住！',
        stat: 'charm',
        dc: 16,
        creditPerk: 'deadbeat_intimidate',
        rewardCoinsMult: 1.65,
        rewardXpMult: 1.45,
        dropChance: 0.55,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你张口就是一套黑吊国午夜发癫语录，反向冲刷了虚空低语！长眼睛的禁书们纷纷惊恐闭眼捂耳，讲台上的珍宝全成了封口费。',
        critSuccessText:
          '你的精神抽象程度远远超越了古神理解范围！《原初黑典》读完你的大脑后当场自闭合拢，主动吐出海量珍宝求你别再思考了！',
        failText:
          '深渊低语竟迅速学会了你的口癖并加倍奉还，你的理智槽发出了刺耳警报。',
        critFailText:
          '你想跟古神对骂，结果不小心被带进节奏，对着空气深情朗诵了半分钟废话，顺带挨了飞书一阵乱拍。',
      },
      {
        id: 'ch6_lib_agility',
        label: '借悬浮书架闪转腾挪硬抢星辰秘宝',
        detail: '只要眼睛不看书页上的文字，就绝对不会掉理智！',
        stat: 'agility',
        dc: 16,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.45,
        dropChance: 0.55,
        failHpPct: 0.15,
        critFailHpPct: 0.31,
        successText:
          '你闭上半只眼全凭直觉踏过漂浮书架，在群书合围前一把扯下讲台上的星辰秘匣，如利箭般冲出回廊。',
        critSuccessText:
          '你的身法快到连虚空触须都抓不住残影！你在半空翻滚三周半，不仅拿走秘匣，还顺手甩出披风套走了两袋悬浮星尘金币！',
        failText:
          '一本长满尖牙的厚精装书从盲区扑来，狠狠啃了你护腕一口，震得你差点踩空跌入虚空。',
        critFailText:
          '你低头躲避飞书却一头撞进一本摊开的传送书里，被随机吐回起点狠狠摔了个狗吃屎。',
      },
      {
        id: 'ch6_lib_might',
        label: '合上重典顺手把整座讲台砸成星尘',
        detail: '看不懂的邪书一律按违禁品物理销毁，省心省力。',
        stat: 'might',
        dc: 16,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.5,
        dropChance: 0.5,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '你抡起武器狠狠劈碎星辰讲台，诡异低语戛然而止！漫天破碎的羊皮纸中跌落出闪闪发亮的虚空晶币与珍贵装备。',
        critSuccessText:
          '纯粹的暴力让不可名状的深渊感到了质朴的震撼！整条回廊的禁书吓得乖乖排成书梯送你登顶，并献上珍藏已久的秘宝！',
        failText:
          '讲台爆发出一圈紫黑冲击波，震得你虎口崩裂，四周飞舞的禁书趁机对你发动了纸片千刃风暴。',
        critFailText:
          '你这一击只把黑典震开，它张开大嘴一口吞掉了你的气势并喷出一股让人头晕目眩的陈年墨水雾。',
      },
    ],
  },
  {
    id: 'ch6_fallen_paladins',
    chapter: 6,
    title: '堕落圣堂武士的审判长阶',
    emoji: '🖤',
    narrative:
      '漆黑如墨的星辉长阶直通王座前庭，两侧燃烧着永不熄灭的苍白冷火。四名曾守护光明、如今被深渊侵蚀的堕落圣堂武士双手拄着黑曜巨剑，头盔缝隙中流淌出暗紫烟雾。为首者抬起巨剑指向你的咽喉，嘶哑宣判：“凡踏入终焉阶梯者，必先经受破碎誓言的拷问！”',
    choices: [
      {
        id: 'ch6_pal_paladin',
        label: '以纯粹辉光唤醒他们残存的骑士荣光',
        detail: '同为圣殿之人，用未曾动摇的信念为堕落前辈送行。',
        stat: 'charm',
        dc: 14,
        requiredClass: 'paladin',
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.55,
        dropChance: 0.6,
        healPctOnSuccess: 0.2,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你高举圣徽步步登阶，炽热圣光刺穿他们铠甲里的暗紫腐雾。四名武士缓缓单膝跪地，在安宁的叹息中化作光尘，留下了他们生前的神圣遗珍与疗愈辉光。',
        critSuccessText:
          '纯粹无瑕的圣光如黎明降临深渊！堕落武士眼中的虚空彻底退散，他们列队为你行最高骑士礼，不仅修复了你的全部疲惫，还献上了圣殿传世秘宝！',
        failText:
          '深渊执念比预想更深沉，领头武士冷笑一声“光明早已死去”，黑曜巨剑挟着暗浪劈面斩落。',
        critFailText:
          '圣光与深渊暗焰激烈对冲，震碎了你脚下的石阶，你踉跄后退时结结实实挨了一记沉重剑脊拍击。',
      },
      {
        id: 'ch6_pal_warrior',
        label: '正面迎击四柄黑曜巨剑硬撼剑阵',
        detail: '既然他们怀念战场，那就给他们一场最痛快的钢铁对决！',
        stat: 'might',
        dc: 14,
        requiredClass: 'warrior',
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.55,
        dropChance: 0.58,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '金铁轰鸣震荡星阶，你凭一己之力硬生生砸开黑曜剑阵！四名堕落武士在敬佩的轰鸣声中溃散，留下一地闪耀的骑士战利品。',
        critSuccessText:
          '你的战意化作无匹剑罡，一记重斩同时崩飞四柄黑曜巨剑！领头武士盔甲轰然炸裂，临消散前竖起大拇指把自己的绝世宝匣赠予了你！',
        failText:
          '四名老练剑士的合击密不透风，你虽逼退两人，却仍被暗影剑气划开了胸甲。',
        critFailText:
          '你在石阶上发力过猛踩碎台阶，整个人顺着长阶连滚三圈，还好皮够厚才没被四把巨剑串成烤肉。',
      },
      {
        id: 'ch6_pal_agility',
        label: '借冷火阴影逐个绕后斩断暗影契约',
        detail: '重甲骑士的转身死角，正是暗影猎手最爱的舞台。',
        stat: 'agility',
        dc: 16,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.5,
        dropChance: 0.55,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你化作四道飘忽残影掠过长阶，匕首精准挑断每具铠甲颈后的深渊锁链。黑甲依次轰然散架，战利品尽入囊中。',
        critSuccessText:
          '你的速度令堕落武士连抬剑的机会都没有！四道寒光闪过，整支仪仗队同步倒地化烟，留下满满一袋星辉赏金与稀有装备！',
        failText:
          '一名武士反手横扫封住了退路，凌厉剑风扫过你的肋下，逼得你翻滚避开致命一击。',
        critFailText:
          '你绕到一半踩中一滩冷火余烬，鞋底冒烟的瞬间发出怪叫，四把巨剑同时朝声音方向劈了下来。',
      },
      {
        id: 'ch6_pal_charm_gold',
        label: '出示最高信誉金卡宣称免检觐见',
        detail: '连堕落贵族都认顶级贵宾徽记，试试刷脸走VIP通道！',
        stat: 'charm',
        dc: 16,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.35,
        dropChance: 0.5,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你从容举起金光流转的最高信誉卡，冷声责问守卫竟敢阻拦特邀贵宾。刻在骑士骨子里的宫廷礼仪瞬间生效，他们收剑让路并呈上通关供奉。',
        critSuccessText:
          '金卡的尊贵光辉竟短暂压过了深渊冷火！四名堕落武士立刻切换为五星级礼宾模式，列队护送你登阶并献上王庭迎宾大礼！',
        failText:
          '领头武士看了一眼冷哼：“深渊王座只认血祭，不认黑吊国信用卡！”话音未落便挥剑劈来。',
        critFailText:
          '你甩卡时力道太大，金卡“啪”地拍在武士头盔缝里卡住了！暴怒的武士举着剑追着你满楼梯讨说法。',
      },
    ],
  },
  {
    id: 'ch6_chaos_rift',
    chapter: 6,
    title: '吞噬星光的混沌裂隙之眼',
    emoji: '🌀',
    narrative:
      '王座前最后一道天堑是撕裂虚空的巨大混沌旋涡，无数破碎星辰与失落宝船的残骸在引力环中旋转。一只由纯粹虚空凝成的观测者之眼在旋涡中央缓缓睁开，向四周喷射着扭曲时空的重力射线。唯有穿过这片引力风暴，你才能直面深渊之主，顺带捞一把漂浮在旋涡边缘的无主神藏。',
    choices: [
      {
        id: 'ch6_rift_ranger',
        label: '精准狙击观测者之眼的虚空瞳孔',
        detail: '再大的眼睛也怕吃沙子，一箭穿瞳就能让引力风暴停摆三秒。',
        stat: 'agility',
        dc: 14,
        requiredClass: 'ranger',
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.55,
        dropChance: 0.6,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你算准引力弧度松开弓弦，箭矢划出优雅曲线正中巨眼瞳心！观测者痛嚎闭目，旋涡骤然平息，你顺手捞走漂浮的星界宝箱。',
        critSuccessText:
          '箭矢借引力加速化作流光，直接贯穿虚空之眼并钉穿了后面隐藏的星盗宝库！无数珍宝如流星雨般朝你飞来！',
        failText:
          '引力场骤然偏转了箭道，激怒的观测者瞬间锁定你的位置，一道暗紫重力光束擦肩轰过。',
        critFailText:
          '箭矢在引力环里绕了一整圈，险些扎在自己后脑勺上，你狼狈趴倒时被旋转的木桶残骸砸了个正着。',
      },
      {
        id: 'ch6_rift_arcana',
        label: '逆转星界引力法阵借风暴滑行',
        detail: '与其对抗引力，不如把混沌旋涡改造成自己的高速传送带。',
        stat: 'arcana',
        dc: 16,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.55,
        dropChance: 0.58,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你织出星界相位护盾，优雅乘着引力环流滑过旋涡边缘，顺手将数件漂浮的失落神器与星币收入囊中。',
        critSuccessText:
          '你瞬间洞悉了混沌旋涡的时空韵律，不仅毫发无损横渡天堑，还顺带从时空缝隙里打捞出失传已久的顶级战利品！',
        failText:
          '一阵突发空间乱流撕开了护盾一角，失重感让你撞上漂浮碎岩，全身上下被震得生疼。',
        critFailText:
          '你的相位护盾反向激活，瞬间把你变成了微型磁铁——三块废铁和一只虚空水母热情地糊在了你脸上。',
      },
      {
        id: 'ch6_rift_might',
        label: '踏碎漂浮陨石硬闯重力射线风暴',
        detail: '什么时空扭曲，只要起跳力量大过逃逸速度就能一路莽过去！',
        stat: 'might',
        dc: 16,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.55,
        dropChance: 0.52,
        failHpPct: 0.18,
        critFailHpPct: 0.35,
        successText:
          '你在漂浮巨石间连番蹬踏，硬扛着十倍重力一拳轰散迎面而来的虚空射线！震撼的冲击波震落大量星骸秘宝。',
        critSuccessText:
          '你像一颗逆流而上的金色流星直穿旋涡中心，顺手一巴掌把观测者之眼拍进了异次元，连深渊穹顶都为之震颤！',
        failText:
          '十倍重力在半空骤然加压，你像铅球般重重砸在浮石上，震得气血翻腾。',
        critFailText:
          '你一脚把落脚陨石蹬成了两半，自己在无重力旋涡里像滚筒洗衣机一样转了十几圈才被甩到对岸。',
      },
      {
        id: 'ch6_rift_bribe',
        label: '向虚空投喂金币买通星界引力过路费',
        detail: '连混沌裂隙也喜欢吞噬亮晶晶的高纯金属，丢钱换平安！',
        coinCost: 1800,
        rewardCoinsMult: 1.0,
        rewardXpMult: 1.1,
        dropChance: 0.45,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '耀眼金币化作金色星环被观测者之眼一口吞下，旋涡竟满意地为你裂开一条风平浪静的星辉通道，顺带吐出一件它消化不良的精良装备！',
        critSuccessText: '巨眼被这份慷慨供奉逗乐了，直接将你温柔送到王座门前并吐出额外珍藏。',
        failText: '裂隙放行，你安然抵达了对岸。',
        critFailText: '裂隙放行，你安然抵达了对岸。',
      },
    ],
  },
];

const SHARED_SCENES: readonly TabletopSceneDef[] = [
  // 1. 酒馆豪赌
  {
    id: 'sh_tavern_gamble',
    chapter: 'shared',
    title: '血月酒馆的幽灵骰桌',
    emoji: '🎲',
    narrative:
      '旅途拐角竟突兀出现一间挂着破烂木牌的“血月驿站酒馆”，壁炉里跳动着不散发温度的蓝火。角落橡木桌旁坐着三名兜帽遮脸的幽灵赌客，桌心堆满泛着冷光的金币与秘匣。庄家咔哒摇动白骨骰盅，沙哑邀请：“过路的活人，敢不敢押上一点运气，赢走整桌死人财？”',
    choices: [
      {
        id: 'sh_gamble_agility',
        label: '袖口出千偷换加重灌铅骰子',
        detail: '跟鬼魂讲赌品？比比谁的手法更像老千界传说。',
        stat: 'agility',
        dc: 12,
        rewardCoinsMult: 1.75,
        rewardXpMult: 1.15,
        dropChance: 0.45,
        failHpPct: 0.13,
        critFailHpPct: 0.27,
        successText:
          '你趁庄家掀盖的刹那指尖微弹，三颗白骨骰奇迹般齐刷刷停在豹子六！幽灵赌客们哀嚎着愿赌服输，将整堆金币与压桌珍宝推到你面前。',
        critSuccessText:
          '你的千术优雅到连死神都没看清破绽！你不仅一把清空全桌筹码，庄家还敬佩地把传家白骨骰匣奉为战利品送给了你！',
        failText:
          '骰子刚出手就撞在桌面发出诡异闷响，庄家冰冷的鬼爪一把按住你的手腕，寒毒瞬间渗入经脉。',
        critFailText:
          '灌铅骰子太重直接砸穿了破橡木桌，当场人赃并获！三名幽灵赌客掏出酒瓶给你上了一堂生动的“赌场防老千实践课”。',
      },
      {
        id: 'sh_gamble_charm',
        label: '凭黑吊国赌神气场心理诈唬',
        detail: '哪怕手里是最小点，也要演出全压梭哈十亿的王者淡定。',
        stat: 'charm',
        dc: 12,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.65,
        rewardXpMult: 1.2,
        dropChance: 0.4,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你连骰盅都懒得看一眼，云淡风轻推出贵族徽记直接全押！对面幽灵被你深不可测的眼神吓破了胆，纷纷弃牌认输，满桌筹码尽归你手。',
        critSuccessText:
          '你浑身散发着“赢了买下酒馆、输了零花钱”的豪横气息！幽灵庄家直接吓得鞠躬道歉，把整晚抽水连本带利打包孝敬给了你！',
        failText:
          '你嘴角微微抽动泄露了一丝心虚，幽灵庄家冷笑着掀开骰盅——清一色大豹子，顺手抽走了你一缕生机当赌注。',
        critFailText:
          '你拍桌大喊“跟不起就滚”，结果拍断了朽木桌腿，整桌骰子全滚进你衣领，冰冷鬼火烧得你跳脚大叫。',
      },
      {
        id: 'sh_gamble_arcana',
        label: '暗施念力微调骰盅内点数',
        detail: '只要奥术波动够细微，物理规律也能为你打工。',
        stat: 'arcana',
        dc: 13,
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.25,
        dropChance: 0.45,
        failHpPct: 0.13,
        critFailHpPct: 0.27,
        successText:
          '一缕微不可察的奥术丝线钻入骰盅，将点数稳稳拨成大顺。庄家瞪着空洞眼眶叹气认栽，把整桌战利品双手奉上。',
        critSuccessText:
          '你精准操控念力让三颗白骨骰在开盅时叠罗汉立成一柱！幽灵们以为遇见了赌圣转世，跪地奉上全部宝藏！',
        failText:
          '酒馆本身布有反魔法结界，你的咒文刚触碰骰盅就弹出一道幽蓝电弧，把你手指电得焦黑。',
        critFailText:
          '念力失控把白骨骰直接捏成了骨粉，幽灵庄家痛心疾首控诉你毁坏公物，并叫来鬼魂保安把你按着教育了一顿。',
      },
      {
        id: 'sh_gamble_might',
        label: '一巴掌拍碎骰桌直接物理清场',
        detail: '赌博太看脸，直接把庄家和桌子一起掀了才叫稳赚。',
        stat: 'might',
        dc: 13,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.35,
        dropChance: 0.42,
        failHpPct: 0.15,
        critFailHpPct: 0.29,
        successText:
          '你暴喝一声掀翻橡木赌桌，凛冽拳风直接吹散三名幽灵赌客的形体！你在满地碎木里从容捡走所有金币与战利品。',
        critSuccessText:
          '这一掌蕴含雷霆阳刚之气，整座幽灵酒馆瞬间像海市蜃楼般消散，原地只留下一座闪闪发光的无主大宝箱！',
        failText:
          '你的重拳直接穿过了幽灵庄家的虚影，自己收势不住撞进壁炉，被幽蓝冷火冻得直打哆嗦。',
        critFailText:
          '桌板纹丝不动，幽灵赌客们被你野蛮行为激怒，齐刷刷抡起幽灵凳子朝你上演了一出酒馆大乱斗。',
      },
    ],
  },

  // 2. 贪婪地精税务官
  {
    id: 'sh_goblin_tax',
    chapter: 'shared',
    title: '拦路查账的地精税务官',
    emoji: '🧾',
    narrative:
      '一名戴着厚重单片眼镜、身背半人高铁算盘的肥胖地精突然从石碑后钻出，拦在道路正中。它一边飞快拨弄算珠，一边宣读长达三尺的《跨界冒险临时过境增值税清单》：“呼吸魔力空气费、踩坏青苔磨损费、惊吓路边怪物精神损失费——合计立刻缴纳！”',
    choices: [
      {
        id: 'sh_tax_gold',
        label: '甩出黑吊国金卡要求免税走账',
        detail: '高信用贵族享有跨界外交豁免权，顺便反查它的营业执照！',
        stat: 'charm',
        dc: 11,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.15,
        dropChance: 0.4,
        failHpPct: 0.11,
        critFailHpPct: 0.23,
        successText:
          '地精税务官透过单片镜看清你的闪耀金卡，瞬间吓得算盘脱手！它连连鞠躬道歉，不仅全额免税，还自掏腰包奉上“贵宾退税红包”。',
        critSuccessText:
          '你的贵族信誉光环把地精吓出了审计PTSD！它颤抖着交出全套违章小金库求你高抬贵手别上报黑吊国税务总局！',
        failText:
          '地精眯起绿眼冷笑：“你的信用分还不够免税门槛呢！”话音未落便吹响警哨，召来一群挥舞秤砣的讨税打手。',
        critFailText:
          '你装腔作势甩卡片结果把卡片甩进了路边臭水沟，地精趁你弯腰捡卡时用沉重铁算盘照你后背狠狠砸了一下。',
      },
      {
        id: 'sh_tax_deadbeat',
        label: '亮出黑吊国老赖身份让它滚蛋',
        detail: '银行催收队都从我兜里榨不出半枚铜板，你个地精也敢要税？',
        stat: 'charm',
        dc: 12,
        creditPerk: 'deadbeat_intimidate',
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.2,
        dropChance: 0.4,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你掏空口袋翻出几张高利贷催款单，满脸悲愤问它“要不先借我五千应急”？贪婪地精吓得脸色发白，丢下钱袋撒腿就跑！',
        critSuccessText:
          '你缠着地精要求它现场给你办一笔无抵押贷款！地精税务官彻底崩溃，宁可赔你一笔“精神抚慰金”只求你赶紧离开它的视线！',
        failText:
          '地精冷酷表示：“没钱没关系，我们可以现场拆你装备抵税！”紧接着挥动带刺铁尺朝你抽来。',
        critFailText:
          '地精听完你欠债的辉煌战绩不仅没怕，反而眼神放光要把你卖给黑市债主，你在推搡中挨了一记铁算盘爆头。',
      },
      {
        id: 'sh_tax_agility',
        label: '顺手把它的铁算盘和税袋一并顺走',
        detail: '既然是无证黑税官，那就替天行道没收它的非法所得！',
        stat: 'agility',
        dc: 12,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.25,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.24,
        successText:
          '你假装配合翻找钱包，骤然侧身抹过地精腰间！等它低头发现税袋空空如也时，你早已带着战利品走出十丈开外。',
        critSuccessText:
          '你的反扒手艺令地精叹为观止！不仅税袋易主，连它鼻梁上镶金边的单片眼镜都被你顺手摘下来折现了！',
        failText:
          '那只税袋里居然藏着地精捕鼠夹！“咔哒”一声夹得你倒吸一口凉气，狼狈甩手退开。',
        critFailText:
          '你伸手太急被地精一口咬住袖口死活不放，它一边尖叫“抢劫啦”一边用铁算盘把你敲得满头包。',
      },
      {
        id: 'sh_tax_bribe',
        label: '老实交一笔过路税换取正规发票',
        detail: '破财免灾，顺便看看这家伙能不能给点内部情报。',
        coinCost: 550,
        rewardCoinsMult: 0.9,
        rewardXpMult: 1.0,
        dropChance: 0.3,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '地精眉开眼笑收下金币，郑重盖上“黑吊国特许免检”印章，还顺手送你一份沿途隐藏宝箱的批注清单，勉强不算亏本。',
        critSuccessText: '地精见你纳税如此爽快，热情塞给你一张带赠品的VIP退税券。',
        failText: '缴税完毕，地精欢快地让开了去路。',
        critFailText: '缴税完毕，地精欢快地让开了去路。',
      },
    ],
  },

  // 3. 诅咒圣泉
  {
    id: 'sh_cursed_fountain',
    chapter: 'shared',
    title: '泛着紫光的古老圣泉',
    emoji: '⛲',
    narrative:
      '残破的大理石天使雕像早已断了半边翅膀，却仍从掌心源源不断涌出流光溢彩的紫银泉水。石池边缘刻着斑驳古语：“饮者或获神明眷顾，或受恶作剧之神戏弄。”清澈池底隐约沉着无数历代冒险者投下的许愿金币，以及几件散发微光的古老遗物。',
    choices: [
      {
        id: 'sh_fountain_paladin',
        label: '以辉光圣术净化泉水后畅饮',
        detail: '先消毒再喝水，圣骑士从不拿自己的肠胃赌运气。',
        stat: 'charm',
        dc: 10,
        requiredClass: 'paladin',
        rewardCoinsMult: 1.25,
        rewardXpMult: 1.25,
        dropChance: 0.4,
        healPctOnSuccess: 0.28,
        failHpPct: 0.1,
        critFailHpPct: 0.22,
        successText:
          '圣光注入泉池，诡异紫雾瞬间褪去，化作甘甜清冽的纯净圣泉！你痛饮数口，伤势迅速愈合，顺手捞起池底许愿金币。',
        critSuccessText:
          '天使雕像竟因你的纯粹辉光短暂苏醒！圣泉喷涌出璀璨金泉，不仅令你体魄全面焕新，还把深埋池底的珍稀遗物托举到你掌心！',
        failText:
          '诅咒顽固地弹开了你的圣光，泉水喷出一股呛人的紫烟熏得你咳嗽不止。',
        critFailText:
          '天使雕像突然打了个诡异水嗝，把整池发臭的淤泥精准浇了你一头一脸。',
      },
      {
        id: 'sh_fountain_arcana',
        label: '用奥术析出泉水中的毒素与精华',
        detail: '把诅咒和魔力分离，喝营养留毒素，炼金系常规操作。',
        stat: 'arcana',
        dc: 12,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.3,
        dropChance: 0.42,
        healPctOnSuccess: 0.24,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你指尖轻旋，紫色浊气被精准剥离消散，澄澈灵泉化作温润暖流涌入肺腑，你的疲惫一扫而空，还捞走了一把池底亮币。',
        critSuccessText:
          '完美的炼金提纯令泉水凝结成三滴罕见的“月神露”！不仅大幅疗愈伤势，池底秘宝也随着灵气波动浮出水面！',
        failText:
          '分离比例差了一丝，你喝下去半口带涩味的紫水，肚子立刻发出雷鸣般抗议，气血略微受损。',
        critFailText:
          '魔力搅拌过猛把圣泉搅成了强酸喷泉，飞溅水珠在你盔甲上烫出好几个冒烟小洞。',
      },
      {
        id: 'sh_fountain_might',
        label: '管它什么诅咒直接大口闷干顺便摸鱼',
        detail: '只要胃口比诅咒更铁，区区紫水不过是葡萄味功能饮料！',
        stat: 'might',
        dc: 13,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.3,
        dropChance: 0.45,
        healPctOnSuccess: 0.22,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你豪迈捧起紫泉一饮而尽！狂暴魔力在体内横冲直撞却被你强健体魄硬生生消化，伤势恢复大半，顺手还把池底金币洗劫一空。',
        critSuccessText:
          '你的铁胃直接把恶作剧诅咒消化成了纯正能量！你浑身冒出霸气紫光，连石像都被你的豪气震掉了一块暗藏宝石的翅膀！',
        failText:
          '这水喝起来像隔夜蒜汁兑铁锈，一股剧烈腹痛袭来，让你不得不扶着石栏干呕半天。',
        critFailText:
          '喝完这口你不仅拉肚子，还短暂长出了一对粉红兔耳朵，蹲在池边惨遭路过乌鸦无情嘲笑。',
      },
      {
        id: 'sh_fountain_agility',
        label: '只用匕首飞快捞走池底许愿币不喝水',
        detail: '免费的水最贵，不如直接把前人投进去的本金全捞回来！',
        stat: 'agility',
        dc: 11,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.1,
        dropChance: 0.4,
        failHpPct: 0.11,
        critFailHpPct: 0.24,
        successText:
          '你滴水不沾，用刀鞘和披风精准卷起池底一大把许愿金币与闪亮小物件，心安理得地帮前辈们“保管”了愿望。',
        critSuccessText:
          '你手脚麻利到连水花都没溅起两滴，不仅清空了许愿池底，还从雕像底座暗格摸出一件被遗忘的精致宝物！',
        failText:
          '水池里竟潜伏着一只吃许愿币长大的魔化食人鱼，一口啃在你的指节上鲜血直流。',
        critFailText:
          '你重心前倾太多，噗通一声整个人栽进紫水池喝了个水饱，不仅一分钱没捞到，还呛出了一口紫色泡泡。',
      },
    ],
  },

  // 4. 失恋魅魔委托
  {
    id: 'sh_heartbroken_succubus',
    chapter: 'shared',
    title: '买醉倾诉的失恋魅魔',
    emoji: '💋',
    narrative:
      '幽暗石阶旁，一名头生弯角、黑翼耷拉的魅魔正抱着半坛烈酒抽泣，妆容哭得像一只精致的烟熏熊猫。她一边用尾巴暴躁地敲打地面，一边控诉某个负心恶魔公爵骗光她的私房钱跑去和火元素私奔了。她红着眼圈望向你：“冒险者，帮我出个主意解解气，我把他的珍藏赏给你！”',
    choices: [
      {
        id: 'sh_succubus_charm',
        label: '化身情感导师传授黑吊国渣男防骗课',
        detail: '精准共情加上毒舌锐评渣男，让她醍醐灌顶重拾自信。',
        stat: 'charm',
        dc: 11,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.25,
        dropChance: 0.48,
        healPctOnSuccess: 0.16,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你一番“旧的不去新的不来、渣男就该挂黑吊国老赖榜”的深情开导让魅魔破涕为笑！她感激地送你一吻疗愈疲惫，并把公爵的私藏宝匣塞给了你。',
        critSuccessText:
          '你的情商高到让魅魔当场把你奉为地狱情感教父！她擦干眼泪雄赳赳气昂昂去烧前任老巢，临走把整箱珠宝与祝福之吻全留给了你！',
        failText:
          '你一不小心嘴笨说了一句“多喝热水”，魅魔的眼神瞬间冷过九层寒冰，一记炽热尾鞭抽得你眼冒金星。',
        critFailText:
          '你居然脱口而出“他是不是也挺不容易的”！暴怒的失恋魅魔直接把半坛烈酒扣在你头上，附赠一发地狱烈焰吻。',
      },
      {
        id: 'sh_succubus_arcana',
        label: '替她画一道“渣男脱发诅咒符”',
        detail: '没有什么比让负心恶魔公爵明天早上变成光头更解恨的报复了。',
        stat: 'arcana',
        dc: 12,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.3,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.26,
        successText:
          '你挥手绘出恶毒却精准的恶作剧咒印，透过残存气息隔空送去。魅魔通过水晶球看到前任瞬间秃顶后笑到打滚，大方奉上丰厚酬金！',
        critSuccessText:
          '你的诅咒不仅让恶魔公爵秒变反光卤蛋，还附带“放屁带彩虹烟花”特效！魅魔笑出眼泪，直接把压箱底的稀有战利品全送给了你！',
        failText:
          '咒文画岔了一笔，恶魔公爵没事，反而把魅魔自己的一缕长发烫成了爆炸头。结果可想而知……',
        critFailText:
          '反噬魔力直奔你自己头顶，虽保住了头发却被炸得浑身黑灰，魅魔一边道歉一边趁乱溜走了。',
      },
      {
        id: 'sh_succubus_might',
        label: '拍胸脯帮她砸烂渣男留下的纪念碑',
        detail: '情绪需要宣泄口，直接把前任送的那尊金像劈成两半最解压！',
        stat: 'might',
        dc: 12,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.3,
        dropChance: 0.42,
        failHpPct: 0.13,
        critFailHpPct: 0.27,
        successText:
          '你怒喝一声把渣男那尊浮夸金像劈成漫天金块，魅魔拍手叫好直呼解气！碎掉的金块连同她的赏赐全数归你。',
        critSuccessText:
          '你一套行云流水的连斩把金像雕成了一只滑稽大王八！魅魔笑得前仰后合，大方把所有碎金与珍稀宝物打包塞给你！',
        failText:
          '金像里居然藏着恶魔公爵设下的防盗火焰雷，轰然炸开把你熏成了一根焦炭。',
        critFailText:
          '你用力太猛武器弹飞，反倒劈坏了魅魔自己最心爱的限定版包包！她瞬间忘了前任，决定先把你揍成前任。',
      },
      {
        id: 'sh_succubus_deadbeat',
        label: '以专业老赖经验教她怎么把前任告破产',
        detail: '论转移资产与信用爆破，黑吊国失信人员全是顶级教授。',
        stat: 'charm',
        dc: 12,
        creditPerk: 'deadbeat_intimidate',
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.2,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你掏出小本本手把手教她怎么用恶魔公爵的名义刷爆十家高利贷！魅魔听得两眼放光，直接分你一半“启动资金”与珍藏。',
        critSuccessText:
          '你的缺德金融方案让深渊恶魔都直呼内行！魅魔当场把你聘为复仇总顾问，豪气奉上双倍重金与精良战利品！',
        failText:
          '魅魔听完皱眉怀疑：“你这套路这么熟，该不会也是个骗钱渣男吧？”二话不说赏了你一记暗影耳光。',
        critFailText:
          '你太投入不小心把自己的欠债黑历史全抖了出来，魅魔瞬间联想到前任，气急败坏把你当出气筒揍了一顿。',
      },
    ],
  },

  // 5. 黑市密道
  {
    id: 'sh_blackmarket_tunnel',
    chapter: 'shared',
    title: '雾巷尽头的黑市走私密道',
    emoji: '🗝️',
    narrative:
      '石壁裂缝后藏着一条灯火幽暗的走私密道，戴着乌鸦面具的黑市接头人正靠在木箱上擦拭匕首。地上摊着来路不明的走私军火、神秘暗匣与几张标着捷径的羊皮地图。接头人敲了敲铁门：“陌生面孔？要么对出黑市暗语，要么留下买路钱，或者比比谁的刀更快。”',
    choices: [
      {
        id: 'sh_bm_ranger',
        label: '亮出暗影游侠黑话与暗号手势',
        detail: '混江湖的都懂道上规矩，一套熟练手势直接免单拿内部价。',
        stat: 'agility',
        dc: 10,
        requiredClass: 'ranger',
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.3,
        dropChance: 0.55,
        failHpPct: 0.12,
        critFailHpPct: 0.24,
        successText:
          '你指尖翻飞比出三连暗影暗号，乌鸦面具人立刻肃然起敬，不仅敞开捷径铁门，还低价半卖半送了你一批走私好货。',
        critSuccessText:
          '你的暗语纯正到接头人以为你是黑市大老板微服私访！他毕恭毕敬献上季度分红与最顶级的走私珍藏，亲自替你清扫前路！',
        failText:
          '暗号最后一步比错了一根手指，接头人脸色骤变以为你是官府卧底，瞬间掷出三柄毒飞刀。',
        critFailText:
          '你比出的手势在当地黑话里居然是“我来抢劫顺便问候你全家”，整条密道的走私贩一拥而上热情款待了你。',
      },
      {
        id: 'sh_bm_agility',
        label: '熄灭油灯趁黑端掉整个走私摊',
        detail: '黑吃黑是西幻世界最古老的经济学，关灯就开抢！',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.3,
        dropChance: 0.52,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你弹指打灭油灯，在伸手不见五指的烟雾里连摸三只黑市暗匣，等接头人重新擦亮火石时，密道里只剩回荡的笑声。',
        critSuccessText:
          '你在黑暗中如鱼得水，不仅顺走所有值钱货，还顺手把接头人的鞋带系在了木箱上，听着身后噗通摔倒声潇洒离场！',
        failText:
          '乌鸦面具人居然戴着夜视魔晶镜！黑暗根本没挡住他，一记闷棍准确敲中了你的后肩。',
        critFailText:
          '漆黑一片里你摸错箱子，一巴掌拍进装满捕兽夹的货箱里，惨叫声响彻整条走私密道。',
      },
      {
        id: 'sh_bm_might',
        label: '踹翻货箱强行清缴非法走私窝点',
        detail: '代表正义（以及自己的钱包）查封这批无证军火！',
        stat: 'might',
        dc: 13,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.48,
        failHpPct: 0.15,
        critFailHpPct: 0.29,
        successText:
          '你一脚踹飞沉重铁门，威风凛凛撞散走私团伙！面具人见硬茬上门，丢下货箱钻进狗洞逃之夭夭，战利品全归你笑纳。',
        critSuccessText:
          '你的气势宛如王城禁卫军团突袭！整条黑市的商贩齐刷刷抱头蹲下交出全部赃款与精品装备，你还顺走了一张绝密地图！',
        failText:
          '密道狭窄难以施展大开大合的招式，接头人引爆一颗震荡烟雾弹，震得你头晕眼花挨了两刀。',
        critFailText:
          '你大力踹门结果门是往里拉的，反震力把你弹回墙上，顺带触发了门框上吊着的防盗铁桶砸中脑袋。',
      },
      {
        id: 'sh_bm_bribe',
        label: '痛快付金币走黑市VIP通道并扫货',
        detail: '花钱买捷径加神秘盲盒，做生意讲究皆大欢喜。',
        coinCost: 700,
        rewardCoinsMult: 0.95,
        rewardXpMult: 1.05,
        dropChance: 0.5,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '金币落地有声，乌鸦面具人爽快拉开密门，还顺手往你包里塞了一件品相极佳的走私神秘包裹，称赞你是个懂规矩的大客户。',
        critSuccessText: '接头人被你的大气折服，免费附赠了一批稀有货物与安全护送。',
        failText: '交易完成，你穿过密道继续前行。',
        critFailText: '交易完成，你穿过密道继续前行。',
      },
    ],
  },

  // 6. 古老石像谜题
  {
    id: 'sh_stone_riddle',
    chapter: 'shared',
    title: '会讲冷笑话的古老石像',
    emoji: '🗿',
    narrative:
      '青苔密布的遗迹拱门中央，一尊长着滑稽大胡子的智慧石像突然睁开石眼，咳嗽着喷出两团千年灰尘。它清了清嗓子宣称：“答对我的终极哲学谜题，我将献上古王秘藏；答错嘛——就尝尝我珍藏五百年的落石惩罚吧！听好了：什么东西越洗越脏，且黑吊国老赖最怕看见？”',
    choices: [
      {
        id: 'sh_riddle_arcana',
        label: '结合古代语义学给出满分哲学解答',
        detail: '用渊博学识不仅答出谜底，还反手给石像出了道高阶悖论题。',
        stat: 'arcana',
        dc: 12,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.4,
        dropChance: 0.48,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你淡定回答“水与信用记录”，并顺手解析了谜面里的双关古语法。石像欣慰大笑，张开大嘴吐出一箱闪闪发光的古王财宝！',
        critSuccessText:
          '你的回答之精妙令石像热泪盈眶（流了两行泥浆）！它感叹五百年来终于遇到知音，把头顶王冠里的绝世珍宝也震下来送给了你！',
        failText:
          '你想得太复杂长篇大论了三分钟，石像听得打瞌睡误判你超时，冷酷触发了头顶落石机关。',
        critFailText:
          '你一本正经分析出完全相反的答案，石像觉得智商受到侮辱，直接朝你吐出一块结结实实的大理石砖。',
      },
      {
        id: 'sh_riddle_charm',
        label: '反讲一个更冷的西幻冷笑话折服石像',
        detail: '对付无聊了五百年的老石头，逗它笑比答题管用一百倍！',
        stat: 'charm',
        dc: 12,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.3,
        dropChance: 0.45,
        failHpPct: 0.11,
        critFailHpPct: 0.24,
        successText:
          '你讲了个“为什么骷髅不敢去黑吊国银行借钱——因为它没胆也没皮”的冷笑话。石像笑得石屑直掉，爽快打开了藏宝暗格！',
        critSuccessText:
          '你的段子戳中了石像尘封五百年的笑点！它笑到下巴脱臼，肚子里积攒了几个世纪的财宝哗啦啦全倒进了你怀里！',
        failText:
          '场间陷入长达十秒的尴尬死寂，连乌鸦都飞过叫了一声。石像面无表情地落下三块石头表示差评。',
        critFailText:
          '你讲的笑话太烂直接触发了石像的“低俗惩罚协议”，一道魔法闪电精准劈焦了你的发型。',
      },
      {
        id: 'sh_riddle_might',
        label: '直接拿武器撬开石像嘴巴掏宝藏',
        detail: '谁有空听一块大石头说脱口秀，答案就在你肚子里对吧？',
        stat: 'might',
        dc: 13,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.3,
        dropChance: 0.45,
        failHpPct: 0.15,
        critFailHpPct: 0.29,
        successText:
          '你懒得废话，直接用武器撑开石像大嘴一顿猛掏！石像含糊不清地抗议着“不讲武德”，却眼睁睁看你抱走了全部宝藏。',
        critSuccessText:
          '你一拳震得石像满口石牙乱飞，整尊雕像吓得乖乖张大嘴把压箱底的所有金币和秘宝全吐了出来，发誓以后再也不考人了！',
        failText:
          '石像嘴闭合得比铁钳还快，险些把你的武器一口咬断，还顺手喷出一股呛人的石化尘雾。',
        critFailText:
          '你刚把手伸进去，石像打了个震天响的喷嚏，直接把你当炮弹喷飞出去摔在碎石堆里。',
      },
      {
        id: 'sh_riddle_agility',
        label: '趁它眨眼盲区拆除底座藏宝暗锁',
        detail: '石像的眼睛在正面，后脑勺的维修盖板肯定没人看守！',
        stat: 'agility',
        dc: 12,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.25,
        dropChance: 0.48,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你假装低头苦思，悄悄溜到石像背后两下撬开维修暗门，把里面的古王秘藏搬得干干净净。石像还在前面催你快点回答！',
        critSuccessText:
          '你不仅掏空了它的后脑勺金库，还顺手拨停了它的发条机关！石像卡在半句冷笑话里原地静音，你满载而归！',
        failText:
          '后盖里连着警报钢丝，你刚扯动一下，底座就弹出一排锋利暗针扎得你跳脚退开。',
        critFailText:
          '石像的脖子居然能一百八十度旋转！它幽幽回头盯住你：“想作弊？”随即给了你一记沉重头槌。',
      },
    ],
  },

  // 7. 落魄骑士决斗
  {
    id: 'sh_fallen_knight',
    chapter: 'shared',
    title: '典当战甲的落魄骑士决斗',
    emoji: '🤺',
    narrative:
      '林间空地上站着一位身披补丁链甲、却依然把破旧披风甩得猎猎作响的中年骑士。他自称“苍穹白银爵士”，因沉迷赌博把祖传板甲典当在了黑吊国当铺，如今只剩一把缺口长剑和满腔过剩的荣誉感。他朝你丢下一只磨破手指的铁手套：“尊贵的同行，来一场骑士决斗吧！赢家带走我最后的荣誉奖金！”',
    choices: [
      {
        id: 'sh_knight_warrior',
        label: '以圣殿骑士礼正面迎战三回合',
        detail: '成全落魄老兵的体面，用堂堂正正的剑技赢下尊重与馈赠。',
        stat: 'might',
        dc: 11,
        requiredClass: 'warrior',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.45,
        dropChance: 0.5,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '三记硬碰硬的剑锋交错火星四溅，你以教科书般的格挡挑飞他的缺口长剑。老骑士大笑认输，豪爽赠你藏在鞍囊里的战利品与金币。',
        critSuccessText:
          '你的剑势刚柔并济令白银爵士热泪盈眶！他感慨后继有人，不仅奉上全部赏金，还把压箱底未舍得典当的传家神兵赠予了你！',
        failText:
          '瘦死的骆驼比马大，老骑士一招刁钻的假动作挑开你的防御，剑脊狠狠拍在你肩膀上让你吃痛退步。',
        critFailText:
          '你行骑士礼时剑鞘绊住马刺，一头撞进老骑士怀里，他顺势一记标准过肩摔把你放倒在地并点评“下盘太浮”。',
      },
      {
        id: 'sh_knight_agility',
        label: '以灵巧步法戏耍老骑士卸下佩剑',
        detail: '不伤老前辈和气，三步绕后轻点剑柄就能漂亮收官。',
        stat: 'agility',
        dc: 12,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你如清风般滑过他沉重劈砍的轨迹，刀背轻敲他手腕，缺口长剑应声落地。白银爵士佩服拱手，愿赌服输献上战利品。',
        critSuccessText:
          '你绕着老骑士转了三圈顺手帮他把松开的披风系成蝴蝶结，再轻弹剑身夺刃！他目瞪口呆，心服口服奉上珍藏宝物！',
        failText:
          '老骑士虽穷却经验老辣，预判了你的侧闪路线，反手一记铁肘把你撞得气血翻涌。',
        critFailText:
          '你耍帅后空翻结果一脚踩进路边泥坑滑倒，老骑士满脸困惑地用剑尖戳了戳你问需不需要拉一把。',
      },
      {
        id: 'sh_knight_charm',
        label: '聊黑吊国当铺行情劝他合伙反杀庄家',
        detail: '打架多伤和气，不如一起痛骂黑心赌场结成异姓盟友！',
        stat: 'charm',
        dc: 12,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.25,
        dropChance: 0.42,
        healPctOnSuccess: 0.15,
        failHpPct: 0.11,
        critFailHpPct: 0.23,
        successText:
          '两人从赌场抽水骂到当铺折价，瞬间相见恨晚！老骑士豪爽取消决斗，分享了一壶私藏疗伤烈酒，还硬塞给你一笔路费和装备当见面礼。',
        critSuccessText:
          '你几句肺腑之言点醒了迷途骑士！他当场发誓戒赌，把留作翻本的最后私房钱和珍贵装备全送给你作为“戒赌见证礼”！',
        failText:
          '你刚提起他输光盔甲的往事，老骑士恼羞成怒觉得你在羞辱贵族尊严，红着眼挥剑劈来。',
        critFailText:
          '你顺口提议“要不我借你点钱再赢回来”，彻底触怒了老骑士的逆鳞，他追着你劈了整整三条街。',
      },
      {
        id: 'sh_knight_bribe',
        label: '直接赞助一笔赎甲费买下他的老古董',
        detail: '用金币成全落魄骑士的体面，顺带低价淘一件好装备。',
        coinCost: 600,
        rewardCoinsMult: 0.9,
        rewardXpMult: 1.05,
        dropChance: 0.55,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '老骑士眼眶湿润地接过金币，郑重行骑士礼，将自己随身携带的一件古董秘宝郑重托付给你，宣称等你凯旋必以美酒相待。',
        critSuccessText: '你的慷慨重燃了白银爵士的尊严，他把珍藏多年的家族圣物一并赠予了你。',
        failText: '双方体面交换信物，各自踏上旅途。',
        critFailText: '双方体面交换信物，各自踏上旅途。',
      },
    ],
  },

  // 8. 假冒圣物商
  {
    id: 'sh_fake_relic_merchant',
    chapter: 'shared',
    title: '兜售“真·圣遗物”的江湖骗子',
    emoji: '🏺',
    narrative:
      '路边篝火旁摆着一块花哨波斯地毯，上面陈列着发光玻璃珠、涂了金漆的木棍和一瓶标着“初代龙王原味洗澡水”的浑浊液体。留着两撇油亮八字胡的商贩热情迎上来，压低声音神秘推销：“少侠骨骼惊奇！这根可是圣光大帝用过的牙签，今天跳楼价只卖有缘人！”',
    choices: [
      {
        id: 'sh_relic_arcana',
        label: '用奥术鉴宝眼揭穿假货顺便捡漏真宝',
        detail: '骗子自己都分不清真假，那堆破烂角落里好像混着一件真货！',
        stat: 'arcana',
        dc: 12,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.3,
        dropChance: 0.58,
        failHpPct: 0.11,
        critFailHpPct: 0.24,
        successText:
          '你的魔力扫过地毯，一眼识破十件假货，却锁定了角落那块灰扑扑的真古董！你假意挑刺砍到白菜价顺走真宝，还顺带敲了一笔封口费。',
        critSuccessText:
          '你当众拆穿全套骗局吓得商贩冷汗直流，顺手把角落里那件连他自己都认不出的真·珍稀圣物连带摊位钱箱一起“合法罚没”！',
        failText:
          '商贩见你识破骗局，笑嘻嘻拍手甩出一把致盲胡椒粉，趁你泪流满面时踹了你一脚卷毯跑路。',
        critFailText:
          '你的鉴定术居然被一只涂满劣质荧光粉的假夜明珠晃花了眼，不仅被忽悠买单，还被劣质魔晶炸得满脸黑灰。',
      },
      {
        id: 'sh_relic_charm',
        label: '反客为主向他推销黑吊国空气币',
        detail: '想骗冒险者？先见识一下什么叫降维打击级别的顶级话术！',
        stat: 'charm',
        dc: 13,
        rewardCoinsMult: 1.65,
        rewardXpMult: 1.25,
        dropChance: 0.45,
        failHpPct: 0.11,
        critFailHpPct: 0.24,
        successText:
          '你三言两语把“去中心化黑吊圣币”吹得天花乱坠，江湖骗子听得如痴如醉，不仅没卖出假货，反倒掏空钱袋找你认购了两股原始股！',
        critSuccessText:
          '你的忽悠境界震碎了骗子的三观！他当场跪地拜师，把整车货款和压箱底唯一一件真品圣物全当拜师礼捧给了你！',
        failText:
          '骗子混迹江湖二十年，听了两句就冷笑反呛，趁你分神朝你扔来一颗劣质烟雾弹溜之大吉，熏得你直咳嗽。',
        critFailText:
          '你俩越聊越投机，结果糊里糊涂反被他绕进话术里，回过神来发现自己挨了记闷棍还差点签了卖身契。',
      },
      {
        id: 'sh_relic_might',
        label: '拎起骗子衣领倒立抖出真私房钱',
        detail: '假货留着烧火，你身上肯定藏着真正值钱的货！',
        stat: 'might',
        dc: 12,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.25,
        dropChance: 0.45,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你一把拎起八字胡抖了两下，叮里咣啷滚出一大堆金灿灿的真币和一件藏在夹层里的好装备。骗子哭爹喊娘求饶着滚进了树林。',
        critSuccessText:
          '你只用一只手就把骗子晃成了人体老虎机，源源不断抖出三倍金币与藏匿珍宝！他发誓从今往后改邪归正去当老实农夫！',
        failText:
          '这厮滑得像条泥鳅，一脱外衣金蝉脱壳，顺手把那瓶“龙王洗澡水”砸在你胸口，恶臭熏得你头晕目眩。',
        critFailText:
          '你用力太猛一脚踩中他藏在地毯下的弹簧捕兽夹，痛得跳起三尺高，骗子一边大笑一边收拾摊子跑没影了。',
      },
      {
        id: 'sh_relic_agility',
        label: '趁他眉飞色舞推销时反手顺走钱箱',
        detail: '骗子最专注的时刻，就是他吹牛吹到忘我的时候。',
        stat: 'agility',
        dc: 12,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.2,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你配合地频频点头赞叹“太神奇了”，另一只手已悄无声息把马车后的钱箱和真品暗袋卷了个精光，转身挥手告别。',
        critSuccessText:
          '你不仅清空了骗子的全部家当，还用一块路边石头完美配重塞回他暗袋！他还在热情朝你挥手喊“下次再来光顾啊”！',
        failText:
          '钱箱上系着隐形铜铃，刚一挪动就叮当大作！骗子瞬间翻脸，甩出藏在袖里的带刺流星锤。',
        critFailText:
          '你顺手摸进他暗袋却抓了一把粘稠强力胶，手被粘在钱箱上尴尬对视三秒后挨了一顿平底锅暴打。',
      },
    ],
  },

  // 9. 吸血鬼收债人
  {
    id: 'sh_vampire_collector',
    chapter: 'shared',
    title: '披风带算盘的吸血鬼收债人',
    emoji: '🧛',
    narrative:
      '夜雾凝聚成一名身着燕尾服、披风内衬绣满复利公式的苍白吸血鬼，手里优雅地晃着一本猩红账簿与纯银算盘。他推了推金丝眼镜，冷冰冰核对你的面孔：“受黑吊国暗影金融公会委托，特来核查跨位面逾期利息——先生，您打算用金币结清，还是用两升新鲜热血分期？”',
    choices: [
      {
        id: 'sh_vamp_gold',
        label: '掏出黑吊国金卡要求经理出来道歉',
        detail: '五星优质客户也敢错查？马上投诉到暗影金融公会总部！',
        stat: 'charm',
        dc: 11,
        creditPerk: 'high_free',
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.2,
        dropChance: 0.45,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '吸血鬼核验完你的顶级金卡记录瞬间脸色比平时更白！他深鞠一躬为“系统误报”致歉，奉上丰厚礼金与赔礼宝匣后化作蝙蝠仓皇遁走。',
        critSuccessText:
          '看到你的金卡尊享评级，收债人吓得直接跪地恳求千万别给差评！他不仅自掏腰包奉上巨额补偿金，还把随身秘银宝物留作赔罪礼！',
        failText:
          '吸血鬼推推眼镜冷笑：“抱歉，您的信用评级显示您刚在酒馆赊过账呢。”随即露出森白尖牙扑了过来。',
        critFailText:
          '你高傲甩卡结果掏出一张超市打折券，吸血鬼气得觉得职业尊严被践踏，挥动猩红账簿朝你脸颊狠狠抽来。',
      },
      {
        id: 'sh_vamp_deadbeat',
        label: '理直气壮宣布老赖豁免权并反向借钱',
        detail: '凭本事借的债凭什么还？顺便问问你家还放不放新款高利贷！',
        stat: 'charm',
        dc: 13,
        creditPerk: 'deadbeat_intimidate',
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.25,
        dropChance: 0.45,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你毫无愧色地摊开双手表示“烂命一条、血里全是烈酒和大蒜，要抽赶紧抽”！吸血鬼嫌弃得连退三步，宁可丢下封口费也不愿沾染你的坏账！',
        critSuccessText:
          '你的滚刀肉功力震碎了吸血鬼三百年的催收道心！他抱着算盘崩溃大喊“这单呆账我不要了”，落荒而逃时连收缴的赃款袋都忘拿了！',
        failText:
          '吸血鬼面不改色冷笑：“我们公会对付专业老赖有一百零八种无痛放血方案。”寒光一闪已攻至眼前。',
        critFailText:
          '你刚喊完“有本事来吸我啊”，吸血鬼真的一口咬在你手腕上——虽然嫌味道太冲吐了出来，但你也疼得原地起跳。',
      },
      {
        id: 'sh_vamp_paladin',
        label: '拔出圣光武器宣告非法高利贷无效',
        detail: '以辉光律法查封这家吸血放贷机构，顺手净化收债人！',
        stat: 'charm',
        dc: 11,
        requiredClass: 'paladin',
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.4,
        dropChance: 0.48,
        healPctOnSuccess: 0.15,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '炽烈圣光轰然炸开，猩红账簿瞬间烧成灰烬！吸血鬼捂脸惨叫化作黑烟逃窜，留下一地散落的催收金币与精良战利品。',
        critSuccessText:
          '圣光照耀之下，吸血鬼收债人当场被感化得痛哭流涕，主动烧毁全部卖身契并把身上所有财宝捐献给了正义事业！',
        failText:
          '这名吸血鬼披风里竟缝了抗圣光锡箔衬里，硬扛下余波反手甩出一串锋利银算珠。',
        critFailText:
          '圣光刚亮起就被对方用镜面银盘折射回来，晃得你睁不开眼，趁机被对方踢中膝盖。',
      },
      {
        id: 'sh_vamp_might',
        label: '捏碎纯银算盘用拳头跟它平账',
        detail: '算盘打得再响，也抵不过沙包大的拳头直接销账！',
        stat: 'might',
        dc: 13,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.15,
        critFailHpPct: 0.29,
        successText:
          '你一把夺过纯银算盘折成两段，反手重拳将吸血鬼轰进灌木丛！它尖叫着化作蝙蝠逃走，留下了装满金币的公文包。',
        critSuccessText:
          '你势大力沉的一拳直接把吸血鬼打回了棺材原型！公文包炸开，里面的金币与精良抵押品如雨般落入你怀中！',
        failText:
          '吸血鬼身法鬼魅般化作血雾避开重拳，绕到你身后冰冷地划破了你的护肩。',
        critFailText:
          '你挥拳落空一头扎进对方张开的催眠披风里，被绕得晕头转向狠狠摔了个大马趴。',
      },
    ],
  },

  // 10. 迷路宝箱怪
  {
    id: 'sh_lost_mimic',
    chapter: 'shared',
    title: '迷路流泪的社恐宝箱怪',
    emoji: '📦',
    narrative:
      '阴暗角落里瑟瑟发抖着一只镶铜橡木宝箱，盖子微微掀开一条缝，露出两排雪白利齿和一双水汪汪的委屈大眼睛。它显然和同类走散了，舌头耷拉在外面小声呜咽，肚子因为紧张发出咕噜咕噜的响声——每响一次，里面就隐约传来稀世珍宝碰撞的悦耳清音。',
    choices: [
      {
        id: 'sh_mimic_charm',
        label: '温柔摸头顺毛并递给它一块肉干',
        detail: '谁说宝箱怪只能挨打？社恐大狗狗哄好了比谁都大方！',
        stat: 'charm',
        dc: 11,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.25,
        dropChance: 0.55,
        healPctOnSuccess: 0.15,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '宝箱怪小心翼翼叼走肉干，开心得把箱盖啪嗒啪嗒拍得像鼓掌！它感激地吐出一大堆消化不了的闪亮金币与精美装备送给你。',
        critSuccessText:
          '你把它撸得翻肚皮露锁孔，舒服得直吐泡泡！宝箱怪直接把整副家当挑最值钱的塞进你怀里，还舔了舔你的伤口带来神奇暖意！',
        failText:
          '它实在太社恐了，你的手刚伸过去就吓得本能闭嘴，“咔嚓”咬穿了你的手套留下一排整齐牙印。',
        critFailText:
          '你摸头力道没掌握好戳中了它的敏感锁孔！宝箱怪惊慌失措把你的胳膊吞到肘部，费了九牛二虎之力才拔出来。',
      },
      {
        id: 'sh_mimic_agility',
        label: '趁它打嗝瞬间飞快掏空肚子里的宝物',
        detail: '只要拔手的速度快过它合盖的反射弧，就能无伤零元购！',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.3,
        dropChance: 0.58,
        failHpPct: 0.14,
        critFailHpPct: 0.29,
        successText:
          '趁它打嗝张大嘴的零点三秒，你闪电出手掏出一把耀眼金币与神秘战利品！宝箱怪懵懂地眨眨眼，似乎还没搞清怎么突然瘦了一圈。',
        critSuccessText:
          '你的手速快得像闪电侠附体！不仅清空了它肚里的全套稀有宝藏，还顺手塞了根木棍撑住牙口，潇洒拍屁股走人！',
        failText:
          '宝箱怪的闭嘴速度堪比捕蝇草！你虽抢到一点碎屑，手背却被锋利牙齿划出一道长长血痕。',
        critFailText:
          '你的手腕被它粘稠长舌头死死卷住，整个人被拖着在地上摩擦了三圈才勉强挣脱。',
      },
      {
        id: 'sh_mimic_might',
        label: '先礼后兵一脚踹晕强行开箱',
        detail: '在西幻地牢里，对宝箱怪最大的尊重就是直接物理开锁！',
        stat: 'might',
        dc: 12,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.5,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你果断一记重击砸在铁扣上，宝箱怪眼冒金星晕了过去。你稳稳撬开箱盖，将里面的金币与装备一网打尽。',
        critSuccessText:
          '一击震晕宝箱怪的瞬间，它像吐币机一样哗啦啦吐出全套珍宝！你潇洒收包，顺手还帮它把箱盖体面合上了。',
        failText:
          '这只社恐宝箱怪其实是全钢加固款！你一脚踹上去震得脚趾发麻，反被它猛地扑上来啃了小腿一口。',
        critFailText:
          '你抡起武器狠砸，结果武器被宝箱怪一口咬住夺走甩飞！赤手空拳的你被委屈巴巴的箱子撞翻在地。',
      },
      {
        id: 'sh_mimic_arcana',
        label: '用驯兽灵光为它指明回巢方向',
        detail: '奥术安抚加导航法阵，做一回温暖的迷途怪物守护者。',
        stat: 'arcana',
        dc: 11,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.52,
        failHpPct: 0.11,
        critFailHpPct: 0.23,
        successText:
          '柔和星光指引出同类的气息，宝箱怪欢快地蹦跶两下，临走前主动抖落一大堆闪闪发亮的过路谢礼。',
        critSuccessText:
          '你的善意法阵感动了这只小家伙！它不仅留下一件罕见珍藏，还发出一声鸣叫让附近所有隐藏暗匣都发出了定位微光！',
        failText:
          '星光太刺眼反而把社恐宝箱怪吓得应激发作，朝你喷出一口带酸性的消化黏液。',
        critFailText:
          '法阵画反把方向指到了你怀里！宝箱怪欢呼着把你当成妈妈扑上来疯狂贴贴，差点把你肋骨勒断。',
      },
    ],
  },

  // 11. 精灵占卜师
  {
    id: 'sh_elf_fortuneteller',
    chapter: 'shared',
    title: '塔罗牌缺两张的精灵占卜师',
    emoji: '🔮',
    narrative:
      '挂满风铃的紫绒帐篷悄然立于路畔，一位银发尖耳的精灵占卜师正盯着水晶球发愁，面前摊开的命运塔罗牌明显缺了“愚者”与“死神”两张。她抬起碧绿双眸叹息：“旅人，我的牌被路过的地精叼走了两张，但星象告诉我，你今天命中带财——还是带灾，抽一张看看？”',
    choices: [
      {
        id: 'sh_elf_mage',
        label: '以奥术星象学帮她补全缺失命牌',
        detail: '用自己的魔力重绘星辰牌面，顺便把今天的运势往高了调！',
        stat: 'arcana',
        dc: 11,
        requiredClass: 'mage',
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.45,
        dropChance: 0.55,
        healPctOnSuccess: 0.18,
        failHpPct: 0.12,
        critFailHpPct: 0.25,
        successText:
          '你指尖凝聚璀璨星辉，在虚空中完美补绘出两张缺失命牌！精灵占卜师惊喜不已，立刻赠你一道强力祝福与珍藏秘宝作为谢礼。',
        critSuccessText:
          '你顺手在命运牌面上偷偷刻了个“欧皇暴击”彩蛋！整座帐篷沐浴在金色星雨里，你的精力焕然一新，罕见宝物也凭空浮现！',
        failText:
          '星力调和略微失衡，补出来的牌面居然变成了“倒霉蛋”，一道小小厄运雷弧劈得你头发倒竖。',
        critFailText:
          '水晶球承受不住你的狂暴魔力咔嚓裂成两半，占卜师心疼得直接用银法杖敲了你一记爆栗。',
      },
      {
        id: 'sh_elf_charm',
        label: '用深情赞美免费套出一套幸运神谕',
        detail: '精灵最吃优雅赞美这一套，夸到她心花怒放自然送福利！',
        stat: 'charm',
        dc: 12,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        healPctOnSuccess: 0.18,
        failHpPct: 0.11,
        critFailHpPct: 0.23,
        successText:
          '你用抑扬顿挫的十四行诗赞美了她的双眸与星辰智慧。精灵占卜师掩唇轻笑，免费为你降下疗愈星辉，并指引了一处隐藏宝藏！',
        critSuccessText:
          '你的情话优雅到让见多识广的精灵都红了耳尖！她不仅送上最高级幸运星佑恢复气血，还把压箱底的星月珍宝塞进你手中！',
        failText:
          '你夸她“看起来至少比真实年龄年轻两百岁”，瞬间踩中精灵禁忌，她面无表情抽出一张“天打雷劈”扣在你头上。',
        critFailText:
          '你脱口而出的土味情话把精灵尴尬得脚趾抠地，水晶球因承受不了油腻氛围直接爆炸糊了你一脸闪粉。',
      },
      {
        id: 'sh_elf_agility',
        label: '盲抽塔罗牌并靠手速换成“命运之轮”',
        detail: '命运掌握在自己手里——字面意义上的手速改命！',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.3,
        dropChance: 0.5,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你指尖轻掠牌背，精准感知到最温热的那张牌并稳稳翻开——正位太阳！占卜师惊叹你的绝世好运，依约奉上丰厚吉兆赠礼。',
        critSuccessText:
          '你的偷天换日令命运本尊都竖起大拇指！翻开瞬间竟然连出三张大吉圣牌，金光闪过，财宝与极品战利品落满地毯！',
        failText:
          '你的小动作被精灵敏锐的尖耳和夜视眼抓个正着，她冷哼一声强行翻开逆位高塔，诅咒余波震伤了你的气血。',
        critFailText:
          '换牌时把整副塔罗牌全扫进了炭火盆！精灵占卜师彻底暴走，拎着水晶球把你从帐篷里砸了出来。',
      },
      {
        id: 'sh_elf_bribe',
        label: '付金币请她做一次正经高阶星辰占卜',
        detail: '专业的事花钱找专业精灵，明码标价童叟无欺。',
        coinCost: 550,
        rewardCoinsMult: 0.95,
        rewardXpMult: 1.15,
        dropChance: 0.4,
        healPctOnSuccess: 0.22,
        failHpPct: 0.08,
        critFailHpPct: 0.16,
        successText:
          '金币落入星盘，占卜师庄重咏唱星辰祷文。柔和治愈星光笼罩全身，她还贴心指明了前方隐藏的一袋前人遗宝。',
        critSuccessText: '星辰为你绽放罕见的双吉兆，不仅伤势大愈，还额外收获一件星光饰品。',
        failText: '占卜结束，你带着温暖祝福踏上征途。',
        critFailText: '占卜结束，你带着温暖祝福踏上征途。',
      },
    ],
  },

  // 12. 断桥伏击
  {
    id: 'sh_broken_bridge_ambush',
    chapter: 'shared',
    title: '雷雨夜的断桥强盗伏击',
    emoji: '⛈️',
    narrative:
      '瓢泼暴雨倾盆而下，一道惨白闪电照亮前方塌了半边的古老石桥。桥头阴影里猛然窜出五名披着黑蓑衣的蒙面强盗，弓弩上弦、弯刀滴水，领头刀疤汉子在雷鸣中大喝：“此桥乃黑风帮所修，要想踏过残梁，把身上的金币和武器全留下！”',
    choices: [
      {
        id: 'sh_bridge_might',
        label: '借雷鸣之势一记重劈连人带桥震退',
        detail: '雨夜正适合教训不长眼的毛贼，让他们见识什么叫人形天灾。',
        stat: 'might',
        dc: 12,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '伴随一道炸雷，你如猛虎下山般一击劈断领头强盗的弯刀！其余毛贼吓破了胆，丢下抢来的钱袋和战利品跳进雨雾溃逃。',
        critSuccessText:
          '你周身气浪竟生生震开漫天雨幕！一击把刀疤首领连同两名喽啰直接轰进河滩泥坑，余众跪地奉上全帮积蓄只求活命！',
        failText:
          '暴雨让石板滑不留脚，你蓄力时身形微晃，被强盗弓弩擦中肩头留下一道血口。',
        critFailText:
          '你霸气高举铁制武器仰天怒吼——结果在雷雨夜完美客串了一根避雷针，被一道小天雷劈得外焦里嫩。',
      },
      {
        id: 'sh_bridge_agility',
        label: '踩着残桥铁链凌空绕后反包围',
        detail: '他们以为断桥是绝路，其实是你最擅长的立体机动赛道。',
        stat: 'agility',
        dc: 12,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.35,
        dropChance: 0.48,
        failHpPct: 0.13,
        critFailHpPct: 0.26,
        successText:
          '你足尖轻点垂落铁链借力翻越断口，鬼魅般出现在弓箭手背后！三下五除二缴械放倒，反把这伙强盗洗劫一空。',
        critSuccessText:
          '你在雷雨闪电的频闪里化作五道残影，一息之间解除了全员武装并把他们捆成一串雨中粽子！所有赃物归你所有！',
        failText:
          '生锈铁链在半空骤然绷断，你虽勉强翻回桥面，膝盖却在乱石上磕得鲜血淋漓。',
        critFailText:
          '你踩铁链时脚底打滑一字马劈在桥栏上，场面之惨烈连对面蒙面强盗都不忍直视地沉默了两秒才动手。',
      },
      {
        id: 'sh_bridge_arcana',
        label: '引动暴雨天雷在桥头降下连锁闪电',
        detail: '大自然的雷暴已经在头顶蓄满蓝了，不用白不用！',
        stat: 'arcana',
        dc: 13,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.4,
        dropChance: 0.45,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你指天吟唱导雷咒，炽白电蛇顺着雨水在强盗脚下炸开！五名毛贼瞬间变成冒烟的爆炸头，战利品乖乖留在原地。',
        critSuccessText:
          '雷霆宛如听话的银龙精准绕过你劈碎强盗全部兵刃！刀疤头领以为惹上了雷神化身，磕头献上全帮秘藏后连滚带爬逃命！',
        failText:
          '雨夜魔力潮湿紊乱，闪电劈偏了三尺砸碎了桥栏，飞溅碎石刮伤了你的面颊。',
        critFailText:
          '雨水把你和强盗连成了同一条导体，闪电劈过去的同时自己也跟着跳了一段抽搐电流舞。',
      },
      {
        id: 'sh_bridge_deadbeat',
        label: '掏出欠条痛哭流涕向强盗反要路费',
        detail: '比惨？黑吊国老赖能让山贼当场动恻隐之心！',
        stat: 'charm',
        dc: 13,
        creditPerk: 'deadbeat_intimidate',
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.2,
        dropChance: 0.4,
        failHpPct: 0.13,
        critFailHpPct: 0.27,
        successText:
          '你淋着大雨悲愤掏出三叠催收函，泣诉自己被高利贷逼得走投无路正准备跳河。刀疤强盗听得眼眶发红，不仅放行还塞给你一笔救济金！',
        critSuccessText:
          '你的悲惨账单让这伙凶恶强盗集体破防落泪！刀疤头领感慨“原来这世道还有比我们更苦的兄弟”，把刚抢的整袋财宝和装备全塞给了你！',
        failText:
          '刀疤汉子冷笑一声：“少来这套，老子以前也是被你这种老赖拖垮才上山当强盗的！”提刀就砍。',
        critFailText:
          '你演得太卖力不小心真滑向桥边，强盗本想拉你一把结果顺手把你推进了冰冷雨水坑。',
      },
    ],
  },
];

export const TABLETOP_SCENES: readonly TabletopSceneDef[] = [
  ...CHAPTER_1_TO_3_SCENES,
  ...CHAPTER_4_TO_6_SCENES,
  ...SHARED_SCENES,
];

export const TABLETOP_BOSS_ACTS: readonly TabletopBossActDef[] = [
  // =========================================================================
  // Boss 1: 哥布林酋长·格鲁克 (👑)
  // =========================================================================
  {
    chapter: 1,
    bossName: '哥布林酋长·格鲁克',
    bossEmoji: '👑',
    phase1Title: '废铁王座上的绿皮暴君',
    phase1Narrative:
      '密林深处的骸骨祭坛高台上，体型如灰熊般魁梧的哥布林酋长·格鲁克正歪戴着一顶偷来的黄铜王冠。它脚下踩着堆满商旅财宝的木箱，手中巨大的狼牙棒挂满战利品铃铛，每挥一下就发出刺耳狂笑：“又来个细皮嫩肉的冒险者！把金币交出来，老子赏你个痛快！”',
    phase1Choices: [
      {
        id: 'boss1_p1_agility',
        label: '挑断王座悬绳用铁笼砸晕护卫',
        detail: '先破坏它的高台支架与节奏，削弱格鲁克第二阶段防线！',
        stat: 'agility',
        dc: 11,
        weakenBoss: true,
        rewardCoinsMult: 1.25,
        rewardXpMult: 1.25,
        dropChance: 0.35,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你精准斩断吊着废铁吊灯的粗麻绳，沉重铁笼轰然砸塌王座半边，格鲁克的护甲被砸出明显破绽，气急败坏地滚下高台！',
        critSuccessText:
          '铁笼连带滚烫火盆精准扣在格鲁克王冠上！它像只顶着铁锅的无头苍蝇乱撞，防线彻底崩坏，连腰间金币都震落一地！',
        failText:
          '粗麻绳浸满油脂格外坚韧，一刀竟没斩断。格鲁克狞笑着甩出狼牙棒劲风，震得你踉跄退后。',
        critFailText:
          '麻绳断得太晚，吊灯擦着你头皮砸在脚边，反倒溅了你一身滚烫火油，格鲁克笑得前仰后合。',
      },
      {
        id: 'boss1_p1_arcana',
        label: '释放油腻术让高台变成绿皮滑梯',
        detail: '用奥术滑腻咒破坏酋长下盘重心，令它破绽百出！',
        stat: 'arcana',
        dc: 11,
        weakenBoss: true,
        rewardCoinsMult: 1.2,
        rewardXpMult: 1.3,
        dropChance: 0.35,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '幽紫油脂瞬间铺满高台木板，格鲁克刚迈出一步就劈了个标准一字马，重重摔下石阶，气势大损！',
        critSuccessText:
          '油腻术完美衔接火把火星，高台瞬间变成喷火滑梯！格鲁克连滚带爬摔成焦黑绿团，护身战意彻底瓦解！',
        failText:
          '格鲁克鞋底沾满松脂竟然防滑！它大笑着跃下高台，一记部落重击震得地面龟裂。',
        critFailText:
          '咒文施放过近把自己脚下也涂上了奥术润滑油，你先它一步表演了一个华丽的平地滑跪。',
      },
      {
        id: 'boss1_p1_might',
        label: '迎面硬撼狼牙棒正面崩裂酋长架势',
        detail: '以绝对力量正面交锋，一举砸松它的狂妄气焰！',
        stat: 'might',
        dc: 12,
        weakenBoss: true,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.35,
        dropChance: 0.4,
        failHpPct: 0.16,
        critFailHpPct: 0.31,
        successText:
          '兵器相交爆出刺目火星，你的沛然巨力硬生生将格鲁克震退五步！它虎口崩裂，眼神里首次浮现一丝惊慌。',
        critSuccessText:
          '一击震断格鲁克狼牙棒的铁箍！酋长看着手里变成烧火棍的武器陷入短暂呆滞，破绽洞开！',
        failText:
          '酋长的蛮力远超普通哥布林，沉重狼牙棒砸得你双臂发麻，气血一阵翻腾。',
        critFailText:
          '你踩碎脚下朽木重心一偏，被格鲁克顺势一记铁肩撞飞进火堆旁，灰头土脸。',
      },
      {
        id: 'boss1_p1_charm',
        label: '嘲讽它的黄铜王冠是地摊假货激怒它',
        detail: '用嘴炮戳中暴君虚荣心，让它在暴怒中露出致命空门！',
        stat: 'charm',
        dc: 12,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.25,
        dropChance: 0.35,
        failHpPct: 0.13,
        critFailHpPct: 0.27,
        successText:
          '你指着它歪斜的王冠大笑“黑吊国地摊三文钱一打”，格鲁克气得理智全失，胡乱挥棒反而把满身空门暴露无遗！',
        critSuccessText:
          '你精准点评王冠掉漆露出的铁皮底色，旁边哥布林小弟竟然忍不住噗嗤笑出声！格鲁克当场道心破碎，气急败坏扑了下来！',
        failText:
          '格鲁克大吼“假货砸死你也一样管用”，狂暴咆哮震得你耳膜嗡嗡作响。',
        critFailText:
          '你笑得太得意忘形没注意脚下，被格鲁克顺手丢来的生锈铁锅正中脑门。',
      },
    ],
    phase2Title: '终局时刻：酋长的部落咆哮重击',
    phase2Narrative:
      '被彻底激怒的格鲁克撕碎残破披风，浑身肌肉暴涨，高举沉重狼牙棒仰天发出震落松针的部落狂嚎！火光映照着它通红的兽瞳，它踏碎石阶如狂暴公牛般朝你发起孤注一掷的终结冲锋——这是决定密林归属的最后一击！',
    phase2Choices: [
      {
        id: 'boss1_p2_might',
        label: '蓄满全身气力正面绝杀劈斩',
        detail: '以刚克刚，用最酣畅淋漓的决胜一击终结绿皮暴君！',
        stat: 'might',
        dc: 13,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.5,
        dropChance: 0.85,
        failHpPct: 0.17,
        critFailHpPct: 0.33,
        successText:
          '你迎着狂暴冲锋悍然挥出决胜一击，彻底压垮格鲁克的狼牙棒！沉闷巨响后，哥布林酋长轰然倒地，黄铜王冠咕噜噜滚到你脚边。',
        critSuccessText:
          '宛如劈山裂石的完美一击！格鲁克连人带棒被震飞十丈撞碎废铁王座，整片哥布林密林瞬间陷入敬畏的死寂！',
        failText:
          '格鲁克临死反扑气势惊人，狂暴冲击震退了你的武器，你在剧痛中稳住身形准备再战！',
        critFailText:
          '你的武器与狼牙棒磕出刺耳火花后险些脱手，被酋长顺势一记野蛮冲撞顶得胸口剧痛！',
      },
      {
        id: 'boss1_p2_agility',
        label: '滑步钻过腋下反手锁喉致命突刺',
        detail: '借它冲锋惯性四两拨千斤，一击直取要害！',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.5,
        dropChance: 0.85,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你在狼牙棒落地的刹那贴地滑步掠过，反手寒光精准切中格鲁克后颈要害！庞大身躯顺着惯性扑倒在尘土里再起不能。',
        critSuccessText:
          '行云流水般的致命华尔兹！你甚至在半空顺手摘下了它的王冠戴在剑尖，落地时格鲁克恰好轰然跪倒！',
        failText:
          '酋长临阵变招横扫一棒，封死了你的滑步路线，灼热棍风刮伤了你的肩侧。',
        critFailText:
          '地上松针滑得要命，你滑步过头直接撞在了格鲁克坚硬的膝盖上，换来一记结结实实的重砸。',
      },
      {
        id: 'boss1_p2_arcana',
        label: '引爆预埋奥术火印轰碎酋长狂怒',
        detail: '将所有剩余魔力凝成一点，在它扑至眼前时绚丽引爆！',
        stat: 'arcana',
        dc: 13,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.5,
        dropChance: 0.85,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '炽蓝火柱在格鲁克脚下轰然冲天，彻底吞没了它的部落咆哮！烟尘散尽后，焦黑的哥布林酋长举着白旗般冒烟的断棒倒地不起。',
        critSuccessText:
          '奥术火莲在密林夜空绽放出史诗光芒！气浪把格鲁克掀成一颗划破树冠的绿皮流星，顺手炸开了它私藏多年的宝库暗箱！',
        failText:
          '魔力引导差了半拍，火印只炸伤了它的护腿，愤怒的酋长顶着浓烟一拳砸中你的肋下。',
        critFailText:
          '魔力失控在身前提前爆裂，冲击波把你和酋长双双熏成了黑炭，而它显然皮更厚一点。',
      },
      {
        id: 'boss1_p2_charm',
        label: '以无畏神威震慑溃军并施以终结裁决',
        detail: '用压倒性领袖气场瓦解部落士气，给予酋长致命一击！',
        stat: 'charm',
        dc: 13,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.45,
        dropChance: 0.85,
        failHpPct: 0.15,
        critFailHpPct: 0.31,
        successText:
          '你凛然立于火光之前一声断喝，四周观战的哥布林小弟当场丢械逃窜！军心崩溃的格鲁克气势骤泄，被你顺势一击放倒。',
        critSuccessText:
          '你的王者气场令整片密林鸦雀无声！格鲁克冲到一半竟腿软刹停，被自己绊倒摔晕在王座前，小弟们争先恐后把宝库钥匙献给了你！',
        failText:
          '狂暴状态下的酋长根本听不进半句话，震耳咆哮直接打断了你的气势并震伤了你。',
        critFailText:
          '你气势磅礴地喊出终结宣言，结果一只惊慌蝙蝠刚好撞你脸上，局面瞬间失控挨了一记闷棍。',
      },
    ],
    victoryEpilogue:
      '随着哥布林酋长·格鲁克倒在熄灭的篝火旁，密林深处压抑许久的阴霾一扫而空。残存绿皮丢下成堆劫掠来的金币与秘宝四散逃窜，微风拂过松涛，你在黑吊国冒险史上的第一枚勋章已然铸就。',
  },

  // =========================================================================
  // Boss 2: 骸骨领主·莫德雷德 (💀)
  // =========================================================================
  {
    chapter: 2,
    bossName: '骸骨领主·莫德雷德',
    bossEmoji: '💀',
    phase1Title: '冥火王庭的千年枯骨君王',
    phase1Narrative:
      '地穴最深处的黑曜石祭殿内，十二根聚魂石柱同时燃起森冷碧火。身披残破皇袍的骸骨领主·莫德雷德缓缓从石棺起身，空洞眼眶跳动着摄人心魄的紫焰。它拔出缠绕怨灵的斩魂大剑，冰冷神念震荡殿堂：“生者踏足永眠圣域，当以魂魄补全吾之王冠！”',
    phase1Choices: [
      {
        id: 'boss2_p1_arcana',
        label: '逆转聚魂石柱符文切断亡灵供能',
        detail: '先拆掉给莫德雷德回血续命的冥火阵眼，大幅削弱它！',
        stat: 'arcana',
        dc: 12,
        weakenBoss: true,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.3,
        dropChance: 0.4,
        failHpPct: 0.15,
        critFailHpPct: 0.29,
        successText:
          '你指尖连点三道解咒光束，聚魂石柱的碧火瞬间熄灭大半！莫德雷德周身护盾剧烈闪烁，魂火黯淡了一截。',
        critSuccessText:
          '你反手把聚魂阵改成了抽魂阵！三根石柱倒吸走莫德雷德大片死灵魔力，骸骨领主惊怒交加，铠甲咔嚓裂开数道大口！',
        failText:
          '古老死灵阵法比想象中顽固，反震阴寒顺着魔力回路刺痛了你的经脉。',
        critFailText:
          '你误触了祭坛警戒铭文，幽绿鬼火化作锁链抽打过来，烫得你连退数步。',
      },
      {
        id: 'boss2_p1_charm',
        label: '咏唱辉光祷文驱散大殿亡灵怨雾',
        detail: '以凛然意志与圣洁气场压制死灵王威，震松它的骨甲！',
        stat: 'charm',
        dc: 12,
        weakenBoss: true,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.3,
        dropChance: 0.4,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '浩然辉光如利剑撕破死寂阴霾，莫德雷德身周哀嚎的怨灵烟消云散，它的行动明显滞重起来！',
        critSuccessText:
          '璀璨圣辉照亮整座地穴穹顶，莫德雷德仿佛直面正午烈阳般捂脸后退，皇袍燃起金色净火，战力大减！',
        failText:
          '骸骨领主发出刺耳冥界啸叫强行压下你的祷文，寒意透骨而来。',
        critFailText:
          '怨灵尖啸震得你心神一晃，脚下踩中冷雾险些跌倒，挨了一记幽冥剑气。',
      },
      {
        id: 'boss2_p1_might',
        label: '猛砸石棺底座震散领主护身骨盾',
        detail: '管它什么千年亡灵仪式，先砸了它的老床板再说！',
        stat: 'might',
        dc: 13,
        weakenBoss: true,
        rewardCoinsMult: 1.3,
        rewardXpMult: 1.35,
        dropChance: 0.4,
        failHpPct: 0.16,
        critFailHpPct: 0.31,
        successText:
          '重击轰碎千年玄石棺，冥火阵基瞬间失衡！莫德雷德怒不可遏却失去了石棺共鸣加持，防御出现巨大空缺。',
        critSuccessText:
          '你一击把石棺掀飞直接拍在莫德雷德胸口，震掉它三根肋骨与半截王冠，场面一度十分解气！',
        failText:
          '玄石棺坚逾精铁，反震震得你虎口生疼，斩魂剑气已顺势斩来。',
        critFailText:
          '你砸偏了一寸，棺材板弹起正好磕在你下巴上，莫德雷德发出了诡异的下颌骨咔哒笑声。',
      },
      {
        id: 'boss2_p1_agility',
        label: '游走阴影袭扰斩断领主皇袍飘带',
        detail: '避开斩魂大剑锋芒，快速消耗它的魂力储备。',
        stat: 'agility',
        dc: 13,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.3,
        dropChance: 0.42,
        failHpPct: 0.14,
        critFailHpPct: 0.28,
        successText:
          '你在石柱间闪烁腾挪，接连削断数道护身符带，莫德雷德空挥巨剑气急败坏。',
        critSuccessText:
          '你绕后一刀挑飞它腰间的聚魂玉佩，大殿碧火瞬间暴走反噬其主！',
        failText:
          '森冷剑风封锁了石柱转角，你闪避不及被擦破护甲，寒气渗入伤口。',
        critFailText:
          '你一脚踩到滑腻骨灰摔了个跟头，险险滚开才没被斩魂剑劈成两半。',
      },
    ],
    phase2Title: '终局时刻：冥界斩魂的宿命一剑',
    phase2Narrative:
      '莫德雷德将整座地穴残余的幽绿魂火尽数吸入剑锋，斩魂大剑膨胀成三丈长的死亡镰影！石柱在恐怖威压下寸寸龟裂，亡灵君王挟着千年不甘朝你劈下足以割裂魂魄的终焉斩击——胜负在此一举！',
    phase2Choices: [
      {
        id: 'boss2_p2_might',
        label: '挺身硬破斩魂剑锋轰碎骷髅王冠',
        detail: '以血肉之躯与无匹巨力正面碾碎亡灵千年的执念！',
        stat: 'might',
        dc: 14,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.55,
        dropChance: 0.88,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '你暴喝着正面架开冥火巨剑，反手势不可挡的一击直接劈碎莫德雷德胸甲！亡灵君王在幽绿星火中轰然坍塌为一地静默白骨。',
        critSuccessText:
          '雷霆万钧的终结重击将斩魂大剑连同王冠一并劈成两半！莫德雷德临散架前眼眶竟闪过一丝敬佩，彻底归于永眠！',
        failText:
          '幽冥剑势重如山岳，震得你连退数步咳出闷气，但你咬牙重新握紧了武器！',
        critFailText:
          '寒气顺着兵刃直侵双臂，你的攻势被生生震歪，胸口结结实实挨了一道阴冷剑芒！',
      },
      {
        id: 'boss2_p2_arcana',
        label: '以烈焰星爆彻底净化冥界魂火',
        detail: '点燃体内澎湃魔力，用炽烈奥术把死灵王庭烧成白昼！',
        stat: 'arcana',
        dc: 14,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.55,
        dropChance: 0.88,
        failHpPct: 0.16,
        critFailHpPct: 0.33,
        successText:
          '炽白奥术星爆精准命中莫德雷德眉心魂火，将千年死灵执念瞬间蒸发！大殿阴冷骤散，满地珍宝闪耀出温暖光芒。',
        critSuccessText:
          '你的星爆法阵在墓穴穹顶化作微型太阳！莫德雷德连同冥火斩击一并灰飞烟灭，只留下一枚璀璨的王者战利品匣！',
        failText:
          '冥界斩魂劈开了半数火流，反冲气浪将你震倒在冰冷石阶上。',
        critFailText:
          '法术共鸣在指尖失衡炸开，灼伤了自己手掌，莫德雷德趁势逼近再挥一剑！',
      },
      {
        id: 'boss2_p2_agility',
        label: '贴剑锋滑步突进一击刺穿眉心魂核',
        detail: '巨剑挥落必有死角，迎着剑风钻入怀中直取命门！',
        stat: 'agility',
        dc: 14,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.55,
        dropChance: 0.88,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你如闪电般贴着幽绿剑芒切入中门，利刃精准贯穿莫德雷德额前魂核！紫焰骤灭，千年君王轰然跪地碎成尘沙。',
        critSuccessText:
          '你在剑锋落地的毫厘之间旋身腾空，反手一击直接挑飞它的头骨再精准接住王冠！整座墓穴为你献上无声礼赞！',
        failText:
          '剑气余波划破你的斗篷逼退了突进，亡灵君王森然举剑准备下一击。',
        critFailText:
          '你在最后一步踩中碎骨打滑，险些撞进斩魂剑锋，狼狈翻滚吃了一记寒气冲击。',
      },
      {
        id: 'boss2_p2_charm',
        label: '宣告安魂圣谕令千年亡君放下执念',
        detail: '以绝对信念直视死亡，击溃莫德雷德最后的冥界意志！',
        stat: 'charm',
        dc: 14,
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.5,
        dropChance: 0.88,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你浑身绽放不屈信念，朗声宣告旧王时代已终。莫德雷德的斩魂大剑竟在半空寸寸瓦解，它缓缓垂首，化作一捧安详的星尘。',
        critSuccessText:
          '你的意志宛如黎明圣钟响彻九幽！骸骨领主眼中的疯狂紫焰化作释然金芒，它单膝跪地将王庭密藏尽数托付于你后安然消散！',
        failText:
          '莫德雷德冷酷嘲笑生者的天真，一道冰寒魂波狠狠撞击你的心神。',
        critFailText:
          '冥界怨念反扑让你一时失语，被斩魂大剑的劲风横扫摔在石柱旁。',
      },
    ],
    victoryEpilogue:
      '随着莫德雷德的冥火彻底熄灭，笼罩亡灵墓穴数百年的刺骨阴风终于散去。一束清晨微光顺着坍塌的穹顶缝隙洒落石棺，你拾起闪耀着古老徽记的战利品，告别了这座重归宁静的地下王庭。',
  },

  // =========================================================================
  // Boss 3: 血族伯爵·弗拉德 (🧛)
  // =========================================================================
  {
    chapter: 3,
    bossName: '血族伯爵·弗拉德',
    bossEmoji: '🧛',
    phase1Title: '绯红钟楼顶端的猩红晚宴',
    phase1Narrative:
      '血月高悬在哥特尖塔之上，猩红彩窗将整座顶层大厅染得如酒池般妖艳。血族伯爵·弗拉德摇晃着水晶高脚杯，黑红丝绒披风在夜风中猎猎飞舞，唇边噙着傲慢而危险的微笑：“能闯过我的舞厅与魔偶，你值得成为我今晚的头盘——让我看看，你的鲜血有几分醇香？”',
    phase1Choices: [
      {
        id: 'boss3_p1_agility',
        label: '击碎彩窗高悬的银质吊灯封锁血雾',
        detail: '砸碎银吊灯制造满地纯银碎屑，彻底限制弗拉德的血雾瞬移！',
        stat: 'agility',
        dc: 13,
        weakenBoss: true,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '飞刃斩断银链，巨型纯银吊灯轰然坠落炸出漫天银屑！弗拉德刚化作血雾便被银光灼伤显形，眉头首次紧紧皱起。',
        critSuccessText:
          '银吊灯精准砸翻了伯爵的血酒祭坛，纯银碎屑如天女散花铺满全场！弗拉德狼狈躲避，精致礼服破了好几个冒烟焦洞！',
        failText:
          '弗拉德弹指化作三只血蝠避开坠落吊灯，冰冷利爪顺势划过你的臂膀。',
        critFailText:
          '吊灯落下时砸偏反弹出几块碎玻璃，割破你的袖口，伯爵优雅鼓掌讥笑你的准头。',
      },
      {
        id: 'boss3_p1_charm',
        label: '当众揭露血堡财政赤字扰乱伯爵心境',
        detail: '用犀利贵族礼仪与毒舌审计击穿他的优雅假面，令其露怯！',
        stat: 'charm',
        dc: 13,
        weakenBoss: true,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.3,
        dropChance: 0.45,
        failHpPct: 0.14,
        critFailHpPct: 0.29,
        successText:
          '你慢条斯理指出他城堡屋顶漏水、酒窖兑水且欠了一屁股黑吊国高利贷。弗拉德脸色铁青失了分寸，猩红法术出现明显破绽！',
        critSuccessText:
          '你的优雅讽刺精准捅进这位落魄伯爵的肺管子！他气得捏碎了水晶高脚杯，红酒洒满前襟，优雅人设当场崩塌，防线门户大开！',
        failText:
          '弗拉德冷笑反击“死人不需要关心税收”，猩红魅惑视线刺痛了你的双眸。',
        critFailText:
          '你刚开口就被伯爵随手泼来一杯腐蚀血酒，精致台词全变成了一阵咳嗽。',
      },
      {
        id: 'boss3_p1_arcana',
        label: '投射模拟正午烈日的奥术光棱阵',
        detail: '虽然窗外是血月，但奥术师随时可以在室内制造紫外线！',
        stat: 'arcana',
        dc: 13,
        weakenBoss: true,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '耀眼白金光棱在大厅骤然亮起，灼热光波烤得弗拉德嘶声退避，血族再生之力遭到大幅压制！',
        critSuccessText:
          '你的高能日光棱镜直接把钟楼大厅照成热带海滩！弗拉德举着披风抱头鼠窜，一身血族魔能瞬间蒸发三成！',
        failText:
          '猩红血月透窗而入压制了光阵，弗拉德冷笑着甩出一记血刃斩伤了你。',
        critFailText:
          '光棱折射角度算错直接照进自己眼睛，你捂眼瞬间被伯爵优雅地补了一脚。',
      },
      {
        id: 'boss3_p1_might',
        label: '顶着血蝠风暴强拆钟楼祭坛石柱',
        detail: '先拆房子再打贵族，看他还怎么在天花板上装深沉！',
        stat: 'might',
        dc: 14,
        rewardCoinsMult: 1.35,
        rewardXpMult: 1.4,
        dropChance: 0.45,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你怒吼着劈裂承重石柱，漫天落石迫使弗拉德从半空狼狈落地与你近身对决！',
        critSuccessText:
          '整根石柱轰然砸向血月窗棂，破晓前的第一缕银辉渗入大厅，弗拉德气急败坏！',
        failText:
          '成群嗜血蝙蝠扑面而来遮蔽视野，趁你挥舞武器驱赶时，弗拉德一剑刺中肩头。',
        critFailText:
          '石柱纹丝不动，反倒把你震得虎口发麻，伯爵轻蔑地赞叹了你的“石匠热情”。',
      },
    ],
    phase2Title: '终局时刻：猩红盛宴的血月狂潮',
    phase2Narrative:
      '弗拉德终于收起轻蔑微笑，猩红双眸燃烧起疯狂血焰！他张开巨大蝠翼腾空而起，整座血堡的绯红血雾化作滔天浪潮向你压顶席卷，数百柄血晶长矛悬浮空中蓄势待发——只要挺过这一瞬并给予致命反击，血堡的永夜便将终结！',
    phase2Choices: [
      {
        id: 'boss3_p2_might',
        label: '迎着血矛暴雨悍然跃斩撕裂蝠翼',
        detail: '一力降十会，把高高在上的吸血鬼伯爵硬生生斩落尘埃！',
        stat: 'might',
        dc: 15,
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.6,
        dropChance: 0.9,
        failHpPct: 0.18,
        critFailHpPct: 0.35,
        successText:
          '你挥舞兵刃震碎迎面血矛，纵身跃起一记雷霆斩落！弗拉德的蝠翼与狂傲一同碎裂，在尖啸中化作满天血色玫瑰灰烬。',
        critSuccessText:
          '势若奔雷的一击直接将伯爵从半空钉穿在大理石地面！随着一声不甘叹息，猩红血雾彻底溃散，伯爵的珍藏秘匣滚落身前！',
        failText:
          '血晶长矛如雨点倾泻，虽挡下大半却仍被余威震退，你擦去嘴角血渍重新摆开架势！',
        critFailText:
          '你起跳瞬间被血雾绊住脚步，连挨数记血刃割裂，重重跌回地面。',
      },
      {
        id: 'boss3_p2_agility',
        label: '借坠落血矛踏空连跳直刺伯爵心脏',
        detail: '把漫天血矛当踏板，送上最复古的猎魔人穿心礼！',
        stat: 'agility',
        dc: 15,
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.6,
        dropChance: 0.9,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '你足尖轻点血矛逆流而上，在弗拉德错愕的目光中将锋刃精准送入心口！猩红盛宴戛然而止，伯爵化作飞灰消散。',
        critSuccessText:
          '宛如夜空舞者的绝世身法！你借血矛连踏七步瞬间突至伯爵身后，反手一击直接终结血族霸主，甚至没沾上一滴红酒！',
        failText:
          '血矛在半空骤然爆裂，气浪把你掀飞出去，险险翻滚稳住身形。',
        critFailText:
          '一脚踩碎了一根虚影血矛，你在半空失衡摔进酒桌堆里，被伯爵趁机补了一道血浪。',
      },
      {
        id: 'boss3_p2_arcana',
        label: '引爆浓缩破晓光爆彻底蒸发血雾',
        detail: '用最耀眼的黎明奥术给这场午夜派对画上句号！',
        stat: 'arcana',
        dc: 15,
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.6,
        dropChance: 0.9,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '刺目金色破晓光球在你掌心炸裂，滔天血浪如冰雪消融！弗拉德在璀璨光芒中发出最后哀嚎，化作一缕青烟归于虚无。',
        critSuccessText:
          '奥术破晓之光冲破钟楼穹顶直贯夜空，连天上血月都被染回银白！弗拉德连灰都没剩下多少，唯独那枚华丽伯爵印戒闪闪发光！',
        failText:
          '血雾浓度过高吞噬了大半魔力，反冲震得你胸口剧痛，不得不稳息重聚魔能。',
        critFailText:
          '魔力失衡炸出一团绚烂却无害的烟花，弗拉德冷笑着挥手降下血雨将你击退。',
      },
      {
        id: 'boss3_p2_charm',
        label: '以破晓圣誓与王者威压彻底粉碎血契',
        detail: '宣告黑夜终结，用不屈辉光与气场镇杀千年吸血鬼！',
        stat: 'charm',
        dc: 15,
        rewardCoinsMult: 1.65,
        rewardXpMult: 1.55,
        dropChance: 0.9,
        failHpPct: 0.16,
        critFailHpPct: 0.33,
        successText:
          '你迎着血潮一步不退，炽烈信念化作无形圣盾震碎所有血矛！弗拉德的血契彻底反噬崩解，在优雅而苦涩的致意中化作星尘。',
        critSuccessText:
          '你的光辉誓言宛如黎明初升，弗拉德的血族威压竟在瞬间土崩瓦解！他低声叹道“果然时代变了”，微笑化灰并留下满室珍宝！',
        failText:
          '伯爵的猩红意志阴冷而狂暴，精神对撞令你一阵眩晕，挨了一道血浪冲击。',
        critFailText:
          '血雾呛入喉咙让你宣言卡壳，弗拉德抓住破绽一记重击把你扫退十步。',
      },
    ],
    victoryEpilogue:
      '随着血族伯爵·弗拉德化作随风飘散的绯红灰烬，猩红血堡钟楼敲响了久违的黎明晨钟。第一缕金色阳光刺破彩绘玻璃洒满大厅，你收起沉甸甸的伯爵战利品，迈向更加炙热的未知征程。',
  },

  // =========================================================================
  // Boss 4: 熔岩魔像·卡兹丹 (🔥)
  // =========================================================================
  {
    chapter: 4,
    bossName: '熔岩魔像·卡兹丹',
    bossEmoji: '🔥',
    phase1Title: '地心铸炉苏醒的泰坦巨像',
    phase1Narrative:
      '矮人熔炉最深处的沸腾岩浆池骤然掀起十丈巨浪，一尊由黑铁护甲与流动岩浆铸就的恐怖巨人缓步踏上铁桥！熔岩魔像·卡兹丹胸口镶嵌着炽白如烈日的地心熔核，每走一步都把钢铁地板踩得通红发软，震耳欲聋的金属轰鸣回荡地底：“入侵炉心者——皆化铁水！”',
    phase1Choices: [
      {
        id: 'boss4_p1_agility',
        label: '拉动顶棚泄洪闸用冰泉浇淋魔像外壳',
        detail: '给滚烫岩浆巨头来个急速淬火，让它的黑铁护甲脆如瓷器！',
        stat: 'agility',
        dc: 14,
        weakenBoss: true,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.4,
        dropChance: 0.48,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '你飞身跃上蒸汽管道狠拉总闸，冰冷地下河水轰然倾泻在卡兹丹头顶！滚滚白雾中黑铁外壳咔咔爆裂出密密麻麻的裂纹！',
        critSuccessText:
          '极寒急冷让卡兹丹全身黑铁护甲像酥皮一样大片剥落！魔像发出痛苦的蒸汽长啸，胸口熔核毫无遮掩地彻底暴露！',
        failText:
          '总闸链条被高温烤得死死卡住，你正使劲扯动时，卡兹丹甩出的熔岩火球已擦身炸开。',
        critFailText:
          '滚烫水管烫得你脱手摔落铁架，落地正好滚进一堆灼热煤渣里灰头土脸。',
      },
      {
        id: 'boss4_p1_arcana',
        label: '用极寒霜咒封堵卡兹丹背部散热阀',
        detail: '堵住矮人造物的排热口，让它自己内部过热降频！',
        stat: 'arcana',
        dc: 14,
        weakenBoss: true,
        rewardCoinsMult: 1.4,
        rewardXpMult: 1.4,
        dropChance: 0.48,
        failHpPct: 0.16,
        critFailHpPct: 0.32,
        successText:
          '寒冰魔纹瞬间封死了魔像背后的三大蒸汽排气口！卡兹丹体内压力骤增发出刺耳警报，动作明显变得僵硬迟缓。',
        critSuccessText:
          '完美的冰封过载让卡兹丹肩部锅炉发生连锁小爆破！漫天零件雨里，魔像的防御符文几乎彻底失灵！',
        failText:
          '地心高温瞬间融化了冰霜咒文，反扑热浪烤得你嘴唇干裂，气血受挫。',
        critFailText:
          '冰火对撞引发剧烈蒸汽爆炸，把你像弹珠一样震飞撞在了玄铁柱上。',
      },
      {
        id: 'boss4_p1_might',
        label: '硬砸膝盖液压轴承迫使巨像单膝跪地',
        detail: '再庞大的机械泰坦，膝盖受不了重锤也得给你乖乖弯腰！',
        stat: 'might',
        dc: 15,
        weakenBoss: true,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.45,
        dropChance: 0.5,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '你顶着灼热气浪悍然突进，重击精准崩碎左膝黄铜轴承！卡兹丹轰隆单膝跪地，整座铸炉都在震颤，要害彻底落入你的攻击高度！',
        critSuccessText:
          '你的巨力生生把玄铁轴承砸弯成了麻花！熔岩魔像重心全失跪碎铁桥，胸口熔核的保护罩直接震落在地！',
        failText:
          '魔像护膝烫得像刚出炉的铁块，你一击未破防反被一记熔岩铁腿横扫震飞。',
        critFailText:
          '你挥击用力过猛武器险些被滚烫岩浆粘住，狼狈抽身时挨了一记重拳余波。',
      },
      {
        id: 'boss4_p1_charm',
        label: '高喊矮人古语“停工检修指令”干扰核心',
        detail: '试试用上古工匠最高权限口令让这台老古董进入自检卡顿！',
        stat: 'charm',
        dc: 15,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.35,
        dropChance: 0.45,
        failHpPct: 0.15,
        critFailHpPct: 0.3,
        successText:
          '你声音洪亮地模仿矮人王庭工头下达“炉温超标、立刻泄压自检”指令！卡兹丹胸口核心闪烁黄灯卡顿了三秒，被你趁机重创！',
        critSuccessText:
          '古老语音协议奇迹般奏效！卡兹丹一边机械复读“遵命首席大师”一边自动打开了胸口检修盖，连护盾都主动关了！',
        failText:
          '卡兹丹发出低沉嘲讽：“检测到非矮人声纹，判定为盗矿贼！”随即喷出一道熔岩火柱。',
        critFailText:
          '你念错一个古语词根，直接触发了它的“全功率赶工超频模式”，一记炙热铁拳迎面砸来。',
      },
    ],
    phase2Title: '终局时刻：地裂熔岩冲击的终极过载',
    phase2Narrative:
      '卡兹丹胸口的地心熔核亮到令人无法直视，整座地下铸炉的岩浆被它疯狂吸入体内！它高举双拳化作两颗燃烧陨星狠狠砸向铁桥，炽烈岩浆波涛连同崩塌碎石向你汹涌扑来——唯有击碎它的熔核，才能终结这场毁灭性的地心风暴！',
    phase2Choices: [
      {
        id: 'boss4_p2_might',
        label: '跃过岩浆裂隙全力一击轰碎地心熔核',
        detail: '正面粉碎钢铁泰坦的心脏，用绝对力量征服矮人熔炉！',
        stat: 'might',
        dc: 16,
        rewardCoinsMult: 1.65,
        rewardXpMult: 1.65,
        dropChance: 0.92,
        failHpPct: 0.19,
        critFailHpPct: 0.36,
        successText:
          '你踏碎飞溅火石凌空而起，倾尽全力的一击精准贯入地心熔核！震耳欲聋的崩鸣后，卡兹丹炽红双目熄灭，庞大铁躯轰然崩解。',
        critSuccessText:
          '宛如矮人战神亲临的灭世一击！你一拳轰穿了整个熔核核心，满天冷却岩浆凝结成璀璨黑曜宝石与绝世锻造秘宝！',
        failText:
          '地裂冲击波震得铁桥剧烈摇晃，你的重击稍偏寸许，灼热气浪逼得你翻滚后退再寻良机！',
        critFailText:
          '滚烫岩浆溅在护靴上令你动作一滞，结结实实吃下了卡兹丹一记熔铁横扫！',
      },
      {
        id: 'boss4_p2_agility',
        label: '沿铁链荡至魔像胸前精准拆解核心锁扣',
        detail: '避开正面地裂冲击，用外科手术般的身法直接拔掉它的电池！',
        stat: 'agility',
        dc: 16,
        rewardCoinsMult: 1.65,
        rewardXpMult: 1.65,
        dropChance: 0.92,
        failHpPct: 0.18,
        critFailHpPct: 0.35,
        successText:
          '你借吊炉铁链在熔岩浪潮上方优雅滑翔，落地瞬间精准撬断核心锁扣！炽白熔核脱壳坠灭，卡兹丹轰然瘫倒成一堆寂静黑铁。',
        critSuccessText:
          '如鬼魅般穿行火雨之中，你不仅一击拔出完整地心熔核，还顺带接住了从魔像核心暗格震出的绝版秘银神兵！',
        failText:
          '滚烫蒸汽遮住了视线，你从铁链滑落时擦过炽热护臂，烫伤迫使你暂退蓄势。',
        critFailText:
          '铁链被飞溅岩浆烧断一节，你狼狈砸在铁桥边缘，险些滑进沸腾熔浆池。',
      },
      {
        id: 'boss4_p2_arcana',
        label: '倾泻绝对零度霜爆令熔核瞬间骤冷炸裂',
        detail: '把整座铸炉的热量瞬间抽空，让物理热胀冷缩完成绝杀！',
        stat: 'arcana',
        dc: 16,
        rewardCoinsMult: 1.65,
        rewardXpMult: 1.65,
        dropChance: 0.92,
        failHpPct: 0.18,
        critFailHpPct: 0.35,
        successText:
          '璀璨冰蓝法阵在你掌心轰然展开，刺骨寒潮迎面撞上炽白熔核！伴随清脆爆裂声，卡兹丹全身瞬间化作布满裂纹的黑曜石雕像轰然碎裂。',
        critSuccessText:
          '极寒与极热的交响在铸炉穹顶炸出漫天晶莹冰晶！卡兹丹被瞬间冻成完美的熔炉艺术品，随即崩散出海量锻造金币与稀有战利品！',
        failText:
          '过载岩浆的热度远超预期，寒流只冻结了表层护甲，炽热冲击波将你掀翻在地。',
        critFailText:
          '冰霜法术在高温下瞬间汽化爆炸，滚烫水蒸气把你熏得眼冒金星。',
      },
      {
        id: 'boss4_p2_charm',
        label: '以不灭意志驾驭矮人圣火反噬魔像',
        detail: '向古老铸炉之灵宣告新的主宰，令魔像核心向你臣服崩解！',
        stat: 'charm',
        dc: 16,
        rewardCoinsMult: 1.7,
        rewardXpMult: 1.6,
        dropChance: 0.92,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '你迎着滔天热浪寸步不让，浩荡意志竟与古老矮人铸炉之魂产生共鸣！卡兹丹胸口的狂暴火焰骤然温顺熄灭，庞大身躯单膝跪地停机。',
        critSuccessText:
          '整座矮人熔炉响应了你的王者召唤！地心烈焰化作金色王冠环绕你身周，卡兹丹彻底瓦解，熔炉自动为你锻出耀眼战利品！',
        failText:
          '失控魔像早已忘却矮人荣光，狂暴地裂震波打断了你的共鸣并震伤了你。',
        critFailText:
          '灼热硫磺浓烟直呛喉咙，你的威严宣誓变成一阵咳嗽，险险躲过一记熔岩重拳。',
      },
    ],
    victoryEpilogue:
      '沸腾的岩浆池在卡兹丹崩塌后逐渐恢复平静，古老矮人熔炉的蒸汽管发出一声悠长而安详的叹息。你从冷却的黑曜铁骸中拾起流光溢彩的矮人神藏，踏出炽热地底，直面远方冰雪与烈焰交织的龙巢山巅。',
  },

  // =========================================================================
  // Boss 5: 双头古龙·提亚马特 (🐉)
  // =========================================================================
  {
    chapter: 5,
    bossName: '双头古龙·提亚马特',
    bossEmoji: '🐉',
    phase1Title: '冰火双首的龙巢天空霸主',
    phase1Narrative:
      '山巅巨窟穹顶轰然撕裂，寒风暴雪与火山灰同时倒灌而入。双头古龙·提亚马特展开遮蔽天日的巨大龙翼，左侧冰霜龙首吞吐着冻结灵魂的极寒吐息，右侧赤焰龙首咆哮着焚尽钢铁的烈焰风暴！两双金色竖瞳居高临下俯视渺小的你：“胆敢觊觎古龙宝库的蝼蚁，选好你想被冻成冰雕，还是烤成焦炭了吗？”',
    phase1Choices: [
      {
        id: 'boss5_p1_charm',
        label: '挑拨冰火两颗龙头互喷抢功打内讧',
        detail: '两颗脑袋总会有意见分歧的时候，先让它们自己吵起来！',
        stat: 'charm',
        dc: 15,
        weakenBoss: true,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.45,
        dropChance: 0.52,
        failHpPct: 0.17,
        critFailHpPct: 0.33,
        successText:
          '你高声称赞火龙首英姿飒爽、顺便贬低冰龙首像根发霉冰棍！两颗高傲龙头果然互相怒吼撕咬起来，护身龙威瞬间溃散大半！',
        critSuccessText:
          '你的挑拨离间精准点燃了它们憋了三千年的内部矛盾！冰火两首直接在半空对喷了一口，把自己炸得晕头转向摔落岩台，破绽百出！',
        failText:
          '两颗龙头罕见地达成了一致——决定先把嘴欠的你烤熟再冰镇保鲜！',
        critFailText:
          '你刚夸完火龙头，冰龙头二话不说一口寒风把你冻成了原地颤抖的冰糖葫芦。',
      },
      {
        id: 'boss5_p1_agility',
        label: '借龙巢崩塌岩柱飞跃斩裂古龙翼膜',
        detail: '只要把天上的大蜥蜴拽回地面，它的空中优势便荡然无存！',
        stat: 'agility',
        dc: 15,
        weakenBoss: true,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.45,
        dropChance: 0.52,
        failHpPct: 0.17,
        critFailHpPct: 0.33,
        successText:
          '你踩着飞溅岩块腾空掠过，锋利刃光精准划开龙翼薄弱筋膜！提亚马特痛嚎着失去升力重重坠落地面，防线大开！',
        critSuccessText:
          '宛如疾风闪电般的空中连击！你不仅划伤双翼迫使其坠地，还顺手从它颈鳞缝隙挑落数枚闪亮龙鳞秘宝！',
        failText:
          '巨龙振翅卷起十二级狂风把你吹得偏离路线，滚烫尾焰扫过你的侧腹。',
        critFailText:
          '你刚跳上岩柱就被龙尾扫塌，整个人像颗炮弹摔进雪堆里吃了一嘴霜灰。',
      },
      {
        id: 'boss5_p1_arcana',
        label: '布下元素折射镜让冰火吐息正面互撞',
        detail: '借力打力是奥术的最高艺术，让提亚马特自己品尝双息爆炸！',
        stat: 'arcana',
        dc: 15,
        weakenBoss: true,
        rewardCoinsMult: 1.45,
        rewardXpMult: 1.45,
        dropChance: 0.52,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '璀璨奥术棱镜在半空成形，精准偏转了冰火两道龙息！剧烈元素对冲轰然反炸在提亚马特胸口，厚重龙鳞裂开大缝！',
        critSuccessText:
          '完美的元素共振把双息能量原封不动弹回双首之间！巨大白雾爆鸣中，古龙惨嚎坠地，浑身龙威被震散大半！',
        failText:
          '古龙吐息的纯粹威能击穿了棱镜边缘，冰火余波溅得你遍体鳞伤。',
        critFailText:
          '折射角度算歪导致冰火两股气息合流直扑自己而来，你连滚带爬才保住小命。',
      },
      {
        id: 'boss5_p1_might',
        label: '硬撼龙爪俯冲以巨力震退古龙前肢',
        detail: '用最原始的屠龙血性正面告诉古龙，谁才是真正的掠食者！',
        stat: 'might',
        dc: 16,
        rewardCoinsMult: 1.5,
        rewardXpMult: 1.5,
        dropChance: 0.55,
        failHpPct: 0.18,
        critFailHpPct: 0.35,
        successText:
          '面对泰山压顶般的龙爪，你怒吼架住并反震出恐怖反冲！提亚马特惊愕后退半步，龙威气势顿时折损。',
        critSuccessText:
          '你硬生生抗住古龙俯冲并一击砸断它一根前爪利刃！鲜血滴落岩台，提亚马特首次露出了凝重神色！',
        failText:
          '古龙体重宛如山岳，狂暴下压震得你单膝跪裂石板，气血剧烈翻涌。',
        critFailText:
          '龙爪带起的飓风把你像片树叶般拍飞撞在冰壁上，浑身骨头都在抗议。',
      },
    ],
    phase2Title: '终局时刻：毁天灭地的冰火双息吐息',
    phase2Narrative:
      '提亚马特发出撼动整座雪山的震天龙吟，冰霜与赤焰两颗巨首并肩昂起，喉间亮起足以融穿山脉的毁灭光辉！冰蓝与赤金双色吐息交织成旋转风暴呼啸倾泻，所过之处岩石先化熔浆再结玄冰——这是唯有史诗屠龙者方能跨越的绝境终幕！',
    phase2Choices: [
      {
        id: 'boss5_p2_might',
        label: '逆着双息风暴跃斩劈开龙鳞逆鳞',
        detail: '以凡人之躯比肩神明，一剑斩碎千年古龙的无敌神话！',
        stat: 'might',
        dc: 17,
        rewardCoinsMult: 1.75,
        rewardXpMult: 1.75,
        dropChance: 0.95,
        failHpPct: 0.2,
        critFailHpPct: 0.37,
        successText:
          '你顶着灼骨与极寒的双重炼狱怒吼突进，兵刃精准劈中提亚马特胸前逆鳞！惊天龙鸣戛然而止，双头古龙轰然倒在璀璨金币海中。',
        critSuccessText:
          '传唱千年的屠龙神迹在此刻诞生！你一击撕裂冰火双息并直接贯穿双首共鸣心核，漫天龙血化作金色星雨为你加冕！',
        failText:
          '冰火交加的吐息威势滔天，你的冲锋被硬生生震退，但眼中战火丝毫未熄！',
        critFailText:
          '半身结霜半身焦黑的剧痛令你剑势一滞，被巨龙甩尾狠狠扫飞数丈！',
      },
      {
        id: 'boss5_p2_agility',
        label: '踩踏冰柱凌空折跃直刺双首汇合喉结',
        detail: '在毁灭风暴的缝隙里起舞，用最致命的一击封喉屠龙！',
        stat: 'agility',
        dc: 17,
        rewardCoinsMult: 1.75,
        rewardXpMult: 1.75,
        dropChance: 0.95,
        failHpPct: 0.19,
        critFailHpPct: 0.36,
        successText:
          '你在极寒冰刺与烈焰火舌间化作金色流光，瞬间切入双颈交汇死角一刃封喉！提亚马特双目骤暗，庞大龙躯重重倾覆。',
        critSuccessText:
          '你的身法连古龙竖瞳都无法捕捉！你在双息交错的中心完成绝美螺旋突刺，不仅瞬间屠龙，还顺手从龙角上摘下千年古王冠！',
        failText:
          '一道飞溅火浪封死了你的落脚冰柱，你狼狈翻滚避开致命吐息，伤势添新痕。',
        critFailText:
          '起跳瞬间寒霜冻滑了鞋底，你擦着龙息边缘跌落岩缝，被滚石砸得灰头土脸。',
      },
      {
        id: 'boss5_p2_arcana',
        label: '凝聚星穹崩解术正面轰穿冰火龙息',
        detail: '以纯粹奥术真理对抗太古龙威，来一场载入史册的对波！',
        stat: 'arcana',
        dc: 17,
        rewardCoinsMult: 1.75,
        rewardXpMult: 1.75,
        dropChance: 0.95,
        failHpPct: 0.19,
        critFailHpPct: 0.36,
        successText:
          '炫目星辉洪流自你掌心奔涌而出，硬生生碾碎冰火双息直贯龙首！刺目光华过后，古龙化作点点龙晶沉眠于巢穴之巅。',
        critSuccessText:
          '你的星穹洪流宛如神罚降临，不仅一举蒸发了双息风暴，更把提亚马特的千年龙魂直接炼化成闪耀传说辉光的稀世神藏！',
        failText:
          '双息能量过于狂暴，对波余震震碎了你的护盾，反噬魔力让你气血剧烈动荡。',
        critFailText:
          '吟唱关键音节被龙吼震乱，奥术光球在身前失衡炸开，把你掀翻进雪坑里。',
      },
      {
        id: 'boss5_p2_charm',
        label: '以真龙克星的王者气魄令古龙俯首伏诛',
        detail: '直视双头古龙的威压，以不屈灵魂斩断它统治山巅的霸权！',
        stat: 'charm',
        dc: 17,
        rewardCoinsMult: 1.8,
        rewardXpMult: 1.7,
        dropChance: 0.95,
        failHpPct: 0.18,
        critFailHpPct: 0.35,
        successText:
          '你昂首立于冰火交界之眼，璀璨意志化作金色龙威反压全场！提亚马特双首竟本能地发出敬畏低鸣，在你的终结裁决下缓缓伏倒。',
        critSuccessText:
          '你的气魄令天空乌云散尽、金日穿透龙巢！提亚马特震撼叹息“吾败于真王之手”，主动敞开千年龙巢宝库后安详瞑目！',
        failText:
          '高傲古龙发出震耳狂笑，强横龙威混合寒焰正面冲击而来，逼得你连退数步。',
        critFailText:
          '狂风夹杂火山灰灌了满嘴，霸气台词硬生生卡在喉咙里，顺带吃了一记龙翼劲风。',
      },
    ],
    victoryEpilogue:
      '随着双头古龙·提亚马特的呼吸归于沉寂，霜火交加的山巅奇迹般放晴，绚烂极光在龙巢上空缓缓铺展。你踏过熠熠生辉的古龙宝库，已然拥有直面最终深渊王座的史诗威名。',
  },

  // =========================================================================
  // Boss 6: 堕落魔神·阿撒托斯 (👁️)
  // =========================================================================
  {
    chapter: 6,
    bossName: '堕落魔神·阿撒托斯',
    bossEmoji: '👁️',
    phase1Title: '群星尽头的不可名状王座',
    phase1Narrative:
      '破碎星河在无尽虚空中缓慢旋转，一座由熄灭恒星铸成的暗黑王座悬浮于时空尽头。堕落魔神·阿撒托斯的万千虚空之眼同时睁开，不可名状的混沌笛音令重力与理智开始扭曲崩解！低沉宏大的神念跨越维度响起：“渺小尘埃竟敢直视混沌之核？你的存在，将在下一瞬被从现实抹除！”',
    phase1Choices: [
      {
        id: 'boss6_p1_arcana',
        label: '刻画现实锚点法阵强行锁死深渊维度',
        detail: '先把混沌魔神拉进正常物理法则里，剥夺它扭曲现实的特权！',
        stat: 'arcana',
        dc: 16,
        weakenBoss: true,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.55,
        dropChance: 0.6,
        failHpPct: 0.18,
        critFailHpPct: 0.35,
        successText:
          '金色几何锚链贯穿虚空，硬生生将混沌王座钉死在三维现实中！阿撒托斯发出震怒低鸣，无形不可知护罩裂开巨大缺口！',
        critSuccessText:
          '你的现实锚点精准锁死了魔神的时空相位！群星停止倒流，阿撒托斯被迫显露实体核心，连虚空触须都僵硬了大半！',
        failText:
          '混沌法则疯狂侵蚀你的法阵，几条暗紫触须突破防线狠狠抽打在你的护甲上。',
        critFailText:
          '锚点法阵在非欧空间里打了个死结，重力突然反转让你头朝下狠狠摔在了星辰天花板上。',
      },
      {
        id: 'boss6_p1_charm',
        label: '用黑吊国顶级荒诞意志反向击穿古神理智',
        detail: '只要你的精神防线比深渊还抽象，魔神也得被你整沉默！',
        stat: 'charm',
        dc: 16,
        weakenBoss: true,
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.5,
        dropChance: 0.6,
        failHpPct: 0.17,
        critFailHpPct: 0.34,
        successText:
          '你直视万千虚空之眼毫不畏惧，用充满烟火气的凡人幽默与不屈信念迎面回敬！混沌笛音竟第一次出现紊乱走调，魔神气息动摇！',
        critSuccessText:
          '你的凡人意志璀璨到让不可名状之神感到了真正的“不可理解”！阿撒托斯三百只眼睛同时陷入困惑宕机，防御彻底松动！',
        failText:
          '深渊低语如潮水涌入脑海，震得你太阳穴突突剧痛，险些迷失在星海幻境中。',
        critFailText:
          '你盯着魔神主眼多看了一秒，眼前瞬间浮现一万只长着触须的哥布林在跳交谊舞，晕头转向挨了一记虚空波。',
      },
      {
        id: 'boss6_p1_agility',
        label: '踩碎悬浮星辰连斩魔神外围观测眼',
        detail: '先戳瞎它的外围警戒魔眼，为最终决战撕开致命通道！',
        stat: 'agility',
        dc: 16,
        weakenBoss: true,
        rewardCoinsMult: 1.55,
        rewardXpMult: 1.55,
        dropChance: 0.6,
        failHpPct: 0.18,
        critFailHpPct: 0.35,
        successText:
          '你化作星海间一道不可捕捉的金色电光，接连斩碎七枚外围虚空魔眼！阿撒托斯痛嚎震荡星宇，王座防御出现致命盲区！',
        critSuccessText:
          '你的速度快到跨越了时空延迟！十二枚观测眼在同一次呼吸间全部崩灭，魔神王座剧烈倾斜，秘宝星辉四溅！',
        failText:
          '虚空射线在星石间织出死亡罗网，你闪避稍慢半拍，肩甲被混沌能量灼出焦痕。',
        critFailText:
          '脚下星石突然虚化消失，你在失重虚空里扑腾半天，被路过的暗影触须抽了个正着。',
      },
      {
        id: 'boss6_p1_might',
        label: '以凡躯硬撼混沌触须强拆星骸王座',
        detail: '管你什么维度魔神，挨上这一记实打实的重击照样得流血！',
        stat: 'might',
        dc: 17,
        rewardCoinsMult: 1.6,
        rewardXpMult: 1.6,
        dropChance: 0.62,
        failHpPct: 0.19,
        critFailHpPct: 0.36,
        successText:
          '你迎着撕裂星辰的暗影巨触悍然挥斩，硬生生劈断魔神前哨触须并震裂王座扶手！混沌深渊为你的狂猛血性剧烈震颤。',
        critSuccessText:
          '纯粹到极致的力量竟短暂撕裂了虚空法则！王座一角轰然崩塌，阿撒托斯的核心露出了罕见的裂隙！',
        failText:
          '暗影触须如深海巨鲸般沉重，反震力让你虎口渗血、连退数块浮石。',
        critFailText:
          '你奋力劈中一团虚空幻影收力不及，自己一头扎进暗紫星云里被电得浑身发麻。',
      },
    ],
    phase2Title: '终局时刻：终焉深渊裁决的灭世奇点',
    phase2Narrative:
      '堕落魔神·阿撒托斯彻底展露毁灭真容！星辰在它身后坍缩成一颗吞噬一切光明的暗黑奇点，无数破碎世界的残影在深渊漩涡中哀嚎旋转！毁灭万物的“终焉深渊裁决”已然降临——挥出凝聚全部传奇旅途的最后一击，向群星宣告凡人的胜利！',
    phase2Choices: [
      {
        id: 'boss6_p2_might',
        label: '燃尽战魂正面劈开灭世黑洞斩落魔神',
        detail: '以一往无前的凡人锋芒，将不可名状的终焉彻底斩为两段！',
        stat: 'might',
        dc: 17,
        rewardCoinsMult: 1.8,
        rewardXpMult: 1.8,
        dropChance: 1.0,
        failHpPct: 0.21,
        critFailHpPct: 0.38,
        successText:
          '你纵身跃入吞噬星光的暗黑风暴，倾尽毕生修为的一击悍然劈碎灭世奇点！灿烂金芒穿透深渊，阿撒托斯在无声崩解中彻底陨落！',
        critSuccessText:
          '超越神明想象的弑神绝斩！你的武器燃烧起群星余晖，一击将堕落魔神连同深渊王座劈成璀璨银河，整个黑吊国都将传颂你的威名！',
        failText:
          '黑洞引力撕扯着你的铠甲，这一击虽撼动了奇点却未能彻底贯穿，你咬紧牙关再次挺身而起！',
        critFailText:
          '时空乱流偏折了你的重斩，反冲星暴狠狠撞击胸口，你在剧痛中稳住重心绝不退缩！',
      },
      {
        id: 'boss6_p2_agility',
        label: '跨越事件视界以极速瞬杀刺穿混沌之核',
        detail: '只要速度超越深渊吞噬的光速，就能在奇点闭合前完成弑神！',
        stat: 'agility',
        dc: 17,
        rewardCoinsMult: 1.8,
        rewardXpMult: 1.8,
        dropChance: 1.0,
        failHpPct: 0.2,
        critFailHpPct: 0.37,
        successText:
          '你化作一道逆转星河的金色极光，在灭世奇点闭合前零点一息精准贯穿魔神真核！暗黑漩涡瞬间崩塌为漫天温柔星雨。',
        critSuccessText:
          '突破时间维度的神速一击！群星尚未反应过来，你已优雅收刃立于王座废墟之上，身后的混沌魔神轰然绽放为璀璨超新星！',
        failText:
          '事件视界边缘的时空阻力骤增，你虽逼近核心却被虚空波浪震退，仍握紧武器伺机再刺！',
        critFailText:
          '重力乱流将你甩偏了半尺，擦着混沌边缘摔在星骸上，狼狈滚起继续迎战！',
      },
      {
        id: 'boss6_p2_arcana',
        label: '重构创世星辰法阵以光明法则覆盖深渊',
        detail: '用最璀璨的奥术真理重写这片虚空，将混沌彻底放逐出界！',
        stat: 'arcana',
        dc: 17,
        rewardCoinsMult: 1.8,
        rewardXpMult: 1.8,
        dropChance: 1.0,
        failHpPct: 0.2,
        critFailHpPct: 0.37,
        successText:
          '亿万枚璀璨创世符文自你身后铺满星穹，辉煌光潮迎面吞噬终焉奇点！阿撒托斯在宇宙级奥术律令下分崩离析，归于寂静。',
        critSuccessText:
          '你竟在深渊尽头点燃了一颗崭新恒星！创世之光瞬间蒸发堕落魔神，破碎虚空为你凝聚出传世级别的星界秘宝与海量荣耀赏金！',
        failText:
          '深渊奇点疯狂吞噬了前排符文，魔力反震让你嘴角溢血，你迅速重绘法阵准备绝杀！',
        critFailText:
          '混沌法则扭曲了咒文末尾，法阵炸出一圈暗紫火花震伤了你自己。',
      },
      {
        id: 'boss6_p2_charm',
        label: '集结黑吊国万千羁绊信念宣判魔神终结',
        detail: '凡人的欢笑、热血与荒诞羁绊，才是深渊永远无法理解的终极奇迹！',
        stat: 'charm',
        dc: 17,
        rewardCoinsMult: 1.8,
        rewardXpMult: 1.8,
        dropChance: 1.0,
        failHpPct: 0.19,
        critFailHpPct: 0.36,
        successText:
          '你高举双手直面灭世深渊，旅途中所有荒诞欢笑与滚烫羁绊化作无尽金色光柱冲破黑暗！堕落魔神在温暖而耀眼的凡人奇迹中彻底瓦解！',
        critSuccessText:
          '万千星火化作金色羽翼为你加冕！阿撒托斯在漫天辉煌光雨中发出一声仿佛解脱的长叹，整个深渊王座坍缩为只属于你的传奇冠冕！',
        failText:
          '冷酷无情的深渊虚无试图冻结你的心火，你在剧烈精神冲击下稳住神智再度燃起光芒！',
        critFailText:
          '混沌笛音刺破耳膜打断了你的宣告，虚空浪潮扑面而来震伤了你的体魄！',
      },
    ],
    victoryEpilogue:
      '随着堕落魔神·阿撒托斯在璀璨星雨中彻底陨落，深渊王座的暗黑裂隙缓缓弥合，久违的纯净星河重新照耀苍穹。从哥布林密林的腐木哨卡一路走到宇宙尽头，你的名字已然化作黑吊国酒馆里最滚烫、也最不可思议的传奇史诗！',
  },
];

export const TABLETOP_BOSS_MAP: ReadonlyMap<number, TabletopBossActDef> = new Map(
  TABLETOP_BOSS_ACTS.map((boss) => [boss.chapter, boss]),
);

export function getScenesForChapter(chapter: number): readonly TabletopSceneDef[] {
  return TABLETOP_SCENES.filter(
    (scene) => scene.chapter === chapter || scene.chapter === 'shared',
  );
}
