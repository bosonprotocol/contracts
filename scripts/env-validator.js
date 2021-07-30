const availableEnvironments = ['dev', 'demo', 'prod', 'hardhat'];

const isValidEnv = (env) => {
  return availableEnvironments.some((e) => e == env);
};

module.exports = {
  isValidEnv,
};
