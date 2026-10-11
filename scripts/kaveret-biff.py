#!/usr/bin/env python3
"""קורא ייצוא XLS של כוורת גם כשהקובץ "פגום".

כוורת כותבת BIFF8 עם שתי תקלות: טבלת ה-FAT של הקובץ שבורה (xlrd/LibreOffice נכשלים),
ואמוג׳י בשם נספר כתו אחד במקום שתי יחידות UTF-16 (SheetJS מאבד את כל השמות אחריו).
כאן קוראים את רשומות ה-BIFF ברצף מה-BOF, ומתקנים את ספירת התווים.

שימוש: python3 -I scripts/kaveret-biff.py <file.xls> <out.json>   → מערך שורות (השורה הראשונה = כותרות)
"""
import sys, struct, json
d=open(sys.argv[1],'rb').read()
pos=d.find(b'\x09\x08\x10\x00\x00\x06\x05\x00')
recs=[]
nb=0
while pos < len(d)-4:
    t,l=struct.unpack_from('<HH',d,pos); recs.append((t,d[pos+4:pos+4+l])); pos+=4+l
    if t==0x809: nb+=1
    if t==0x0A and nb>=2: break
# SST + CONTINUE chunks
k=[i for i,r in enumerate(recs) if r[0]==0xFC][0]
chunks=[recs[k][1]]; j=k+1
while recs[j][0]==0x3C: chunks.append(recs[j][1]); j+=1
total,uniq=struct.unpack_from('<II',chunks[0],0)
ci=0; buf=chunks[0]; p=8; sst=[]
def need(n):
    global ci,buf,p
    if p+n<=len(buf): return
    raise Exception('need')
def nextchunk():
    global ci,buf,p
    ci+=1; buf=chunks[ci]; p=0
for _ in range(uniq):
    if p>=len(buf): nextchunk()
    cch,flags=struct.unpack_from('<HB',buf,p); p+=3
    rt=sz=0
    if flags&8: rt=struct.unpack_from('<H',buf,p)[0]; p+=2
    if flags&4: sz=struct.unpack_from('<I',buf,p)[0]; p+=4
    wide=flags&1; out=bytearray(); left=cch
    # כוורת סופרת אמוג'י (זוג surrogate) כתו אחד — קוראים יחידה נוספת אחרי high surrogate
    while left>0:
        if p>=len(buf) or (wide and len(buf)-p<2):
            nextchunk(); wide=buf[p]&1; p+=1
        if wide:
            u=struct.unpack_from('<H',buf,p)[0]; out+=buf[p:p+2]; p+=2
            if 0xD800<=u<=0xDBFF:
                if p>=len(buf): nextchunk(); wide=buf[p]&1; p+=1
                out+=buf[p:p+2]; p+=2
        else:
            out+=bytes([buf[p],0]); p+=1
        left-=1
    skip=4*rt+sz
    while skip>0:
        if p>=len(buf): nextchunk()
        s=min(skip,len(buf)-p); p+=s; skip-=s
    sst.append(bytes(out).decode('utf-16-le','replace'))
cells={}
for t,b in recs:
    if t==0xFD:
        r,c,xf,i=struct.unpack_from('<HHHI',b,0); cells[(r,c)]=sst[i]
    elif t==0x203:
        r,c,xf,v=struct.unpack_from('<HHHd',b,0); cells[(r,c)]=int(v) if v==int(v) else v
    elif t==0x27E:
        r,c,xf,rk=struct.unpack_from('<HHHI',b,0)
        v=(struct.unpack('<d',struct.pack('<Q',(rk&0xfffffffc)<<32))[0]) if not rk&2 else (rk>>2 if rk < 1<<31 else (rk>>2)-(1<<30))
        if rk&1: v/=100
        cells[(r,c)]=v
nr=max(r for r,c in cells)+1; nc=max(c for r,c in cells)+1
rows=[[cells.get((r,c),'') for c in range(nc)] for r in range(nr)]
print('sst',len(sst),'of',uniq,'rows',nr,'cols',nc, file=sys.stderr)
json.dump(rows, open(sys.argv[2],'w'), ensure_ascii=False)
