import json
import re
from pathlib import Path

import pdfplumber


SOURCE_DIR = Path(
    "/Users/amitjangra/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Agriculture/M.Sc/untitled folder"
)
OUT_DIR = Path("src/data")
OUT_FILE = OUT_DIR / "papers.json"
OUT_JS_FILE = OUT_DIR / "papers-data.js"
MANUAL_PAPER_FILES = [
    OUT_DIR / "paper-2025-set-b.json",
]

PAPER_CONFIGS = [
    {"year": 2018, "file": "MSc HAU 2018.pdf", "question_pages": range(1, 17), "key_page": 65, "limit": 200},
    {"year": 2019, "file": "MSc HAU 2019.pdf", "question_pages": range(1, 9), "key_page": 9, "limit": 100},
    {"year": 2020, "file": "MSc HAU 2020.pdf", "question_pages": range(1, 9), "key_page": 9, "limit": 100},
    {"year": 2021, "file": "MSc HAU 2021.pdf", "question_pages": range(1, 8), "key_page": 8, "limit": 100},
    {"year": 2022, "file": "Msc HAU 2022.pdf", "question_pages": range(1, 9), "key_page": 9, "limit": 100},
    {"year": 2023, "file": "MSc HAU 2023.pdf", "question_pages": range(1, 8), "key_page": 8, "limit": 100},
    {"year": 2024, "file": "MSc Hau 2024.pdf", "question_pages": range(1, 10), "key_page": 10, "limit": 100},
]


NOISE_PATTERNS = [
    re.compile(r"^[ABCD]$"),
    re.compile(r"^\|?P\s*G\s+Agriculture", re.I),
    re.compile(r"^\|?M\s*Sc\s+Ag", re.I),
    re.compile(r"^Sr\.\s*Question$", re.I),
    re.compile(r"^No\.$", re.I),
    re.compile(r"^Page\s+\d+\s+of\s+\d+", re.I),
    re.compile(r"^\d+\s*\|\s*P\s*G", re.I),
    re.compile(r"^\d+\s*\|\s*P\s*G\s*A\s*g\s*r\s*i", re.I),
]


OPTION_MARKER = re.compile(r"(?<![A-Za-z])(?:\(\s*([ABCD])\s*\)|([ABCD])\s*[\).])\s*")
QUESTION_START = re.compile(r"^\s*(\d{1,3})\.\s+(.*)")


def clean_space(value):
    return re.sub(r"\s+", " ", value).strip()


def is_noise_line(line):
    stripped = line.strip()
    if not stripped:
        return True
    return any(pattern.search(stripped) for pattern in NOISE_PATTERNS)


def clean_question_text(text):
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if is_noise_line(line):
            continue
        lines.append(line)
    return "\n".join(lines)


def extract_pdf_pages(path, page_numbers):
    chunks = []
    with pdfplumber.open(path) as pdf:
        for page_number in page_numbers:
            text = pdf.pages[page_number - 1].extract_text(x_tolerance=1, y_tolerance=3) or ""
            chunks.append(text)
    return clean_question_text("\n".join(chunks))


def extract_pdf_page(path, page_number):
    with pdfplumber.open(path) as pdf:
        return pdf.pages[page_number - 1].extract_text(x_tolerance=1, y_tolerance=3) or ""


def split_question_blocks(text, limit):
    blocks = []
    current = None
    expected = 1
    for raw in text.splitlines():
        line = raw.strip()
        match = QUESTION_START.match(line)
        question_number = int(match.group(1)) if match else None
        if match and question_number == expected:
            if current:
                blocks.append(current)
            current = {"number": question_number, "lines": [match.group(2).strip()]}
            expected += 1
        elif current:
            current["lines"].append(line)
    if current:
        blocks.append(current)
    return [block for block in blocks if 1 <= block["number"] <= limit]


def parse_question_block(block):
    joined = clean_space(" ".join(block["lines"]))
    all_markers = list(OPTION_MARKER.finditer(joined))
    first_a = next(
        (index for index, marker in enumerate(all_markers) if (marker.group(1) or marker.group(2)) == "A"),
        None,
    )
    if first_a is None:
        return {
            "number": block["number"],
            "question": joined,
            "options": {},
            "parseWarning": "Could not find all four options",
        }

    markers = []
    expected_labels = ["A", "B", "C", "D"]
    expected_index = 0
    for marker in all_markers[first_a:]:
        label = marker.group(1) or marker.group(2)
        expected = expected_labels[expected_index]
        if label == expected or (expected == "D" and label == "C"):
            markers.append((expected, marker))
            expected_index += 1
            if expected_index == len(expected_labels):
                break

    if len(markers) < 4:
        return {
            "number": block["number"],
            "question": joined,
            "options": {},
            "parseWarning": "Could not find all four options",
        }

    first = markers[0][1]
    question = clean_space(joined[: first.start()])
    options = {}
    for index, (label, marker) in enumerate(markers):
        end = markers[index + 1][1].start() if index + 1 < len(markers) else len(joined)
        options[label] = clean_space(joined[marker.end() : end])

    return {
        "number": block["number"],
        "question": question,
        "options": options,
    }


def normalize_number_token(token):
    token = token.strip().strip(".")
    if not token.isdigit():
        return None
    if len(token) >= 4 and len(token) % 2 == 0:
        half = len(token) // 2
        if token[:half] == token[half:]:
            token = token[:half]
        elif all(token[index] == token[index + 1] for index in range(0, len(token), 2)):
            token = token[::2]
    number = int(token)
    return number if 1 <= number <= 200 else None


def normalize_answer_token(token):
    token = token.strip()
    if re.fullmatch(r"([A-D])\1", token):
        return token[0]
    return token if re.fullmatch(r"[A-D](?:/[A-D])?", token) else None


def parse_answer_key(text, limit):
    key = {}
    tokens = re.findall(r"\b(?:[A-D]{1,2}(?:/[A-D])?|\d+\.?)\b", text)
    i = 0
    while i < len(tokens) - 1:
        number = normalize_number_token(tokens[i])
        answer = normalize_answer_token(tokens[i + 1])
        if number is not None and answer:
            if 1 <= number <= limit:
                key[number] = answer
            i += 2
        else:
            i += 1
    return key


def build_paper(config):
    path = SOURCE_DIR / config["file"]
    question_text = extract_pdf_pages(path, config["question_pages"])
    key_text = extract_pdf_page(path, config["key_page"])
    answer_key = parse_answer_key(key_text, config["limit"])
    blocks = split_question_blocks(question_text, config["limit"])
    questions = []
    for block in blocks:
        parsed = parse_question_block(block)
        parsed["correctOption"] = answer_key.get(parsed["number"])
        questions.append(parsed)

    return {
        "id": f"hau-msc-agri-{config['year']}-set-a",
        "title": f"HAU M.Sc Agri Entrance {config['year']}",
        "year": config["year"],
        "set": "A",
        "sourceFile": config["file"],
        "questionCount": len(questions),
        "answerCount": len(answer_key),
        "questions": questions,
    }


def main():
    papers = [build_paper(config) for config in PAPER_CONFIGS]
    for manual_file in MANUAL_PAPER_FILES:
        if manual_file.exists():
            papers.append(json.loads(manual_file.read_text(encoding="utf-8")))
    papers.sort(key=lambda paper: paper["year"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    papers_json = json.dumps(papers, indent=2, ensure_ascii=False)
    OUT_FILE.write_text(papers_json, encoding="utf-8")
    OUT_JS_FILE.write_text(f"window.HAU_PAPERS = {papers_json};\n", encoding="utf-8")
    for paper in papers:
        missing_answers = [q["number"] for q in paper["questions"] if not q.get("correctOption")]
        option_warnings = [q["number"] for q in paper["questions"] if len(q.get("options", {})) != 4]
        print(
            f"{paper['year']} Set {paper['set']}: "
            f"{paper['questionCount']} questions, {paper['answerCount']} answers, "
            f"missing answers={missing_answers[:10]}, option warnings={option_warnings[:10]}"
        )


if __name__ == "__main__":
    main()
