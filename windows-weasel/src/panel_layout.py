"""Viewport for candidate overview and the forty-cell sentence editor."""
import math

def viewport(kind,count,selected,dpi,area_width,area_height,row_height):
    scale=dpi/96
    if kind=='detail':cols=1;target=round(490*scale)
    elif kind=='schemas':cols=1;target=round(360*scale)
    elif kind=='similar':cols=3;target=round(505*scale)
    elif kind=='sentence':cols=min(8,max(1,int(area_width//(108*scale))));target=round(cols*108*scale)
    else:cols=min(8,max(1,int(area_width//(172*scale))));target=round(cols*172*scale)
    cols=min(cols,max(1,count))
    if kind=='sentence':target=round(max(324,cols*108)*scale)
    elif kind=='grid':target=round(max(344,cols*172)*scale)
    width=min(area_width,target)
    available=max(1,int((area_height-72)//row_height))
    rows=min(available,max(1,math.ceil(count/cols)))
    capacity=rows*cols
    start=(max(0,selected)//capacity)*capacity
    return cols,width,min(area_height,72+rows*row_height),start,capacity
