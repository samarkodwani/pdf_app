"""Generate test PDFs: a book (prose, headers/footers, hyphenation), a two-column paper, and a mixed text+scan PDF."""
import fitz, os, textwrap

OUT = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(OUT, exist_ok=True)

LOREM = (
    "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of "
    "foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, "
    "it was the season of Darkness, it was the spring of hope, it was the winter of despair. We had "
    "everything before us, we had nothing before us, we were all going direct to Heaven, we were all going "
    "direct the other way."
)
HYPHEN_WORDS = {"foolishness": "fool-", "incredulity": "incred-", "everything": "every-"}


def wrap(text, font, size, width):
    """Greedy wrap that hyphenates a few known words at the line end, like typeset books do."""
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if font.text_length(trial, size) <= width:
            cur = trial
            continue
        if word in HYPHEN_WORDS:
            head = HYPHEN_WORDS[word]
            if font.text_length(cur + " " + head, size) <= width:
                lines.append(cur + " " + head)
                cur = word[len(head) - 1:]
                continue
        lines.append(cur)
        cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_paragraph(page, text, x, y, width, font, size=11, leading=15, indent=18):
    font_obj = fitz.Font(font)  # measure with the font actually drawn, or columns overflow the gutter
    lines = wrap(text, font_obj, size, width - indent)
    for i, line in enumerate(lines):
        page.insert_text((x + (indent if i == 0 else 0), y), line, fontname=font, fontsize=size)
        y += leading
    return y


def book():
    doc = fitz.open()
    for n in range(1, 7):
        page = doc.new_page(width=420, height=595)  # phone-ish A5
        page.insert_text((150, 35), "THE TEST BOOK", fontname="tiro", fontsize=9)
        page.insert_text((200, 570), str(n), fontname="tiro", fontsize=9)
        y = 90
        if n == 1:
            page.insert_text((60, y), "Chapter One", fontname="tibo", fontsize=22)
            y += 40
        for _ in range(4):
            y = draw_paragraph(page, LOREM, 60, y, 300, "tiro")
            y += 8
    doc.save(os.path.join(OUT, "book.pdf"))


def paper():
    doc = fitz.open()
    col_w, gap, left = 230, 24, 56
    for n in range(1, 5):
        page = doc.new_page(width=612, height=792)
        page.insert_text((200, 40), "Journal of Test Results 2026", fontname="helv", fontsize=9)
        page.insert_text((300, 760), str(n), fontname="helv", fontsize=9)
        y = 90
        if n == 1:
            page.insert_text((120, y), "A Study of Two-Column Reading Order", fontname="hebo", fontsize=20)
            y += 34
            y = draw_paragraph(page, "Abstract. " + LOREM + " " + LOREM, left, y, 500, "helv", size=10, leading=13, indent=0)
            y += 16
        for col in range(2):
            x = left + col * (col_w + gap)
            cy = y
            marker = "LEFTCOL" if col == 0 else "RIGHTCOL"
            for _ in range(4 if n == 1 else 5):  # keep page 1 clear of the footer
                cy = draw_paragraph(page, f"{marker}{n} " + LOREM, x, cy, col_w, "helv", size=10, leading=13, indent=0)
                cy += 6
    doc.save(os.path.join(OUT, "paper.pdf"))


def mixed():
    """Book pages 1-2 as text, page 3 as an image-only scan, page 4 text again."""
    src = fitz.open(os.path.join(OUT, "book.pdf"))
    doc = fitz.open()
    for i in range(6):
        if i == 2:
            pix = src[i].get_pixmap(dpi=150)
            page = doc.new_page(width=420, height=595)
            page.insert_image(page.rect, pixmap=pix)
        else:
            doc.insert_pdf(src, from_page=i, to_page=i)
    doc.save(os.path.join(OUT, "mixed.pdf"))


def allscan():
    """First 4 book pages, every one an image (no text layer anywhere)."""
    src = fitz.open(os.path.join(OUT, "book.pdf"))
    doc = fitz.open()
    for i in range(4):
        page = doc.new_page(width=420, height=595)
        page.insert_image(page.rect, pixmap=src[i].get_pixmap(dpi=150))
    doc.save(os.path.join(OUT, "allscan.pdf"))


if __name__ == "__main__":
    book(); paper(); mixed(); allscan()
    print("fixtures written to", OUT)
