require 'childprocess'
require 'random-port'
require 'fileutils'

module Ganache
  def self.builder
    Builder.new
  end

  def self.on_available_port(options = {}, &block)
    RandomPort::Pool.new.acquire do |port|
      begin
        instance = Builder.new(options.merge(port: port)).build
        instance.start
        block.call(instance)
      ensure
        instance.stop
      end
    end
  end

  class Instance
    attr_reader(
        :binary,
        :port,
        :account_keys_directory,
        :pidfile_directory,
        :allow_unlimited_contract_size)

    def initialize(options)
      @binary = options[:binary]
      @port = options[:port]
      @account_keys_directory = options[:account_keys_directory]
      @pidfile_directory = options[:pidfile_directory]
      @allow_unlimited_contract_size = options[:allow_unlimited_contract_size]

      @started = false
    end

    def started?
      @started
    end

    def pidfile
      "#{@pidfile_directory}/ganache-#{@port}.pid"
    end

    def account_keys_file
      "#{@account_keys_directory}/accounts-#{@port}.json"
    end

    def start
      FileUtils.mkdir_p(@pidfile_directory)
      FileUtils.mkdir_p(@account_keys_directory)

      command = [@binary, '--port', @port.to_s]
      if @allow_unlimited_contract_size
        command = command.concat(['--allowUnlimitedContractSize'])
      end
      if @account_keys_directory
        command = command.concat(['--acctKeys', account_keys_file])
      end

      process = ChildProcess.build(*command)
      # process.io.inherit!
      process.leader = true
      process.detach = true
      process.start

      File.open(pidfile, "w") { |pidfile| pidfile.write(process.pid) }

      @started = true
    end

    def stop
      pid = File.read(pidfile).to_i

      Process.kill('INT', pid)
      File.unlink(pidfile)
      File.unlink(account_keys_file)

      @started = false
    end
  end

  class Builder
    def initialize(options = {})
      @binary = options[:binary] || './node_modules/.bin/ganache-cli'
      @port = options[:port] || 8545
      @pidfile_directory = options[:pidfile_directory] || 'run/pid'
      @account_keys_directory =
          options[:account_keys_directory] || 'build/ganache'
      @allow_unlimited_contract_size =
          options[:allow_unlimited_contract_size] || false
    end

    def clone(options)
      Builder.new(to_h.merge(options))
    end

    def on_port(port)
      clone(port: port)
    end

    def allowing_unlimited_contract_size
      clone(allow_unlimited_contract_size: true)
    end

    def saving_account_keys_to(directory)
      clone(account_keys_directory: directory)
    end

    def saving_pidfile_to(directory)
      clone(pidfile_directory: directory)
    end

    def build
      Instance.new(to_h)
    end

    def to_h
      {
          binary: @binary,
          port: @port,
          pidfile_directory: @pidfile_directory,
          account_keys_directory: @account_keys_directory,
          allow_unlimited_contract_size: @allow_unlimited_contract_size
      }
    end
  end
end
