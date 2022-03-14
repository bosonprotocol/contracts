import {isValidEnv, getAddressesFilePath, GateTokenPair} from './utils';
import fs from 'fs';
import hre from 'hardhat';

export async function verifyContracts(env: string): Promise<void> {
  const contracts = JSON.parse(
    fs.readFileSync(
      getAddressesFilePath(hre.network.config.chainId, env, 'gates'),
      'utf-8'
    )
  );

  if (contracts.chainId != hre.network.config.chainId) {
    throw new Error(
      'Contracts are not deployed on the same network, that you are trying to verify!'
    );
  }

  if (!isValidEnv(env.toLowerCase())) {
    throw new Error(`Env: ${env} is not recognized!`);
  }

  const gates: GateTokenPair[] = contracts.gates;

  for (const gate of gates) {
    console.log(
      'Verifying Gate contract %s for conditional token %s of type %s  ',
      gate.gate,
      gate.token,
      gate.tokenType
    );

    //verify Gate
    try {
      await hre.run('verify:verify', {
        address: gate.gate,
        constructorArguments: [
          process.env.BOSON_ROUTER_ADDRESS,
          gate.token,
          gate.tokenType,
        ],
      });
    } catch (error) {
      logError('Gate', error.message);
    }
  }
}

function logError(contractName, msg) {
  console.log(
    `\x1b[31mError while trying to verify contract: ${contractName}!`
  );
  console.log(`Error message: ${msg}`);
  resetConsoleColor();
}

function resetConsoleColor() {
  console.log('\x1b[0m');
}
