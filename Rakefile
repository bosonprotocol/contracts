require_relative 'lib/ganache'

task :default => :"contracts:compile"

namespace :ganache do
  task :start, [:port] do |_, args|
    port = args.port

    puts "Starting ganache on port #{port}..."
    ganache = Ganache.builder
        .on_port(port)
        .allowing_unlimited_contract_size
        .build
    ganache.start
    puts "Started ganache on port #{port}"
    puts "  - with pidfile at #{ganache.pidfile}"
    puts "  - with account keys file at #{ganache.account_keys_file}"
  end

  task :stop, [:port] do |_, args|
    port = args.port

    puts "Stopping ganache on port #{port}..."
    ganache = Ganache.builder
        .on_port(port)
        .build
    ganache.stop
    puts "Stopped ganache on port #{port}"
  end
end

namespace :contracts do
  desc "Compile all contracts"
  task :compile do
    sh('npm run compile')
  end
end

namespace :test do
  desc "Run all contract integration tests"
  task :integration do
    Ganache.on_available_port(
        allow_unlimited_contract_size: true) do |ganache|
      puts "Running integration tests against ganache node listening on " +
          "#{ganache.port}..."

      sh({
          "HOST" => "127.0.0.1",
          "PORT" => "#{ganache.port}",
          "ACCOUNT_KEYS_FILE" => "#{ganache.account_keys_file}"
      }, 'npm run test:integration')
    end
  end

  desc "Run test coverage for contract integration tests"
  task :coverage do
    puts "Running test coverage for contract integration tests..."
    sh('npm run test:coverage')
  end
end
