# Smart Contracts - Overview

This is a brief description of the smart contracts used in Boson Protocol. They 
are based on two NFT standards, 
[ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) and 
[ERC-721](https://eips.ethereum.org/EIPS/eip-721).  

Main contracts:  
* BosonRouter: creation of VoucherSets and Vouchers  
* BosonToken: ERC-20 contract for the native Boson Protocol token  
* Cashier: escrow management  
* ERC1155ERC721: token factory  
* VoucherKernel: main business logic  
* UsingHelpers: common utils as structures  

Supported currencies are currently ETH and BSN tokens therefore functions 
dealing with funds have appendices such as ETHETH or ETHTKN to denote the 
currencies used in that particular function (e.g. 
`function requestCreateOrderETHETH(uint256[] calldata metadata)`).  

## Transactions flow

The journey through the NFT lifecycle is presented on a simplified diagram 
below.  

![Simplified exchange mechanism](docs/assets/exchange-diagram-simplified.png)  

Voucher's status is defined in 7 bits that are set depending on the path in its 
lifecycle (defined in 
[UsingHelpers.sol](https://github.com/bosonprotocol/bsn-core-prototype/blob/master/contracts/UsingHelpers.sol#L29)):  

7:COMMITTED  
6:REDEEMED  
5:REFUNDED   
4:EXPIRED  
3:COMPLAINED  
2:CANCELORFAULT  
1:FINAL  

### Happy path

The process starts with Seller making an offer - minting a VoucherSet, which is 
represented as ERC-1155 token: `BosonRouter.requestCreateOrder()`. The Seller sets 
the expiration period of the whole VoucherSet.  

Then the Buyer purchases the Voucher, i.e. is committing to redeem it at some 
point later - this means an ERC-721 token is extracted from a VoucherSet: 
`BosonRouter.requestVoucher()`.  

The Buyer redeems the voucher, thus releasing the payment amount to the Seller: 
`VoucherKernel.redeem()`.  

After the two wait periods pass (the period within which Buyer can complain and 
the period within which Seller can admit cancel/fault), the Seller's deposit 
can be returned to the Seller and Buyer's deposit can be returned to the Buyer.  

A scheduled process is running in the backend that flags the vouchers when 
redemption was made and when wait periods expire. Anybody could be executing 
these functions, marked as external, the backend is currently running them for 
convenience: `VoucherKernel.triggerExpiration()`, 
`VoucherKernel.triggerFinalizeVoucher()`, `Cashier.withdraw()`.  