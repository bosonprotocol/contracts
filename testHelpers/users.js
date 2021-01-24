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
  constructor(addresses) {
    this.addresses = addresses;
    this.privateKeys = loadPrivateKeys(
      process.env.ACCOUNT_KEYS_FILE || 'config/accounts.json'
    );
  }

  getAccountAtIndex(index) {
    const address = this.addresses[index];
    const privateKey = this.privateKeys[address.toLowerCase()];

    return {address, privateKey};
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
