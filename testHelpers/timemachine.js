const ethers = require('hardhat').ethers;

async function advanceTimeSeconds(_seconds) {
  await ethers.provider.send('evm_increaseTime', [_seconds]);
  await ethers.provider.send('evm_mine');
}

Object.assign(exports, {
  advanceTimeSeconds,
});
