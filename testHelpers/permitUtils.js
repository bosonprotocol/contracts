const {
  keccak256,
  defaultAbiCoder,
  toUtf8Bytes,
  solidityPack,
  AbiCoder,
  Interface,
} = require('ethers').utils;

const PERMIT_TYPEHASH = keccak256(
  toUtf8Bytes(
    'Permit(' +
      'address owner,' +
      'address spender,' +
      'uint256 value,' +
      'uint256 nonce,' +
      'uint256 deadline)'
  )
);

const toWei = (value) => {
  return value + '0'.repeat(18);
};

async function getApprovalDigest(
  token,
  owner,
  spender,
  value,
  nonce,
  deadline
) {
  const name = await token.name();
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address);

  return keccak256(
    solidityPack(
      ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
      [
        '0x19',
        '0x01',
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [
              PERMIT_TYPEHASH,
              owner,
              spender,
              value.toString(),
              nonce.toString(),
              deadline,
            ]
          )
        ),
      ]
    )
  );
}

function getDomainSeparator(name, tokenAddress) {
  return keccak256(
    defaultAbiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(
          toUtf8Bytes(
            'EIP712Domain(' +
              'string name,' +
              'string version,' +
              'uint256 chainId,' +
              'address verifyingContract)'
          )
        ),
        keccak256(toUtf8Bytes(name)),
        keccak256(toUtf8Bytes('1')),
        1,
        tokenAddress,
      ]
    )
  );
}

async function getEncodedTopic(receipt, abi, eventName) {
  const interface = new Interface(abi);
  for (const log in receipt.logs) {
    const topics = receipt.logs[log].topics;
    for (const index in topics) {
      const encodedTopic = topics[index];

      try {
        // CHECK IF TOPIC CORRESPONDS TO THE EVENT GIVEN TO FN
        let event = await interface.getEvent(encodedTopic);

        if (event.name === eventName) return encodedTopic;
      } catch (error) {
        // breaks silently as we do not need to do anything if the there is not
        // such an event
      }
    }
  }

  return '';
}

async function decodeData(receipt, encodedTopic, paramsArr) {
  const decoder = new AbiCoder();

  const encodedData = receipt.logs.filter((e) =>
    e.topics.includes(encodedTopic)
  )[0].data;

  return decoder.decode(paramsArr, encodedData);
}

module.exports = {
  PERMIT_TYPEHASH,
  toWei,
  getApprovalDigest,
  getEncodedTopic,
  decodeData,
};
