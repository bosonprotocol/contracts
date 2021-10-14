export default {
  balanceOf1155: 'balanceOf(' + 'address,' + 'uint256)',
  balanceOf721: 'balanceOf(' + 'address)',
  mint1155: 'mint(' + 'address,' + 'uint256,' + 'uint256,' + 'bytes)',
  mint721: 'mint(' + 'address,' + 'uint256)',
  safeTransfer1155:
    'safeTransferFrom(' +
    'address,' +
    'address,' +
    'uint256,' +
    'uint256,' +
    'bytes)',
  safeBatchTransfer1155:
    'safeBatchTransferFrom(' +
    'address,' +
    'address,' +
    'uint256[],' +
    'uint256[],' +
    'bytes)',
  safeTransfer721:
    'safeTransferFrom(' + 'address,' + 'address,' + 'uint256,' + 'bytes)',
  safeTransfer721WithNoData:
  'safeTransferFrom(' + 'address,' + 'address,' + 'uint256)',
  transfer721: 'transferFrom(' + 'address,' + 'address,' + 'uint256)',
  burn1155: 'burn(' + 'address,' + 'uint256,' + 'uint256)',
};
