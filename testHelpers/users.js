const fs = require('fs');

const userIndices = {
  deployer: 0,
  seller: 1,
  buyer: 2,
  attacker: 3,
  other1: 4,
  other2: 5,
};

const loadPrivateKeys = (accountKeysFile) => {
  const accountKeysRaw = fs.readFileSync(accountKeysFile);
  const accountKeysJs = JSON.parse(accountKeysRaw);

  return Object.fromEntries(
    Object.entries(accountKeysJs['private_keys']).map((entry) => [
      entry[0],
      `0x${entry[1]}`,
    ])
  );
};

class Users {
  constructor(signers) {
    this.addresses = signers ? signers.map((e) => e.address) : null;
    this.privateKeys = loadPrivateKeys(
      process.env.ACCOUNT_KEYS_FILE || 'config/accounts.json'
    );
    this.signers = signers
      ? Object.fromEntries(
          this.addresses.map((address) => [
            address,
            signers.find((signer) => signer.address == address),
          ])
        )
      : null;
  }

  getAccountAtIndex(index) {
    const address = this.addresses[index];
    const privateKey = this.privateKeys[address];
    const signer = this.signers[address];

    return {address, privateKey, signer};
  }

  get deployer() {
    return this.getAccountAtIndex(userIndices.deployer);
  }

  get seller() {
    return this.getAccountAtIndex(userIndices.seller);
  }

  get buyer() {
    return this.getAccountAtIndex(userIndices.buyer);
  }

  get attacker() {
    return this.getAccountAtIndex(userIndices.attacker);
  }

  get other1() {
    return this.getAccountAtIndex(userIndices.other1);
  }

  get other2() {
    return this.getAccountAtIndex(userIndices.other2);
  }
}

module.exports = Users;
