# ============================================================
# dshsplus 앱 아이콘 만들기: 흰 배경에 검은 글자 "D+" (D 는 크게, + 는 작게)
#   python scripts/make-plus-icons.py      → plus/icons/*.png
# scripts/build-plus.mjs 가 이 그림들로 42/ · 43/ · 첫 화면의 아이콘(같은 파일 이름)을 덮어씁니다.
# 두 앱(dshs42 · dshs43) 자체의 아이콘은 바꾸지 않습니다. 모양을 바꾸려면 여기를 고치고 다시 실행해 커밋합니다.
# 글꼴: Windows 의 Segoe UI Black (없으면 Arial Black → Arial Bold)
# ============================================================
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "plus", "icons")
FONTS = [r"C:\Windows\Fonts\seguibl.ttf", r"C:\Windows\Fonts\ariblk.ttf", r"C:\Windows\Fonts\arialbd.ttf",
         "/System/Library/Fonts/Supplemental/Arial Black.ttf"]
FONT = next(f for f in FONTS if os.path.exists(f))

# (파일 이름, 크기, 글자가 차지할 너비 비율) — maskable 은 가장자리가 잘려도 되게 더 작게 (안전 영역 80%)
ICONS = [("favicon-32.png", 32, 0.86), ("apple-touch-icon.png", 180, 0.72),
         ("icon-144.png", 144, 0.72), ("icon-192.png", 192, 0.72), ("icon-256.png", 256, 0.72),
         ("icon-384.png", 384, 0.72), ("icon-512.png", 512, 0.72),
         ("icon-maskable-192.png", 192, 0.56), ("icon-maskable-512.png", 512, 0.56)]


def draw(size, width_ratio):
    S = 1024   # 크게 그린 뒤 줄여서 가장자리를 매끄럽게
    img = Image.new("RGB", (S, S), "white")
    d = ImageDraw.Draw(img)
    big, small = ImageFont.truetype(FONT, 700), ImageFont.truetype(FONT, 400)
    bd, bp = d.textbbox((0, 0), "D", font=big), d.textbbox((0, 0), "+", font=small)
    dw, dh = bd[2] - bd[0], bd[3] - bd[1]
    pw, ph = bp[2] - bp[0], bp[3] - bp[1]
    gap = int(dw * 0.04)
    gw = dw + gap + pw
    scale = S * width_ratio / gw   # 묶음(D + +)이 정해진 너비가 되게 다시 크기를 맞춤
    big, small = ImageFont.truetype(FONT, int(700 * scale)), ImageFont.truetype(FONT, int(400 * scale))
    bd, bp = d.textbbox((0, 0), "D", font=big), d.textbbox((0, 0), "+", font=small)
    dw, dh = bd[2] - bd[0], bd[3] - bd[1]
    pw, ph = bp[2] - bp[0], bp[3] - bp[1]
    gap = int(dw * 0.04)
    x0 = (S - (dw + gap + pw)) // 2
    y0 = (S - dh) // 2
    d.text((x0 - bd[0], y0 - bd[1]), "D", font=big, fill="black")
    # + 는 D 의 위쪽에 맞춤 (성적 표기 'A+' 처럼 위로)
    d.text((x0 + dw + gap - bp[0], y0 - bp[1] - int(dh * 0.02)), "+", font=small, fill="black")
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
for name, size, ratio in ICONS:
    draw(size, ratio).save(os.path.join(OUT, name), optimize=True)
print(f"plus/icons/ 에 {len(ICONS)}개를 만들었어요 (글꼴 {os.path.basename(FONT)})")
