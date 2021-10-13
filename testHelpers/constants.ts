import {ethers} from 'hardhat';

const BN = ethers.BigNumber.from;

// common
const ONE_MINUTE = 60;
const SECONDS_IN_DAY = 86400;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO = BN(0);
const ONE = BN(1);
const TWO = BN(2);
const FOUR = BN(4);
const NINE = BN(9);
const ZERO_BYTES =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

// asset
const ASSET_VERSION = '0x3132';
const ASSET_TITLE = 'Dragon wizard hat';
const ASSET_TITLE2 = 'T-shirt dragons';
const ASSET_TITLE3 = 'T-shirt goblins';
const ASSET_PIN1 = 'I3DESK';
const ASSET_PIN2 = 'QBSOS';
const ASSET_QR1 = 'XYZ12';
const ASSET_QR2 = 'QWY43';
const ASSET_DESCRIPTION = 'mighty wizard hat, universal size';
const CATEGORY1 = 'entertainment.games.swag';
const CATEGORY2 = 'entertainment.games.shield';

// promise
let PROMISE_VALID_FROM: number; // evaluated based on the current block timestamp
let PROMISE_VALID_TO: number; // evaluated based on the PROMISE_VALID_FROM + 2 * SECONDS_IN_DAY
const PROMISE_PRICE1 = 10;
const PROMISE_PRICE2 = 21;
const PROMISE_DEPOSITSE1 = 1000000;
const PROMISE_DEPOSITSE2 = 5;
const PROMISE_DEPOSITBU1 = 1;
const PROMISE_DEPOSITBU2 = 2;
const PROMISE_CHALLENGE_PERIOD = 8;
const PROMISE_CANCELORFAULT_PERIOD = 8;

// order
const ORDER_QUANTITY1 = 1;
const ORDER_QUANTITY2 = 2;

const buyer_deposit = '40000000000000000'; // 0.04
const buyer_incorrect_deposit = '4000000000000000'; // 0.004
const seller_deposit = '50000000000000000'; // 0.05
const product_price = '300000000000000000'; // 0.3
const incorrect_product_price = '30000000000000000'; // 0.03
const QTY_10 = 10;
const QTY_15 = 15;
const QTY_20 = 20;
const QTY_1 = 1;

// fund limits
const ETHER_LIMIT = (5 * 10 ** 18).toString();
const ABOVE_ETH_LIMIT = (10 * 10 ** 18).toString();

const TOKEN_LIMIT = (5 * 10 ** 18).toString();
const ABOVE_TOKEN_LIMIT = (10 * 10 ** 18).toString();

const PROMISE_DATA_FIELDS = {} as any;
{
  let index = 0;
  const keys = ['promiseId', 'nonce', 'validFrom', 'validTo', 'idx'];
  for (const key of keys) {
    PROMISE_DATA_FIELDS[key] = index++;
  }
}

const VOUCHER_STATUS_FIELDS = {} as any;
{
  let index = 0;
  const keys = [
    'status',
    'isPaymentReleased',
    'isDepositsReleased',
    'complainPeriodStart',
    'cancelFaultPeriodStart',
  ];
  for (const key of keys) {
    VOUCHER_STATUS_FIELDS[key] = index++;
  }
}

const PROMISE_ORDER_FIELDS = {} as any;
{
  let index = 0;
  const keys = ['price', 'depositSe', 'depositBu'];
  for (const key of keys) {
    PROMISE_ORDER_FIELDS[key] = index++;
  }
}

const NFT_TOKEN_ID = BN('12345');
const EMPTY_NFT_TOKEN_ID = BN('0');
const VOUCHER_SET_ID = BN('54321');

export default {
  ASSET_VERSION,
  ASSET_TITLE,
  ASSET_TITLE2,
  ASSET_TITLE3,
  ASSET_PIN1,
  ASSET_PIN2,
  ASSET_QR1,
  ASSET_QR2,
  ASSET_DESCRIPTION,
  CATEGORY1,
  CATEGORY2,
  PROMISE_VALID_FROM,
  PROMISE_VALID_TO,
  PROMISE_PRICE1,
  PROMISE_PRICE2,
  PROMISE_DEPOSITSE1,
  PROMISE_DEPOSITSE2,
  PROMISE_DEPOSITBU1,
  PROMISE_DEPOSITBU2,
  PROMISE_CHALLENGE_PERIOD,
  PROMISE_CANCELORFAULT_PERIOD,
  ORDER_QUANTITY1,
  ORDER_QUANTITY2,
  ONE_MINUTE,
  SECONDS_IN_DAY,
  ZERO_ADDRESS,
  ZERO_BYTES,
  buyer_deposit,
  buyer_incorrect_deposit,
  seller_deposit,
  product_price,
  incorrect_product_price,
  QTY_1,
  QTY_10,
  QTY_15,
  QTY_20,
  ETHER_LIMIT,
  ABOVE_ETH_LIMIT,
  TOKEN_LIMIT,
  ABOVE_TOKEN_LIMIT,
  ZERO,
  ONE,
  TWO,
  FOUR,
  NINE,
  PROMISE_DATA_FIELDS,
  VOUCHER_STATUS_FIELDS,
  PROMISE_ORDER_FIELDS,
  NFT_TOKEN_ID,
  EMPTY_NFT_TOKEN_ID,
  VOUCHER_SET_ID,
};
