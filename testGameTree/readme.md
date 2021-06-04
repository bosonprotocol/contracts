# GAME TREE SCENARIOS
#### These tests cover the overall game tree scenarios
The tests run against Rinkeby and perform assertions on event parameters. Because the provider sometimes misses events, test scenarios occassionally randomly fail with the message
about not being able to reference `returnValues` on `undefined`. If this happens, re-run the test.

The tests can also be run locally by deploying to a local ganache instance and then configuring  local contract addresses and buyer/seller addresses and private keys in config.js.
Comment out the Rinkeby provider and uncomment the local provider.  The tests to not use the "time machine" utility to advance time or blocks, so scenario 13 does not always run properly
against a local ganache instance.

### How To Run

- Install the dependencies: `npm install`.
- Copy `testGameTree/helpers/config.example.js` to  `testGameTree/helpers/config.js` and update it with current Rinkeby contract addresses.
- Compile the contracts: `truffle compile`. 
- To run tests:
    - Run the tests with saving the logs: `npm run test:gametree >> log.txt`.
        - These logs can be found in `log.txt`.
    - Run the tests without saving the logs `npm run test:gametree`.

### Scenarios

| SCENARIO    | ⚙ ACTION   | DESCRIPTION                                             |
| ----------- | ---------- | ------------------------------------------------------  |
| SCENARIO 01 | 💁‍LISTING  |SELLER LISTS A VOUCHER FOR SALE                          |
| SCENARIO 02 | 🙅‍CANCEL   |SELLER CANCELS A VOUCHER SET                             |
| SCENARIO 03 | 💰COMMIT   |BUYER PURCHASES A VOUCHER                                |
| SCENARIO 04 | 🎫REDEEM   |BUYER REDEEMS A COMMITTED VOUCHER                        |
| SCENARIO 05 | 💸REFUND   |BUYER CLAIMS REFUND FOR A COMMITTED VOUCHER              |
| SCENARIO 06 | 🙋‍COMPLAIN |BUYER COMPLAINS ABOUT REDEEMED VOUCHER                   |
| SCENARIO 07 | 🙋‍COMPLAIN |BUYER COMPLAINS ABOUT REFUND VOUCHER                     |
| SCENARIO 08 | 🤦‍FAULT    |SELLER ACCEPTS REDEEM FAULT ON COMPLAIN                  |
| SCENARIO 09 | 🤦‍FAULT    |SELLER ACCEPTS REFUND FAULT ON COMPLAIN                  |
| SCENARIO 10 | 🤦‍FAULT    |SELLER ACCEPTS REFUND FAULT                              |
| SCENARIO 11 | 🙋‍COMPLAIN |BUYER COMPLAINS ABOUT REFUNDED AND FAULTED VOUCHER       |
| SCENARIO 12 | 🙋‍COMPLAIN |BUYER COMPLAINS ABOUT FAULTED BUT NOT REDEEMED VOUCHER   |
| SCENARIO 13 | ⏰EXPIRE   |BUYER LETS VOUCHER EXPIRE                                |



### Sample partial test output
```angular2html

> y@1.0.0 test D:\GitHub\contracts
> mocha



  createdVoucherSetID │ 57896044618658097711785492504343953931398945469713420508216036508001319780352 │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ nftSupply           │ 10                                                                            │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ nftSeller           │ 0x91b46A76b9B960d8d614973B8dcD3a4d0A256892                                    │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ paymentType         │ 1                                                                             │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ operator            │ 0xbf688B302622955f6ADE9D14DE370Bc546bA57eA                                    │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ transferFrom        │ 0x0000000000000000000000000000000000000000                                    │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ transferTo          │ 0x91b46A76b9B960d8d614973B8dcD3a4d0A256892                                    │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ transferValue       │ 10                                                                            │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasPaid             │ 1000847                                                                       │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasUsed             │ 398946                                                                        │
└─────────────────────┴───────────────────────────────────────────────────────────────────────────────┘
      ✓ TEST SCENARIO 09 :: SELLER CREATE :: 1.0 Seller creates a voucher set (21015ms)
      ✓ TEST SCENARIO 09 :: SELLER CREATE :: 1.1 VALIDATE VALID FROM
      ✓ TEST SCENARIO 09 :: SELLER CREATE :: 1.2 VALIDATE VALID TO
      ✓ TEST SCENARIO 09 :: SELLER CREATE :: 1.3 VALIDATE ORDER QUANTITY
      ✓ TEST SCENARIO 09 :: SELLER CREATE :: 1.4 VALIDATE SELLER
      ✓ TEST SCENARIO 09 :: SELLER CREATE :: 1.5 VALIDATE PAYMENT TYPE
      ✓ TEST SCENARIO 09 :: SELLER CREATE :: 1.6 VALIDATE ERC1155ERC721 DATA
┌──────────────┬────────────────────────────────────────────┬──────────────┐
│ ACCOUNT TYPE │ ADDRESS                                    │ ETH VALUE    │
├──────────────┼────────────────────────────────────────────┼──────────────┤
│ SELLER       │ 0x91b46A76b9B960d8d614973B8dcD3a4d0A256892 │ 22.442990718 │
├──────────────┼────────────────────────────────────────────┼──────────────┤
│ BUYER        │ 0xb00FF8BA574E089082473cD435aF4e8b71f42DA6 │ 23.895928351 │
└──────────────┴────────────────────────────────────────────┴──────────────┘
Transaction Hash : 0xb6fe3c2dbf06552c5691f6165e52984f9f2251269473eb0b6c7d483d05675a2e
┌─────────────────┬───────────────────────────────────────────────────────────────────────────────┐
│ PARAMETER       │ VALUE                                                                         │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ TransactionHash │ 0xb6fe3c2dbf06552c5691f6165e52984f9f2251269473eb0b6c7d483d05675a2e            │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ VoucherSetID    │ 57896044618658097711785492504343953931398945469713420508216036508001319780352 │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ MintedVoucherID │ 57896044618658097711785492504343953931398945469713420508216036508001319780353 │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ issuer          │ 0x91b46A76b9B960d8d614973B8dcD3a4d0A256892                                    │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ holder          │ 0xb00FF8BA574E089082473cD435aF4e8b71f42DA6                                    │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ promiseID       │ 0x6ab177969a30721aacdae5de3d19ca0abced906fbf96f27726abaeb2e08060de            │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasPaid         │ 1000847                                                                       │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasUsed         │ 172501                                                                        │
└─────────────────┴───────────────────────────────────────────────────────────────────────────────┘
      ✓ TEST SCENARIO 09 :: BUYER COMMITS :: 2.0 Buyer commits to purchases a voucher (29984ms)
      ✓ TEST SCENARIO 09 :: BUYER COMMITS :: 2.1 VALIDATE ISSUER
      ✓ TEST SCENARIO 09 :: BUYER COMMITS :: 2.2 VALIDATE HOLDER
┌──────────────┬────────────────────────────────────────────┬──────────────┐
│ ACCOUNT TYPE │ ADDRESS                                    │ ETH VALUE    │
├──────────────┼────────────────────────────────────────────┼──────────────┤
│ SELLER       │ 0x91b46A76b9B960d8d614973B8dcD3a4d0A256892 │ 22.442990718 │
├──────────────┼────────────────────────────────────────────┼──────────────┤
│ BUYER        │ 0xb00FF8BA574E089082473cD435aF4e8b71f42DA6 │ 23.89120583  │
└──────────────┴────────────────────────────────────────────┴──────────────┘
Transaction Hash : 0x487d9c9da7d0c2396786f6db1a230f178a32c98c2a6ccc4e5dbb47e6980e7ebf
┌───────────────────┬───────────────────────────────────────────────────────────────────────────────┐
│ PARAMETER         │ VALUE                                                                         │
├───────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ refundedVoucherID │ 57896044618658097711785492504343953931398945469713420508216036508001319780353 │
├───────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasPaid           │ 90222                                                                         │
├───────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasUsed           │ 90222                                                                         │
└───────────────────┴───────────────────────────────────────────────────────────────────────────────┘
      ✓ TEST SCENARIO 09 :: BUYER REFUNDS :: 3.0 Buyer refunds a purchased voucher (29952ms)
      ✓ TEST SCENARIO 09 :: SELLER CREATE :: 3.1 VALIDATE REFUNDED VOUCHER
┌──────────────┬────────────────────────────────────────────┬──────────────┐
│ ACCOUNT TYPE │ ADDRESS                                    │ ETH VALUE    │
├──────────────┼────────────────────────────────────────────┼──────────────┤
│ SELLER       │ 0x91b46A76b9B960d8d614973B8dcD3a4d0A256892 │ 22.442990718 │
├──────────────┼────────────────────────────────────────────┼──────────────┤
│ BUYER        │ 0xb00FF8BA574E089082473cD435aF4e8b71f42DA6 │ 23.889311168 │
└──────────────┴────────────────────────────────────────────┴──────────────┘
Transaction Hash : 0x69743173dcd4da4e87fee2d9d1573c2f79d913e42ecc87fe35dd11a86f9d7064
┌─────────────────────┬───────────────────────────────────────────────────────────────────────────────┐
│ PARAMETER           │ VALUE                                                                         │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ complainedVoucherID │ 57896044618658097711785492504343953931398945469713420508216036508001319780353 │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasPaid             │ 1000847                                                                       │
├─────────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasUsed             │ 97620                                                                         │
└─────────────────────┴───────────────────────────────────────────────────────────────────────────────┘
      ✓ TEST SCENARIO 09 :: BUYER COMPLAINS :: 4.0 Buyer complains a refunded voucher (14806ms)
      ✓ TEST SCENARIO 09 :: BUYER COMPLAINS :: 4.1 VALIDATE COMPLAINED VOUCHER
┌──────────────┬────────────────────────────────────────────┬──────────────┐
│ ACCOUNT TYPE │ ADDRESS                                    │ ETH VALUE    │
├──────────────┼────────────────────────────────────────────┼──────────────┤
│ SELLER       │ 0x91b46A76b9B960d8d614973B8dcD3a4d0A256892 │ 22.442990718 │
├──────────────┼────────────────────────────────────────────┼──────────────┤
│ BUYER        │ 0xb00FF8BA574E089082473cD435aF4e8b71f42DA6 │ 23.887261148 │
└──────────────┴────────────────────────────────────────────┴──────────────┘
Transaction Hash : 0x1fd2824692b761807bd960165ec34cedec569b3ac9fc35cb6f282e5cf1b74719
┌──────────────────┬───────────────────────────────────────────────────────────────────────────────┐
│ PARAMETER        │ VALUE                                                                         │
├──────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ TransactionHash  │ 0x1fd2824692b761807bd960165ec34cedec569b3ac9fc35cb6f282e5cf1b74719            │
├──────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ FaultedVoucherID │ 57896044618658097711785492504343953931398945469713420508216036508001319780353 │
├──────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasPaid          │ 1000847                                                                       │
├──────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ gasUsed          │ 63656                                                                         │
├──────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ status           │ true                                                                          │
└──────────────────┴───────────────────────────────────────────────────────────────────────────────┘
      ✓ TEST SCENARIO 09 :: SELLER FAULTS :: 5.0 Seller faults a complained voucher (29942ms)
      ✓ TEST SCENARIO 09 :: SELLER FAULTS :: 5.1 VALIDATE FAULTED VOUCHER
┌──────────────┬────────────────────────────────────────────┬────────────────────┐
│ ACCOUNT TYPE │ ADDRESS                                    │ ETH VALUE          │
├──────────────┼────────────────────────────────────────────┼────────────────────┤
│ SELLER       │ 0x91b46A76b9B960d8d614973B8dcD3a4d0A256892 │ 22.441653942000002 │
├──────────────┼────────────────────────────────────────────┼────────────────────┤
│ BUYER        │ 0xb00FF8BA574E089082473cD435aF4e8b71f42DA6 │ 23.887261148       │
└──────────────┴────────────────────────────────────────────┴────────────────────┘


  16 passing (2m)



```