"""Garimpo QA: function-by-function checks against the built renderer.

Drives the real UI with Playwright; the Electron main process and the local
server are replaced by route mocks and by setting Pinia store state the way
the main process would. Writes qa-results.json and screenshots to ./shots.
"""
import asyncio, json, re, os, sys
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, 'shots'); os.makedirs(SHOTS, exist_ok=True)
AXE = open(os.path.join(HERE, 'node_modules/axe-core/axe.min.js')).read()
BASE = 'http://localhost:4173/#'
results = []

def record(area, name, ok, detail='', shot=None):
    results.append({'area': area, 'check': name, 'ok': bool(ok), 'detail': detail, 'shot': shot})
    print(('PASS ' if ok else 'FAIL ') + f'[{area}] {name} {detail}')

STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get"
ROUTER = "document.querySelector('#app').__vue_app__.config.globalProperties.$router"

COV = 'http://localhost:4173/icon.png'
TRACKS = [{"path": f"/m/{t}.flac", "title": t, "artist": a, "bpm": b, "camelot": k, "key": k, "energy": e, "duration": 300, "analyzedAt": 1 if b else None}
          for t, a, b, k, e in [("Noite", "Lua", 124, "8A", 7), ("Lagoa", "Pacatos", 122.5, "9A", 6), ("Asfalto", "Duda", 128, "8B", 9), ("Fitas", "Kaio", 126, "3A", 8), ("LadoB", "Clara", None, None, None)]]
DJSTATE = {"folders": ["/m"], "tracks": TRACKS, "playlists": [{"id": "p1", "name": "Sexta", "paths": [t["path"] for t in TRACKS[:4]], "updatedAt": 1}], "seratoFolders": ["/Users/x/Music/_Serato_"]}
PL = {"service": "spotify", "name": "Minha playlist", "cover": COV, "tracks": [{"title": f"Faixa {i}", "artist": "Artista", "durationMs": 200000} for i in range(4)]}
MATCH = [{"source": PL["tracks"][i], "deezer": ({"id": 900 + i, "title": f"Faixa {i}", "artist": {"name": "Artista"}, "album": {"title": "A", "cover_medium": COV}, "duration": 200, "preview": ""} if i < 3 else None), "matchType": "isrc" if i < 3 else "none", "confidence": 100 if i < 3 else 0} for i in range(4)]
captured = {'settings': [], 'downloads': []}

async def api(route):
    u = route.request.url
    body = None
    if '/api/dj/state' in u: body = DJSTATE
    elif '/api/import/read' in u: body = PL
    elif '/api/import/match' in u: body = {"jobId": "j"}
    elif '/api/import/status' in u: body = {"finished": True, "results": MATCH if 'from=0' in u else []}
    elif '/api/preview/stream' in u or '/api/library/file' in u:
        data = open(os.path.join(HERE, 'test.mp3'), 'rb').read()
        rng = route.request.headers.get('range')
        m = re.match(r'bytes=(\d*)-(\d*)', rng or '')
        if m:
            start = int(m.group(1) or 0); end = int(m.group(2)) if m.group(2) else len(data) - 1
            return await route.fulfill(status=206, body=data[start:end + 1], headers={'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Range': f'bytes {start}-{end}/{len(data)}', 'Access-Control-Allow-Origin': '*'})
        return await route.fulfill(status=200, body=data, headers={'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*'})
    elif '/api/settings' in u and route.request.method == 'POST':
        captured['settings'].append(route.request.post_data or ''); body = {"ok": True}
    elif '/api/download' in u and route.request.method == 'POST':
        captured['downloads'].append(route.request.post_data or ''); body = {"id": "d1", "ok": True}
    if body is None:
        return await route.fulfill(status=503, body='{}', headers={'Access-Control-Allow-Origin': '*'})
    await route.fulfill(status=200, body=json.dumps(body), headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})

async def ev(pg, js):
    return await pg.evaluate(js)

async def store_set(pg, store, js_assign):
    await pg.evaluate(f"(() => {{ const s = {STORE}('{store}'); {js_assign} }})()")

async def go(pg, path, wait=900):
    await pg.evaluate(f"{ROUTER}.push({json.dumps(path)})")
    await pg.wait_for_timeout(wait)

async def text(pg, sel='body'):
    return await pg.locator(sel).first.inner_text()

async def shot(pg, name):
    p = os.path.join(SHOTS, name + '.png'); await pg.screenshot(path=p); return 'shots/' + name + '.png'

def account_state(mode='remote', signed=True, modules=('downloads', 'converter', 'dj', 'qobuz'), reason=None, plan='dj'):
    return {"mode": mode, "signedIn": signed, "user": {"id": "u1", "email": "dj@garimpo.app"} if signed else None,
            "profile": {"plan": plan, "status": "active", "modules": list(modules), "expires_at": None} if signed else None,
            "modules": list(modules) if signed and not reason else ([] if mode == 'remote' else list(modules)), "offline": False, "reason": reason}

async def set_account(pg, st):
    await store_set(pg, 'account', f"s.state = {json.dumps(st)}; s.ready = true;")
    await pg.wait_for_timeout(300)

async def set_deezer(pg, user):
    if user is None:
        await store_set(pg, 'auth', "s.user = null; s.isAuthenticated = false;")
    else:
        await store_set(pg, 'auth', f"s.user = {json.dumps(user)}; s.isAuthenticated = true;")
    await pg.wait_for_timeout(300)

FREE = {"id": 1, "name": "Diego", "country": "BR", "canStream": False, "canDownload": True, "maxQuality": "128", "subscription": {"type": "Deezer Free"}}
PREMIUM = {**FREE, "maxQuality": "320", "subscription": {"type": "Deezer Premium"}}
HIFI = {**FREE, "maxQuality": "flac", "subscription": {"type": "Deezer HiFi"}}

ENGLISH = re.compile(r"\b(Download(s|ing)?|Settings|Search|Cancel|Loading|Favorites|Library|Retry|Clear|Pause|Resume|Queue|Saved|Failed|Sign in|Log ?in|Logout|Connect|Browse|Charts|Genres|Home|Tracks|Albums|Artists|Playlists?|Upgrade|Error|Unknown)\b")
ALLOWED_EN = {'Playlist', 'Playlists', 'Downloads', 'Artists'}  # 'Various Artists' is the literal Deezer tag value  # used as Portuguese loanwords in the UI

async def check_portuguese(pg, area, page):
    t = await text(pg)
    hits = sorted({m.group(0) for m in ENGLISH.finditer(t)} - ALLOWED_EN)
    record(area, f'texto em português em {page}', not hits, ('inglês encontrado: ' + ', '.join(hits)) if hits else '')

async def contrast(pg, area, page):
    await pg.add_script_tag(content=AXE)
    r = await pg.evaluate("""async () => { const r = await axe.run(document, { runOnly: ['color-contrast'] });
      return r.violations.flatMap(v => v.nodes.map(n => ({ t: (n.target||[]).join(' ').slice(0,90), d: (n.any[0]||{}).message || '' }))) }""")
    record(area, f'contraste AA em {page}', len(r) == 0, f'{len(r)} elementos' + ((': ' + ' | '.join(x['t'] + ' → ' + x['d'][:90] for x in r[:4])) if r else ''))
    return r

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.route('http://127.0.0.1:6595/**', api)
        await pg.goto(BASE + '/'); await pg.wait_for_timeout(7000)

        # ---------------- A. Garimpo account ----------------
        await set_account(pg, account_state(mode='dev', signed=False))
        await go(pg, '/settings?tab=accounts')
        t = await text(pg)
        record('Conta', 'modo desenvolvimento sem login', await pg.locator('text=Entrar').count() == 0 or 'Modo desenvolvimento' in t, 'card mostra Modo desenvolvimento' if 'Modo desenvolvimento' in t else t[:80], await shot(pg, 'a1-dev'))

        await set_account(pg, account_state(signed=False))
        gate = pg.locator('form:has(input[type=email])')
        vis = await gate.count() > 0 and await gate.first.is_visible()
        btn = pg.locator('form button[type=submit]').first
        dis_empty = await btn.is_disabled()
        await pg.fill('input[type=email]', 'dj@garimpo.app'); await pg.fill('input[autocomplete=current-password]', '123')
        dis_short = await btn.is_disabled()
        await pg.fill('input[autocomplete=current-password]', 'senha-forte')
        en_ok = not await btn.is_disabled()
        record('Conta', 'sem login mostra a tela de entrada', vis, '', await shot(pg, 'a2-login'))
        record('Conta', 'botão Entrar só habilita com e-mail válido e senha ≥ 6', dis_empty and dis_short and en_ok, f'vazio={dis_empty} curta={dis_short} válida={en_ok}')
        await store_set(pg, 'account', "s.error = 'E_CREDENTIALS'"); await pg.wait_for_timeout(200)
        record('Conta', 'erro de senha traduzido', 'E-mail ou senha incorretos.' in await text(pg))
        await store_set(pg, 'account', "s.error = null")

        await set_account(pg, account_state(reason='blocked'))
        t = await text(pg)
        record('Conta', 'conta bloqueada explica e oferece Sair', 'Seu acesso está bloqueado' in t and 'SAIR' in t.upper(), '', await shot(pg, 'a3-blocked'))
        await set_account(pg, account_state(reason='pending'))
        record('Conta', 'conta pendente mostra aguardando aprovação', 'aguardando aprovação' in (await text(pg)).lower())

        await set_account(pg, account_state(modules=('downloads',), plan='free'))
        locks = await pg.locator('nav [aria-label="Não incluído no seu plano"]').count()
        await go(pg, '/dj')
        url = await ev(pg, f"{ROUTER}.currentRoute.value.fullPath")
        record('Conta', 'módulos fora do plano mostram cadeado no menu', locks >= 2, f'{locks} cadeados')
        record('Conta', 'abrir módulo bloqueado leva à página explicativa', url.startswith('/locked'), url, await shot(pg, 'a4-locked'))

        await set_account(pg, account_state())
        await go(pg, '/settings?tab=accounts')
        t = await text(pg)
        record('Conta', 'logado mostra e-mail e plano, sem tela de entrada', 'dj@garimpo.app' in t and await pg.locator('input[type=email]').count() == 0, '', await shot(pg, 'a5-account'))
        await go(pg, '/dj')
        record('Conta', 'módulo liberado abre normalmente', (await ev(pg, f"{ROUTER}.currentRoute.value.path")) == '/dj')

        # ---------------- B. Deezer and quality ----------------
        await set_deezer(pg, None)
        await go(pg, '/settings?tab=accounts')
        side = await text(pg, 'nav')
        record('Deezer', 'deslogado: menu mostra "Deezer · Conectar"', 'DEEZER · CONECTAR' in side.upper())
        record('Deezer', 'deslogado: Ajustes mostra botão de conectar e campo ARL', await pg.locator('[data-testid=deezer-connect]').count() == 1 and await pg.locator('[data-testid=arl-field]').first.is_visible() and await pg.locator('[data-testid=deezer-connected]').count() == 0, '', await shot(pg, 'b1-deezer-off'))
        dot = await pg.locator('[data-testid=quality-badge] span').first.get_attribute('class')
        record('Deezer', 'deslogado: ponto do selo vazado', 'border' in dot and 'bg-primary' not in dot, dot)

        # download while logged out opens the wizard
        await ev(pg, f"{STORE}('downloads').addDownload({{id: 1, title: 'X', artist: {{name: 'Y'}}, album: {{}}, duration: 1}})")
        await pg.wait_for_timeout(500)
        record('Deezer', 'baixar sem Deezer abre o assistente de login', await ev(pg, f"{STORE}('wizard').deezerOpen"), '', await shot(pg, 'b2-wizard'))
        await store_set(pg, 'wizard', 's.closeAll()')

        await store_set(pg, 'settings', "s.settings.quality = '320'")
        await set_deezer(pg, FREE)
        await go(pg, '/settings?tab=downloads')
        badge = re.sub(r'\s+', ' ', (await text(pg, '[data-testid=quality-badge]'))).strip().replace(' *', '*')
        side = await text(pg, 'nav')
        record('Qualidade', 'conta Free com 320 escolhido: selo mostra MP3 128*', badge == 'MP3 128*', badge)
        record('Qualidade', 'conta Free: menu mostra Deezer · MP3 128', 'DEEZER · MP3 128' in side.upper())
        note = await pg.locator('[data-testid=quality-capped]').count()
        dis320 = await pg.locator('option[value="320"]').first.is_disabled()
        disflac = await pg.locator('option[value="flac"]').first.is_disabled()
        record('Qualidade', 'conta Free: 320 e FLAC desabilitados com aviso', note == 1 and dis320 and disflac, f'aviso={note} 320={dis320} flac={disflac}', await shot(pg, 'b3-free-quality'))
        captured['settings'].clear()
        await ev(pg, f"{STORE}('downloads').syncSettingsToServer && {STORE}('downloads').syncSettingsToServer()")
        await pg.wait_for_timeout(600)
        sent = ' '.join(captured['settings'])
        q = re.search(r'"quality":"(\w+)"', sent)
        record('Qualidade', 'conta Free: download enviado ao servidor em MP3_128', bool(q) and q.group(1) == 'MP3_128', q.group(1) if q else 'sem envio capturado')

        await go(pg, '/settings?tab=accounts')
        record('Deezer', 'logado: sem botão de conectar, com status e plano', await pg.locator('[data-testid=deezer-connect]').count() == 0 and await pg.locator('[data-testid=deezer-connected]').count() == 1 and 'Conectado como Diego' in await text(pg), '', await shot(pg, 'b4-deezer-on'))
        record('Deezer', 'logado: campo ARL recolhido', not await pg.locator('[data-testid=arl-field]').first.is_visible())
        dot = await pg.locator('[data-testid=quality-badge] span').first.get_attribute('class')
        record('Deezer', 'logado: ponto do selo preenchido', 'bg-primary-500' in dot, dot)

        await store_set(pg, 'settings', "s.settings.quality = 'flac'"); await set_deezer(pg, PREMIUM)
        badge = re.sub(r'\s+', ' ', (await text(pg, '[data-testid=quality-badge]'))).strip().replace(' *', '*')
        record('Qualidade', 'Premium com FLAC escolhido: selo MP3 320*', badge == 'MP3 320*', badge)
        await set_deezer(pg, HIFI)
        await go(pg, '/settings?tab=downloads')
        badge = re.sub(r'\s+', ' ', (await text(pg, '[data-testid=quality-badge]'))).strip().replace(' *', '*')
        record('Qualidade', 'HiFi com FLAC: selo FLAC sem aviso', badge == 'FLAC' and await pg.locator('[data-testid=quality-capped]').count() == 0, badge)
        await store_set(pg, 'settings', "s.settings.quality = '128'")
        badge = re.sub(r'\s+', ' ', (await text(pg, '[data-testid=quality-badge]'))).strip().replace(' *', '*')
        record('Qualidade', 'HiFi com 128 escolhido: respeita 128', badge == 'MP3 128', badge)
        await store_set(pg, 'settings', "s.settings.quality = '320'")

        # ---------------- C. Spotify ----------------
        await store_set(pg, 'settings', "s.settings.spotifyClientId = ''; s.settings.spotifyClientSecret = ''")
        await go(pg, '/settings?tab=accounts')
        off = await pg.locator('[data-testid=spotify-connect]').count() == 1 and await pg.locator('[data-testid=spotify-connected]').count() == 0
        await store_set(pg, 'settings', "s.settings.spotifyClientId = 'abcdef0123456789abcdef0123456789'; s.settings.spotifyClientSecret = 'x'.repeat(32)")
        await pg.wait_for_timeout(300)
        on = await pg.locator('[data-testid=spotify-connect]').count() == 0 and await pg.locator('[data-testid=spotify-connected]').count() == 1
        record('Spotify', 'sem credenciais mostra assistente; com credenciais mostra conectado', off and on, f'sem={off} com={on}', await shot(pg, 'c1-spotify'))

        # ---------------- D. Player ----------------
        await go(pg, '/')
        await ev(pg, f"""(() => {{ const pl = {STORE}('player'); const t = {{id: 7, title: 'Noite de Cerrado', artist: {{name: 'Lua'}}, preview: 'https://cdns-preview-1.dzcdn.net/x.mp3', album: {{cover_medium: '{COV}'}}}};
            pl.play(t, [t, {{...t, id: 8, title: 'Lagoa'}}]) }})()""")
        await pg.wait_for_timeout(2500)
        vis = await pg.locator('section[aria-label="Player de prévia"]').count() == 1
        st = await ev(pg, f"(() => {{ const p = {STORE}('player'); return {{ playing: p.isPlaying, meters: p.metersLive, next: p.hasNext }} }})()")
        record('Player', 'abre flutuante e toca com VU ativo', vis and st['playing'] and st['meters'], json.dumps(st), await shot(pg, 'd1-player'))
        bar = pg.locator('[role=slider][aria-label="Posição"]')
        bb = await bar.bounding_box()
        await pg.mouse.click(bb['x'] + bb['width'] * 0.75, bb['y'] + bb['height'] / 2)
        await pg.wait_for_timeout(400)
        pos = await ev(pg, f"{STORE}('player').position")
        record('Player', 'clicar na barra avança a posição', pos > 15, f'{pos:.1f}s')
        await pg.locator('[aria-label="Pausar"]').first.click(); await pg.wait_for_timeout(300)
        record('Player', 'pausar', not await ev(pg, f"{STORE}('player').isPlaying"))
        await pg.locator('[aria-label="Próxima"]').first.click(); await pg.wait_for_timeout(1500)
        record('Player', 'próxima faixa da fila', (await ev(pg, f"{STORE}('player').currentTrack?.title")) == 'Lagoa')
        await pg.locator('[aria-label="Fechar player"]').click(); await pg.wait_for_timeout(500)
        record('Player', 'fechar some com o player', await pg.locator('section[aria-label="Player de prévia"]').count() == 0)

        # ---------------- E. Download desk ----------------
        await ev(pg, f"""(() => {{ const d = {STORE}('downloads'); d.downloads = [
          {{id:'a', type:'album', title:'Álbum A', artist:'X', status:'downloading', progress:64, completedTracks:7, totalTracks:10, speed:2600000}},
          {{id:'b', type:'track', title:'Faixa B', artist:'Y', status:'pending', progress:0}},
          {{id:'c', type:'track', title:'Faixa C', artist:'Z', status:'completed', progress:100}},
          {{id:'d', type:'track', title:'Faixa D', artist:'W', status:'error', progress:10}} ] }})()""")
        await go(pg, '/downloads')
        rack = await text(pg, 'aside[aria-label="Mesa de downloads"]')
        faders = await pg.locator('aside [role=progressbar]').count()
        record('Mesa', 'canais com fader para baixando e fila', faders == 2, f'{faders} faders')
        record('Mesa', 'estados Salvo, Falhou e contadores', 'SALVO' in rack.upper() and 'FALHOU' in rack.upper() and '1 AO VIVO' in rack.upper(), '', await shot(pg, 'e1-rack'))
        fv = await pg.locator('aside [role=progressbar]').first.get_attribute('aria-valuenow')
        record('Mesa', 'fader reflete o progresso (64%)', fv == '64', fv)

        # ---------------- F. Converter ----------------
        await set_deezer(pg, None)
        await go(pg, '/convert')
        await pg.fill('input[type=url]', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')
        sel = await pg.locator('[role=tab][aria-selected=true]').first.inner_text()
        record('Converter', 'detecta o serviço pelo link', sel.strip().upper() == 'SPOTIFY', sel)
        await pg.click('form button[type=submit]'); await pg.wait_for_timeout(800)
        await pg.get_by_role('button', name='Encontrar músicas').click(); await pg.wait_for_timeout(1500)
        t = await text(pg)
        record('Converter', 'mostra encontradas e faltando', '3 ENCONTRADAS' in t.upper() and '1 FALTANDO' in t.upper(), '', await shot(pg, 'f1-convert'))
        await pg.get_by_role('button', name=re.compile('Baixar 3')).click(); await pg.wait_for_timeout(500)
        record('Converter', 'baixar sem Deezer abre o assistente', await ev(pg, f"{STORE}('wizard').deezerOpen"))
        await store_set(pg, 'wizard', 's.closeAll()')
        await pg.get_by_role('tab', name='Faltando').click(); await pg.wait_for_timeout(200)
        record('Converter', 'filtro Faltando mostra só não encontradas', await pg.locator('main li').count() == 1)

        # ---------------- G. DJ studio ----------------
        await go(pg, '/dj', 1500)
        rows = await pg.locator('main input[type=checkbox][aria-label]').count()
        record('Estúdio DJ', 'biblioteca lista as faixas', rows >= 5, f'{rows} linhas', await shot(pg, 'g1-dj'))
        await pg.select_option('main select', '8A'); await pg.wait_for_timeout(300)
        rows8 = await pg.locator('main div.grid.border-t').count()
        record('Estúdio DJ', 'filtro "combina com 8A" mostra 8A, 7A, 9A e 8B', rows8 == 3, f'{rows8} faixas (Noite 8A, Lagoa 9A, Asfalto 8B)')
        await pg.select_option('main select', '')
        await go(pg, '/dj?tab=playlists', 800)
        t = await text(pg)
        clash = await pg.locator('main ol span.border-primary-500').count()
        record('Estúdio DJ', 'playlist mostra curva de energia e marca tom que não combina', 'ENERGIA AO LONGO DO SET' in t.upper() and clash >= 1, f'{clash} marcações', await shot(pg, 'g2-playlists'))
        await go(pg, '/dj?tab=sync', 800)
        t = await text(pg).__await__() if False else await text(pg)
        record('Estúdio DJ', 'aba Serato e Rekordbox com enviar, importar e converter', all(x in t.upper() for x in ['SERATO → REKORDBOX', 'REKORDBOX → SERATO', 'EXPORTAR M3U']), '', await shot(pg, 'g3-sync'))

        # ---------------- U. Update notice ----------------
        await store_set(pg, 'update', "s.status = { state: 'available', current: '0.3.0', latest: '0.4.0', notes: 'Novidades da versão', manualReason: 'unsigned' }; s.dialogOpen = true")
        await pg.wait_for_timeout(400)
        t = await text(pg, '[role=dialog]')
        record('Atualização', 'nova versão abre aviso pedindo o download', '0.4.0' in t and 'BAIXAR ATUALIZAÇÃO' in t.upper() and 'Aplicativos' in t, '', await shot(pg, 'u1-update'))
        await pg.get_by_role('button', name=re.compile('Depois', re.I)).first.click(); await pg.wait_for_timeout(300)
        record('Atualização', '"Depois" fecha o aviso', not await ev(pg, f"{STORE}('update').dialogOpen"))

        # ---------------- H/I. Theme, contrast and Portuguese ----------------
        await set_deezer(pg, FREE)
        pages = ['/', '/search', '/downloads', '/favorites', '/convert', '/dj', '/settings?tab=accounts', '/settings?tab=downloads', '/settings?tab=look', '/settings?tab=about']
        for mode in ['dark', 'light']:
            await store_set(pg, 'settings', f"s.setTheme('{mode}')"); await pg.wait_for_timeout(500)
            dm = await ev(pg, "document.documentElement.getAttribute('data-mode') || 'dark'")
            record('Tema', f'tema {mode} aplicado', (dm == 'light') == (mode == 'light'), dm)
            for pth in pages:
                await go(pg, pth, 1000)
                await contrast(pg, f'Contraste ({mode})', pth)
                if mode == 'dark': await check_portuguese(pg, 'Português', pth)
            await shot(pg, f'h-{mode}-settings')
            await go(pg, '/', 1000); await shot(pg, f'h-{mode}-home')
        await b.close()

    json.dump(results, open(os.path.join(HERE, 'qa-results.json'), 'w'), ensure_ascii=False, indent=1)
    fails = [r for r in results if not r['ok']]
    print(f"\n{len(results) - len(fails)}/{len(results)} passaram")

asyncio.run(main())
