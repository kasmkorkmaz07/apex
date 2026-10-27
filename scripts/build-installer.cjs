const path=require('path'),{build,Platform,Arch}=require('electron-builder');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json');
if(!process.argv[2])throw Error('Tam hazir uygulama klasoru gerekli.');
build({projectDir:root,prepackaged:path.resolve(process.argv[2]),targets:Platform.WINDOWS.createTarget('nsis',Arch.x64),publish:'never',config:require('../electron-builder.json'),
  // 1.0.130 updater expects a four-part Windows ProductVersion string.
  effectiveOptionComputed:async options=>{
    const commands=options[1];
    commands.VIAddVersionKey=commands.VIAddVersionKey.map(line=>line.replace(/ProductVersion "[^"]*"/,`ProductVersion "${pkg.version}.0"`));
    return false;
  }
}).catch(error=>{console.error(error);process.exit(1)});
