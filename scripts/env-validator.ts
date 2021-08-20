const availableEnvironments = ['dev', 'demo', 'prod', 'hardhat'];

export const isValidEnv = (env: string): boolean => {
  return availableEnvironments.some((e) => e == env);
};
