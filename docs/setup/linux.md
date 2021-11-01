# Machine Setup - Linux

## Requirements

In order for the build to run correctly, a few tools will need to be installed
on your development machine:

* git
* Node (12.20.x)
* NPM (7)

## Installation

Installing the required tools is dependent on your distribution. In this guide,
we assume a Debian based distribution.

### git

To install git:

```shell script
apt-get install git
```

### Node & NPM

To install Node & NPM:

```shell script
apt-get update
apt-get install curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.37.2/install.sh | bash
mkdir ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.bashrc
exec $SHELL
nvm install 12.20
nvm use 12.20
```

Note: if you use zsh instead of bash, change `~/.bashrc` above to `~/.zshrc`. 
