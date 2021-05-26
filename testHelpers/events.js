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
};

function findEventByName(txReceipt, eventName, ...eventFields) {
  for (const key in txReceipt.events) {
    if (txReceipt.events[key].event == eventName) {
      const event = txReceipt.events[key];

      const resultObj = {
        txHash: txReceipt.transactionHash,
      };

      for (let index = 0; index < eventFields.length; index++) {
        resultObj[eventFields[index]] = event.args[eventFields[index]];
      }
      return resultObj;
    }
  }
}

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
  let parsedEvent;

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
          parsedEvent = interface.parseLog(receipt.logs[log]).args;
        }
      } catch (error) {
        continue;
      }
    }
  }

  if (!found) {
    throw new Error(`Event with name ${eventName} was not emitted!`);
  }

  return callback(parsedEvent);
}

module.exports = {
  findEventByName,
  getEventArgsFromFactory,
  getEventArgTypesFromFactory,
  assertEventEmitted,
  eventNames,
};
