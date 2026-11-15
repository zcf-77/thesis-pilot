"""Deterministic v1 lexical protection; no model output can disable these checks."""

import hashlib
import re
import unicodedata
from collections.abc import Iterator
from dataclasses import dataclass
from itertools import zip_longest

from thesis_pilot.core.errors import AppError
from thesis_pilot.modules.documents.structure import well_formed
from thesis_pilot.modules.revisions.anchors import ResolvedSelection
from thesis_pilot.modules.revisions.schemas import (
    POLICY_VERSION,
    RevisionCheck,
    RevisionPatch,
    RevisionSelection,
    RuleName,
)

# The TS implementation uses \p{Nd} for Python's Unicode decimal \d.
SPACE = (
    r"[\u0000-\u0020\u007f-\u009f\u00a0\u061c\u1680\u2000-\u200f"
    r"\u2028-\u202f\u205f\u2060-\u206f\u3000\ufeff\ufff9-\ufffb]"
)
NUMBER_PATTERN = r"[-+−]?\d+(?:[.,]\d+)*(?:[eE][-+−]?\d+)?" + rf"(?:{SPACE}*[%％‰‱])?"
UNITS = (
    "mmol/L",
    "mol/L",
    "mg/L",
    "g/mL",
    "kg/m³",
    "g/cm³",
    "m/s²",
    "m/s",
    "km/h",
    "W/m²",
    "kPa",
    "MPa",
    "Pa",
    "kN",
    "N",
    "kJ",
    "J",
    "kW",
    "W",
    "GHz",
    "MHz",
    "kHz",
    "Hz",
    "kg",
    "mg",
    "μg",
    "µg",
    "g",
    "km",
    "cm",
    "mm",
    "μm",
    "µm",
    "nm",
    "m²",
    "m³",
    "cm²",
    "cm³",
    "mm²",
    "mm³",
    "m",
    "mL",
    "μL",
    "µL",
    "L",
    "ms",
    "min",
    "s",
    "h",
    "d",
    "°C",
    "℃",
    "K",
    "Ω",
    "年",
    "月",
    "日",
    "天",
    "周",
    "岁",
    "个",
    "次",
    "组",
    "人",
    "页",
    "章",
    "节",
    "行",
    "件",
    "项",
    "份",
    "条",
    "只",
    "台",
    "千米",
    "厘米",
    "毫米",
    "米",
    "千克",
    "毫克",
    "克",
    "毫升",
    "升",
    "小时",
    "分钟",
    "秒",
)
UNIT_PATTERN = (
    "(?:"
    + "|".join(re.escape(unit) for unit in sorted(UNITS, key=len, reverse=True))
    + r")(?![A-Za-zµμΩ²³])"
)
NUMBER = re.compile(NUMBER_PATTERN)
UNIT = re.compile(SPACE + "*(?:" + UNIT_PATTERN + ")")
UNKNOWN_UNIT = re.compile(SPACE + r"*(?:[^\W\d_]|[°℃\u0300-\u036f])")
RANGE = re.compile(SPACE + "*[–—~～至到−-]" + SPACE + "*")
RANGE_AHEAD = re.compile(RANGE.pattern + r"(?=[-+−]?\d)")
BRACKET = re.compile(r"\[[^\[\]\r\n]+\]|【[^【】\r\n]+】")
PAREN = re.compile(r"[（(][^()（）\r\n]{0,160}[)）]")
YEAR = re.compile(r"(?<!\d)\d{4}[a-z]?(?!\d)")
AUTHOR = re.compile(
    r"(?:[A-Za-z][A-Za-z.'’\-]*(?:[ \t]+(?:et[ \t]+al\."
    r"|and[ \t]+[A-Za-z][A-Za-z.'’\-]*))?|[\u3400-\u9fff]{1,20})" + SPACE + "*$"
)
FORMULA = re.compile(
    r"[$=∑∫√×÷±≠≈≤≥<>]|\\(?:[()[\]]|[A-Za-z]+)|[A-Za-z][ \t]*[\^_][ \t]*[A-Za-z0-9{]"
    r"|[A-Za-z][⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]"
)
VARIABLE_OPERATION = re.compile(
    r"(?<![A-Za-z\u0370-\u03ff])[A-Za-z\u0370-\u03ff]+"
    + SPACE
    + "*[+*/−-]"
    + SPACE
    + r"*[A-Za-z0-9\u0370-\u03ff]+(?:[²³])?"
)
NUMERIC_OPERATION = re.compile(r"\d" + SPACE + "*[+*/^]" + SPACE + r"*[-+−]?\d")
POLICY_DIGEST = hashlib.sha256(
    (
        POLICY_VERSION
        + NUMBER_PATTERN
        + UNIT_PATTERN
        + BRACKET.pattern
        + PAREN.pattern
        + AUTHOR.pattern
        + FORMULA.pattern
        + VARIABLE_OPERATION.pattern
        + NUMERIC_OPERATION.pattern
        + "exact-lexemes;full-block;per-patch;no-partial-token;utf16;"
        "locked-marks;unicode-unit-tail:v1"
    ).encode()
).hexdigest()


@dataclass(frozen=True)
class Token:
    start: int
    end: int
    text: str
    supported: bool = True


def number_atoms(text: str) -> Iterator[Token]:
    end = 0
    for match in NUMBER.finditer(text):
        if match.start() < end:
            continue
        end = match.end()
        unit = UNIT.match(text, end)
        supported = True
        if unit:
            end = unit.end()
            if end < len(text):
                tail = text[end]
                category = unicodedata.category(tail)
                supported = not (
                    category[0] in {"N", "M"}
                    or (category[0] == "L" and not "\u3400" <= tail <= "\u9fff")
                    or tail in "_%％‰‱°℃"
                )
        elif UNKNOWN_UNIT.match(text, end) and not RANGE_AHEAD.match(text, end):
            supported = False
        yield Token(match.start(), end, text[match.start() : end], supported)


def numbers(text: str) -> Iterator[Token]:
    iterator = iter(number_atoms(text))
    pending = next(iterator, None)
    while pending is not None:
        following = next(iterator, None)
        gap = text[pending.end : following.start] if following else ""
        joins = bool(RANGE.fullmatch(gap)) or bool(
            following and following.text.startswith(("-", "−")) and re.fullmatch(SPACE + "*", gap)
        )
        if following and joins:
            yield Token(
                pending.start,
                following.end,
                text[pending.start : following.end],
                pending.supported and following.supported,
            )
            pending = next(iterator, None)
        else:
            yield pending
            pending = following


def numbers_supported(text: str) -> bool:
    if any(not token.supported for token in numbers(text)):
        return False
    iterator = iter(numbers(text))
    token = next(iterator, None)
    for index, char in enumerate(text):
        if unicodedata.category(char).startswith("N") and not char.isdecimal():
            while token is not None and token.end <= index:
                token = next(iterator, None)
            if token is None or not token.start <= index < token.end:
                return False
    return True


def citations(text: str) -> Iterator[Token]:
    bracket = iter(BRACKET.finditer(text))
    parens = iter(PAREN.finditer(text))
    left, right = next(bracket, None), next(parens, None)
    covered = 0
    while left is not None or right is not None:
        is_bracket = right is None or (left is not None and left.start() <= right.start())
        match = left if is_bracket else right
        assert match is not None
        if is_bracket:
            left = next(bracket, None)
        else:
            right = next(parens, None)
        if match.start() < covered or (not is_bracket and not YEAR.search(match[0])):
            continue
        start = match.start()
        if not is_bracket:
            author = AUTHOR.search(text[max(0, start - 160) : start])
            if author:
                start = max(0, start - 160) + author.start()
        if start < covered:
            continue
        covered = match.end()
        yield Token(start, covered, text[start:covered])


def citations_supported(text: str) -> bool:
    iterator = iter(citations(text))
    token = next(iterator, None)
    for index, char in enumerate(text):
        if char not in "[]【】()（）":
            continue
        while token is not None and token.end <= index:
            token = next(iterator, None)
        if token is not None and token.start <= index < token.end:
            continue
        if char in "[]【】" or YEAR.search(text[max(0, index - 160) : index + 161]):
            return False
    return True


def formula(text: str) -> bool:
    if bool(FORMULA.search(text) or NUMERIC_OPERATION.search(text)) or any(
        match[0] not in UNITS for match in VARIABLE_OPERATION.finditer(text)
    ):
        return True
    tokens = iter(numbers(text))
    token = next(tokens, None)
    for index, char in enumerate(text):
        if char not in "+*/^_":
            continue
        while token is not None and token.end <= index:
            token = next(tokens, None)
        if token is None or not token.start <= index < token.end:
            return True
    return False


def equal_tokens(left: Iterator[Token], right: Iterator[Token]) -> bool:
    return all(
        a is not None and b is not None and a.text == b.text for a, b in zip_longest(left, right)
    )


def positions(text: str, offsets: set[int]) -> dict[int, int]:
    found: dict[int, int] = {}
    cursor = 0
    for index, char in enumerate(text):
        if cursor in offsets:
            found[cursor] = index
        cursor += 2 if ord(char) > 0xFFFF else 1
    if cursor in offsets:
        found[cursor] = len(text)
    return found


def check_patches(
    resolved: ResolvedSelection,
    selection: RevisionSelection,
    patches: list[RevisionPatch],
    *,
    base_version: int,
    current_version: int,
) -> list[RevisionCheck]:
    sorted_patches = sorted(patches, key=lambda patch: patch.from_position)
    offsets = {
        value - resolved.start for patch in patches for value in (patch.from_position, patch.to)
    }
    indices = positions(resolved.text, offsets)
    valid = (
        bool(patches)
        and len(patches) <= 100
        and len({patch.id for patch in patches}) == len(patches)
    )
    ranges: list[tuple[int, int, RevisionPatch]] = []
    for patch in sorted_patches:
        left, right = patch.from_position - resolved.start, patch.to - resolved.start
        valid_patch = (
            selection.from_position <= patch.from_position < patch.to <= selection.to
            and left in indices
            and right in indices
            and well_formed(patch.after)
        )
        if valid_patch:
            start, end = indices[left], indices[right]
            valid_patch = resolved.text[start:end] == patch.before
            ranges.append((start, end, patch))
        valid = valid and valid_patch
    valid = valid and any(patch.before != patch.after for patch in patches)
    overlap = all(
        a.to <= b.from_position for a, b in zip(sorted_patches, sorted_patches[1:], strict=False)
    )
    combined = resolved.text
    if valid and overlap:
        for start, end, patch in reversed(ranges):
            combined = combined[:start] + patch.after + combined[end:]

    def uncut(tokens: Iterator[Token]) -> bool:
        return all(
            all(
                patch.before == patch.after
                or end <= token.start
                or start >= token.end
                or (start <= token.start and end >= token.end)
                for start, end, patch in ranges
            )
            for token in tokens
        )

    number_support = numbers_supported(resolved.text) and numbers_supported(combined)
    citation_support = citations_supported(resolved.text) and citations_supported(combined)
    number_ok = (
        valid
        and overlap
        and uncut(numbers(resolved.text))
        and all(equal_tokens(numbers(patch.before), numbers(patch.after)) for patch in patches)
        and equal_tokens(numbers(resolved.text), numbers(combined))
    )
    citation_ok = (
        valid
        and overlap
        and uncut(citations(resolved.text))
        and all(equal_tokens(citations(patch.before), citations(patch.after)) for patch in patches)
        and equal_tokens(citations(resolved.text), citations(combined))
    )
    locked = any(
        patch.before != patch.after
        and patch.from_position < run.end
        and patch.to > run.start
        and run.locked
        for patch in patches
        for run in resolved.runs
    )
    items: list[tuple[RuleName, bool, bool, str]] = [
        ("version", base_version == current_version, False, "候选基础版本必须与当前正文一致。"),
        ("range", valid, False, "补丁必须位于原选区，原文与 UTF-16 边界完全一致。"),
        (
            "number",
            number_ok,
            not number_support,
            "数字、区间、单位及其完整字面和顺序必须保留；未识别计量写法拒绝。",
        ),
        (
            "citation",
            citation_ok,
            not citation_support,
            "完整引用及出现顺序必须保留；疑似而未解析的引文拒绝。",
        ),
        (
            "formula",
            True,
            formula(resolved.text)
            or formula(combined)
            or any(formula(patch.after) for patch in patches),
            "包含公式的整个文本块暂不支持自动修订。",
        ),
        ("lock", not locked, False, "补丁不能修改或改变 AI 锁定文字的标记。"),
        ("overlap", overlap, False, "接受的补丁不能重叠。"),
        ("structure", True, False, "仅替换同一文本区间，保留其余结构与格式。"),
    ]
    located: dict[RuleName, RevisionPatch] = {}
    for patch in sorted_patches:
        if not equal_tokens(numbers(patch.before), numbers(patch.after)):
            located.setdefault("number", patch)
        if not equal_tokens(citations(patch.before), citations(patch.after)):
            located.setdefault("citation", patch)
        if any(
            run.locked
            and patch.before != patch.after
            and patch.from_position < run.end
            and patch.to > run.start
            for run in resolved.runs
        ):
            located.setdefault("lock", patch)
    for previous_patch, next_patch in zip(sorted_patches, sorted_patches[1:], strict=False):
        if previous_patch.to > next_patch.from_position:
            located.setdefault("overlap", next_patch)
    return [
        RevisionCheck.model_validate(
            {
                "rule": rule,
                "result": "unsupported" if unsupported else "pass" if passed else "fail",
                "detail": detail,
                "patch_id": located[rule].id
                if rule in located and not passed and not unsupported
                else None,
                "from": located[rule].from_position
                if rule in located and not passed and not unsupported
                else None,
                "to": located[rule].to
                if rule in located and not passed and not unsupported
                else None,
            }
        )
        for rule, passed, unsupported, detail in items
    ]


def require_passed(checks: list[RevisionCheck]) -> None:
    if all(check.result == "pass" for check in checks):
        return
    if any(check.rule in {"range", "overlap"} and check.result != "pass" for check in checks):
        raise AppError("REVISION_PATCH_INVALID", "补丁范围、原文或重叠检查未通过。", 422)
    if any(check.result == "unsupported" for check in checks):
        raise AppError("REVISION_UNSUPPORTED", "候选包含不能可靠处理的公式、对象或保护表达。", 422)
    raise AppError(
        "REVISION_PROTECTION_FAILED", "数字、引用或锁定内容检查未通过，正文保持不变。", 422
    )
