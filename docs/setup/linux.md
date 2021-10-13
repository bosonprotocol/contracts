# Machine Setup - Linux

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

Installing the required tools is dependent on your distribution. In this guide,
we assume a Debian based distribution.

### git & direnv

To install git:

```shell script
apt-get install git
```

To install direnv:

```shell script
apt-get install direnv
echo "$(direnv hook bash)" >> ~/.bashrc
exec $SHELL

direnv allow <repository-directory>
```

Note: if you use zsh instead of bash, change `~/.bashrc` above to `~/.zshrc`
and use `direnv hook zsh`.

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
nvm install 10.23.0
nvm use 10.23.0
```

Note: if you use zsh instead of bash, change `~/.bashrc` above to `~/.zshrc`. 

### Ruby & Bundler

To install Ruby and bundler:

```shell script
apt-get update
apt-get install \
  git curl libssl-dev libreadline-dev zlib1g-dev \
  autoconf bison build-essential libyaml-dev \
  libreadline-dev libncurses5-dev libffi-dev libgdbm-dev
curl -fsSL https://github.com/rbenv/rbenv-installer/raw/master/bin/rbenv-installer | bash
echo 'export PATH="$PATH:~/.rbenv/bin"' >> ~/.bashrc
echo 'eval "$(rbenv init - bash)"' >> ~/.bashrc
exec $SHELL
rbenv install 2.7.2
rbenv rehash
rbenv local 2.7.2
gem install bundler
```

Note: if you use zsh instead of bash, change `~/.bashrc` above to `~/.zshrc`
and use `rbenv init - zsh`.

Note: if you use Fedora, see installation instructions at 
[Installing Ruby and Rails with rbenv](https://developer.fedoraproject.org/start/sw/web-app/rails.html).
