$ErrorActionPreference = 'Stop'
$kit = Join-Path $PSScriptRoot 'build'
$weasel = Join-Path $kit 'weasel-0.17.4'
$source = Join-Path $PSScriptRoot 'panel_text.cpp'
& cl.exe /nologo /LD /EHsc /O2 /MT /utf-8 /std:c++17 /DUNICODE /D_UNICODE "/I$kit\atl\include" "/I$weasel\include" "/I$weasel\WeaselUI" "/I$kit\boost184" $source "/Fe:$kit\xm_native_text.dll" "/Fo:$kit\panel_text.obj" /link "$weasel\msbuild\Release\x64\WeaselUI.lib" "/LIBPATH:$kit\atl\lib\x64" d2d1.lib dwrite.lib gdi32.lib user32.lib advapi32.lib ole32.lib
exit $LASTEXITCODE
