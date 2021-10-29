# Machine Setup - OS X

## Requirements

In order for the build to run correctly, a few tools will need to be installed
on your development machine:

* git
* Node (12.20)
* NPM (7)

## Installation

Installing the required tools is best managed by [homebrew](http://brew.sh).

To install homebrew:

```
ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
```

### git

To install git:

```shell script
brew install git
```

### Node & NPM

To install Node & NPM:

```shell script
brew install nvm
mkdir ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/usr/local/opt/nvm/nvm.sh" ] && . "/usr/local/opt/nvm/nvm.sh"' >> ~/.zshrc
echo '[ -s "/usr/local/opt/nvm/etc/bash_completion.d/nvm" ] && . "/usr/local/opt/nvm/etc/bash_completion.d/nvm"' >> ~/.zshrc
exec $SHELL
nvm install 12.20
nvm use 12.20
```

Note: if you use bash instead of zsh, change `~/.zshrc` above to `~/.bashrc`
