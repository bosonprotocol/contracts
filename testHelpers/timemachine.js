function advanceTimeBlocks(_blocks) {
    return new Promise(function(resolve) {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_mine",
            params: [_blocks],
            id: new Date().getTime()
        }, resolve);
    });
};

function advanceTimeSeconds(_seconds) {
    return new Promise(function(resolve) {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [_seconds],
            id: new Date().getTime()
        }, resolve);
    });
};


Object.assign(exports, {
  advanceTimeBlocks,
  advanceTimeSeconds
});