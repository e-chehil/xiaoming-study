#include "stdafx.h"
#include "WeaselUI.h"
#include "VerticalLayout.h"
#include "HorizontalLayout.h"
#include <dwrite_3.h>
#include <iostream>
#include <set>

class Families : public IDWriteTextRenderer {
 public:
  std::set<std::wstring> names;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** p) override {
    if(!p)return E_POINTER;
    *p=nullptr;
    if(iid==__uuidof(IUnknown)||iid==__uuidof(IDWriteTextRenderer)||iid==__uuidof(IDWritePixelSnapping)){
      *p=static_cast<IDWriteTextRenderer*>(this);AddRef();return S_OK;
    }
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return 1; }
  ULONG STDMETHODCALLTYPE Release() override { return 1; }
  HRESULT STDMETHODCALLTYPE IsPixelSnappingDisabled(void*,BOOL* v) override {*v=TRUE;return S_OK;}
  HRESULT STDMETHODCALLTYPE GetCurrentTransform(void*,DWRITE_MATRIX* v) override {*v={1,0,0,1,0,0};return S_OK;}
  HRESULT STDMETHODCALLTYPE GetPixelsPerDip(void*,FLOAT* v) override {*v=1;return S_OK;}
  HRESULT STDMETHODCALLTYPE DrawGlyphRun(void*,FLOAT,FLOAT,DWRITE_MEASURING_MODE,const DWRITE_GLYPH_RUN* run,const DWRITE_GLYPH_RUN_DESCRIPTION*,IUnknown*) override {
    Microsoft::WRL::ComPtr<IDWriteFontFace3> face;
    if (FAILED(run->fontFace->QueryInterface(IID_PPV_ARGS(&face)))) return E_FAIL;
    Microsoft::WRL::ComPtr<IDWriteLocalizedStrings> strings;
    face->GetFamilyNames(&strings);
    UINT32 index=0;BOOL exists=FALSE;strings->FindLocaleName(L"en-us",&index,&exists);
    if(!exists)index=0;
    wchar_t text[256]={};strings->GetString(index,text,256);names.insert(text);return S_OK;
  }
  HRESULT STDMETHODCALLTYPE DrawUnderline(void*,FLOAT,FLOAT,const DWRITE_UNDERLINE*,IUnknown*) override{return S_OK;}
  HRESULT STDMETHODCALLTYPE DrawStrikethrough(void*,FLOAT,FLOAT,const DWRITE_STRIKETHROUGH*,IUnknown*) override{return S_OK;}
  HRESULT STDMETHODCALLTYPE DrawInlineObject(void*,FLOAT,FLOAT,IDWriteInlineObject*,BOOL,BOOL,IUnknown*) override{return S_OK;}
};
int wmain(int argc,wchar_t**argv){
  if(argc!=2)return 2;
  SetProcessDPIAware();
  CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
  Gdiplus::GdiplusStartupInput startup;ULONG_PTR token=0;
  Gdiplus::GdiplusStartup(&token,&startup,nullptr);
  HDC dc=CreateCompatibleDC(nullptr);
  wchar_t face[4096]={};GetPrivateProfileStringW(L"header",L"face",L"Yu Mincho, SimSun",face,4096,argv[1]);
  weasel::UIStyle style;
  style.font_face=style.label_font_face=style.comment_font_face=face;
  style.font_point=20;style.label_font_point=style.comment_font_point=10;
  style.margin_x=12;style.margin_y=6;style.spacing=4;style.candidate_spacing=2;
  style.label_text_format=L"%s";style.back_color=0xffecf1f2;
  style.comment_text_color=style.hilited_comment_text_color=0xff805f4a;
  weasel::Context ctx;ctx.preedit.str=L"rjbyf";
  weasel::Text word,comment,label;word.str=L"彻";comment.str=L"＋j  彳七刀";label.str=L"1";
  ctx.cinfo.candies.push_back(word);ctx.cinfo.comments.push_back(comment);ctx.cinfo.labels.push_back(label);
  weasel::Status status;status.schema_id=L"xiaoming";status.schema_name=L"潇明";status.composing=true;
  for(UINT dpi:{96,144,192}){
    std::cerr<<"Creating resources "<<dpi<<std::endl;
    auto dwr=std::make_shared<weasel::DirectWriteResources>(style,dpi,true);
    std::cerr<<"Resources created "<<dwr->pTextFormat.Get()<<" "<<dwr->pPreeditTextFormat.Get()<<std::endl;
    if(abs(dwr->pTextFormat->GetFontSize()/dwr->pPreeditTextFormat->GetFontSize()-2)>0.01)return 3;
    weasel::VerticalLayout layout(style,ctx,status,dwr);
    std::cerr<<"Layout created"<<std::endl;
    layout.DoLayout(dc,dwr);
    std::cerr<<"Layout computed"<<std::endl;
    if(layout.footer_rect.IsRectEmpty())return 4;
    if(layout.footer_rect.top<layout.GetCandidateRect(0).bottom)return 5;
    if(layout.CommentParts(0)!=std::make_pair(std::wstring(L"j"),std::wstring(L"彳七刀")))return 10;
    const auto hint=layout.subscript_rects[0];
    if(hint.IsRectEmpty()||hint.left<layout.GetCandidateTextRect(0).right||hint.right>layout.GetCandidateRect(0).right)return 11;
    if(dwr->NativeAppearanceChanged())return 12;
    std::cout<<"DPI "<<dpi<<" candidate="<<dwr->pTextFormat->GetFontSize()<<" header="<<dwr->pPreeditTextFormat->GetFontSize()<<" footer="<<dwr->pFooterTextFormat->GetFontSize()<<" bounds="<<layout.GetContentSize().cx<<"x"<<layout.GetContentSize().cy<<"\n";
    for(auto item:{std::pair<const wchar_t*,const wchar_t*>(L"彻",L"SimSun"),{L"徹",L"Yu Mincho"},{L"做",L"Yu Mincho"},{L"剧",L"SimSun"},{L"劇",L"Yu Mincho"}}){
      Families renderer;
      dwr->CreateTextLayout(item.first,1,dwr->pTextFormat.Get(),500,500);
      if(FAILED(dwr->pTextLayout->Draw(nullptr,&renderer,0,0)))return 6;
      if(renderer.names!=std::set<std::wstring>{item.second}){
        std::cerr<<"Wrong family for U+"<<std::hex<<unsigned(item.first[0])<<" runs="<<renderer.names.size()<<std::endl;
        for(auto n:renderer.names){char output[1024]={};WideCharToMultiByte(CP_UTF8,0,n.c_str(),-1,output,1024,nullptr,nullptr);std::cerr<<output<<std::endl;}
        return 7;
      }
    }
  }
  ctx.cinfo.candies.push_back(word);ctx.cinfo.comments.push_back(comment);ctx.cinfo.labels.push_back(label);
  ctx.cinfo.comments[0].str=L"␣  彳七刀";
  style.layout_type=weasel::UIStyle::LAYOUT_HORIZONTAL;style.max_width=150;
  auto horizontal_dwr=std::make_shared<weasel::DirectWriteResources>(style,144,true);
  weasel::HorizontalLayout horizontal(style,ctx,status,horizontal_dwr);horizontal.DoLayout(dc,horizontal_dwr);
  if(horizontal.CommentParts(0).first!=L"_")return 13;
  if(horizontal.GetCandidateRect(1).top<=horizontal.GetCandidateRect(0).top)return 14;
  for(int i=0;i<2;i++){
    const auto hint=horizontal.subscript_rects[i],candidate=horizontal.GetCandidateRect(i);
    if(hint.IsRectEmpty()||hint.left<horizontal.GetCandidateTextRect(i).right||hint.right>candidate.right||hint.bottom>candidate.bottom)return 15;
  }
  style.layout_type=weasel::UIStyle::LAYOUT_VERTICAL;style.max_width=0;
  auto normal=std::make_shared<weasel::DirectWriteResources>(style,96,false);
  if(normal->pTextFormat->GetFontSize()!=normal->pPreeditTextFormat->GetFontSize())return 8;
  status.schema_id=L"rime_ice";weasel::VerticalLayout other(style,ctx,status,normal);other.DoLayout(dc,normal);
  if(!other.footer_rect.IsRectEmpty()||!other.CommentParts(0).first.empty())return 9;
  std::cout<<"PASS font families, three DPIs, footer, completion/space subscripts, horizontal wrapping, other-schema isolation\n";
}
