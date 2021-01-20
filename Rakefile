require 'random-port'
require 'childprocess'

task :default => :"contracts:compile"

namespace :ganache do
  task :start, [:port] do |_, args|
    port = args.port.to_s

    puts "Starting ganache on port #{port}..."
    process = ChildProcess.build(
        './node_modules/.bin/ganache-cli',
        '--allowUnlimitedContractSize',
        '-p', port)
    # process.io.inherit!
    process.leader = true
    process.detach = true
    process.start

    FileUtils.mkdir_p('run/pid')
    File.open("run/pid/ganache-#{port}.pid", "w") do |pidfile|
      pidfile.write(process.pid)
    end
  end

  task :stop, [:port] do |_, args|
    port = args.port.to_s

    puts "Stopping ganache on port #{port}..."
    pid = File.read("run/pid/ganache-#{port}.pid").to_i

    Process.kill('INT', pid)
    File.unlink("run/pid/ganache-#{port}.pid")
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
    RandomPort::Pool.new.acquire do |port|
      begin
        Rake::Task[:'ganache:start'].invoke(port)

        puts "Running integration tests against node listening on #{port}..."
        sh({
            "HOST" => "127.0.0.1",
            "PORT" => "#{port}"
        }, 'npm run test:integration')
      ensure
        Rake::Task[:'ganache:stop'].invoke(port)
      end
    end
  end
end
