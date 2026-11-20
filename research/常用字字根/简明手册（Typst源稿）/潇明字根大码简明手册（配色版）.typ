// Typst 0.15.1
// 在本文件所在目录编译：typst compile --ignore-system-fonts --font-path fonts 潇明字根大码简明手册.typ
// 数据源：本地 zigen-xiaoming.csv、chaifen.csv 及《通用规范汉字表》一级字。
// 专用字形：forfudan/yu 的 Yuniversus（src/public/fonts/Yuniversus.woff）。
// 编译所需字体与来源见本归档 research/README.md。
// 每组 pairs 中第一个字符串是原表字根，第二个字符串是一级例字。
// 空字符串表示一级字表中没有例字。口诀改序后，“句中”栏自动跟随。
#let serif = "Noto Serif SC"
#let sans = "Noto Sans SC"
#let scheme = "Yuniversus"
#let ink = rgb("#192c2d")
#let examples-ink = rgb("#3d4c4d")
#let mute = rgb("#526260")
#let accent = rgb("#904631")
#let rule = rgb("#b7c5c0")
#let row-height = 21.5pt
#let letter-col = 31pt

#set document(title: "潇明字根大码简明手册", description: "19 键口诀、397 个字根及一级例字")
#set text(font: sans, lang: "zh", region: "CN", size: 10pt, fill: ink)
#set par(justify: false, spacing: 0pt, leading: 0.4em)
#set page(
  paper: "a4",
  margin: (top: 12.5mm, bottom: 16mm, x: 13.8mm),
  footer-descent: 5mm,
  footer: context [
    #line(length: 100%, stroke: 0.4pt + rule)
    #v(3.5pt)
    #grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      [],
      text(size: 9pt, fill: accent)[#counter(page).display("01") / #context numbering("01", counter(page).final().first())],
    )
  ],
)
#show heading.where(level: 1): it => block(width: 100%, above: 0pt, below: 0pt, it.body)

#let glyph(form) = {
  let cp = form.to-unicode()
  let font = if cp >= 0xe000 and cp <= 0xf8ff { scheme } else { serif }
  text(font: font, size: 17pt, weight: "medium", fill: rgb("#00695f"), form)
}
#let specimen(pair) = {
  let (form, chars) = pair
  let example = if chars == "" {
    text(size: 9.5pt, fill: mute, "无例")
  } else if chars == form {
    text(size: 9.5pt, fill: mute, "仅本字")
  } else {
    text(size: 10.6pt, fill: examples-ink, chars.clusters().join("、"))
  }
  box[#box(width: 21pt, glyph(form))#h(2pt)#example]
}
#let group-row(label, entries) = grid(
  columns: (letter-col, 1fr), column-gutter: 6pt, align: left + top,
  grid(columns: (1fr,), rows: row-height, align: left + horizon,
    text(size: 9.1pt, fill: mute, label)),
  grid(columns: (1fr,) * 6, rows: row-height, column-gutter: 2pt,
    align: left + horizon, ..entries.map(specimen)),
)
#let key-block(item) = {
  let recited = item.verse.clusters().filter(c => not "，。、“”".contains(c))
  let roots = item.pairs.map(p => p.first())
  assert(recited.all(r => roots.contains(r)), message: "口诀含有不属于 " + item.key + " 键的字根")
  let first = recited.map(r => item.pairs.find(p => p.first() == r))
  let other = item.pairs.filter(p => not recited.contains(p.first()))
  let attested = other.filter(p => p.last() != "")
  let unused = other.filter(p => p.last() == "")
  block(width: 100%, breakable: false, above: 0pt, below: 0pt)[
    #heading(level: 1, numbering: none)[#grid(
      columns: (letter-col, 1fr, auto), column-gutter: 6pt,
      align: (left + horizon, left + horizon, right + horizon),
      box(width: 25pt, height: 24pt, radius: 2pt, fill: accent, align(center + horizon, text(font: serif, size: 17pt, fill: white, item.key))),
      text(font: serif, size: 17.1pt, weight: "medium", fill: ink, item.verse),
      text(font: sans, size: 9.1pt, fill: mute, str(roots.len()) + " 根"),
    )]
    #v(4pt)
    #pad(left: 37pt)[#block(width: 100%, fill: rgb("#f7f3ed"), inset: (x: 7pt, y: 2.5pt), radius: 2pt)[#text(size: 10.6pt, fill: accent, item.cue)　#text(size: 10.6pt, item.story)]]
    #v(5pt)
    #group-row("句中", first)
    #v(2pt)
    #if attested.len() > 0 { group-row("补充", attested) }
    #if unused.len() > 0 {
      grid(
        columns: (letter-col, 1fr), column-gutter: 6pt,
        align: left + horizon, rows: 19.5pt,
        text(size: 9.1pt, fill: mute, "无例"),
        unused.map(p => glyph(p.first())).join(h(9pt)),
      )
    }
  ]
}
#let page-head(keys) = block(width: 100%, above: 0pt, below: 0pt)[
  #grid(
    columns: (1fr, auto), align: (left + horizon, right + horizon),
    text(font: serif, size: 19.8pt, weight: "medium")[潇明字根大码简明手册],
    text(size: 9.6pt, fill: mute, keys.join("  ·  ")),
  )
  #v(5pt)
  #line(length: 100%, stroke: 0.8pt + ink)
]

// 数据按键位编排。每个键内，补充字根按参与一级字的数量递减。
#let data = (
  (
    key: "A", cue: "安民 ān", story: "广目天王开口示警：亥时魔曲一响，守门的犬就会早夭。神位旁的礻、门边的犭，都留在这幅画里。", verse: "广目口示，亥曲犬夭。",
    pairs: (
      ("广", "庄床"), ("目", "眼泪"), ("口", "唱喝"), ("示", "宗票"),
      ("亥", "孩刻"), ("曲", "曲"), ("犬", "伏吠"), ("夭", "妖沃"),
      ("", "狗猫"), ("", "礼社"), ("", "曹遭"), ("〇", ""),
    ),
  ),
  (
    key: "B", cue: "捕鱼 bǔ", story: "捕鱼人姑且举弋试射，网住一条七爪鱼。进石厂，用瓜形皿盛鱼，最后登记入冊。", verse: "且弋七爪鱼，石厂瓜皿冊。",
    pairs: (
      ("且", "助姐"), ("弋", "代式"), ("七", "切屯"), ("爪", "抓采"),
      ("鱼", "渔鲜"), ("石", "矿岩"), ("厂", "厅历"), ("瓜", "狐孤"),
      ("皿", "盘盒"), ("冊", ""), ("匚", "区匹"), ("罒", "罗罚"),
      ("", "直具"), ("", "民尧"), ("", "扁匾"), ("丆", "百陌"),
      ("鳥", ""), ("", ""), ("烏", ""), ("", ""),
      ("", ""),
    ),
  ),
  (
    key: "C", cue: "柴房 chái", story: "长女走过麻田，卯时进柴房生火，把兽皮和肉片摊在爿形木板上烤。“长女”读 zhǎng nǚ，定键靠“柴”。", verse: "长女走麻田，卯火皮片爿。",
    pairs: (
      ("长", "张帐"), ("女", "妈姐"), ("走", "赶起"), ("麻", "磨摩"),
      ("田", "男苗"), ("卯", "柳聊"), ("火", "灯秋"), ("皮", "波披"),
      ("片", "版牌"), ("爿", "藏鼎"), ("", "氏印"), ("", "贸留"),
      ("", "乐烁"), ("貝", ""), ("", ""), ("", ""),
    ),
  ),
  (
    key: "G", cue: "耕田 gēng", story: "耕田人盼着早日见儿子。见面时木工说“给你一枚贝”，一回头，牛竟生出一头小豸（zhì）。", verse: "早日见了儿子面，工曰“予贝”，而牛生豸。",
    pairs: (
      ("早", "草章"), ("日", "明晴"), ("见", "观现"), ("了", "辽疗"),
      ("儿", "兄先"), ("子", "字孙"), ("面", "缅"), ("工", "江功"),
      ("曰", "曰"), ("予", "序抒"), ("贝", "贡财"), ("而", "耐耍"),
      ("牛", "牧牢"), ("生", "星姓"), ("豸", "豹豺"), ("", "丈友"),
      ("", "击半"), ("", "免沈"), ("", "先告"), ("", "曾僧"),
      ("", "年降"), ("", "临"), ("孑", ""),
    ),
  ),
  (
    key: "H", cue: "皇城 huáng", story: "皇城的千户大臣看见一张矮几，上有短匕和长殳（shū）。他心头一紧（忄），抓起兵器沿弯道（辶）追出去。", verse: "千户之臣，一几匕殳。",
    pairs: (
      ("千", "迁纤"), ("户", "房护"), ("之", "芝泛"), ("臣", "卧宦"),
      ("一", "旦本"), ("几", "凡朵"), ("匕", "它比"), ("殳", "投设"),
      ("辶", "近过"), ("", "怕情"), ("", "巨拒"), ("", "决诀"),
      ("", "化华"), ("戶", "所"), ("", "熙"), ("戸", ""),
      ("⻍", ""), ("", ""), ("", ""), ("", ""),
      ("門", ""), ("鬥", ""), ("", ""), ("風", ""),
      ("", ""),
    ),
  ),
  (
    key: "L", cue: "老宅 lǎo", story: "壬辰年的未时将末，老宅耳房（阝）的屋盖（宀）下传来私语（厶）。探头一看，那人的舌头像剪刀一样交叉（乂）。", verse: "壬辰未末，其舌也乂。",
    pairs: (
      ("壬", "任凭"), ("辰", "晨唇"), ("未", "妹味"), ("末", "抹沫"),
      ("其", "期基"), ("舌", "话刮"), ("也", "他地"), ("乂", "区冈"),
      ("丶", "丸勺"), ("宀", "字宁"), ("厶", "公云"), ("", "队邓"),
      ("乀", "久尺"), ("乜", ""), ("", ""),
    ),
  ),
  (
    key: "M", cue: "母猪 mǔ", story: "八九头母豕围着米锅，锅底四点火（灬）正旺。母猪开口（讠）说“尚且合口”，一口咽下碎米丁。", verse: "八九母豕，尚合下米丁。",
    pairs: (
      ("八", "分公"), ("九", "轨仇"), ("母", "姆拇"), ("豕", "家逐"),
      ("尚", "堂常"), ("合", "拾盒"), ("下", "吓虾"), ("米", "迷粉"),
      ("丁", "打钉"), ("", "话记"), ("", "井介"), ("灬", "点热"),
      ("", "象遂"), ("丅", "丐钙"), ("", "尝偿"), ("", "贯惯"),
      ("彑", "互缘"), ("", "惠穗"), ("", ""), ("僉", ""),
      ("", ""), ("頁", ""), ("", ""), ("", ""),
      ("車", ""), ("", ""),
    ),
  ),
  (
    key: "N", cue: "南街 nán", story: "南街卜者拂衣袖（衤）、摇铜铃（钅），用古文卜出家业丰。卅是三十只羊缺毛，卌是四十具虫尸堆满石臼。", verse: "古文卜业丰，卅羊欠毛，卌虫尸臼。",
    pairs: (
      ("古", "故苦"), ("文", "纹蚊"), ("卜", "扑外"), ("业", "显亚"),
      ("丰", "邦蚌"), ("卅", "带滞"), ("羊", "洋样"), ("欠", "吹欢"),
      ("毛", "笔尾"), ("卌", "舞"), ("虫", "虹虾"), ("尸", "尺尼"),
      ("臼", "舀舅"), ("", "钉针"), ("", "共昔"), ("", "占卢"),
      ("", "衣农"), ("", "补衫"), ("", "乍作"), ("", "美姜"),
      ("", "寒塞"), ("", "畏丧"), ("", "差羞"), ("", "幸南"),
      ("", "假暇"), ("", "声眉"), ("", "派旅"), ("", "舆"),
      ("", ""), ("鹵", ""), ("", ""),
    ),
  ),
  (
    key: "O", cue: "圆月像 O", story: "黄昏白月升上谷口，月轮正圆。戊日守边的人在冖形棚下握戈背弓，尝尽辛苦。口诀念戊（wù）。", verse: "夕上白月，戊戈弓辛。",
    pairs: (
      ("夕", "名外"), ("上", "让卡"), ("白", "拍伯"), ("月", "明朋"),
      ("戊", "茂成"), ("戈", "伐划"), ("弓", "引张"), ("辛", "辞锌"),
      ("", "久尔"), ("冖", "军写"), ("凵", "凶出"), ("㔾", "仓犯"),
      ("卩", "印叩"), ("屮", "出茁"), ("丄", "贵遗"), ("", "祭蔡"),
      ("", "发拨"), ("", "禹属"), ("", "追埠"), ("丩", "叫纠"),
      ("", "卫节"), ("", "然燃"), ("丱", ""), ("", ""),
      ("馬", ""), ("", ""), ("見", ""),
    ),
  ),
  (
    key: "P", cue: "铺子 pù", story: "高大的蚩尤顶着丷形双角，也向十里铺走去。门帘遮住招牌“铺”的金旁，只露出甫（fǔ）。", verse: "大尤亦向十甫。",
    pairs: (
      ("大", "太天"), ("尤", "优犹"), ("亦", "迹"), ("向", "响晌"),
      ("十", "什汁"), ("甫", "铺捕"), ("丷", "半平"), ("", "兰并"),
      ("丬", "北壮"), ("", "帅归"), ("", "变峦"), ("尢", "尬抚"),
      ("", "囱粤"), ("", "奥澳"), ("魚", ""),
    ),
  ),
  (
    key: "Q", cue: "骑警 qí", story: "雷雨闪电停了，小鬼向骑警申诉：马之所以逃走，正因有人用斧斤砍断缰绳。骑警扬鞭（攵），循脚印（夊）去追。", verse: "雨电止，幺鬼申，马亡正由斤。",
    pairs: (
      ("雨", "雷雪"), ("电", "龟拽"), ("止", "址企"), ("幺", "幻幼"),
      ("鬼", "槐愧"), ("申", "伸审"), ("马", "妈骑"), ("亡", "忘忙"),
      ("正", "政证"), ("由", "邮抽"), ("斤", "斧折"), ("夊", "冬各"),
      ("攵", "政放"), ("", "定是"), ("", "反后"), ("", "卑啤"),
      ("", "赢"), ("", ""), ("甶", ""), ("齒", ""),
    ),
  ),
  (
    key: "R", cue: "弱鸟 ruò", story: "三只小乌鸦挤着一只短尾鸟（隹），病弱得飞不动。仆隶用牙咬住细丝（糸），在疒形棚里给它们包扎（勹）。", verse: "三小乌鸟隹，隶糸牙。",
    pairs: (
      ("三", "叁承"), ("小", "尖少"), ("乌", "呜"), ("鸟", "鸣鸭"),
      ("隹", "谁推"), ("隶", "逮康"), ("糸", "累索"), ("牙", "芽鸦"),
      ("勹", "句包"), ("彐", "雪扫"), ("疒", "病痛"), ("⺌", "光当"),
      ("彳", "街行"), ("", "兴应"), ("", "丹册"), ("肀", "肃唐"),
      ("", "万厉"), ("", "州学"), ("", "步涉"), ("", "微徽"),
      ("", "疟虐"), ("", "岛捣"), ("", ""),
    ),
  ),
  (
    key: "S", cue: "手封 shǒu", story: "西王伸手（扌）取一寸虎革封住酒缶，把干粮（饣）放在一旁。坛上写“酉”，存酒的东北角写“艮”。", verse: "手用寸虎革，西王、艮方、酉缶。",
    pairs: (
      ("手", "拿掌"), ("用", "拥佣"), ("寸", "对村"), ("虎", "唬彪"),
      ("革", "鞋靴"), ("西", "晒洒"), ("王", "珠全"), ("艮", "跟很"),
      ("方", "放访"), ("酉", "酒配"), ("缶", "缸缺"), ("", "拍打"),
      ("丿", "少才"), ("囗", "围回"), ("", "饭饱"), ("", "于才"),
      ("", "即卿"), ("虍", "虑虚"), ("", "看拜"), ("", ""),
    ),
  ),
  (
    key: "T", cue: "亭台 tíng", story: "车行至竹林边的河川。亭盖（亠）下，老者（耂）请世人立言，各把心愿写在一支箭（矢）上，插回竹丛（⺮）。", verse: "车至竹川，世言心矢。",
    pairs: (
      ("车", "军轮"), ("至", "到室"), ("竹", "笔笛"), ("川", "训顺"),
      ("世", "泄屉"), ("言", "信誓"), ("心", "忘想"), ("矢", "知医"),
      ("亠", "市交"), ("", "乞午"), ("丨", "中个"), ("耂", "孝者"),
      ("〢", "肾坚"), ("丂", "巧号"), ("", "临览"), ("", "荒流"),
      ("", "喜彭"), ("巛", "巡巢"), ("", "与写"), ("", "鼠"),
      ("〣", ""), ("巜", ""),
    ),
  ),
  (
    key: "U", cue: "谷底像 U", story: "谷中那人乃是本土隐士。他用丝缰（纟）牵着鹿，鹿角弯成乙字，正练习用角挑起一束禾。", verse: "夫乃土士，乙鹿习禾。",
    pairs: (
      ("夫", "扶肤"), ("乃", "奶扔"), ("土", "地杜"), ("士", "吉志"),
      ("乙", "亿艺"), ("鹿", "鹿"), ("习", "羽扇"), ("禾", "秋和"),
      ("", "红纪"), ("", "刁幻"), ("", "今买"), ("乚", "孔礼"),
      ("", "麦青"), ("", "奉春"), ("廴", "延建"), ("", "场扬"),
      ("亅", "争净"), ("", "专丐"), ("", "以越"), ("", "乡丝"),
      ("", ""), ("", ""), ("", ""), ("", ""),
      ("", ""), ("", ""), ("飛", ""), ("", ""),
      ("", ""), ("", ""),
    ),
  ),
  (
    key: "V", cue: "倒影像 V", story: "人立在长木耳的树下，两腿映入水中，倒影张成 V。干巾巴在自己背上，揭下来时已到巳时。", verse: "人立木耳，干巾巴己已巳。",
    pairs: (
      ("人", "从众"), ("立", "位站"), ("木", "林材"), ("耳", "闻取"),
      ("干", "汗杆"), ("巾", "布帆"), ("巴", "把爸"), ("己", "记纪"),
      ("已", "已"), ("巳", "包祀"), ("朩", "条杂"), ("", "民氓"),
      ("來", ""),
    ),
  ),
  (
    key: "W", cue: "武士 wǔ", story: "单人武士（亻）腰佩立刀（刂），金甲护着身足，跨进冂形山门。到了高山里，他兀自翻书，一只猴子（禺）从书页里跳出来。", verse: "金甲身足入高里，兀自页禺。",
    pairs: (
      ("金", "鉴"), ("甲", "押鸭"), ("身", "射躺"), ("足", "跑捉"),
      ("入", "入"), ("高", "稿搞"), ("里", "理埋"), ("兀", "元光"),
      ("自", "息咱"), ("页", "顶项"), ("禺", "遇偶"), ("", "他伙"),
      ("", "利列"), ("冂", "冈内"), ("", "京享"), ("", "亭亮"),
      ("", "壤嚷"), ("丌", "鼻痹"), ("", "严"), ("", "膏"),
      ("", "凹"), ("", "丽"),
    ),
  ),
  (
    key: "X", cue: "穴门 xué", story: "黑山洞穴门上铺瓦，门边长草（艹），檐下挂两点冰（冫）。两个丑角在洞口比力气，骨头撞得咯咯响。", verse: "黑山穴门瓦，二丑骨力气。",
    pairs: (
      ("黑", "墨默"), ("山", "仙岩"), ("穴", "空穷"), ("门", "问闪"),
      ("瓦", "瓶瓷"), ("二", "仁云"), ("丑", "扭纽"), ("骨", "滑髓"),
      ("力", "加功"), ("气", "汽氧"), ("艹", "草苗"), ("", "冰冷"),
      ("彡", "形衫"), ("廾", "开升"), ("⺀", "冬头"), ("", "勿匆"),
      ("", "飞兆"), ("", "五伍"), ("亍", "街行"), ("咼", ""),
      ("", ""),
    ),
  ),
  (
    key: "Y", cue: "游舟 yóu", story: "游舟激起三点水花（氵），船头一滴水也没吞。小舟不食水，又不是刀，怎么能把浪切得这样齐？", verse: "舟不食水，又非刀。",
    pairs: (
      ("舟", "船般"), ("不", "还否"), ("食", "餐"), ("水", "泉冰"),
      ("又", "双汉"), ("非", "悲排"), ("刀", "分切"), ("", "江河"),
      ("", "令诵"), ("氺", "求录"), ("癶", "登凳"), ("", "劲茎"),
      ("镸", "套肆"), ("髟", "鬓"), ("長", ""),
    ),
  ),
)

#let pages = (
  ("A", "B", "C", "G"),
  ("H", "L", "M", "N"),
  ("O", "P", "Q", "R"),
  ("S", "T", "U", "V"),
  ("W", "X", "Y"),
)
#for (i, keys) in pages.enumerate() {
  if i > 0 { pagebreak() }
  page-head(keys)
  v(10pt)
  for (j, key) in keys.enumerate() {
    if j > 0 {
      v(1fr)
      line(length: 100%, stroke: 0.4pt + rule)
      v(1fr)
    }
    key-block(data.find(row => row.key == key))
  }
}


// 第五页附录：小码与补码助记

#let mnemonic(key, first, middle, last, codes) = block(
  width: 100%,
  fill: rgb("#f7f3ed"),
  inset: (x: 7pt, y: 6pt),
  radius: 2pt,
)[
  #grid(
    columns: (25pt, 1fr),
    column-gutter: 6pt,
    align: (center + horizon, left + horizon),
    box(
      width: 24pt,
      height: 24pt,
      radius: 2pt,
      fill: accent,
      align(center + horizon,
        text(font: serif, size: 14pt, fill: white, key)),
    ),
    [
      #text(size: 10pt)[
        #first#text(weight: "bold", fill: accent)[#middle]#last
      ]
      #h(4pt)
      #text(size: 9pt, fill: mute)[（#codes）]
    ],
  )
]

#block(width: 100%, breakable: false)[
  #v(8pt)
  #line(length: 100%, stroke: 0.8pt + ink)
  #v(8pt)

  #grid(
    columns: (1fr, auto),
    align: (left + horizon, right + horizon),
    text(font: serif, size: 15pt, weight: "medium", fill: ink)[
      小码与补码速记
    ],
    text(size: 9pt, fill: mute)[六键联记 · 声母与首笔],
  )

  #v(8pt)

  #grid(
    columns: (1fr, 1fr),
    column-gutter: 8pt,
    row-gutter: 7pt,

    mnemonic("J", "鸡尾一", "撇", "，赖皮抢肉屑", "lpqrx"),
    mnemonic("F", "斧落", "点", "飞，剁骨头", "dgt"),

    mnemonic("K", "扛起", "横", "梁，才觉困难", "cjkn"),
    mnemonic("I", "一根", "竖", "棍，放帽子", "fmz"),

    mnemonic("D", "", "顺", "道兜弯，爱晃悠", "0hy"),
    mnemonic("E", "", "逆", "向折回，不算晚", "bsw"),
  )
]
