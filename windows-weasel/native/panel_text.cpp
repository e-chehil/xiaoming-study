#include "stdafx.h"
#include "WeaselUI.h"
#include <map>
#include <tuple>

namespace {
struct Entry {
  weasel::UIStyle style;
  weasel::PDWR resources;
  Entry(const wchar_t* face,int point,UINT dpi) {
    style.font_face=style.label_font_face=style.comment_font_face=face;
    style.font_point=style.label_font_point=style.comment_font_point=point;
    style.linespacing=110;style.baseline=88;
    resources=std::make_shared<weasel::DirectWriteResources>(style,dpi,true);
  }
};
auto& Entries() {
  struct Apartment {
    HRESULT result=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    ~Apartment(){if(SUCCEEDED(result))CoUninitialize();}
  };
  static thread_local Apartment apartment;
  static thread_local std::map<std::tuple<std::wstring,int,UINT>,std::unique_ptr<Entry>> cache;
  return cache;
}
}
extern "C" __declspec(dllexport) HRESULT __stdcall DrawPanelText(
    HDC dc,const RECT* rect,const wchar_t* text,const wchar_t* face,int point,UINT dpi,COLORREF color) {
  if(!dc||!rect||!text||!face||point<6||point>96||dpi<48||dpi>768)return E_INVALIDARG;
  if(rect->right<=rect->left||rect->bottom<=rect->top)return S_FALSE;
  try {
    auto& cache=Entries();
    const auto key=std::make_tuple(std::wstring(face),point,dpi);
    auto found=cache.find(key);
    if(found==cache.end()){
      if(cache.size()>=16)cache.clear();
      found=cache.emplace(key,std::make_unique<Entry>(face,point,dpi)).first;
    }
    auto& dwr=found->second->resources;
    HRESULT hr=dwr->pRenderTarget->BindDC(dc,rect);
    if(FAILED(hr))return hr;
    hr=dwr->CreateTextLayout(text,static_cast<int>(wcslen(text)),dwr->pTextFormat.Get(),
                             static_cast<float>(rect->right-rect->left),static_cast<float>(rect->bottom-rect->top));
    if(FAILED(hr))return hr;
    dwr->pTextLayout->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
    dwr->pRenderTarget->BeginDraw();
    dwr->SetBrushColor(D2D1::ColorF(GetRValue(color)/255.f,GetGValue(color)/255.f,GetBValue(color)/255.f,1.f));
    dwr->pRenderTarget->DrawTextLayout(D2D1::Point2F(),dwr->pTextLayout.Get(),dwr->pBrush.Get(),D2D1_DRAW_TEXT_OPTIONS_CLIP);
    return dwr->pRenderTarget->EndDraw();
  }catch(...){return E_FAIL;}
}
