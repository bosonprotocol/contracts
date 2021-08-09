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
    require("./scenarios/a-10-buyer-commit-refund-fault");
    require("./scenarios/b-11-buyer-commit-refund-fault-complain");
    require("./scenarios/c-12-buyer-commit-fault-complain");
    require("./scenarios/d-13-buyer-commit-expire");
    require("./scenarios/e-14-buyer-commit-seller-fault.js");
    require("./scenarios/f-15-buyer-commit-redeem-seller-fault-complain.js");
    require("./scenarios/g-16-buyer-commit-redeem-seller-fault.js");
    require("./scenarios/h-17-buyer-commit-expire-complain.js");
    require("./scenarios/i-18-buyer-commit-expire-complain-seller-fault.js");
    require("./scenarios/j-19-buyer-commit-expire-seller-fault-complain.js");
    require("./scenarios/k-20-buyer-commit-expire-seller-fault.js");
});
