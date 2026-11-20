local M = {}
local base = rime_api.get_user_data_dir() .. "/xm_yume/"
local meta, bycode, personal, prefixes
local runtime_flags={"xm_sentence","xm_delay","xm_noivs","xm_words","xm_nopredict","xm_nohints","xm_noquickhint","xm_fullprefix"}
for _,group in ipairs({{"xm_note",9},{"xm_charset",5},{"xm_sort",5}}) do
  for i=0,group[2]-1 do runtime_flags[#runtime_flags+1]=group[1]..i end
end
local runtime_set={};for _,name in ipairs(runtime_flags) do runtime_set[name]=true end
local function save_runtime(ctx,env)
  if not env.runtime_ready or env.runtime_loading then return end
  local lines={};for _,name in ipairs(runtime_flags) do lines[#lines+1]=name.."\t"..(ctx:get_option(name) and "1" or "0").."\n" end
  local raw=table.concat(lines)..".\n"
  local f=io.open(base.."runtime.tsv","w")
  if f then f:write(raw);f:close();env.runtime_seen=raw end
end
local function sync_runtime(ctx,env)
  local f=io.open(base.."runtime.tsv","r");local raw
  if f then raw=f:read("*a");f:close() end
  if raw and raw~=env.runtime_seen and raw:sub(-3)=="\n.\n" then
    local flags={};local count=0
    for name,value in raw:gmatch("([%w_]+)\t([01])\n") do if runtime_set[name] then flags[name]=value=="1";count=count+1 end end
    if count==#runtime_flags then
      env.runtime_loading=true
      for _,name in ipairs(runtime_flags) do ctx:set_option(name,flags[name]) end
      env.runtime_loading=false;env.runtime_seen=raw
    end
  end
  env.runtime_ready=true
end
local function metadata()
  if meta then return meta end
  meta=require('xm_packed').open(base..'packed/meta',false)
  if meta then return meta end
  meta = {}
  for line in io.lines(base.."meta.tsv") do
    local ch, rest = line:match("^([^\t]+)\t(.*)$")
    if ch then meta[ch]=rest end
  end
  return meta
end
local function details(ch)
  local row=metadata()[ch]
  if row then return row:match("^([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t(.*)$") end
end
local function codepoints(s)
  local t={}
  for _,n in utf8.codes(s) do t[#t+1]=string.format("U+%04X",n) end
  return table.concat(t," ")
end
local readings
local function reading(ch)
  if not readings then
    readings=require('xm_packed').open(base..'packed/readings',false)
  end
  if not readings then
    readings={};local f=io.open(base.."readings.tsv");if f then for line in f:lines() do local ch,r=line:match("^([^\t]+)\t(.*)$");if ch then readings[ch]=r end end;f:close() end
  end
  return (readings[ch] or "\t"):match("^(.-)\t(.*)$")
end
local field_defaults={"roots,code","roots,holo,code,pinyin,region,unicode,meaning"}
local function annotation_character(text, last_character)
  if metadata()[text] then return text end
  if not last_character or text=="" then return nil end
  local pos=utf8.offset(text,-1)
  local cp=utf8.codepoint(text,pos)
  if (cp>=0xfe00 and cp<=0xfe0f) or (cp>=0xe0100 and cp<=0xe01ef) then
    local base_pos=utf8.offset(text,-2)
    if not base_pos then return nil end
    local variant=text:sub(base_pos)
    if metadata()[variant] then return variant end
    return text:sub(base_pos,pos-1)
  end
  return text:sub(pos)
end
local function note(text,level,env)
  local ch=annotation_character(text,not env or env.word_last)
  if not ch then return "" end
  local roots,codes,py,region,flags,holo=details(ch)
  if not codes then return "" end
  local fields=env and env.note_fields[level] or field_defaults[level]
  if not fields then return "" end
  local root_codes={}
  for root in holo:gmatch("%S+") do
    root_codes[#root_codes+1]=root:sub(1,1):upper()..root:sub(2,2)
  end
  local values={roots=roots,holo=holo,code=table.concat(root_codes,"-"),fullcode=codes:gsub("_","␣"),pinyin=py,region=region}
  if fields:find("pinyin",1,true) or fields:find("meaning",1,true) then
    local mandarin,definition=reading(ch)
    if mandarin~="" then values.pinyin=mandarin end
    values.meaning=definition
  end
  if fields:find("unicode",1,true) then values.unicode=codepoints(ch) end
  if fields:find("region",1,true) then
    local sets={}
    for _,pair in ipairs({{"C","常用"},{"S","通规"},{"T","传统"}}) do
      if flags:find(pair[1],1,true) then sets[#sets+1]=pair[2] end
    end
    if region~="" then sets[#sets+1]=region end
    values.region=table.concat(sets,"·")
  end
  local parts={}
  for key in fields:gmatch("%a+") do
    if values[key] and values[key]~="" then parts[#parts+1]=values[key] end
  end
  return table.concat(parts," · ")
end
local function is_delayed(input,ctx)
  return ctx:get_option("xm_delay") and input:match("^[a-y]+$")~=nil
end
local charsets={"全部","常用","简体规范","传统通用","自定义"}
local comments={"关闭","拆分及编码","详细注解"}
local function level(ctx,prefix,n)
  for i=1,n-1 do if ctx:get_option(prefix..i) then return i end end
  return 0
end
local function cycle(ctx,prefix,n)
  local next=(level(ctx,prefix,n)+1)%n
  if prefix=="xm_charset" and next==4 and not (M.custom and _G.next(M.custom)) then next=0 end
  for i=1,n-1 do ctx:set_option(prefix..i,i==next) end
  ctx:refresh_non_confirmed_composition()
end
local function allowed(ch,ctx)
  if ctx:get_option("xm_noivs") and ch:find("[\243][\160][\132-\135]") then return false end
  local group=level(ctx,"xm_charset",5)
  if group==0 then return true end
  if group==4 then return (M.custom or {})[ch] end
  local _,_,_,_,flags=details(ch)
  return flags and flags:find(({"C","S","T"})[group],1,true)
end
local function wordlist()
  if not personal then
    personal={}
    for _,file in ipairs({"user.tsv","created.tsv"}) do
    local f=io.open(base..file,"r")
    if f then for row in f:lines() do
      local w,c=row:match("^([^\t]+)\t([a-y_]+)")
      if w then personal[c]=personal[c] or {}; table.insert(personal[c],w) end
    end; f:close() end
    end
  end
  return personal
end
local indices,buckets
local function phrase_rows(input)
  if #input<4 or #input>5 then return {} end
  if not indices then
    indices={};buckets={}
    for row in io.lines(base.."phrases.idx") do local k,a,b=row:match("^(%a+)\t(%d+)\t(%d+)");if k then indices[k]={tonumber(a),tonumber(b)} end end
  end
  local key=input:sub(1,3);local loc=indices[key]
  if not loc then return {} end
  if not buckets[key] then
    local f=assert(io.open(base.."phrases.tsv","rb"));f:seek("set",loc[1]);local lines=f:read(loc[2]);f:close()
    buckets={};local group={};buckets[key]=group
    for c,w in lines:gmatch("([a-y]+)\t([^\n]+)\n") do group[c]=group[c] or {};table.insert(group[c],w) end
  end
  return buckets[key][input] or {}
end
local function auto_code(w)
  local a={}
  for _,cp in utf8.codes(w) do
    local _,_,_,_,_,holo=details(utf8.char(cp))
    if not holo or holo:find("?",1,true) then return end
    local roots={};for r in holo:gmatch("%a+") do roots[#roots+1]=r end
    if #roots==0 then return end
    a[#a+1]=roots
  end
  if #a<2 then return end
  local x,y=a[1],a[#a]
  if #a==2 then return (x[1]:sub(1,2)..(#x>1 and x[#x]:sub(1,1) or "")..(#y==1 and y[1]:sub(1,2) or y[1]:sub(1,1)..y[#y]:sub(1,2))):sub(1,5) end
  if #a==3 then return x[#x]:sub(1,2)..a[2][#a[2]]:sub(1,1)..(#y==1 and y[1]:sub(1,2) or y[1]:sub(1,1)..y[#y]:sub(1,1)) end
  return x[#x]:sub(1,2)..a[2][#a[2]]:sub(1,1)..a[3][#a[3]]:sub(1,1)..y[#y]:sub(1,1)
end
local function learn(w)
  local c=auto_code(w);if not c then return end
  local words=wordlist();words[c]=words[c] or {}
  for _,old in ipairs(words[c]) do if old==w then return end end
  local f=io.open(base.."created.tsv","a");if f then f:write(w,"\t",c,"\n");f:close();table.insert(words[c],w) end
end
local function lookup()
  if bycode then return bycode end
  bycode=require('xm_packed').open(base..'packed/dictionary',true)
  if bycode then return bycode end
  bycode={};prefixes={}
  local start=false
  for row in io.lines(rime_api.get_user_data_dir().."/xiaoming.dict.yaml") do
    if start then
      local w,c=row:match("^([^\t]+)\t([a-y_]+)")
      if c then
        if not bycode[c] then
          bycode[c]={}
          if not c:find("_",1,true) then
            for n=1,#c-1 do
              local prefix=c:sub(1,n)
              prefixes[prefix]=prefixes[prefix] or {}
              table.insert(prefixes[prefix],c)
            end
          end
        end
        table.insert(bycode[c],w)
      end
    elseif row=="..." then start=true end
  end
  for _,codes in pairs(prefixes) do table.sort(codes) end
  return bycode
end
local symbols,starts,offsets,weights_file,cache,weight_index
local weight_queue,weight_head={},1
local function syms(s)
  if not symbols then
    symbols={}
    for row in io.lines(base.."symbols.tsv") do local k,w=row:match("^([^\t]+)\t(.*)$");if k then symbols[k]=symbols[k] or {};table.insert(symbols[k],w) end end
  end
  return symbols[s] or {}
end
-- Index one sorted block of 16 words. Binary word weights stay on disk.
local function weight(w)
  if not cache then
    starts={};offsets={};cache={}
    weight_index=require('xm_packed').open(base..'packed/weights',false)
    if not weight_index then
      for line in io.lines(base.."weights.idx") do local key,off=line:match("^(.*)\t(%d+)$");if key then starts[#starts+1]=key;offsets[#offsets+1]=tonumber(off) end end
    end
    weights_file=assert(io.open(base.."lang.ywtb","rb"))
  end
  if cache[w] then return cache[w] end
  local location
  if weight_index then location=tonumber(weight_index.floor(w))
  else local lo,hi=1,#starts;while lo<=hi do local mid=math.floor((lo+hi)/2);if starts[mid]<=w then lo=mid+1 else hi=mid-1 end end;location=hi>=1 and offsets[hi] or nil end
  local value=0
  if location then
    weights_file:seek("set",location)
    local function var()
      local v,k=0,0
      repeat local s=weights_file:read(1);if not s then return nil end;local b=s:byte();v=v+(b%128)*2^k;k=k+7;if b<128 then return v end until k>49
    end
    local prev=""
    for i=1,16 do local p=0;if i>1 then p=var() end;if not p then break end
      local n=var();if not n then break end
      prev=prev:sub(1,p)..(weights_file:read(n) or "");local freq=var()
      if prev==w then value=freq or 0;break elseif prev>w then break end
    end
  end
  local old=weight_queue[weight_head];if old then cache[old]=nil end
  weight_queue[weight_head]=w;weight_head=weight_head%2048+1
  cache[w]=value;return value
end
local gram_lookup
local lane_sets
local function memberships(word)
  if not lane_sets then
    lane_sets={}
    local f=io.open(base.."lane_sets.tsv")
    if f then
      for line in f:lines() do
        local ch,flags=line:match("^([^\t]+)\t([SFT]+)$")
        if ch then lane_sets[ch]=flags end
      end
      f:close()
    end
  end
  return lane_sets[word] or ""
end
local function predict(items,track,gram_cache)
  if #items<2 then return end
  for _,item in ipairs(items) do if #item.opts==0 then return end end
  if gram_lookup==nil then gram_lookup=require("xm_gram").open(base.."lang.ygram") or false end
  local beam={{score=0,choices={},indices={}}}
  for _,item in ipairs(items) do
    local paths={}
    for j=1,math.min(12,#item.opts) do
      local ch=item.opts[j]
      local prior=math.log(1+weight(ch))*.12-math.log(j)*1.4
      if track and not memberships(ch):find(track,1,true) then prior=prior-6 end
      for _,path in ipairs(beam) do
        local phrase,bonus=ch,0
        for k=#path.choices,math.max(1,#path.choices-4),-1 do
          phrase=path.choices[k]..phrase
          local value=gram_cache[phrase]
          if value==nil then
            local association=gram_lookup and gram_lookup(phrase) or 0
            value=math.max(association,math.log(1+weight(phrase))*.78)
            gram_cache[phrase]=value
          end
          bonus=math.max(bonus,value)
        end
        paths[#paths+1]={score=path.score+prior+bonus,parent=path,index=j,text=ch,order=#paths+1}
      end
    end
    table.sort(paths,function(a,b)
      if a.score==b.score then return a.order<b.order end
      return a.score>b.score
    end)
    beam={}
    for i=1,math.min(24,#paths) do
      local next_path=paths[i]
      local words={table.unpack(next_path.parent.choices)}
      local indices={table.unpack(next_path.parent.indices)}
      words[#words+1]=next_path.text
      indices[#indices+1]=next_path.index
      beam[i]={score=next_path.score,choices=words,indices=indices}
    end
  end
  return beam[1].indices
end
local last_cell_key,last_cells
local function cells(input,ctx,env)
  local filter=level(ctx,"xm_charset",5)
  local cache_key=table.concat({input,env.tracks,tostring(filter),tostring(ctx:get_option("xm_nopredict")),tostring(ctx:get_option("xm_noivs"))},"|")
  if cache_key==last_cell_key then return last_cells end
  local tbl=lookup();local items={}; local code=""
  for i=1,#input do
    local key=input:sub(i,i)
    if key~="\96" then
      code=code..key
      if tbl[code] then
        local opts={}
        for _,w in ipairs(tbl[code]) do if allowed(w,ctx) then opts[#opts+1]=w end end
        items[#items+1]={code=code,opts=opts};code=""
      end
    elseif code~="" then items[#items+1]={code=code,opts={}};code="" end
  end
  if code~="" then items[#items+1]={code=code,opts={}} end
  items.lanes={}
  if not ctx:get_option("xm_nopredict") then
    local gram_cache,seen={},{}
    local tracks=env.tracks
    if filter==2 then tracks="S" elseif filter==3 then tracks=tracks:gsub("S","");if tracks=="" then tracks="FT" end end
    for track in tracks:gmatch("[SFT]") do
      local indices=predict(items,track,gram_cache)
      if indices then
        local words={}
        for i,j in ipairs(indices) do words[i]=items[i].opts[j] end
        local text=table.concat(words)
        if not seen[text] then
          if #items.lanes==0 then for i,j in ipairs(indices) do items[i].best=j end end
          items.lanes[#items.lanes+1]={text=text,track=track}
          seen[text]=true
        end
      end
    end
  end
  last_cell_key,last_cells=cache_key,items
  return items
end
local function groups(st,items)
  local result={};local i=1
  while i<=#items do
    local last=i;while last<#items and (st.join or {})[last] do last=last+1 end
    if last==i then
      local cell=items[i];cell.start=i;cell.last=i;result[#result+1]=cell
    else
      local code,first="",{}
      for j=i,last do local cell=items[j];code=code..cell.code;first[#first+1]=cell.opts[cell.best or 1] or "" end
      local opts={table.concat(first)}
      for j=i,last do for t=1,math.min(12,#items[j].opts) do
        local old=first[j-i+1];first[j-i+1]=items[j].opts[t];local w=table.concat(first);first[j-i+1]=old
        if w~=opts[1] then opts[#opts+1]=w end
      end end
      result[#result+1]={opts=opts,code=code,start=i,last=last}
    end
    i=last+1
  end
  return result
end
local function copy(t)local y={};for k,v in pairs(t or {}) do y[k]=v end;return y end
local function remember(st,ctx)
  st.undo[#st.undo+1]={choice=copy(st.choice),join=copy(st.join),cell=st.cell,raw=ctx.input}
end
local function sentence(env,items,upto)
  local out={}
  for j,cell in ipairs(items) do
    if upto and j>upto then break end
    local word=cell.opts[(env.choice or {})[j] or cell.best or 1]
    if not word then return nil end
    out[#out+1]=word
  end
  return table.concat(out)
end
local function clear_edit(env)
  env.cell=nil; env.choice={}; env.undo={};env.making=nil;env.recode=nil;env.join={}
end
local function history(ctx)
  local out,seen={},{}
  for _,rec in ipairs(ctx.commit_history:to_table()) do
    local s=rec.text
    if s and s~="" and #s<512 then
      for i=#out,1,-1 do if out[i]==s then table.remove(out,i) end end
      out[#out+1]=s
    end
  end
  return out
end
local function launch(page,parameter)
  local name=base.."requests/"..string.format("%x%x",os.time(),math.random(1,0x7fffffff))
  local f=io.open(name..".tmp","w")
  if f then f:write(page,parameter and (" "..parameter) or "");f:close();os.rename(name..".tmp",name..".job") end
end
local commands={{"update","查看小狼毫官方更新"},{"mabiao","打开方案管理"},{"ziran","自然码双拼"},{"space","一码简提示"},{"head","切换编码位置"},{"preview","预编辑首选预览"},{"schema","输入方案菜单"},{"delay","顶字／自动上屏"},{"sort","循环候选排序"},{"index","序号显隐"},{"empty","隐藏／恢复面板"},{"preedit","行内／候选窗编码"},{"default","恢复输入设置，保留外观和词库"},{"word","单字／YUME 词组"},{"predict","顶字候选预测"},{"set","外观与输入设置"},{"mode","顶字／自动／整句"},{"comment","切换候选注解"},{"charset","切换字集"},{"user","编辑个人词库"},{"lookup","查字与相似部件"},{"pinyin","切换全拼"},{"flypy","切换小鹤双拼"},{"variation","显示／隐藏异体序列"},{"punc","中西文标点"},{"layout","调整候选布局"},{"menu","调整每页数量"},{"key","查看按键与快捷字符"},{"info","查看方案信息"},{"tab","插入制表符"},{"version","输出版本号"}}
local function matches(input)
  local out={}
  for _,entry in ipairs(commands) do if entry[1]:sub(1,#input)==input then out[#out+1]=entry end end
  return out
end
local function action(id,env)
  local ctx=env.engine.context
  ctx:clear()
  if id=="space" then ctx:set_option("xm_noquickhint",not ctx:get_option("xm_noquickhint"))
  elseif id=="head" then launch("preedit")
  elseif id=="preview" then launch("preview")
  elseif id=="schema" then env.engine:process_key(KeyEvent("F4"))
  elseif id=="mabiao" then launch("schemas")
  elseif id=="update" then launch("update")
  elseif id=="sort" then cycle(ctx,"xm_sort",5)
  elseif id=="delay" then ctx:set_option("xm_sentence",false);ctx:set_option("xm_delay",not ctx:get_option("xm_delay"))
  elseif id=="index" or id=="layout" or id=="preedit" then launch(id)
  elseif id=="empty" then launch("hidden")
  elseif id=="default" then launch("resetsettings")
  elseif id=="comment" then cycle(ctx,"xm_note",env.note_count+1)
  elseif id=="charset" then cycle(ctx,"xm_charset",5)
  elseif id=="word" then ctx:set_option("xm_words",not ctx:get_option("xm_words"))
  elseif id=="predict" then ctx:set_option("xm_nohints",not ctx:get_option("xm_nohints"))
  elseif id=="mode" then
    local delayed=ctx:get_option("xm_delay");local sentence_mode=ctx:get_option("xm_sentence")
    ctx:set_option("xm_delay",sentence_mode);ctx:set_option("xm_sentence",not delayed and not sentence_mode);clear_edit(env)
  elseif id=="variation" then ctx:set_option("xm_noivs",not ctx:get_option("xm_noivs"))
  elseif id=="punc" then ctx:set_option("ascii_punct",not ctx:get_option("ascii_punct"))
  elseif id=="pinyin" or id=="ziran" or id=="flypy" then env.engine:apply_schema(Schema(({pinyin="rime_ice",ziran="double_pinyin",flypy="double_pinyin_flypy"})[id]))
  elseif id=="tab" then env.engine:commit_text("\t")
  elseif id=="version" then env.engine:commit_text("潇明 v2.0 · 小狼毫")
  else launch(id=="user" and "words" or id=="lookup" and "lookup" or "appearance") end
end
local quick={}
local function read_quick(name)
  local f=io.open(base..name)
  if not f then return end
  for line in f:lines() do
    local k,v=line:match("^([a-z])\t(.*)$")
    if k then quick[k]=v~="" and v or nil end
  end
  f:close()
end
local function init(env)
  local config=env.engine.schema.config
  env.bindings={}
  for key in ("Shift_L Shift_R Control_L Control_R Caps_Lock Escape Return space Tab slash semicolon apostrophe grave comma period minus equal"):gmatch("%S+") do
    local actions=config:get_string("xm_keys/"..key)
    if actions then
      local empty,partial,menu=actions:match("^(%w[_%w]*),(%w[_%w]*),(%w[_%w]*)$")
      if empty then env.bindings[key]={empty,partial,menu} end
    end
  end
  env.sentence_space=config:get_int("xm_options/sentence_space") or 0
  env.uppercase=config:get_int("xm_options/uppercase") or 3
  env.digits=config:get_int("xm_options/digits") or 0
  env.digit_outside=config:get_bool("xm_options/digit_outside") or false
  env.commit_on_switch=config:get_bool("xm_options/commit_on_switch") or false
  env.tracks=config:get_string("xm_options/tracks") or "SFT"
  env.note_count=config:get_int("xm_options/note_count") or 2
  env.note_fields={}
  for i=1,env.note_count do
    env.note_fields[i]=config:get_string("xm_options/note_fields"..i) or field_defaults[i]
  end
  env.word_last=config:get_string("xm_options/word_annotation")~="off"
  env.horizontal=config:get_string("xm_options/direction")=="horizontal"
  env.second=env.engine.schema.config:get_string("xm_options/second") or "semicolon"
  env.third=env.engine.schema.config:get_string("xm_options/third") or "apostrophe"
  clear_edit(env)
  if not M.custom then
    M.custom={}
    local f=io.open(base.."charset.txt"); if f then for line in f:lines() do for _,cp in utf8.codes(line) do M.custom[utf8.char(cp)]=true end end;f:close() end
    if config:get_string("xm_options/quick_complete")~="yes" then read_quick("quick-defaults.tsv") end
    read_quick("quick.tsv")
  end
end
-- The processor and translator are separate Rime components; keep editor state per context.
local states={}
local function state(env)
  local key=env.engine.context:get_property("xm_session")
  if not key or key=="" then key=tostring({});env.engine.context:set_property("xm_session",key) end
  if not states[key] then states[key]={choice={},undo={}} end
  return states[key],key
end
local function panelpath(st)
  return base.."panel-"..st.token..".tsv"
end
local function close_panel(st)
  if st.token then os.remove(panelpath(st));os.remove(base.."panel-"..st.token..".pick");os.remove(base.."panel-"..st.token..".layout");st.token=nil end
  st.rows=nil
end
local function display_panel(st)
  local offset=math.floor((st.sel-1)/9)*9
  if st.panel=="grid" or st.panel=="sentence" then offset=0 end
  local file=io.open(panelpath(st),"w");if not file then return end
  local names={detail="字根查阅",similar="相似部件",grid="全部候选",sentence="整句编辑",schemas="输入方案"}
  local hint=st.panel=="sentence" and "字母定位　数字换字　Tab 返回" or "方向键定位　Enter 选字　Esc 返回　Ctrl+Enter 查字典"
  file:write(st.panel,"\t",names[st.panel]," · ",st.focus or "","\t",hint,"\n")
  local limit=(st.panel=="grid" or st.panel=="sentence") and #st.rows or math.min(#st.rows,offset+9)
  for i=offset+1,limit do
    local r=st.rows[i]
    file:write(i,"\t",i==st.sel and "1" or "0","\t",r[1]:gsub("[%c]"," "),"\t",(r[2] or ""):gsub("[%c]"," "),"\n")
  end
  file:close()
end
local function display_sentence(st,seq)
  local fresh=not st.token
  if fresh then st.token=string.format("%x%x",os.time(),math.random(1,0x7fffffff)) end
  st.panel="sentence";st.focus="";st.sel=st.cell;st.rows={}
  for i,cell in ipairs(seq) do
    local word=cell.opts[st.choice[i] or cell.best or 1] or ""
    local label=string.char(i<=20 and i+96 or i-20+64)
    st.rows[#st.rows+1]={word,cell.code.." · "..label}
  end
  display_panel(st)
  if fresh then launch("panel",st.token) end
end
local function panel_rows(kind,ctx,word)
  local rows={}
  if kind=="detail" then return {{word,note(word,2)}} end
  if kind=="grid" then
    local seg=ctx.composition:back()
    for j=0,499 do local c=seg:get_candidate_at(j);if not c then break end;rows[#rows+1]={c.text,c.comment} end
  else
    local target=details(word);if not target or target=="" then return {{word,note(word,1)}} end
    local pattern={};for _,cp in utf8.codes(target) do pattern[#pattern+1]=utf8.char(cp) end
    local exact,partial={},{}
    local f=io.open(base.."related.tsv")
    if f then
      for row in f:lines() do local ch,r=row:match("^(.-)\t(.+)$")
        if ch and ch~=word then
          local pos=1;local count=0
          for _,part in ipairs(pattern) do local _,j=r:find(part,pos,true);if j then count=count+1;pos=j+1 end end
          if count==#pattern then exact[#exact+1]={ch,r}
          elseif count>=math.max(1,#pattern-1) and #partial<90 then partial[#partial+1]={ch,r} end
          if #exact>=180 then break end
        end
      end
      f:close()
    end
    for _,v in ipairs(exact) do rows[#rows+1]=v end
    for _,v in ipairs(partial) do rows[#rows+1]=v end
  end
  if #rows==0 then rows={{word,note(word,1)}} end
  return rows
end
local function open_panel(st,ctx,kind)
  local c=ctx:get_selected_candidate();if not c then return false end
  st.focus=c.text;st.return_input=ctx.input;st.panel=kind;st.rows=panel_rows(kind,ctx,c.text);st.sel=1
  if kind=="grid" then st.sel=math.min(#st.rows,ctx.composition:back().selected_index+1) end
  st.token=string.format("%x%x",os.time(),math.random(1,0x7fffffff))
  ctx.input=":";display_panel(st)
  launch("panel",st.token)
  return true
end

local modifiers={[0xffe1]="Shift_L",[0xffe2]="Shift_R",[0xffe3]="Control_L",[0xffe4]="Control_R",[0xffe5]="Caps_Lock"}
local punctuation={slash="／",semicolon="；",apostrophe="‘",grave="｀",comma="，",period="。",minus="－",equal="＝"}
local function buffer_action(env,st,key,k,action)
  local ctx=env.engine.context
  local input=ctx.input
  local raw=input:gsub("^[~!]","")
  local candidate=ctx:get_selected_candidate()
  local function commit(text)
    ctx:clear()
    if text and text~="" then env.engine:commit_text(text) end
  end
  local function highlighted() return candidate and candidate.text or raw end
  if action=="pass" then return 0 end
  if action=="ignore" then return 1 end
  if action=="clear" then ctx:clear();clear_edit(st)
  elseif action=="section" then
    if input:sub(1,1)=="~" then
      local atoms=cells(raw,ctx,env);local seq=groups(st,atoms);local remain={}
      if seq[#seq] then for i=1,seq[#seq].start-1 do remain[#remain+1]=atoms[i].code end end
      clear_edit(st);if #remain==0 then ctx:clear() else ctx.input="~"..table.concat(remain) end
    else ctx:clear() end
  elseif action=="ascii" then ctx:clear();ctx:set_option("ascii_mode",not ctx:get_option("ascii_mode"))
  elseif action=="raw" or action=="raw_ascii" then
    commit(raw)
    if action=="raw_ascii" then ctx:set_option("ascii_mode",true) end
  elseif action=="selected" or action=="selected_ascii" then
    commit(highlighted())
    if action=="selected_ascii" then ctx:set_option("ascii_mode",true) end
  elseif action=="first" then
    local seg=ctx.composition:back()
    local first=seg and seg:get_candidate_at(0)
    commit(first and first.text or raw)
  elseif action=="second" or action=="third" then
    local seg=ctx.composition:back()
    local index=action=="second" and 1 or 2
    local size=env.engine.schema.page_size
    local c=seg and seg:get_candidate_at(math.floor(seg.selected_index/size)*size+index)
    if c then commit(c.text)
    else
      local fallback=env.bindings[k] and env.bindings[k][2] or "default"
      if fallback=="default" then fallback=({semicolon="quick",apostrophe="punctuation"})[k] or "ignore" end
      if fallback~="second" and fallback~="third" then return buffer_action(env,st,key,k,fallback) end
    end
  elseif action=="next" or action=="previous" then
    if ctx:has_menu() then env.engine:process_key(KeyEvent(action=="next" and "Page_Down" or "Page_Up")) end
  elseif action=="note" then cycle(ctx,"xm_note",env.note_count+1)
  elseif action=="charset" then cycle(ctx,"xm_charset",5)
  elseif action=="inspect" or action=="grid" then open_panel(st,ctx,action=="grid" and "grid" or "detail")
  elseif action=="command" or action=="reverse" or action=="quick" then
    commit(highlighted())
    if action~="quick" or next(quick) then ctx:push_input(({command="/",reverse="z",quick=";"})[action]) end
  elseif action=="split" then
    if input:sub(1,1)=="~" then
      if raw:sub(-1)~="\96" then ctx:push_input("\96") end
    elseif input~="" then clear_edit(st);st.making=true;ctx.input="~"..raw end
  elseif action=="temporary" then
    ctx:clear()
    if raw~="" then ctx.input="!"..raw else st.await_english=true end
  elseif action=="number" then commit(highlighted());st.number_run=true
    if k=="minus" then env.engine:commit_text("-") end
  elseif action=="punctuation" then
    local mark=punctuation[k]
    if not mark then return 0 end
    if ctx:get_option("ascii_punct") and key.keycode<128 then mark=string.char(key.keycode)
    elseif k=="apostrophe" then mark=st.quote_open and "’" or "‘";st.quote_open=not st.quote_open end
    commit(highlighted()..mark)
  else return nil end
  return 1
end
local function binding_at(env,ctx,k)
  local bindings=env.bindings[k]
  if not bindings then return nil end
  local phase=ctx.input=="" and 1 or ctx:has_menu() and 3 or 2
  local action=bindings[phase]
  if action~="default" then return action end
end
local shifted_keys={question="/",slash="/",colon=";",semicolon=";",quotedbl="'",apostrophe="'",asciitilde="`",grave="`",less=",",comma=",",greater=".",period=".",underscore="-",minus="-",plus="=",equal="=",braceleft="[",bracketleft="[",braceright="]",bracketright="]",bar="\\",backslash="\\",Return="Enter",parenright="0",exclam="1",at="2",numbersign="3",dollar="4",percent="5",asciicircum="6",ampersand="7",asterisk="8",parenleft="9"}
local function shortcut(key,env)
  if not key:ctrl() or not key:shift() then return nil end
  local f=io.open(base.."shortcuts.tsv","r")
  if f then
    local raw=f:read("*a");f:close()
    if raw~=env.shortcut_raw and raw:sub(-3)=="\n.\n" then
      local bindings={}
      for id,value,alt in raw:gmatch("([%w_]+)\t([^\t\n]+)\t([01])\n") do
        if value~="-" then bindings[alt..value]=id end
      end
      env.shortcuts=bindings;env.shortcut_raw=raw
    end
  end
  local name=key:repr():match("([^+]+)$")
  name=shifted_keys[name] or (name and name:upper())
  if not key:alt() and name=="Enter" then return "annotation" end
  return env.shortcuts and env.shortcuts[(key:alt() and "1" or "0")..(name or "")]
end
local function do_shortcut(id,env,st)
  local ctx=env.engine.context
  if id=="annotation" then
    local c=ctx:get_selected_candidate()
    if c then local txt=note(c.text,2,env);if txt~="" then ctx:clear();env.engine:commit_text(txt) end end
  elseif id=="capture_detail" then
    local c=ctx:get_selected_candidate()
    if c then
      local token=string.format("%x%x",os.time(),math.random(1,0x7fffffff))
      local f=io.open(base.."capture-"..token..".tsv","w")
      if f then f:write(c.text:gsub("[%c]"," "),"\t",(note(c.text,2):gsub("[%c]"," ")));f:close();launch("capture_detail",token) end
    end
  elseif id=="schemas" then
    local cfg=Config();cfg:load_from_file(rime_api.get_user_data_dir().."/build/default.yaml")
    local count=cfg:get_list_size("schema_list") or 0
    if count>0 then
      local c=ctx:get_selected_candidate();st.switch_word=c and c.text
      st.return_input=ctx.input;st.panel="schemas";st.focus="";st.rows={};st.schema_ids={};st.sel=1
      for i=0,count-1 do
        local sid=cfg:get_string("schema_list/@"..i.."/schema")
        st.schema_ids[i+1]=sid;st.rows[i+1]={Schema(sid).schema_name,""}
        if sid==env.engine.schema.schema_id then st.sel=i+1 end
      end
      st.token=string.format("%x%x",os.time(),math.random(1,0x7fffffff))
      ctx.input=":";display_panel(st);launch("panel",st.token)
    end
  elseif id=="cycle_schema" then
    local cfg=Config();cfg:load_from_file(rime_api.get_user_data_dir().."/build/default.yaml")
    local count=cfg:get_list_size("schema_list") or 0
    for i=0,count-1 do
      if cfg:get_string("schema_list/@"..i.."/schema")==env.engine.schema.schema_id then
        local next_id=cfg:get_string("schema_list/@"..((i+1)%count).."/schema")
        local c=ctx:get_selected_candidate();local word=c and c.text
        ctx:clear();if env.commit_on_switch and word then env.engine:commit_text(word) end
        env.engine:apply_schema(Schema(next_id));break
      end
    end
  elseif id=="appearance" or id=="words" or id=="schemas" or id=="capture" or id=="capture_detail" or id=="layout" or id=="hidden" or id=="preedit" or id=="preview" or id:match("^page[3-9]$") then launch(id)
  else action(id,env);if id=="mode" then clear_edit(st) end end
end
function M.process(key,env)
  if key:release() then
    local tap=env.tap
    if tap and modifiers[key.keycode]==tap.key then
      env.tap=nil
      return buffer_action(env,state(env),key,tap.key,tap.action) or 2
    end
    if env.mixed_shift and (key.keycode==0xffe1 or key.keycode==0xffe2) then
      env.mixed_shift=false
      return 1
    end
    return 2
  end
  local ctx=env.engine.context; local k=key:repr(); local input=ctx.input
  -- YUME's panel header shows the raw code without Rime's extra soft-cursor glyph.
  -- Keep the cursor in explicit reverse lookup and sentence editing contexts.
  local soft_cursor=input:sub(1,1)=="z" or input:sub(1,1)=="~"
  if ctx:get_option("soft_cursor")~=soft_cursor then ctx:set_option("soft_cursor",soft_cursor) end
  sync_runtime(ctx,env)
  if k=="Control+space" then state(env).after_digit=nil;ctx:clear();ctx:set_option("ascii_mode",not ctx:get_option("ascii_mode"));return 1 end
  local st=state(env)
  local shortcut_id=shortcut(key,env)
  if shortcut_id then do_shortcut(shortcut_id,env,st);return 1 end
  local modifier=modifiers[key.keycode]
  if env.tap and env.tap.key~=modifier then env.tap=nil end
  local solo_modifier=modifier and not key:alt() and
    (not key:ctrl() or modifier=="Control_L" or modifier=="Control_R") and
    (not key:shift() or modifier=="Shift_L" or modifier=="Shift_R")
  if solo_modifier then
    local action=binding_at(env,ctx,modifier)
    if action and action~="pass" then env.tap={key=modifier,action=action};return 1 end
  end
  if ctx:get_option("ascii_mode") then return 2 end
  if st.token and input~=":" and not (st.panel=="sentence" and st.cell and input:sub(1,1)=="~") then close_panel(st) end
  local plain=not key:ctrl() and not key:alt() and not k:find("Super+",1,true)
  if st.await_english and plain and key.keycode>=33 and key.keycode<=126 then
    st.await_english=nil;ctx.input="!"..string.char(key.keycode);return 1
  elseif st.await_english and not modifier then st.await_english=nil end
  if st.number_run and plain and key.keycode>=32 and key.keycode<=126 then
    local literal=string.char(key.keycode)
    if literal:match("^[%d.,:+*/%%-]$") then env.engine:commit_text(literal);return 1 end
    st.number_run=nil
  elseif st.number_run and not modifier then st.number_run=nil end
  if input:sub(1,1)=="!" and #input>1 then
    if k=="Escape" then ctx:clear()
    elseif k=="BackSpace" then
      if #input==2 then ctx:clear() else ctx:pop_input(1) end
    elseif k=="space" or k=="Return" then
      ctx:clear();env.engine:commit_text(input:sub(2))
    elseif plain and key.keycode>=33 and key.keycode<=126 then
      if key:shift() then env.mixed_shift=true end
      ctx:push_input(string.char(key.keycode))
    else return 2 end
    return 1
  end
  if plain and not modifier and not st.cell and (input=="" or input:match("^[a-y~z]")) then
    local action=binding_at(env,ctx,k)
    if action then
      local response=buffer_action(env,st,key,k,action)
      if response~=nil then return response end
    end
  end
  local digit=plain and k:match("^%d$")
  if input:match("^#.+") then
    if k=="Escape" then ctx:clear();return 1 end
    if k=="BackSpace" then if #input==2 then ctx:clear() else ctx:pop_input(1) end;return 1 end
    local ch=plain and key.keycode>=32 and key.keycode<=126 and string.char(key.keycode)
    if ch and ch:match("^[%d.,:+*/%%-]$") then ctx:push_input(ch);return 1 end
    if not modifier and plain then
      ctx:clear();env.engine:commit_text(input:sub(2));input=""
      if k=="space" or k=="Return" then return 1 end
    end
  end
  if input:match("^=[.,:]$") then
    local mark=input:sub(2)
    ctx:clear()
    if k=="BackSpace" or k=="Escape" then return 1 end
    if digit then
      env.engine:commit_text(mark..k);st.after_digit=true;return 1
    end
    env.engine:commit_text(({["."]="。",[","]="，",[":"]="："})[mark])
    input=""
  end
  if input=="" and not ctx:get_option("full_shape") then
    if digit then
      if env.digits==4 then ctx:push_input("#"..k)
      else env.engine:commit_text(k);st.after_digit=true;if env.digits==3 then ctx:set_option("ascii_mode",true) end end
      return 1
    end
    if st.after_digit and not ctx:get_option("ascii_punct") then
      local mark=({period=".",comma=",",colon=":",["Shift+colon"]=":"})[k]
      if mark and env.digits==0 then ctx:push_input("="..mark);st.after_digit=nil;return 1 end
      if mark and env.digits==1 then env.engine:commit_text(mark);st.after_digit=nil;return 1 end
      if mark and env.digits==2 then env.engine:commit_text(({["."]="。",[","]="，",[":"]="："})[mark]);st.after_digit=nil;return 1 end
    end
  end
  if key.keycode~=0xffe1 and key.keycode~=0xffe2 then st.after_digit=nil end
  if plain and key.keycode>=65 and key.keycode<=90 and (input=="" or input:match("^[a-y]+$")) then
    local candidate=ctx:get_selected_candidate()
    local literal=string.char(key.keycode)
    if env.uppercase==2 then
      ctx:clear();ctx:push_input("!"..input..literal)
    else
      if input~="" then
        local word=env.uppercase==1 and input or candidate and candidate.text or input
        ctx:clear();env.engine:commit_text(word)
      end
      if env.uppercase==0 or env.uppercase==1 then
        env.engine:commit_text(literal);ctx:set_option("ascii_mode",true)
      elseif env.uppercase==4 then env.engine:commit_text(literal)
      else ctx:push_input("!"..literal) end
    end
    if key:shift() then env.mixed_shift=true end
    return 1
  end
  if input==":" and st.token then
    local chosen
    if k=="F24" then local f=io.open(base.."panel-"..st.token..".pick");if f then chosen=tonumber(f:read("*l"));f:close() end
    elseif k=="Escape" or k=="Tab" then local prev=st.return_input;close_panel(st);ctx.input=prev;return 1
    elseif k=="Control+Return" then
      local w=st.rows[st.sel][1];local hex=w:gsub(".",function(ch)return string.format("%02x",ch:byte()) end)
      launch("web",hex);return 1
    elseif k=="space" or k=="Return" then chosen=st.sel
    elseif k:match("^[1-9]$") then chosen=math.floor((st.sel-1)/9)*9+tonumber(k)
    else
      local columns,capacity=3,9
      if st.panel=="grid" then
        local f=io.open(base.."panel-"..st.token..".layout")
        if f then local a,b=f:read("*a"):match("^(%d+)\t(%d+)$");f:close();columns=tonumber(a) or columns;capacity=tonumber(b) or capacity end
      end
      local delta=({Left=-1,Right=1,Up=-columns,Down=columns,minus=-capacity,equal=capacity,Page_Up=-capacity,Page_Down=capacity})[k]
      if delta then st.sel=math.max(1,math.min(#st.rows,st.sel+delta));display_panel(st);ctx:refresh_non_confirmed_composition();return 1 end
    end
    if chosen then local row=st.rows[chosen];if row then
      local w=row[1];local schema_id=st.panel=="schemas" and st.schema_ids[chosen];local previous=st.switch_word
      close_panel(st);ctx:clear()
      if schema_id then
        if env.commit_on_switch and previous then env.engine:commit_text(previous) end
        env.engine:apply_schema(Schema(schema_id))
      else env.engine:commit_text(w) end
    end;return 1 end
  elseif ctx:has_menu() and not input:match("^[/:;~]") then
    local previous=env.horizontal and "Up" or "Left"
    local following=env.horizontal and "Down" or "Right"
    if k==previous or k==following then
      env.engine:process_key(KeyEvent(k==previous and "Page_Up" or "Page_Down"))
      return 1
    end
    local kind=({Tab="detail",["Shift+Tab"]="similar",ISO_Left_Tab="similar",Left="grid",Right="grid",Up="grid",Down="grid"})[k]
    if kind and open_panel(st,ctx,kind) then return 1 end
  end
  if k=="slash" and ctx:has_menu() and input:sub(1,1)~="/" then cycle(ctx,"xm_note",env.note_count+1);return 1 end
  if k=="0" and ctx:has_menu() and not input:match("^[/~]") then cycle(ctx,"xm_charset",5);return 1 end
  if env.digit_outside and digit and digit~="0" and ctx:has_menu() and input:match("^[a-y]+$") then
    local seg=ctx.composition:back();local n=env.engine.schema.page_size
    if not seg:get_candidate_at(math.floor(seg.selected_index/n)*n+tonumber(digit)-1) then
      local c=ctx:get_selected_candidate();ctx:clear();if c then env.engine:commit_text(c.text) end
      if env.digits==4 then ctx:push_input("#"..digit) else env.engine:commit_text(digit);st.after_digit=true;if env.digits==3 then ctx:set_option("ascii_mode",true) end end
      return 1
    end
  end
  if input=="" then
    clear_edit(st)
    if k=="slash" or (k=="semicolon" and next(quick)) then ctx:push_input(k=="slash" and "/" or ";");return 1 end
    if ctx:get_option("xm_delay") and k:match("^[a-y]$") then ctx:push_input(k);return 1 end
    if ctx:get_option("xm_sentence") and k:match("^[a-y]$") then ctx:push_input("~"..k);return 1 end
  elseif is_delayed(input,ctx) then
    local raw=input
    local selected=ctx:get_selected_candidate()
    local function commit_selected()
      local w=selected and selected.text or raw
      ctx:clear();env.engine:commit_text(w)
    end
    if k:match("^[a-y]$") then
      local complete=selected and (selected.type=="xm_delayed" or selected.type=="xm_user" or selected.type=="xm_word")
      if complete then
        commit_selected();ctx:push_input(k)
      else ctx:push_input(k) end
      return 1
    elseif k=="grave" then
      clear_edit(st);st.making=true;ctx.input="~"..raw;return 1
    elseif k=="space" then
      if not selected and lookup()[raw.."_"] then
        for _,w in ipairs(lookup()[raw.."_"]) do if allowed(w,ctx) then ctx:clear();env.engine:commit_text(w);return 1 end end
      end
      commit_selected();return 1
    elseif selected and (k==env.second or k==env.third or k:match("^[1-9]$")) then
      local seg=ctx.composition:back();local n=env.engine.schema.page_size
      local idx=math.floor(seg.selected_index/n)*n+((k==env.second and 2 or k==env.third and 3 or tonumber(k))-1)
      local c=seg:get_candidate_at(idx)
      if c then
        local w=c.text;ctx:clear();env.engine:commit_text(w)
      elseif k=="semicolon" or k=="apostrophe" then
        commit_selected()
        if k=="semicolon" and next(quick) then ctx:push_input(";");return 1 end
        return 2
      end
      return 1
    elseif k=="semicolon" or k=="apostrophe" then
      commit_selected()
      if k=="semicolon" and next(quick) then ctx:push_input(";");return 1 end
      return 2
    elseif k=="Return" then ctx:clear();env.engine:commit_text(raw);return 1
    elseif k=="BackSpace" then if #raw<=1 then ctx:clear() else ctx:pop_input(1) end;return 1
    elseif k=="Escape" then ctx:clear();return 1
    elseif k=="z" or k=="comma" or k=="period" or k=="question" or k=="exclam" then
      commit_selected();return 2
    end
  elseif k=="grave" and input:match("^[a-y_]+$") then
    clear_edit(st);st.making=true;ctx.input="~"..input;return 1
  elseif input==";" then
    local s=quick[({semicolon=";",comma=",",period=".",dollar="$",grave="\96"})[k] or k]
    if s then ctx:clear();env.engine:commit_text(s);return 1 end
    if k:match("^[a-z]$") then ctx:clear();return 1 end
  elseif input:sub(1,1)=="/" then
    if input:sub(1,2)=="//" and (k=="space" or k=="Return") then local c=ctx:get_selected_candidate();if c then local s=c.text;ctx:clear();env.engine:commit_text(s) end;return 1 end
    if k=="slash" and input=="/" then ctx:push_input("/");return 1 end
    if k:match("^[a-z]$") or (input:sub(1,2)=="//" and k:match("^[0-9A-F]$")) then ctx:push_input(k);return 1 end
    if input:sub(1,2)~="//" and (k=="space" or k=="Return" or k:match("^[1-9]$")) then
      local seg=ctx.composition:back()
      local index=seg and seg.selected_index or 0
      local n=env.engine.schema.page_size or 5
      if tonumber(k) then index=math.floor(index/n)*n+tonumber(k)-1 end
      local entry=matches(input:sub(2))[index+1];if entry then
        if entry[1]=="schema" then ctx:clear();do_shortcut("schemas",env,st) else action(entry[1],env) end
      else local sym=syms(input)[index+1-#matches(input:sub(2))];if sym then ctx:clear();env.engine:commit_text(sym) end end
      return 1
    end
  elseif input:sub(1,1)=="~" then
    local raw=input:sub(2);local atoms=cells(raw,ctx,env);local seq=groups(st,atoms)
    if k=="Tab" then
      local selected=ctx:get_selected_candidate()
      if not st.cell and selected and selected.type~="xm_sentence" then
        if open_panel(st,ctx,"detail") then return 1 end
      end
      if not st.cell and #seq>40 then
        local overflow=#seq-40
        local prefix=sentence(st,seq,overflow)
        if prefix then
          local remaining={}
          for i=overflow+1,#seq do remaining[#remaining+1]=seq[i].code end
          ctx:clear();env.engine:commit_text(prefix);clear_edit(st)
          ctx.input="~"..table.concat(remaining)
        end
      end
      st.recode=nil;st.cell=not st.cell and 1 or nil
      if not st.cell then close_panel(st) end
      ctx:refresh_non_confirmed_composition();return 1
    end
    if st.cell then
      if plain and key.keycode>=65 and key.keycode<=84 then k=string.char(key.keycode) end
      if k=="F24" and st.token then
        local f=io.open(base.."panel-"..st.token..".pick")
        if f then local chosen=tonumber(f:read("*l"));f:close();if chosen and chosen>=1 and chosen<=#seq then st.cell=chosen end end
      elseif st.recode~=nil then
        if k=="Escape" then st.recode=nil
        elseif k=="space" or k=="Return" then
          local cell=seq[st.cell]
          if cell and st.recode~="" and lookup()[st.recode] then
            remember(st,ctx);local pieces={}
            for j=1,cell.start-1 do pieces[#pieces+1]=atoms[j].code end
            pieces[#pieces+1]=st.recode
            for j=cell.last+1,#atoms do pieces[#pieces+1]=atoms[j].code end
            st.join={};st.choice={};st.recode=nil;ctx.input="~"..table.concat(pieces)
          elseif lookup()[st.recode.."_"] then st.recode=st.recode.."_" end
        elseif k=="BackSpace" then if st.recode=="" then st.recode=nil else st.recode=st.recode:sub(1,-2) end
        elseif k:match("^[a-y]$") and #st.recode<5 then st.recode=st.recode..k end
      elseif k=="x" then st.recode=""
      elseif k=="u" or k=="v" then
        local cell=seq[st.cell]
        if cell and ((k=="u" and cell.last<#atoms) or (k=="v" and cell.last>cell.start)) then
          remember(st,ctx);st.join=st.join or {};st.join[k=="u" and cell.last or cell.last-1]=k=="u" or nil;st.choice={}
        end
      elseif k=="Escape" then st.cell=nil;close_panel(st)
      elseif k=="Left" or k=="Right" then st.cell=math.max(1,math.min(#seq,st.cell+(k=="Right" and 1 or -1)))
      elseif k=="BackSpace" or k=="z" then local h=table.remove(st.undo);if h then st.choice=h.choice;st.cell=h.cell;st.join=h.join;ctx.input=h.raw end
      elseif k=="w" or k=="y" then st.cell=math.max(1,math.min(#seq,st.cell+(k=="w" and 1 or -1)))
      elseif k:match("^[a-tA-T]$") then st.cell=math.min(#seq,k:match("%u") and k:byte()-64+20 or k:byte()-96)
      elseif k=="space" or k:match("^[1-9]$") then
        local seg=ctx.composition:back();local idx=seg and seg.selected_index or 0
        local n=env.engine.schema.page_size or 5
        if tonumber(k) then idx=math.floor(idx/n)*n+tonumber(k)-1 end
        if idx==0 then local s=sentence(st,seq);if s then if st.making then learn(s) end;ctx:clear();env.engine:commit_text(s) end
        elseif seq[st.cell] and seg then local picked=seg:get_candidate_at(idx)
          if picked then for j,w in ipairs(seq[st.cell].opts) do if w==picked.text then remember(st,ctx);st.choice[st.cell]=j;break end end end
        end
      elseif k=="Return" then
        local s=sentence(st,seq,st.cell);if s then local rest={};for i=st.cell+1,#seq do rest[#rest+1]=seq[i].code end;ctx:clear();env.engine:commit_text(s);clear_edit(st);if #rest>0 then ctx:push_input("~"..table.concat(rest)) end end
      else return 2 end
      ctx:refresh_non_confirmed_composition();return 1
    end
    if k:match("^[a-y]$") then ctx:push_input(k);return 1 end
    if k=="grave" then if raw:sub(-1)~="\96" then ctx:push_input("\96") end;return 1 end
    if k=="space" and seq[#seq] and lookup()[seq[#seq].code.."_"] then ctx:push_input("_");return 1 end
    if k=="Escape" or k=="Shift+Escape" then
      local last=seq[#seq]
      local previous={}
      if k=="Escape" and last then
        for i=1,last.start-1 do previous[#previous+1]=atoms[i].code end
      end
      clear_edit(st)
      if #previous==0 then ctx:clear() else ctx.input="~"..table.concat(previous) end
      return 1
    end
    if k=="space" and env.sentence_space>0 and raw:sub(-1)~="\96" and raw:sub(-1)~="_" then
      local last=seq[#seq]
      local automatic=last and (#last.code>=5 or last.code:match("[defijk]$"))
      if last and (env.sentence_space==2 or not automatic) then ctx:push_input("\96");return 1 end
    end
    if k:match("^[2-9]$") then
      local seg=ctx.composition:back()
      local page_size=env.engine.schema.page_size
      if seg and tonumber(k)<=page_size then
        local offset=math.floor(seg.selected_index/page_size)*page_size
        local candidate=seg:get_candidate_at(offset+tonumber(k)-1)
        if candidate then local text=candidate.text;ctx:clear();env.engine:commit_text(text) end
      end
      return 1
    end
    if k=="space" or k=="1" then local selected=ctx:get_selected_candidate()
      local s=k=="space" and selected and selected.type=="xm_lane" and selected.text or sentence(st,seq);if s then if st.making then learn(s) end;ctx:clear();env.engine:commit_text(s) end;return 1 end
    if k=="Return" then ctx:clear();env.engine:commit_text(raw);return 1 end
    local punct=({comma="，",period="。",question="？",exclam="！",colon="：",semicolon="；"})[k]
    if punct then local text=sentence(st,seq);if text then ctx:clear();env.engine:commit_text(text..punct) end;return 1 end
    if k=="BackSpace" then clear_edit(st);if #raw<=1 then ctx:clear() else ctx:pop_input(1) end;return 1 end
  end
  if #input>=2 and input:match("^[a-y_]+$") and k:match("^[a-y]$") and ctx:has_menu() then
    local hit=ctx:get_selected_candidate()
    if hit then local w=hit.text;ctx:clear();env.engine:commit_text(w) end
  end
  return 2
end
function M.translate(input,seg,env)
  local ctx=env.engine.context
  local function put(kind,text,comment,display)
    local c=Candidate(kind,seg.start,seg._end,text,comment or "");if display then c.preedit=display end;yield(c)
  end
  if input:match("^[!#].+") or input:match("^=[.,:]$") then
    local literal=input:sub(2)
    put("xm_literal",literal,"",literal)
  elseif input:sub(1,2)=="//" then
    local h=input:sub(3);local cp=h:match("^%x+$") and tonumber(h,16)
    if cp and cp>=32 and cp<=0x10ffff and not (cp>=0xd800 and cp<=0xdfff) then put("unicode",utf8.char(cp),string.format("U+%04X",cp)) end
  elseif input:sub(1,1)=="/" then for _,v in ipairs(matches(input:sub(2))) do put("xm_cmd","/"..v[1],v[2]) end;for _,v in ipairs(syms(input)) do put("xm_symbol",v,"符号") end
  elseif input==";" then for i=97,122 do local k=string.char(i);if quick[k] then put("xm_quick",quick[k],k) end end
  elseif input=="z" then local h=history(ctx);for i=#h,1,-1 do put("xm_history",h[i],"最近上屏") end
  elseif input==":" then
    local st=state(env);local row=st.rows and st.rows[st.sel];if row then put("xm_detail",row[1],row[2],st.focus) end
  elseif is_delayed(input,ctx) then
    local raw=input;local dictionary=lookup()
    local depth=level(ctx,"xm_note",env.note_count+1);local seen={};local count=0
    local function offer(kind,w,tag)
      if seen[w] or (kind~="xm_user" and kind~="xm_word" and not allowed(w,ctx)) then return end
      seen[w]=true;count=count+1
      local annotation=depth>0 and note(w,depth,env) or ""
      put(kind,w,tag..(tag~="" and annotation~="" and "  " or "")..annotation,raw)
    end
    for _,w in ipairs(wordlist()[raw] or {}) do offer("xm_user",w,"个人词") end
    for _,w in ipairs(dictionary[raw] or {}) do offer("xm_delayed",w,"") end
    if ctx:get_option("xm_words") then
      local lengths=env.engine.schema.config:get_string("xm_options/word_lengths") or "234+"
      for _,w in ipairs(phrase_rows(raw)) do local n=utf8.len(w);if lengths:find(n>4 and "+" or tostring(n),1,true) then offer("xm_word",w,"词") end end
    end
    if count>0 then return end
    if not ctx:get_option("xm_noquickhint") then
      for _,w in ipairs(dictionary[raw.."_"] or {}) do offer("xm_short",w,"␣") end
    end
    if not ctx:get_option("xm_nohints") then
      -- Prioritize codes one key from completion. Never commit a preview on continued typing.
      local maximum=ctx:get_option("xm_fullprefix") and 5 or #raw+1
      local codes=dictionary.prefixes and dictionary.prefixes(raw,maximum) or prefixes[raw] or {}
      for length=#raw+1,(ctx:get_option("xm_fullprefix") and 5 or #raw+1) do
        for _,code in ipairs(codes) do
          if #code==length then
            for _,w in ipairs(dictionary[code]) do
              offer("xm_preview",w,"＋"..code:sub(#raw+1))
              -- Keep all matching candidates available for paging and the grid.
            end
          end
        end
      end
    end
  elseif input:sub(1,1)=="~" then
    local st=state(env);local atoms=cells(input:sub(2),ctx,env);local seq=groups(st,atoms);local s=sentence(st,seq)
    local display=input:sub(2):gsub("_","␣");if not s then return end
    if st.cell then display_sentence(st,seq) end
    put("xm_sentence",s,st.recode~=nil and ("改码："..st.recode) or st.cell and ("正在改第 "..st.cell.." 格") or (st.making and "快捷造词 · Tab 回改" or "Tab 回改"),display)
    if not st.cell and not st.making then
      local titles={S="通规",F="通繁",T="台湾"}
      local seen={[s]=true}
      for _,lane in ipairs(atoms.lanes) do
        if not seen[lane.text] then
          put("xm_lane",lane.text,titles[lane.track],display)
          seen[lane.text]=true
        end
      end
    end
    if st.cell and seq[st.cell] then for _,w in ipairs(seq[st.cell].opts) do put("xm_choice",w,"第 "..st.cell.." 字",display) end end
  else if #input==1 and not ctx:get_option("xm_noquickhint") then local fixed={a="中",b="爱",c="她",g="有",h="一",l="为",m="说",n="这",o="然",p="道",q="后",r="得",s="么",t="到",u="那",v="个",w="你",x="头",y="没"};if fixed[input] then put("xm_short",fixed[input],"␣") end end
    local ws=wordlist()[input];if ws then for _,w in ipairs(ws) do put("xm_user",w,"个人词") end end
    if ctx:get_option("xm_words") and input:match("^[a-y]+$") then local lengths=env.engine.schema.config:get_string("xm_options/word_lengths") or "234+";for _,w in ipairs(phrase_rows(input)) do
      local count=utf8.len(w);if lengths:find(count>4 and "+" or tostring(count),1,true) then local c=Candidate("xm_word",seg.start,seg._end,w,"词");c.quality=-100;yield(c) end
    end end
  end
end
function M.filter(input,env)
  local ctx=env.engine.context;local l=level(ctx,"xm_note",env.note_count+1)
  local order=level(ctx,"xm_sort",5);local tail={}
  for c in input:iter() do
    local orig=c:get_genuine()
    if is_delayed(ctx.input,ctx) and not c.type:match("^xm_") then
      -- The Lua translator owns this buffer, including incomplete codes.
    elseif (c.type=="xm_user" or c.type=="xm_word") and l>0 then
      local label=c.type=="xm_user" and "个人词" or "词"
      local annotation=note(c.text,l,env)
      orig.comment=annotation~="" and (label.."  "..annotation) or label
      yield(c)
    elseif ctx.input==":" and c.type~="xm_detail" then
      -- Only the selected inspection result belongs in the companion panel.
    elseif c.type=="table" or c.type=="reverse_lookup" or c.type=="xm_delayed" or c.type=="xm_preview" or c.type=="xm_short" then
      if allowed(c.text,ctx) then
        if l>0 and c.type~="xm_preview" and c.type~="xm_short" then local n=note(c.text,l,env);if n~="" then orig.comment=n end end
        local priority=true;if order>0 then local _,_,_,_,f=details(c.text);priority=(order==4 and (M.custom or {})[c.text]) or (order<4 and f and f:find(({"C","S","T"})[order],1,true)) end
        if priority then yield(c) else tail[#tail+1]=c end
      end
    else yield(c) end
  end
  for _,c in ipairs(tail) do yield(c) end
end
M.init=init
M.processor_init=function(env)
  init(env);env.runtime_ready=false
  env.runtime_connection=env.engine.context.option_update_notifier:connect(function(ctx,name)
    if runtime_set[name] then save_runtime(ctx,env) end
  end)
end
M.fini=function(env) if env.runtime_connection then env.runtime_connection:disconnect() end;local id=env.engine.context:get_property("xm_session");if id then if states[id] then close_panel(states[id]) end;states[id]=nil end end
return M
