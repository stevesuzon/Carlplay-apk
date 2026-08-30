from pathlib import Path
import tempfile
import zipfile

ZIP = Path('CarPlay-TELEPHONE-GITHUB-CLOUDFLARE-V5.zip')
DATA_PATH = 'public/market-data-fr.js'
NOTE_PATH = 'MAJ-MARCHES-VERIFIES-20260828.txt'

if not ZIP.exists():
    raise SystemExit(f'ZIP introuvable: {ZIP}')

with zipfile.ZipFile(ZIP, 'r') as zin:
    infos = zin.infolist()
    files = {info.filename: zin.read(info.filename) for info in infos}

if DATA_PATH not in files:
    raise SystemExit(f'{DATA_PATH} absent du ZIP')

text = files[DATA_PATH].decode('utf-8')
marker = 'Village de Noël 2026'

if marker not in text:
    days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
    rows = []
    for day in days:
        rows.append(
            '["24","marche","Village de Noël 2026","Périgueux",'
            f'"{day}","horaire à vérifier",'
            '"Marché de Noël · artisans / commerçants / créateurs / producteurs · du 04/12 au 27/12/2026",""]'
        )
    insert = ',' + ','.join(rows)
    pos = text.rfind('];')
    if pos < 0:
        raise SystemExit('Fin du tableau data introuvable')
    text = text[:pos] + insert + text[pos:]
    files[DATA_PATH] = text.encode('utf-8')

    note = files.get(NOTE_PATH, b'').decode('utf-8', errors='replace')
    addition = (
        '\n\nMISE À JOUR 30/08/2026 — PÉRIGUEUX\n'
        '- Ajout du Village / Marché de Noël 2026, confirmé par la Ville de Périgueux le 07/08/2026.\n'
        '- Dates : du vendredi 04/12 au dimanche 27/12/2026.\n'
        '- Candidatures ouvertes aux artisans, commerçants, créateurs et producteurs ; sélection par commission municipale en octobre.\n'
        '- Horaires précis non publiés dans la source officielle consultée : laissés « à vérifier ».\n'
        '- Source : Ville de Périgueux, « Marché de Noël 2026 : appel à candidatures ».\n'
    )
    if 'MISE À JOUR 30/08/2026 — PÉRIGUEUX' not in note:
        files[NOTE_PATH] = (note.rstrip() + addition).encode('utf-8')
else:
    raise SystemExit(0)

with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp:
    tmp_path = Path(tmp.name)

try:
    with zipfile.ZipFile(tmp_path, 'w') as zout:
        for info in infos:
            data = files[info.filename]
            zout.writestr(info, data)
    tmp_path.replace(ZIP)
finally:
    if tmp_path.exists():
        tmp_path.unlink()

# Integrity check
with zipfile.ZipFile(ZIP, 'r') as z:
    bad = z.testzip()
    if bad:
        raise SystemExit(f'ZIP corrompu après modification: {bad}')
    data = z.read(DATA_PATH).decode('utf-8')
    if data.count(marker) != 7:
        raise SystemExit(f'Nombre inattendu d’entrées {marker}: {data.count(marker)}')

print('Mise à jour Périgueux 2026 intégrée au ZIP canonique.')
