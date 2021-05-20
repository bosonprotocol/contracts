/* This is the entry point to executing the game tree test scenarios */

describe("GAME TREE SCENARIOS", function() {
    this.timeout(2000 * 1000)
    require("./scenarios/1-seller-create");
    require("./scenarios/2-seller-create-cancel");
    require("./scenarios/3-buyer-commit");
    require("./scenarios/4-buyer-commit-redeem");
    require("./scenarios/5-buyer-commit-refund");
    require("./scenarios/6-buyer-commit-redeem-complain");
    require("./scenarios/7-buyer-commit-refund-complain");
    require("./scenarios/8-buyer-commit-redeem-complain-seller-fault");
    require("./scenarios/9-buyer-commit-refund-complain-seller-fault");
    require("./scenarios/a-buyer-commit-refund-fault");
    require("./scenarios/b-buyer-commit-refund-fault-complain");
    require("./scenarios/c-buyer-commit-fault-complain");
    require("./scenarios/d-buyer-commit-expiry");
});
