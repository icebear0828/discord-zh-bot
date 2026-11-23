export interface WelcomeTemplateVars {
  user: string;
  username: string;
  server: string;
  memberCount: number;
  inviter: string;
}

export function renderTemplate(template: string, vars: WelcomeTemplateVars): string {
  const tokenMap: Record<string, string> = {
    '{user}': vars.user,
    '{username}': vars.username,
    '{server}': vars.server,
    '{memberCount}': String(vars.memberCount),
    '{inviter}': vars.inviter,
  };

  return template.replace(
    /\{(user|username|server|memberCount|inviter)\}/g,
    (match) => tokenMap[match] ?? match,
  );
}
