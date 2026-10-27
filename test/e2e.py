"""Tests de bout en bout dans un vrai navigateur (Chromium via Playwright).

Prérequis : pip install playwright && python -m playwright install chromium
Lancement : python3 -m http.server 8080 (dans le dossier du projet), puis
            python3 test/e2e.py [http://localhost:8080/]

Couvre : G (hors ligne), H (persistance après fermeture), J (articles manuels),
K (utilisation en magasin), L (modification du planning après le début des
courses), formulaire de recette, actualisation des prix (réseau simulé),
sauvegarde et restauration.
"""
import json, sys, tempfile, os
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
results = []

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('  ok  ' if cond else 'ÉCHEC ') + name + (f' — {detail}' if detail and not cond else ''))

def state(pg, expr):
    return pg.evaluate(f'() => {{ const S = window.__popote.S; return {expr}; }}')

def wait_ready(pg):
    pg.wait_for_function('() => window.__popote && window.__popote.S.state.ready')
    pg.wait_for_timeout(150)

def week_items(pg):
    return state(pg, '[...S.state.shopping.values()].filter(i => i.weekId === window.__popote.selectedWeek())')

with sync_playwright() as p:
    browser = p.chromium.launch()
    profile = tempfile.mkdtemp()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, locale='fr-BE', is_mobile=True, has_touch=True, accept_downloads=True)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))

    print('— Préparation : exemples et planning')
    pg.goto(BASE + '#/reglages'); wait_ready(pg)
    pg.click('[data-action="demo-load"]'); pg.wait_for_timeout(400)
    check('exemples chargés', state(pg, 'S.liveRecipes().length') == 8)
    pg.goto(BASE + '#/planning'); pg.wait_for_timeout(200)
    pg.click('.fab'); pg.wait_for_selector('.pick')
    for name in ['Stoemp aux carottes', 'Spaghetti bolognaise', 'Spaghetti bolognaise', 'Chicons au gratin']:
        pg.click(f'.pick:has-text("{name}")'); pg.wait_for_timeout(200)
    pg.click('.sheet-head [data-close]'); pg.wait_for_timeout(300)
    check('4 repas planifiés (dont un en double)', len(pg.query_selector_all('.entry')) == 4)
    items = week_items(pg)
    pdt = [i for i in items if i['name'] == 'Pommes de terre']
    check('ingrédients regroupés : une seule ligne Pommes de terre', len(pdt) == 1)
    check('quantité regroupée 1 kg + 800 g = 1,8 kg', pdt and abs(pdt[0]['toBuyBase'] - 1800) < 1e-6, str(pdt))

    print('— J : article manuel « Papier toilette » sans quantité ni prix')
    pg.goto(BASE + '#/courses'); pg.wait_for_timeout(300)
    pg.fill('[data-keep="qa-name"]', 'Papier toilette'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    pt = [i for i in week_items(pg) if i['name'] == 'Papier toilette']
    check('article enregistré sans quantité ni prix', len(pt) == 1 and pt[0]['price'] is None and pt[0]['qty'] is None)
    check('rangé dans « Entretien et hygiène »', pt and pt[0]['category'] == 'Entretien et hygiène')
    check('champ prêt pour l\'article suivant (focus conservé)', pg.evaluate('document.activeElement && document.activeElement.dataset.keep') == 'qa-name')
    pg.click('[data-action="qa-toggle"]'); pg.wait_for_timeout(200)
    pg.fill('[data-keep="qa-name"]', 'Lessive'); pg.fill('.qa-details [name="price"]', '8,99'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    budget = pg.inner_text('.receipt')
    check('prix d\'un article manuel inclus dans les achats complémentaires', '8,99' in budget, budget)

    print('— K : cocher en magasin, masquer, fermer, rouvrir')
    pg.click('[data-action="shop-show"][data-v="tous"]'); pg.wait_for_timeout(200)
    pg.click('.item:has-text("Papier toilette") .tick'); pg.wait_for_timeout(150)
    pg.click('.item:has-text("Papier toilette") .tick'); pg.wait_for_timeout(150)
    check('cocher puis décocher', not [i for i in week_items(pg) if i['name'] == 'Papier toilette'][0]['checked'])
    for name in ['Papier toilette', 'Spaghetti', 'Haché porc et bœuf', 'Lessive']:
        pg.click(f'.item:has-text("{name}") .tick'); pg.wait_for_timeout(150)
    check('libellé barré pour un article coché', 'line-through' in pg.eval_on_selector('.item.checked .item-name', 'e => getComputedStyle(e).textDecorationLine'))
    pg.check('[data-change="hide-done"]', force=True); pg.wait_for_timeout(200)
    pg.click('[data-action="shop-show"][data-v="restants"]'); pg.wait_for_timeout(200)
    prog_before = pg.inner_text('.progress-text strong')
    checked_before = sorted(i['name'] for i in week_items(pg) if i['checked'])
    total_before = pg.inner_text('.r-total dd')
    pg.close()
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(BASE); wait_ready(pg); pg.wait_for_timeout(300)
    check('H : l\'application rouvre sur l\'écran des courses', pg.evaluate('location.hash') == '#/courses')
    checked_after = sorted(i['name'] for i in week_items(pg) if i['checked'])
    check('H/K : cases cochées conservées', checked_after == checked_before, f'{checked_before} vs {checked_after}')
    check('K : progression identique', pg.inner_text('.progress-text strong') == prog_before, prog_before)
    check('K : montants identiques', pg.inner_text('.r-total dd') == total_before)
    check('K : filtre « À acheter » et rayons masqués conservés', state(pg, 'S.state.ui.hideDone === true && S.state.ui.shopShow === "restants"'))
    check('K : articles cochés masqués, restants visibles', not pg.query_selector('.item.checked') and len(pg.query_selector_all('.item')) > 3)
    check('J : articles manuels toujours présents', {'Papier toilette', 'Lessive'} <= {i['name'] for i in week_items(pg)})
    check('« Entretien et hygiène » masqué car terminé', 'Entretien et hygiène' not in ' '.join(pg.locator('.aisle-head h2').all_inner_texts()))

    print('— Actualisation des prix (Open Prices simulé)')
    def fake_prices(route):
        route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
            body=json.dumps({'items': [{'id': 99, 'price': 1.09, 'date': '2026-10-25', 'currency': 'EUR',
                'location': {'osm_brand': 'Colruyt', 'osm_address_city': 'Ans', 'osm_address_country_code': 'BE'}}]}))
    pg.route('https://prices.openfoodfacts.org/**', fake_prices)
    spag = state(pg, '[...S.state.products.values()].find(p => p.id === "demo-p-spag")')
    pg.evaluate('(p) => window.__popote.S.saveProduct({ ...p, demo: false, barcode: "8076800195057", autoUpdate: true, priceSource: "Open Prices", priceDate: "2026-09-01T12:00:00Z" })', spag)
    before = json.dumps(sorted(week_items(pg), key=lambda i: i['id']), sort_keys=True)
    pg.goto(BASE + '#/produits'); pg.wait_for_timeout(300)
    pg.click('[data-action="prices-refresh"]'); pg.wait_for_timeout(800)
    sp = state(pg, 'S.state.products.get("demo-p-spag")')
    check('prix mis à jour depuis le relevé Colruyt belge', abs(sp['packPrice'] - 1.09) < 1e-9 and sp['priceSource'] == 'Open Prices', str(sp.get('packPrice')))
    after = json.dumps(sorted(week_items(pg), key=lambda i: i['id']), sort_keys=True)
    check('K/J : l\'actualisation ne modifie ni la liste ni les cases', before == after)
    pg.unroute('https://prices.openfoodfacts.org/**')
    pg.route('https://prices.openfoodfacts.org/**', lambda r: r.abort('failed'))
    pg.click('[data-action="prices-refresh"]'); pg.wait_for_timeout(600)
    check('erreur réseau signalée sans blocage', 'erreur' in pg.inner_text('#toast').lower(), pg.inner_text('#toast'))
    check('le prix précédent est conservé après une erreur', abs(state(pg, 'S.state.products.get("demo-p-spag").packPrice') - 1.09) < 1e-9)

    print('— L : modifier le planning après avoir commencé les courses')
    pg.goto(BASE + '#/planning'); pg.wait_for_timeout(300)
    pg.click('.entry:has-text("Spaghetti") [data-action="entry-menu"]'); pg.wait_for_timeout(250)
    pg.click('[data-m="remove"]'); pg.wait_for_timeout(300)
    pg.click('.entry:has-text("Spaghetti") [data-action="entry-menu"]'); pg.wait_for_timeout(250)
    pg.click('[data-m="remove"]'); pg.wait_for_timeout(400)
    items = week_items(pg)
    names = {i['name'] for i in items}
    check('articles manuels conservés', {'Papier toilette', 'Lessive'} <= names)
    sp = [i for i in items if i['name'] == 'Spaghetti']
    check('article coché devenu inutile : conservé et signalé', sp and sp[0]['orphan'] and sp[0]['checked'])
    check('article non coché devenu inutile : retiré', 'Tomates concassées' not in names or any(i['name'] == 'Tomates concassées' and i['orphan'] for i in items))
    check('cases des autres articles non réinitialisées', [i for i in items if i['name'] == 'Papier toilette'][0]['checked'])
    pg.goto(BASE + '#/courses'); pg.wait_for_timeout(300)
    check('bandeau « ne correspondent plus à aucun repas » affiché', pg.query_selector('.orphans') is not None)
    pg.click('.orphans li:has-text("Spaghetti") [data-action="orphan-keep"]'); pg.wait_for_timeout(300)
    sp = [i for i in week_items(pg) if i['name'] == 'Spaghetti']
    check('article gardé → devient un ajout manuel coché', sp and sp[0]['origin'] == 'manuel' and sp[0]['checked'])

    print('— Formulaire « Ajouter un repas » (saisie rapide de plusieurs ingrédients)')
    pg.goto(BASE + '#/recette/nouvelle'); pg.wait_for_selector('.sheet input[name="name"]')
    pg.fill('.sheet input[name="name"]', 'Riz cantonais test')
    for nm, q, u in [('Riz', '200', 'g'), ('Oignon rouge', '1', 'piece'), ('Petits pois', '150', 'g')]:
        pg.fill('.ia-name', nm); pg.select_option('.ia-unit', u); pg.fill('.ia-qty', q); pg.press('.ia-qty', 'Enter'); pg.wait_for_timeout(200)
    check('3 ingrédients ajoutés sans fermer le formulaire', len(pg.query_selector_all('.ing-edit > li[data-i]')) == 3)
    check('le nom d\'ingrédient est prêt pour le suivant', pg.evaluate('document.activeElement.classList.contains("ia-name")'))
    pg.click('.sheet-head button[type="submit"]'); pg.wait_for_timeout(500)
    r = state(pg, 'S.liveRecipes().find(r => r.name === "Riz cantonais test")')
    check('recette enregistrée', r and len(r['items']) == 3)
    check('ingrédient « Riz » existant réutilisé', r and r['items'][0]['ingredientId'] == 'demo-i-riz')
    check('oignon rouge distinct de l\'oignon jaune', r and r['items'][1]['ingredientId'] == 'demo-i-oigr')

    print('— G : hors ligne complet (après mise en cache)')
    pg.goto(BASE); wait_ready(pg)
    pg.wait_for_function('() => navigator.serviceWorker && navigator.serviceWorker.controller', timeout=10000)
    ctx.set_offline(True)
    pg.close()
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(BASE + '#/recettes'); wait_ready(pg)
    check('l\'application démarre sans réseau', pg.query_selector('.card') is not None)
    check('indicateur hors ligne visible', pg.is_visible('.offline-pill'))
    pg.goto(BASE + '#/recette/nouvelle'); pg.wait_for_selector('.sheet input[name="name"]')
    pg.fill('.sheet input[name="name"]', 'Pâtes hors ligne')
    pg.fill('.ia-name', 'Spaghetti'); pg.fill('.ia-qty', '250'); pg.press('.ia-qty', 'Enter'); pg.wait_for_timeout(200)
    pg.click('.sheet-head button[type="submit"]'); pg.wait_for_timeout(500)
    rid = state(pg, 'S.liveRecipes().find(r => r.name === "Pâtes hors ligne")?.id')
    check('recette créée hors ligne', bool(rid))
    pg.goto(BASE + f'#/recette/{rid}'); pg.wait_for_timeout(300)
    pg.click('.recipe [data-action="plan-recipe"]'); pg.wait_for_timeout(400)
    pg.evaluate('() => window.__popote.S.saveStockItem({ ingredientId: "demo-i-spag", name: "Spaghetti", qty: 100, unit: "g" })'); pg.wait_for_timeout(300)
    sp = [i for i in week_items(pg) if i.get('key') == 'demo-i-spag|masse']
    check('planifié + stock déduit hors ligne (250 g − 100 g = 150 g)', sp and abs(sp[0]['toBuyBase'] - 150) < 1e-6, str(sp))
    pg.goto(BASE + '#/courses'); pg.wait_for_timeout(300)
    pg.locator('.tick').first.click(); pg.wait_for_timeout(200)
    check('liste utilisable hors ligne', len(pg.query_selector_all('.item')) > 0)
    pg.goto(BASE + '#/produits'); pg.wait_for_timeout(300)
    pg.click('[data-action="prices-refresh"]'); pg.wait_for_timeout(500)
    check('actualisation des prix hors ligne : erreur claire', 'erreur' in pg.inner_text('#toast').lower() or 'hors ligne' in pg.inner_text('#toast').lower(), pg.inner_text('#toast'))
    ctx.set_offline(False)

    print('— Sauvegarde et restauration')
    pg.goto(BASE + '#/reglages'); pg.wait_for_timeout(300)
    n_recipes = state(pg, 'S.liveRecipes().length')
    with pg.expect_download() as dl:
        pg.click('[data-action="backup"]')
    path = os.path.join(profile, 'backup.json'); dl.value.save_as(path)
    data = json.load(open(path))
    check('fichier de sauvegarde valide', data['app'] == 'popote' and len(data['data']['recipes']) >= n_recipes)
    pg.evaluate('() => window.__popote.S.addManualItem(window.__popote.selectedWeek(), { name: "Après sauvegarde" })'); pg.wait_for_timeout(200)
    with pg.expect_file_chooser() as fc:
        pg.click('[data-action="restore"]')
    fc.value.set_files(path); pg.wait_for_timeout(400)
    pg.click('.sheet [data-r="ok"]'); pg.wait_for_timeout(600)
    check('restauration : données de la sauvegarde', state(pg, 'S.liveRecipes().length') == n_recipes and not [i for i in week_items(pg) if i['name'] == 'Après sauvegarde'])

    check('aucune erreur JavaScript', not errors, '; '.join(errors))
    browser.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} vérifications réussies')
sys.exit(1 if fails else 0)
