const ethers = require('hardhat').ethers;

const eventNames = {
  LOG_ORDER_CREATED: 'LogOrderCreated',
  LOG_PROMISE_CREATED: 'LogPromiseCreated',
  LOG_VOUCHER_DELIVERED: 'LogVoucherDelivered',
  LOG_VOUCHER_REDEEMED: 'LogVoucherRedeemed',
  LOG_VOUCHER_REFUNDED: 'LogVoucherRefunded',
  LOG_VOUCHER_COMPLAIN: 'LogVoucherComplain',
  LOG_VOUCHER_FAULT_CANCEL: 'LogVoucherFaultCancel',
  LOG_EXPIRATION_TRIGGERED: 'LogExpirationTriggered',
  LOG_FINALIZED_VOUCHER: 'LogFinalizeVoucher',
  LOG_AMOUNT_DISTRIBUTION: 'LogAmountDistribution',
  LOG_FUNDS_RELEASED: 'LogFundsReleased',
  LOG_WITHDRAWAL: 'LogWithdrawal',
  LOG_COMPLAIN_PERIOD_CHANGED: 'LogComplainPeriodChanged',
  LOG_CANCEL_FAULT_PERIOD_CHANGED: 'LogCancelFaultPeriodChanged',
  TRANSFER_SINGLE: 'TransferSingle',
  TRANSFER: 'Transfer',
  TRANSFER_BATCH: 'TransferBatch',
  LOG_DISASTER_STATE_SET: 'LogDisasterStateSet',
  LOG_WITHDRAW_TOKENS_ON_DISASTER: 'LogWithdrawTokensOnDisaster',
  LOG_WITHDRAW_ETH_ON_DISASTER: 'LogWithdrawEthOnDisaster',
  LOG_ETH_LIMIT_CHANGED: 'LogETHLimitChanged',
  LOG_TOKEN_LIMIT_CHANGED: 'LogTokenLimitChanged',
  APPROVAL_FOR_ALL: 'ApprovalForAll',
  APPROVAL: 'Approval',
  LOG_BR_SET: 'LogBosonRouterSet',
  LOG_ERC1155_ERC721_SET: 'LogTokenContractSet',
  LOG_VK_SET: 'LogVoucherKernelSet',
  LOG_CASHIER_SET: 'LogCashierSet',
};

function getEventArgsFromFactory(factory, eventName) {
  let [eventFragment] = factory.interface.fragments.filter(
    (e) => e.name == eventName
  );
  return eventFragment.inputs.map((e) => e.name);
}

function getEventArgTypesFromFactory(factory, eventName) {
  let [eventFragment] = factory.interface.fragments.filter(
    (e) => e.name == eventName
  );
  return eventFragment.inputs
    .filter((e) => e.indexed != true)
    .map((e) => e.type);
}

function assertEventEmitted(receipt, factory, eventName, callback) {
  let found = false;

  let eventFragment = factory.interface.fragments.filter(
    (e) => e.name == eventName
  );
  const interface = new ethers.utils.Interface(eventFragment);

  for (const log in receipt.logs) {
    const topics = receipt.logs[log].topics;
    for (const index in topics) {
      const encodedTopic = topics[index];

      try {
        // CHECK IF TOPIC CORRESPONDS TO THE EVENT GIVEN TO FN
        let event = interface.getEvent(encodedTopic);

        if (event.name == eventName) {
          found = true;
          const eventArgs = interface.parseLog(receipt.logs[log]).args;
          try {
            callback(eventArgs);
          } catch (e) {
            throw new Error(e);
          }
        }
      } catch (e) {
        if (e.message.includes('no matching event')) continue;
        throw new Error(e);
      }
    }
  }

  if (!found) {
    throw new Error(`Event with name ${eventName} was not emitted!`);
  }
}

module.exports = {
  getEventArgsFromFactory,
  getEventArgTypesFromFactory,
  assertEventEmitted,
  eventNames,
};
