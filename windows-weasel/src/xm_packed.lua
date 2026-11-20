-- Immutable large tables stay in one string, outside the Lua object graph.
-- Sparse block index + bounded decoded cache avoids full-heap GC on every query.
local M={}
function M.open(path,split)
  local f=io.open(path..'.tsv','rb');if not f then return nil end
  local data=f:read('*a');f:close()
  f=io.open(path..'.idx','r');if not f then return nil end
  local keys,offsets={},{}
  for line in f:lines() do local key,off=line:match('^(.-)\t(%d+)$');if key then keys[#keys+1]=key;offsets[#offsets+1]=tonumber(off)+1 end end
  f:close();if #keys==0 then return nil end
  local cache,queue,head={}, {},1
  local function start(key)
    local lo,hi=1,#keys
    while lo<=hi do local mid=(lo+hi)//2;if keys[mid]<=key then lo=mid+1 else hi=mid-1 end end
    return offsets[math.max(1,hi)]
  end
  local function get(key)
    if cache[key]~=nil then return cache[key]~=false and cache[key] or nil end
    local pos=start(key);local value
    while pos<=#data do
      local tab=data:find('\t',pos,true);local finish=tab and data:find('\n',tab,true)
      if not finish then break end
      local found=data:sub(pos,tab-1)
      if found>key then break end
      if found==key then value=data:sub(tab+1,finish-1);break end
      pos=finish+1
    end
    if value and split then local list={};for word in value:gmatch('%S+') do list[#list+1]=word end;value=list end
    local old=queue[head];if old then cache[old]=nil end
    queue[head]=key;head=head%256+1;cache[key]=value or false
    return value
  end
  local function prefixes(prefix,length)
    local result={};local pos=start(prefix)
    while pos<=#data do
      local tab=data:find('\t',pos,true);local finish=tab and data:find('\n',tab,true)
      if not finish then break end
      local key=data:sub(pos,tab-1)
      if key>=prefix then
        if key:sub(1,#prefix)~=prefix then break end
        if #key>#prefix and #key<=length and not key:find('_',1,true) then result[#result+1]=key end
      end
      pos=finish+1
    end
    return result
  end
  local function floor(key)
    local pos=start(key);local value
    while pos<=#data do
      local tab=data:find('\t',pos,true);local finish=tab and data:find('\n',tab,true)
      if not finish or data:sub(pos,tab-1)>key then break end
      value=data:sub(tab+1,finish-1);pos=finish+1
    end
    return value
  end
  return setmetatable({prefixes=prefixes,floor=floor},{__index=function(_,key)return get(key) end})
end
return M
