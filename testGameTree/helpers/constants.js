//common
const SECONDS_IN_DAY = 86400;
const SECONDS_IN_A_MINUTE = 60;

// promise
const PROMISE_VALID_FROM = ''; // evaluated based on the current block timestamp
const PROMISE_VALID_TO = ''; // evaluated based on the PROMISE_VALID_FROM + 2 * SECONDS_IN_DAY
const PROMISE_PRICE1 = 1000000000000000;
const PROMISE_DEPOSITSE1 = 100000000000000;
const PROMISE_DEPOSITBU1 = 100000000000000;
const PROMISE_CHALLENGE_PERIOD = 8;
const PROMISE_CANCELORFAULT_PERIOD = 8;

// order
const ORDER_QUANTITY1 = 10;
const ORDER_QUANTITY2 = 1;

const buyer_deposit = '1000000000000000'; //
const buyer_incorrect_deposit = '4000000000000000'; // 0.004
const seller_deposit = '1000000000000000'; // 0.05  // 0.0000000000000001 //0.0001
const product_price = '300000000000000000'; // 0.3
const incorrect_product_price = '30000000000000000'; // 0.03
const QTY_10 = 10;
const QTY_15 = 15;
const QTY_20 = 20;
const QTY_1 = 1;


module.exports = {
    SECONDS_IN_DAY,
    SECONDS_IN_A_MINUTE,
    PROMISE_VALID_FROM,
    PROMISE_VALID_TO,
    PROMISE_PRICE1,
    PROMISE_DEPOSITSE1,
    PROMISE_DEPOSITBU1,
    PROMISE_CHALLENGE_PERIOD,
    PROMISE_CANCELORFAULT_PERIOD,
    ORDER_QUANTITY1,
    ORDER_QUANTITY2,
    buyer_deposit,
    buyer_incorrect_deposit,
    seller_deposit,
    product_price,
    incorrect_product_price,
    QTY_1,
    QTY_10,
    QTY_15,
    QTY_20
};
