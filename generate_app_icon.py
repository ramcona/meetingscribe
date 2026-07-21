import os
from PIL import Image, ImageDraw, ImageFilter

def create_rounded_icon():
    size = 512
    # Create canvas with alpha
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    
    # Base background gradient (deep indigo to dark violet)
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_bg = ImageDraw.Draw(bg)
    
    # Draw rounded squircle rect (corner radius ~110px for 512px canvas)
    radius = 110
    corner_box = [0, 0, size, size]
    
    # Draw smooth gradient inside mask
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(corner_box, radius=radius, fill=255)
    
    # Create gradient background
    for y in range(size):
        r = int(30 + (76 - 30) * (y / size))
        g = int(27 + (29 - 27) * (y / size))
        b = int(75 + (149 - 75) * (y / size))
        draw_bg.line([(0, y), (size, y)], fill=(r, g, b, 255))
        
    # Radial glow highlight in upper-left
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse([30, -50, 450, 370], fill=(139, 92, 246, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(50))
    
    bg.paste(glow, (0, 0), glow)
    
    # Inner border / Glass shine
    border_mask = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border_mask)
    border_draw.rounded_rectangle([3, 3, size-3, size-3], radius=radius, outline=(255, 255, 255, 60), width=4)
    bg.paste(border_mask, (0, 0), border_mask)
    
    # Composite background onto final image using squircle mask
    img.paste(bg, (0, 0), mask)
    
    # Draw Microphone icon + Soundwaves in center
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2 - 10
    
    # Soundwaves (arcs)
    # Outer wave left
    draw.arc([cx - 150, cy - 130, cx + 150, cy + 130], start=130, end=230, fill=(167, 139, 250, 220), width=12)
    # Outer wave right
    draw.arc([cx - 150, cy - 130, cx + 150, cy + 130], start=310, end=410, fill=(167, 139, 250, 220), width=12)
    
    # Inner wave left
    draw.arc([cx - 110, cy - 90, cx + 110, cy + 90], start=130, end=230, fill=(192, 132, 252, 240), width=10)
    # Inner wave right
    draw.arc([cx - 110, cy - 90, cx + 110, cy + 90], start=310, end=410, fill=(192, 132, 252, 240), width=10)

    # Mic Capsule Body (rounded rectangle)
    mic_w, mic_h = 72, 130
    mic_box = [cx - mic_w//2, cy - mic_h//2 - 15, cx + mic_w//2, cy + mic_h//2 - 15]
    draw.rounded_rectangle(mic_box, radius=36, fill=(255, 255, 255, 255))
    
    # Mic U-Stand
    stand_box = [cx - 60, cy - 35, cx + 60, cy + 70]
    draw.arc(stand_box, start=0, end=180, fill=(255, 255, 255, 255), width=14)
    
    # Mic Stem & Base
    draw.line([(cx, cy + 70), (cx, cy + 115)], fill=(255, 255, 255, 255), width=14)
    draw.line([(cx - 45, cy + 115), (cx + 45, cy + 115)], fill=(255, 255, 255, 255), width=14)

    # Save to locations
    paths = [
        "/Users/rafli/node-project/record-ah/icon.png",
        "/Users/rafli/node-project/record-ah/iconTemplate.png",
        "/Users/rafli/node-project/record-ah/client/public/icon.png",
        "/Users/rafli/node-project/record-ah/client/public/iconTemplate.png"
    ]
    
    for p in paths:
        img.save(p, "PNG")
        print(f"Generated icon at {p}")

create_rounded_icon()
