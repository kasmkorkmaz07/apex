"""Preserve the old local receipt paths and add the saved PNG feature in place."""
from pathlib import Path
import json,struct,shutil,sys,datetime
root=Path(sys.argv[1]);documents=Path(sys.argv[2]);resources=root/'resources';errors=[]
def asar_json(p,name):
 with p.open('rb') as f:
  _,hs,_,js=struct.unpack('<4I',f.read(16));header=json.loads(f.read(js));e=header['files'][name];f.seek(8+hs+int(e['offset']));return json.loads(f.read(e['size']))
config=resources/'receipt-integration.json'
try:
 if config.exists():c=json.loads(config.read_text(encoding='utf-8-sig'))
 elif (resources/'app-before-1.0.130.asar').exists():
  try:c=asar_json(resources/'app-before-1.0.130.asar','receipt-integration.json')
  except KeyError:c={'portable':True}
 else:c={'portable':True}
 if not c.get('portable'):
  source=Path(c['source']);data=Path(c['data'])
  if not source.is_dir() or not data.is_dir():raise ValueError('Old receipt directory unavailable; paths preserved for review.')
  rollback=documents/'Apex/backups/upgrade-1.0.130/FisAsistani';rollback.mkdir(parents=True,exist_ok=True)
  for p in (root/'FisAsistani').glob('*.py'):
   old=source/p.name
   if old.exists() and not (rollback/p.name).exists():shutil.copy2(old,rollback/p.name)
   shutil.copy2(p,old)
  # Use the bundled runtime so an old venv is no longer required.
  c['python']=str(root/'Runtime/Python/python.exe')
 config.write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8')
except Exception as e:errors.append(type(e).__name__+': '+str(e))
feature=(root/'resources/kase-export-feature.js').read_text(encoding='utf-8')
for folder in ['KASE-IMZA','KAŞE-İMZA']:
 p=documents/'Apex/Paket Programlar'/folder/'imza-kase-masaustu.html'
 if not p.exists():continue
 try:
  html=p.read_text(encoding='utf-8-sig')
  if 'exportSavedTransparent' in html:continue
  needle='    settingsToggle.addEventListener('
  if needle not in html:raise ValueError('Compatible settings hook not found: '+folder)
  backup=p.with_name('imza-kase-onceki-1.0.130.html')
  if not backup.exists():shutil.copy2(p,backup)
  p.write_text(html.replace(needle,feature+'\n'+needle,1),encoding='utf-8')
 except Exception as e:errors.append(type(e).__name__+': '+str(e))
(resources/'migration-1.0.130.json').write_text(json.dumps({'date':datetime.datetime.now().isoformat(),'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
sys.exit(1 if errors else 0)
