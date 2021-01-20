class Accounts {
  constructor(accountSet) {
    this.accountSet = accountSet
  }

  get seller() {
    return this.accountSet[1]
  }

  get buyer() {
    return this.accountSet[2]
  }

  get attacker() {
    return this.accountSet[3]
  }
}

module.exports = Accounts
