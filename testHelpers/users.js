const fs = require('fs')

const defaultPrivateKeys = {
  "0xd9995bae12fee327256ffec1e3184d492bd94c31":
    "0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8",
  "0xd4fa489eacc52ba59438993f37be9fcc20090e39":
    "0x2030b463177db2da82908ef90fa55ddfcef56e8183caf60db464bc398e736e6f",
  "0x760bf27cd45036a6c486802d30b5d90cffbe31fe":
    "0x62ecd49c4ccb41a70ad46532aed63cf815de15864bc415c87d507afd6a5e8da2",
  "0x56a32fff5e5a8b40d6a21538579fb8922df5258c":
    "0xf473040b1a83739a9c7cc1f5719fab0f5bf178f83314d98557c58aae1910e03a",
  "0xfec44e15328b7d1d8885a8226b0858964358f1d6":
    "0x823d590ed2cb5e8493bb0efc834771c1cde36f9fc49b9fe3620ebd0754ad6ea2",
  "0xda8a06f1c910cab18ad187be1faa2b8606c2ec86":
    "0xd6d710943471e4c37ceb787857e7a2b41ca57f9cb4307ee9a9b21436a8e709c3",
  "0x8199de05654e9afa5c081bce38f140082c9a7733":
    "0x187bb12e927c1652377405f81d93ce948a593f7d66cfba383ee761858b05921a",
  "0x28bf45680ca598708e5cdacc1414fcac04a3f1ed":
    "0xf41486fdb04505e7966c8720a353ed92ce0d6830f8a5e915fbde735106a06d25",
  "0xf0508f89e26bd6b00f66a9d467678c7ed16a3c5a":
    "0x6ca40ba4cca775643398385022264c0c414da1abd21d08d9e7136796a520a543",
  "0x87e0ED760fb316eeb94Bd9cF23D1d2BE87aCe3d8":
    "0xfac0bc9325ad342033afe956e83f0bf8f1e863c1c3e956bc75d66961fe4cd186",
}

const userIndices = {
  deployer: 0,
  seller: 1,
  buyer: 2,
  attacker: 3,
  other1: 4,
  other2: 5
}

const loadPrivateKeys = accountKeysFile => {
  let privateKeys = defaultPrivateKeys

  if(accountKeysFile) {
    const accountKeysRaw = fs.readFileSync(accountKeysFile)
    const accountKeysJs = JSON.parse(accountKeysRaw)

    privateKeys = Object.fromEntries(
      Object.entries(accountKeysJs["private_keys"])
        .map(entry => [entry[0], `0x${entry[1]}`]))
  }

  return privateKeys
}

class Users {
  constructor(addresses) {
    this.addresses = addresses
    this.privateKeys = loadPrivateKeys(process.env.ACCOUNT_KEYS_FILE)
  }

  getAccountAtIndex(index) {
    const address = this.addresses[index]
    const privateKey = this.privateKeys[address.toLowerCase()]

    return { address, privateKey }
  }

  get deployer() {
    return this.getAccountAtIndex(userIndices.deployer)
  }

  get seller() {
    return this.getAccountAtIndex(userIndices.seller)
  }

  get buyer() {
    return this.getAccountAtIndex(userIndices.buyer)
  }

  get attacker() {
    return this.getAccountAtIndex(userIndices.attacker)
  }

  get other1() {
    return this.getAccountAtIndex(userIndices.other1)
  }

  get other2() {
    return this.getAccountAtIndex(userIndices.other2)
  }
}

module.exports = Users