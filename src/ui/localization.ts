export interface LocalizableBuilder<T> {
  setNameLocalizations(localizations: Record<string, string>): T;
  setDescriptionLocalizations?(localizations: Record<string, string>): T;
}

export function applyZhName<T extends LocalizableBuilder<T>>(
  builder: T,
  zhCn: string,
  zhTw?: string,
): T {
  return builder.setNameLocalizations({
    'zh-CN': zhCn,
    'zh-TW': zhTw ?? zhCn,
  });
}

export function applyZh<T extends LocalizableBuilder<T>>(
  builder: T,
  zhCnName: string,
  zhCnDesc?: string,
  zhTwName?: string,
  zhTwDesc?: string,
): T {
  builder.setNameLocalizations({
    'zh-CN': zhCnName,
    'zh-TW': zhTwName ?? zhCnName,
  });
  if (zhCnDesc && builder.setDescriptionLocalizations) {
    builder.setDescriptionLocalizations({
      'zh-CN': zhCnDesc,
      'zh-TW': zhTwDesc ?? zhCnDesc,
    });
  }
  return builder;
}
