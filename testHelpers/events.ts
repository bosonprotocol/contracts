import {ethers} from 'hardhat';

export const eventNames = {
  LOG_ORDER_CREATED: 'LogOrderCreated',
  LOG_CONDITIONAL_ORDER_CREATED: 'LogConditionalOrderCreated',
  LOG_PROMISE_CREATED: 'LogPromiseCreated',
  LOG_VOUCHER_DELIVERED: 'LogVoucherCommitted',
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
  LOG_CANCEL_VOUCHER_SET: 'LogVoucherSetFaultCancel',
  PAUSED: 'Paused',
  UNPAUSED: 'Unpaused',
  LOG_NON_TRANSFERABLE_CONTRACT: 'LogNonTransferableContractSet',
  LOG_BOSON_ROUTER_SET: 'LogBosonRouterSet',
  LOG_GATE_APPROVAL_CHANGED: 'LogGateApprovalChanged',
  LOG_VOUCHER_SET_REGISTERED: 'LogVoucherSetRegistered',
  LOG_USER_VOUCHER_DEACTIVATED: 'LogUserVoucherDeactivated',
  LOG_TOKEN_WRAPPER_CHANGED: 'LogTokenWrapperChanged',
  LOG_TOKEN_ADDRESS_CHANGED: 'LogTokenAddressChanged',
  LOG_PERMIT_CALLED_ON_TOKEN: 'LogPermitCalledOnToken',
  LOG_URI_SET: 'LogUriSet',
  USED_NONCE: 'UsedNonce',
  EXECUTED_META_TX: 'ExecutedMetaTransaction',
  LOG_TOKEN_REGISTRY_SET: 'LogTokenRegistrySet',
  LOG_VOUCHER_SET_TOKEN_SET: 'LogVoucherSetTokenContractSet',
  LOG_VOUCHER_TOKEN_SET: 'LogVoucherTokenContractSet',
  LOG_CONTRACT_URI_SET: 'LogContractUriSet',
};

import {ContractFactory, ContractReceipt} from 'ethers';
import {DistributionEvent} from './types';

type callBack = (eventArgs: DistributionEvent | any) => void;

export function getEventArgsFromFactory(
  factory: ContractFactory,
  eventName: string
): Array<string> {
  const [eventFragment] = factory.interface.fragments.filter(
    (e) => e.name == eventName
  );
  return eventFragment.inputs.map((e) => e.name);
}

export function getEventArgTypesFromFactory(
  factory: ContractFactory,
  eventName: string
): Array<string> {
  const [eventFragment] = factory.interface.fragments.filter(
    (e) => e.name == eventName
  );
  return eventFragment.inputs
    .filter((e) => e.indexed != true)
    .map((e) => e.type);
}

export function assertEventEmitted(
  receipt: ContractReceipt,
  factory: ContractFactory,
  eventName: string,
  callback: callBack
): void {
  let found = false;

  const eventFragment = factory.interface.fragments.filter(
    (e) => e.name == eventName
  );
  const iface = new ethers.utils.Interface(eventFragment);

  for (const log in receipt.logs) {
    const topics = receipt.logs[log].topics;

    for (const index in topics) {
      const encodedTopic = topics[index];

      try {
        // CHECK IF TOPIC CORRESPONDS TO THE EVENT GIVEN TO FN
        const event = iface.getEvent(encodedTopic);

        if (event.name == eventName) {
          found = true;
          const eventArgs = iface.parseLog(receipt.logs[log]).args;
          callback(eventArgs);
        }
      } catch (e) {
        if (e.message.includes('no matching event')) continue;
        console.log('event error: ', e);
        throw new Error(e);
      }
    }
  }

  if (!found) {
    throw new Error(`Event with name ${eventName} was not emitted!`);
  }
}
