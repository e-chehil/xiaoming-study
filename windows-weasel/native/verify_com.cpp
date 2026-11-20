#include <windows.h>
#include <objbase.h>
#include <iostream>
int wmain(int argc,wchar_t**argv){
  if(argc!=2)return 2;
  HRESULT init=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
  if(FAILED(init))return 3;
  CLSID cls;CLSIDFromString(L"{A3F4CDED-B1E9-41EE-9CA6-7B4D0DE6CB0A}",&cls);
  IUnknown* object=nullptr;
  HRESULT result=CoCreateInstance(cls,nullptr,CLSCTX_INPROC_SERVER,IID_IUnknown,(void**)&object);
  if(FAILED(result)){std::cerr<<"CoCreateInstance failed "<<std::hex<<result<<std::endl;return 4;}
  HMODULE module=GetModuleHandleW(argv[1]);
  wchar_t actual[32768]={};GetModuleFileNameW(module,actual,32768);
  bool matches=module && _wcsicmp(argv[1],actual)==0;
  object->Release();CoUninitialize();
  if(!matches)return 5;
  std::cout<<"PASS actual COM activation loaded configured D-drive TSF client, "<<sizeof(void*)*8<<" bit\n";
}
