import {ethers} from 'hardhat';

export async function advanceTimeSeconds(_seconds) {
  await ethers.provider.send('evm_increaseTime', [_seconds]);
  await ethers.provider.send('evm_mine', []);
}



// Object.assign(exports, {
//   advanceTimeSeconds,
// });
