param([int]$Port = 5195)

$ErrorActionPreference = "Stop"
$allowedHosts = @(
  "rpc.ritualfoundation.org",
  "explorer.ritualfoundation.org",
  "www.ritualfoundation.org",
  "discord.com",
  "api.x.com",
  "twitter.com"
)
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "ProofGraph upstream bridge listening on http://127.0.0.1:$Port"

function Send-Json($context, [int]$status, $payload) {
  $json = $payload | ConvertTo-Json -Compress -Depth 8
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $context.Response.StatusCode = $status
  $context.Response.ContentType = "application/json; charset=utf-8"
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      if ($context.Request.Url.AbsolutePath -eq "/health") {
        Send-Json $context 200 @{ ok = $true }
        continue
      }
      if ($context.Request.HttpMethod -ne "POST" -or $context.Request.Url.AbsolutePath -ne "/fetch") {
        Send-Json $context 404 @{ error = "Bridge route not found" }
        continue
      }

      $reader = [System.IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
      $payload = $reader.ReadToEnd() | ConvertFrom-Json
      $reader.Close()
      $uri = [System.Uri]::new([string]$payload.url)
      if ($uri.Scheme -ne "https" -or $allowedHosts -notcontains $uri.Host.ToLowerInvariant()) {
        Send-Json $context 403 @{ error = "Upstream host is not allowed" }
        continue
      }

      $headers = @{}
      $contentType = ""
      $userAgent = "RitualProofGraph/1.0"
      if ($payload.headers) {
        foreach ($property in $payload.headers.PSObject.Properties) {
          $name = $property.Name.ToLowerInvariant()
          if ($name -eq "content-type") { $contentType = [string]$property.Value; continue }
          if ($name -eq "user-agent") { $userAgent = [string]$property.Value; continue }
          if ($name -notin @("host", "content-length", "connection")) {
            $headers[$property.Name] = [string]$property.Value
          }
        }
      }

      $arguments = @{
        Uri = $uri.AbsoluteUri
        Method = [string]$payload.method
        Headers = $headers
        UserAgent = $userAgent
        UseBasicParsing = $true
        TimeoutSec = 25
      }
      if ([string]$payload.body -ne "") { $arguments.Body = [string]$payload.body }
      if ($contentType) { $arguments.ContentType = $contentType }

      try {
        $upstream = Invoke-WebRequest @arguments
        Send-Json $context 200 @{ status = [int]$upstream.StatusCode; body = [string]$upstream.Content }
      } catch {
        $status = 0
        $body = [string]$_.ErrorDetails.Message
        if ($_.Exception.Response) {
          if ($_.Exception.Response.StatusCode) { $status = [int]$_.Exception.Response.StatusCode }
          try {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) {
              $errorReader = [System.IO.StreamReader]::new($stream)
              $responseBody = $errorReader.ReadToEnd()
              $errorReader.Close()
              if ($responseBody) { $body = $responseBody }
            }
          } catch {}
        }
        if (-not $body) { $body = [string]$_.Exception.Message }
        Send-Json $context 200 @{ status = $status; body = $body }
      }
    } catch {
      Send-Json $context 400 @{ error = [string]$_.Exception.Message }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
