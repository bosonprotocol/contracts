/* This is the entry point to executing the e2e tests */

describe("GAME TREE SCENARIOS", function() {
    this.timeout(2000 * 1000)
    require("../actions/1-seller-create");
    require("../actions/2-seller-create-cancel");
    require("../actions/3-buyer-commit");
    require("../actions/4-buyer-commit-redeem");
    require("../actions/5-buyer-commit-refund")
    require("../actions/6-buyer-commit-redeem-complain");
    require("../actions/7-buyer-commit-refund-complain");
    require("../actions/8-buyer-commit-redeem-complain-seller-fault");
    require("../actions/9-buyer-commit-refund-complain-seller-fault");
    // require("../actions/9-buyer-commit-seller-fault");
});
