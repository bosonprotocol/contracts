function advanceTimeBlocks(_blocks) {
  return new Promise(function (resolve) {
    web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_mine',
        params: [_blocks],
        id: new Date().getTime(),
      },
      resolve
    );
  });
}

function advanceTimeSeconds(_seconds) {
  return new Promise(function (resolve) {
    web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [_seconds],
        id: new Date().getTime(),
      },
      resolve
    );
  });
}

function takeSnapshot() {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_snapshot',
        id: new Date().getTime(),
      },
      (err, snapshotId) => {
        if (err) {
          return reject(err);
        }
        return resolve(snapshotId);
      }
    );
  });
}

function revertToSnapShot(id) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: '2.0',
        method: 'evm_revert',
        params: [id],
        id: new Date().getTime(),
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      }
    );
  });
}

Object.assign(exports, {
  advanceTimeBlocks,
  advanceTimeSeconds,
  takeSnapshot,
  revertToSnapShot,
});
