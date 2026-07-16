export const SERVER_ENV_MAP = {
  LEDGER_BACKEND: 'ledger_backend',
  LEDGER_BRANCH: 'ledger_branch',
};

export function envToUserConfig(env = process.env) {
  const userConfig = {};
  for (const [envKey, configKey] of Object.entries(SERVER_ENV_MAP)) {
    const value = env[envKey];
    if (typeof value === 'string' && value.length > 0) {
      userConfig[configKey] = value;
    }
  }
  return userConfig;
}
