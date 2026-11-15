"""Regenerate committed fonts manually: python scripts/optimize_fonts.py

Requires npm dependencies and: pip install fonttools[woff]==4.65.0 brotli==1.2.1
Rerun after content, typography or Fontsource changes. Never run during builds.
Keep original Latin shaping boundaries, axes, rasterizer tables and ink bounds:
changing these failed the pixel comparisons. Recheck rendering after regeneration.
"""
import json
import re
import subprocess
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/fonts'
IMPORTS = [('inter', 'index.css'), ('fraunces', 'index.css'),
           ('fraunces', 'wght-italic.css'), ('noto-sans-gujarati', 'index.css')]
CORE = set(range(0x20, 0x7F)) | {0xA0, 0xB7, 0xD7, 0x2010, 0x2013, 0x2014,
    0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212}
FEATURES = {'calt', 'ccmp', 'locl', 'liga', 'rvrn', 'kern', 'mark', 'mkmk', 'tnum',
    'abvs', 'akhn', 'blwf', 'blws', 'cjct', 'half', 'haln', 'nukt', 'pres', 'psts',
    'rkrf', 'rphf', 'abvm', 'blwm', 'dist'}
NAMES = {'inter': 'Kindred Sans', 'fraunces': 'Kindred Serif', 'noto-sans-gujarati': 'Kindred Gujarati'}
CSS_NAMES = {'inter': 'Inter Variable', 'fraunces': 'Fraunces Variable', 'noto-sans-gujarati': 'Noto Sans Gujarati Variable'}


def ranges(text):
    result = set()
    for item in text.split(','):
        ends = item.strip().removeprefix('U+').split('-')
        result.update(range(int(ends[0], 16), int(ends[-1], 16) + 1))
    return result


def unicode_range(codepoints):
    runs = []
    for cp in sorted(codepoints):
        if runs and cp == runs[-1][1] + 1:
            runs[-1][1] = cp
        else:
            runs.append([cp, cp])
    return ','.join(f'U+{a:04X}' + (f'-{b:04X}' if a != b else '') for a, b in runs)


def sources():
    for family, css_name in IMPORTS:
        package = ROOT / 'node_modules/@fontsource-variable' / family
        for block in re.findall(r'@font-face\s*\{([^}]+)\}', (package / css_name).read_text()):
            path = package / re.search(r'url\(\./([^\)]+)\)', block)[1]
            yield family, path, ranges(re.search(r'unicode-range:\s*([^;]+)', block)[1])


def rename(font, family, style):
    name = NAMES[family]
    font['fvar'].instances = []
    font['name'].names = [n for n in font['name'].names if n.nameID in (0, 5, 7, 8, 9, 10, 11, 12, 13, 14)]
    for key, value in {1: name, 2: style.title(), 3: f'{name}-{style}-subset-v1',
            4: f'{name} {style.title()}', 6: name.replace(' ', '') + '-' + style.title(),
            16: name, 17: style.title(), 25: name.replace(' ', '')}.items():
        font['name'].setName(value, key, 3, 1, 0x409)
    for axis in font['fvar'].axes:
        font['name'].setName('Weight', axis.axisNameID, 3, 1, 0x409)
    if 'STAT' in font:
        del font['STAT']


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    characters = json.loads(subprocess.check_output(['node', 'scripts/font-usage.mjs'], cwd=ROOT, encoding='utf-8'))
    required = set(characters) | set(range(0xA0, 0x180)) | CORE | set(range(0xA80, 0xB00)) | {0x200C, 0x200D}
    inputs = list(sources())
    primary = [set().union(*(set(TTFont(p).getBestCmap()) & r for f, p, r in inputs if f == family)) for family in ('inter', 'fraunces')]
    css, generated = [], set()
    for index, (family, path, declared) in enumerate(inputs):
        style = 'italic' if '-italic' in path.name else 'normal'
        later = set().union(*(r for f, p, r in inputs[index+1:] if f == family and ('italic' if '-italic' in p.name else 'normal') == style))
        original = TTFont(path, recalcTimestamp=False)
        keep = set(original.getBestCmap()) & declared & required - later
        if family == 'noto-sans-gujarati':
            keep -= set.intersection(*primary)
            keep.discard(13)
        # Keep Latin-1 with ASCII: separating accented letters changes kerning.
        core = keep if '-latin-wght-' in path.name and family != 'noto-sans-gujarati' else keep & CORE
        for tier, chars in [('core', core), ('extended', keep - core)]:
            if not chars:
                continue
            font = TTFont(path, recalcTimestamp=False)
            options = subset.Options()
            options.hinting = True
            options.layout_features = sorted(FEATURES)
            options.name_IDs = ['*']
            options.name_legacy = True
            options.name_languages = ['*']
            options.recalc_timestamp = False
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(unicodes=chars)
            subsetter.subset(font)
            rename(font, family, style)
            font.recalcBBoxes = False
            for field in ('xMin', 'yMin', 'xMax', 'yMax'):
                setattr(font['head'], field, getattr(original['head'], field))
            filename = path.stem.removesuffix('-wght-' + style) + '-' + style + '-' + tier + '.woff2'
            font.flavor = 'woff2'
            target = OUTPUT / filename
            font.save(target)
            check = TTFont(target)
            assert set(check.getBestCmap()) == chars
            assert check['name'].getDebugName(1) == NAMES[family]
            assert all(getattr(check['head'], field) == getattr(original['head'], field) for field in ('xMin', 'yMin', 'xMax', 'yMax'))
            axis = check['fvar'].axes[0]
            original_axis = original['fvar'].axes[0]
            assert len(check['fvar'].axes) == 1
            assert (axis.minValue, axis.defaultValue, axis.maxValue) == (original_axis.minValue, original_axis.defaultValue, original_axis.maxValue)
            css.append(f"""@font-face {{
  font-family: '{CSS_NAMES[family]}';
  font-style: {style};
  font-display: swap;
  font-weight: {int(axis.minValue)} {int(axis.maxValue)};
  src: url('/fonts/{filename}') format('woff2');
  unicode-range: {unicode_range(chars)};
}}""")
            generated.add(filename)
            print(f'{filename}: {target.stat().st_size} bytes')
    (OUTPUT / 'fonts.css').write_text('/* Generated by scripts/optimize_fonts.py; do not edit. */\n\n' + '\n\n'.join(css) + '\n', encoding='utf-8')
    for family, path, _ in inputs:
        style = 'italic' if '-italic' in path.name else 'normal'
        for tier in ('core', 'extended'):
            old = OUTPUT / (path.stem.removesuffix('-wght-' + style) + '-' + style + '-' + tier + '.woff2')
            if old.name not in generated and old.is_file():
                old.unlink()
        (OUTPUT / f'LICENSE-{family}.txt').write_bytes((ROOT / 'node_modules/@fontsource-variable' / family / 'LICENSE').read_bytes())


if __name__ == '__main__':
    main()
