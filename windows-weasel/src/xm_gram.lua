-- Read a YGM2 character sequence model using Lua's 64-bit integers.
-- The table contains packed keys followed by single-precision scores.
local M={}
local function fingerprint(text)
  local high,low,length=0,0,0
  for _,cp in utf8.codes(text) do
    length=length+1
    if length>6 then return nil end
    high=(high<<21)|(low>>43)
    low=(low<<21)|cp
  end
  if length<2 then return nil end
  local value=low~(high*0x9e3779b97f4a7c15)
  value=(value~(value>>30))*0xbf58476d1ce4e5b9
  value=(value~(value>>27))*0x94d049bb133111eb
  value=value~(value>>31)
  return value==0 and 1 or value
end

function M.open(path)
  local file=io.open(path,"rb")
  if not file then return nil end
  local header=file:read(16)
  if not header or #header~=16 or header:sub(1,4)~="YGM2" or header:byte(13)~=64 or header:byte(14)~=0 then
    file:close()
    return nil
  end
  local slots,used=string.unpack("<I4I4",header,5)
  local size=file:seek("end")
  if slots==0 or used>=slots or size~=16+12*slots or size>256*1024*1024 then
    file:close()
    return nil
  end
  file:seek("set",16)
  local data=file:read("*a")
  file:close()
  if not data or #data~=size-16 then return nil end
  local score_start=slots*8+1
  return function(text)
    local key=fingerprint(text)
    if not key then return 0 end
    -- Compute the high 64 bits of unsigned key * slots using two limbs.
    local slot=((key>>32)*slots+(((key&0xffffffff)*slots)>>32))>>32
    local start=slot
    repeat
      local stored=string.unpack("<i8",data,slot*8+1)
      if stored==0 then return 0 end
      if stored==key then
        local score=string.unpack("<f",data,score_start+slot*4)
        return score
      end
      slot=(slot+1)%slots
    until slot==start
    return 0
  end
end
return M
