param([ValidateSet('x64','Win32')][string]$Architecture='x64',[string]$Project='WeaselServer')
$ErrorActionPreference='Stop'
$kit=Join-Path $PSScriptRoot 'build'
$repo=Join-Path $kit 'weasel-0.17.4'
$platform=if($Architecture -eq 'x64'){'x64'}else{'x86'}
$env:CL='/I"'+$kit+'\atl\include"'
$env:LINK='/LIBPATH:"'+$kit+'\atl\lib\'+$platform+'"'
$ms=(Get-Command 'MSBuild.exe' -ErrorAction Stop).Source
& $ms "$repo\$Project\$Project.vcxproj" /nologo /verbosity:quiet /m:4 /p:Configuration=Release "/p:Platform=$Architecture" /p:PlatformToolset=v143 /p:WindowsTargetPlatformVersion=10.0.22621.0 "/p:SolutionDir=$repo\" "/flp:logfile=$kit\$Project-$Architecture.log;verbosity=normal"
exit $LASTEXITCODE
