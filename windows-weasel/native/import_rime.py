from pathlib import Path
import os, struct, subprocess
root=Path(__file__).parent/'build'
data=(Path(os.environ['WEASEL_INSTALL']) / 'rime.dll').read_bytes()
pe=struct.unpack_from('<I',data,0x3c)[0]
num,size=struct.unpack_from('<H',data,pe+6)[0],struct.unpack_from('<H',data,pe+20)[0]
optional=pe+24
sections=[]
for i in range(num):
    offset=optional+size+40*i
    vs,va,raw,ptr=struct.unpack_from('<IIII',data,offset+8)
    sections.append((va,max(vs,raw),ptr))
def fileoff(rva):
    for va,size,ptr in sections:
        if va<=rva<va+size:return ptr+rva-va
    raise ValueError(rva)
directory=struct.unpack_from('<I',data,optional+112)[0]
export=fileoff(directory)
count=struct.unpack_from('<I',data,export+24)[0]
names=fileoff(struct.unpack_from('<I',data,export+32)[0])
strings=[]
for i in range(count):
    p=fileoff(struct.unpack_from('<I',data,names+4*i)[0])
    strings.append(data[p:data.index(0,p)].decode('ascii'))
definition=root/'rime.def';definition.write_text('LIBRARY rime.dll\nEXPORTS\n'+'\n'.join(strings)+'\n')
libtool=os.environ.get('LIB_EXE', 'lib.exe')
subprocess.run([str(libtool),'/nologo','/machine:x64','/def:'+str(definition),'/out:'+str(root/'weasel-0.17.4/lib64/rime.lib')],check=True)
print('Import library exports',len(strings))
