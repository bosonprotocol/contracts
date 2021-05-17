/* This is the entry point to executing the e2e tests */

describe("GAME TREE SCENARIOS", function() {
    this.timeout(2000 * 1000)
    require("../testGameTree/1-seller-create");
    require("../testGameTree/2-seller-create-cancel");
    require("../testGameTree/3-buyer-commit");
    require("../testGameTree/4-buyer-commit-redeem");
    require("../testGameTree/5-buyer-commit-refund")
    require("../testGameTree/6-buyer-commit-redeem-complain");
    require("../testGameTree/7-buyer-commit-refund-complain");
    require("../testGameTree/8-buyer-commit-redeem-complain-seller-fault");
    require("../testGameTree/9-buyer-commit-refund-complain-seller-fault");
    // require("../testGameTree/9-buyer-commit-seller-fault");
});
