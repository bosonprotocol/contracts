// SPDX-License-Identifier: LGPL-3.0-or-later

pragma solidity 0.7.6;

interface IUsingHelpers {
    // Those are the payment methods we are using throughout the system.
    // Depending on how to user choose to interact with it's funds we store the method, so we could distribute its tokens afterwise
    enum PaymentMethod {
        ETHETH,
        ETHTKN,
        TKNETH,
        TKNTKN
    }
}
