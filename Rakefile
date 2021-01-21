require_relative 'lib/ganache'

task :default => [
    :"contracts:compile",
    :"contracts:lint_fix",
    :"contracts:format_fix",
    :"tests:lint_fix",
    :"tests:format_fix",
    :"tests:integration"
]

namespace :ganache do
  desc "Start ganache on provided port, default 8545"
  task :start, [:port] do |_, args|
    args.with_defaults(port: 8545)

    puts "Starting ganache on port #{args.port}..."
    ganache = Ganache.builder
        .on_port(args.port)
        .allowing_unlimited_contract_size
        .build
    ganache.start
    puts "Started ganache on port #{args.port}"
    puts "  - with pidfile at #{ganache.pidfile}"
    puts "  - with account keys file at #{ganache.account_keys_file}"
  end

  desc "Stop ganache on provided port, default 8545"
  task :stop, [:port] do |_, args|
    args.with_defaults(port: 8545)

    puts "Stopping ganache on port #{args.port}..."
    ganache = Ganache.builder
        .on_port(args.port)
        .build
    ganache.stop
    puts "Stopped ganache on port #{args.port}"
  end
end

namespace :contracts do
  desc "Compile all contracts"
  task :compile do
    sh('npm', 'run', 'contracts:compile')
  end

  desc "Lint all contracts"
  task :lint do
    sh('npm', 'run', 'contracts:lint')
  end

  desc "Lint & fix all contracts"
  task :lint_fix do
    sh('npm', 'run', 'contracts:lint-fix')
  end

  desc "Format all contracts"
  task :format do
    sh('npm', 'run', 'contracts:format')
  end

  desc "Format & fix all contracts"
  task :format_fix do
    sh('npm', 'run', 'contracts:format-fix')
  end
end

namespace :tests do
  desc "Lint all tests"
  task :lint do
    sh('npm', 'run', 'tests:lint')
  end

  desc "Lint & fix all tests"
  task :lint_fix do
    sh('npm', 'run', 'tests:lint-fix')
  end

  desc "Format all test files"
  task :format do
    sh('npm', 'run', 'tests:format')
  end

  desc "Format & fix all test files"
  task :format_fix do
    sh('npm', 'run', 'tests:format-fix')
  end

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
      }, 'npm', 'run', 'tests:integration')
    end
  end

  desc "Run test coverage for contract integration tests"
  task :coverage do
    puts "Running test coverage for contract integration tests..."
    sh(['npm', 'run', 'tests:coverage'])
  end
end
