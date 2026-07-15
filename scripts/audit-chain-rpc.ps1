$rpcLine = Get-Content .env.local, .env |
  Where-Object { $_ -match '^RITUAL_RPC_URL=https://' } |
  Select-Object -First 1
$rpcUrl = ($rpcLine -split '=', 2)[1].Trim('"')

function Invoke-Rpc([string]$Method, [object[]]$Params) {
  $body = @{
    jsonrpc = '2.0'
    id = 1
    method = $Method
    params = $Params
  } | ConvertTo-Json -Depth 8 -Compress
  (Invoke-RestMethod -Uri $rpcUrl -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20).result
}

function Address-Word([string]$Address) {
  $Address.ToLower().Replace('0x', '').PadLeft(64, '0')
}

$registry = Get-Content -Raw deploy-proofgraph.json | ConvertFrom-Json
$decisions = Get-Content -Raw deploy-review-decisions.json | ConvertFrom-Json
$chainId = Invoke-Rpc 'eth_chainId' @()
$registryCode = Invoke-Rpc 'eth_getCode' @($registry.address, 'latest')
$decisionsCode = Invoke-Rpc 'eth_getCode' @($decisions.address, 'latest')
$registryOwner = Invoke-Rpc 'eth_call' @(@{ to = $registry.address; data = '0x8da5cb5b' }, 'latest')
$decisionsOwner = Invoke-Rpc 'eth_call' @(@{ to = $decisions.address; data = '0x8da5cb5b' }, 'latest')
$coordinatorTrusted = Invoke-Rpc 'eth_call' @(@{ to = $registry.address; data = "0x1338e957$(Address-Word $decisions.address)" }, 'latest')
$directTrusted = Invoke-Rpc 'eth_call' @(@{ to = $registry.address; data = "0x1338e957$(Address-Word $registry.deployer)" }, 'latest')
$relayerTrusted = Invoke-Rpc 'eth_call' @(@{ to = $decisions.address; data = "0x1338e957$(Address-Word $decisions.initialAttestor)" }, 'latest')
$balance = Invoke-Rpc 'eth_getBalance' @($decisions.initialAttestor, 'latest')
$transactionStatuses = @(
  $registry.deployTx
  $decisions.deployTx
  $decisions.coordinatorGrantTx
  $decisions.directAttestorRevokeTx
) | ForEach-Object { (Invoke-Rpc 'eth_getTransactionReceipt' @($_)).status }

[ordered]@{
  chainId = $chainId
  registryCodeBytes = ($registryCode.Length - 2) / 2
  decisionsCodeBytes = ($decisionsCode.Length - 2) / 2
  registryOwner = "0x$($registryOwner.Substring($registryOwner.Length - 40))"
  decisionsOwner = "0x$($decisionsOwner.Substring($decisionsOwner.Length - 40))"
  coordinatorTrusted = $coordinatorTrusted.EndsWith('1')
  directRegistryScoring = $directTrusted.EndsWith('1')
  relayerTrusted = $relayerTrusted.EndsWith('1')
  relayerFunded = $balance -ne '0x0'
  transactionStatuses = $transactionStatuses
} | ConvertTo-Json -Compress
