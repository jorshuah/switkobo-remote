param([Parameter(Mandatory=$true)][string]$DataDirectory,[Parameter(Mandatory=$true)][string]$Addresses)
$ErrorActionPreference='Stop'
$certDirectory=Join-Path $DataDirectory 'https'
[IO.Directory]::CreateDirectory($certDirectory) | Out-Null
$metaPath=Join-Path $certDirectory 'https.json'
$ipList=@($Addresses.Split(',') | Where-Object { $_ } | Sort-Object -Unique)
$flags=[Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
$now=[DateTimeOffset]::UtcNow
if(Test-Path -LiteralPath $metaPath){
  $saved=Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
  $password=$saved.password
  $ca=[Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $certDirectory 'root.pfx'),$password,$flags)
}else{
  $bytes=New-Object byte[] 32
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes);$rng.Dispose()
  $password=[Convert]::ToBase64String($bytes)
  $caKey=[Security.Cryptography.RSA]::Create(3072)
  $request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=TV Remote Local CA',$caKey,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
  $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign),$true))
  $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($request.PublicKey,$false))
  $ca=$request.CreateSelfSigned($now.AddDays(-1),$now.AddYears(5))
  [IO.File]::WriteAllBytes((Join-Path $certDirectory 'root.pfx'),$ca.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$password))
}
if($ca.NotAfter -lt [DateTime]::UtcNow.AddYears(1)){throw 'The local certificate authority is nearing expiry. Back up the https folder and create a new local HTTPS setup.'}
$key=[Security.Cryptography.RSA]::Create(2048)
$request=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=TV Remote',$key,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false,$false,0,$true))
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment),$true))
$oids=[Security.Cryptography.OidCollection]::new()
$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
$request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids,$false))
$san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost')
$san.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'))
foreach($ip in $ipList){$san.AddIpAddress([Net.IPAddress]::Parse($ip))}
$request.CertificateExtensions.Add($san.Build())
$serial=New-Object byte[] 16
$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($serial);$rng.Dispose()
$serial[0]=$serial[0] -band 127
$issued=$request.Create($ca,$now.AddDays(-1),$now.AddDays(365),$serial)
$leaf=[Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($issued,$key)
$collection=[Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
$collection.Add($leaf) | Out-Null
$collection.Add([Security.Cryptography.X509Certificates.X509Certificate2]::new($ca.RawData)) | Out-Null
[IO.File]::WriteAllBytes((Join-Path $certDirectory 'server.pfx'),$collection.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$password))
[IO.File]::WriteAllBytes((Join-Path $certDirectory 'root.cer'),$ca.RawData)
$hash=[Security.Cryptography.SHA256]::Create()
$fingerprint=([BitConverter]::ToString($hash.ComputeHash($ca.RawData))).Replace('-',':')
$meta=@{version=1;password=$password;addresses=$ipList;expires=$leaf.NotAfter.ToUniversalTime().ToString('o');fingerprint=$fingerprint}
[IO.File]::WriteAllText($metaPath,($meta | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Output 'Local HTTPS certificates created. No trust certificates were installed on this PC.'
$leaf.Dispose();$issued.Dispose();$key.Dispose();$ca.Dispose()
