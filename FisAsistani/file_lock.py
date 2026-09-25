"""Windows Restart Manager ile kilit sahiplerini yalnız sorgula; kapatma yok."""
def owners(path):
    import os
    if os.name != 'nt':return []
    import ctypes as c
    from ctypes import wintypes as w
    class Unique(c.Structure):
        _fields_=[('pid',w.DWORD),('start',w.FILETIME)]
    class Info(c.Structure):
        _fields_=[('process',Unique),('name',w.WCHAR*256),('service',w.WCHAR*64),
                  ('type',w.DWORD),('status',w.ULONG),('session',w.DWORD),('restartable',w.BOOL)]
    try:
        rm=c.WinDLL('rstrtmgr');handle=w.DWORD();key=c.create_unicode_buffer(33)
        if rm.RmStartSession(c.byref(handle),0,key):return []
        try:
            paths=(w.LPCWSTR*1)(str(path))
            if rm.RmRegisterResources(handle,1,paths,0,None,0,None):return []
            needed=w.UINT();count=w.UINT();reason=w.DWORD()
            rc=rm.RmGetList(handle,c.byref(needed),c.byref(count),None,c.byref(reason))
            if rc!=234 or needed.value>1000:return []
            rows=(Info*needed.value)();count.value=needed.value
            if rm.RmGetList(handle,c.byref(needed),c.byref(count),rows,c.byref(reason)):return []
            return list(dict.fromkeys(r.name for r in rows[:count.value] if r.name))
        finally:rm.RmEndSession(handle)
    except (OSError,AttributeError):return []
