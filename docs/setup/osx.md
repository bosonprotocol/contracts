# Machine Setup - OS X

## Requirements

In order for the build to run correctly, a few tools will need to be installed
on your development machine:

* git
* direnv
* Node (12.20)
* NPM (7)
* Ruby (2.7)
* Bundler (> 2)

## Installation

Installing the required tools is best managed by [homebrew](http://brew.sh).

To install homebrew:

```
ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
```

### git & direnv

To install git:

```shell script
brew install git
```

To install direnv:

```shell script
brew install direnv
echo "$(direnv hook zsh)" >> ~/.zshrc
exec $SHELL

direnv allow <repository-directory>
```

Note: if you use bash instead of zsh, change `~/.zshrc` above to `~/.bashrc`
and use `direnv hook bash`.

### Node & NPM

To install Node & NPM:

```shell script
brew install nvm
mkdir ~/.nvm
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "/usr/local/opt/nvm/nvm.sh" ] && . "/usr/local/opt/nvm/nvm.sh"' >> ~/.zshrc
echo '[ -s "/usr/local/opt/nvm/etc/bash_completion.d/nvm" ] && . "/usr/local/opt/nvm/etc/bash_completion.d/nvm"' >> ~/.zshrc
exec $SHELL
nvm install 10.23.0
nvm use 10.23.0
```

Note: if you use bash instead of zsh, change `~/.zshrc` above to `~/.bashrc`

### Ruby & Bundler

To install Ruby and bundler:

```shell script
brew install rbenv
brew install ruby-build
echo 'eval "$(rbenv init - zsh)"' >> ~/.zshrc
exec $SHELL
rbenv install 2.7.2
rbenv rehash
rbenv local 2.7.2
gem install bundler
```

Note: if you use bash instead of zsh, change `~/.zshrc` above to `~/.bashrc`
and use `rbenv init - bash`.
