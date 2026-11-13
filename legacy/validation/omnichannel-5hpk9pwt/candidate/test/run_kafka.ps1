$ErrorActionPreference = 'Stop'
$password = [guid]::NewGuid().ToString('N')
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$kafkaPort = $listener.LocalEndpoint.Port
$listener.Stop()
$postgres = $null
$kafka = $null
$previousDatabase = $env:OMNICHANNEL_TEST_DATABASE_URL
$previousBroker = $env:OMNICHANNEL_TEST_KAFKA_BROKER
$result = 1
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $postgres = docker run --rm -d -p '127.0.0.1::5432' -e "POSTGRES_PASSWORD=$password" -e POSTGRES_DB=omnichannel postgres:16-alpine
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL não iniciou.' }
    $kafka = docker run --rm -d -p "127.0.0.1:${kafkaPort}:9092" `
        -e KAFKA_NODE_ID=1 -e KAFKA_PROCESS_ROLES=broker,controller `
        -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093 `
        -e KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093 `
        -e "KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://127.0.0.1:${kafkaPort}" `
        -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT `
        -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT `
        -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 apache/kafka:4.1.0
    if ($LASTEXITCODE -ne 0) { throw 'Kafka não iniciou.' }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker exec $postgres pg_isready -h 127.0.0.1 -U postgres -d omnichannel | Out-Null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 1
    }
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL não ficou disponível.' }
    $port = ((docker port $postgres 5432/tcp) -split ':')[-1].Trim()
    $env:OMNICHANNEL_TEST_DATABASE_URL = "postgresql://postgres:${password}@127.0.0.1:${port}/omnichannel"
    $env:OMNICHANNEL_TEST_KAFKA_BROKER = "127.0.0.1:${kafkaPort}"
    npm run test:kafka
    $result = $LASTEXITCODE
    if ($result -eq 0) {
        npm test
        $result = $LASTEXITCODE
    }
} finally {
    if ($kafka) { docker stop $kafka | Out-Null }
    if ($postgres) { docker stop $postgres | Out-Null }
    $env:OMNICHANNEL_TEST_DATABASE_URL = $previousDatabase
    $env:OMNICHANNEL_TEST_KAFKA_BROKER = $previousBroker
    Pop-Location
}
exit $result
