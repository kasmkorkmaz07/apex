"""Aynı kayıtları iki arayüzün eşzamanlı değiştirmesini engeller."""
import os

class InstanceLock:
    def __init__(self,home):
        self.file=open(home/'uygulama.lock','a+b')
        try:
            self.file.seek(0)
            if not self.file.read(1):self.file.write(b'0');self.file.flush()
            self.file.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:
            self.file.close()
            raise RuntimeError('Fiş Asistanı zaten açık. Önce açık Fiş Asistanı ekranını kapatın; kayıtlarınız korunur.') from None
    def close(self):
        self.file.close()
