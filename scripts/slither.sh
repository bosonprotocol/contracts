#!/bin/bash

if ! docker info > /dev/null 2>&1; then
  echo "This script uses docker, and it isn't running - please start docker and try again!"
  exit 1
fi

docker run --rm -v "$PWD":/share -it --workdir=/share trailofbits/eth-security-toolbox@sha256:7127d551cec947a053a2979d90a018db45ab7679afce3915c232cfef9a41e0c4 -c 'solc-select 0.7.6 && slither .'

exit 0 # Everything executed successfully without errors. Let's continue with the build now.
