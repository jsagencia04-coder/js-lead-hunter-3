"""Auditoria técnica de site (somente verificações passivas, sem testes invasivos).

Uma requisição à página inicial (+ até 8 links internos com HEAD/GET) por site.
Cada problema vem com evidência; nada é afirmado sem ter sido observado.
"""
from __future__ import annotations

import re
from datetime import date
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

from .netguard import BlockedURL, SafeFetcher

PARKED = re.compile(
    r"domain (is )?for sale|this domain (is|may be) for sale|dom[ií]nio (est[aá] )?(à|a) venda|parked( free)?|"
    r"comprar este dom[ií]nio|em constru[cç][aã]o|under construction|coming soon|index of /|"
    r"default web site page|it works!|welcome to nginx|apache2 ubuntu default|site em manuten[cç][aã]o|"
    r"registro\.br.*dispon[ií]vel", re.I)
SOCIAL = {
    "instagram": re.compile(r"https?://(?:www\.)?instagram\.com/([A-Za-z0-9_.]{2,30})/?", re.I),
    "facebook": re.compile(r"https?://(?:www\.|m\.)?(?:facebook|fb)\.com/(?!sharer|share|dialog|plugins|tr\b)([A-Za-z0-9_.\-/]{2,80})", re.I),
    "linkedin": re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/(?:company|in)/([A-Za-z0-9_\-%.]{2,100})/?", re.I),
    "whatsapp": re.compile(r"https?://(?:api\.whatsapp\.com/send\?phone=|wa\.me/|whatsapp\.com/send\?phone=)(\+?\d{10,15})", re.I),
}
PHONE = re.compile(r"(?:\+?55\s?)?\(?\b([1-9]{2})\)?\s?(9?\d{4})[-\s.]?(\d{4})\b")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
YEAR = re.compile(r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})", re.I)
SOCIAL_IGNORE = {"p", "reel", "explore", "stories", "tv", "accounts", "share", "sharer.php", "watch"}


class _Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}
        self.links: list[str] = []
        self.h1 = 0
        self.canonical = None
        self.text_parts: list[str] = []
        self._skip = 0
        self.has_form = False
        self.imgs = 0
        self.imgs_no_alt = 0

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (a.get("name") or a.get("property") or a.get("http-equiv") or "").lower()
            if key:
                self.meta[key] = a.get("content", "")
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "link" and "canonical" in a.get("rel", "").lower():
            self.canonical = a.get("href")
        elif tag == "h1":
            self.h1 += 1
        elif tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag == "form":
            self.has_form = True
        elif tag == "img":
            self.imgs += 1
            if not a.get("alt"):
                self.imgs_no_alt += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.text_parts.append(data)

    @property
    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.text_parts)).strip()


def _issue(issues: list, code: str, severity: str, detail: str) -> None:
    issues.append({"codigo": code, "gravidade": severity, "evidencia": detail})


def audit_site(fetcher: SafeFetcher, url: str, *, check_links: int = 8, today: date | None = None) -> dict:
    """Retorna {"disponivel", "final_url", "checks": {...}, "problemas": [...], "nota": 0-100, "texto", "sociais"}."""
    today = today or date.today()
    out: dict = {"url": url, "disponivel": False, "checks": {}, "problemas": [], "sociais": {}, "texto": ""}
    issues = out["problemas"]
    host = urlsplit(url).hostname or url
    https_url = f"https://{host}/"
    attempts = [https_url, f"http://{host}/"] if not url.startswith("http://") else [url, https_url]
    res = None
    errors = []
    for u in attempts:
        try:
            res = fetcher.get(u)
            break
        except BlockedURL as exc:
            out["bloqueado"] = str(exc)
            return out
        except httpx.HTTPError as exc:
            errors.append(f"{u}: {type(exc).__name__}")
    if res is None:
        out["erro"] = "; ".join(errors)
        return out

    out["final_url"] = res.final_url
    out["http_status"] = res.status
    out["checks"]["redirecionamentos"] = res.redirects
    out["checks"]["tempo_resposta_ms"] = res.elapsed_ms
    if res.status >= 400:
        out["erro"] = f"HTTP {res.status}"
        if res.status in (401, 403, 429) or res.status >= 500:
            out["inconclusivo"] = True
        return out
    out["disponivel"] = True
    https = res.final_url.startswith("https://")
    out["checks"]["https"] = https
    if not https:
        _issue(issues, "sem_https", "alta", f"o site abre sem HTTPS ({res.final_url})")
    if res.elapsed_ms > 3000:
        _issue(issues, "lento", "media", f"página inicial levou {res.elapsed_ms / 1000:.1f} s para responder")
    if res.truncated:
        _issue(issues, "pagina_pesada", "media", "página inicial maior que 1,5 MB")

    html = res.text if "html" in res.headers.get("content-type", "html") else ""
    p = _Parser()
    try:
        p.feed(html)
    except Exception:  # noqa: BLE001 — HTML malformado não interrompe a auditoria
        pass
    text = p.text
    out["texto"] = text[:20000]
    out["checks"]["titulo"] = p.title.strip()[:200]

    # domínio estacionado / página vazia
    parked = bool(PARKED.search(html[:50000]))
    out["checks"]["estacionado"] = parked
    if parked or len(text) < 200:
        _issue(issues, "pagina_vazia_ou_estacionada", "alta",
               "página com conteúdo padrão de hospedagem/estacionada" if parked else f"página com pouco conteúdo ({len(text)} caracteres)")

    # responsividade / celular
    viewport = p.meta.get("viewport", "")
    out["checks"]["viewport"] = viewport
    responsive = "width=device-width" in viewport.replace(" ", "").lower()
    out["checks"]["responsivo"] = responsive
    if not responsive:
        _issue(issues, "nao_responsivo", "alta", "sem a meta tag viewport (width=device-width): o site não se adapta ao celular")

    # SEO básico
    seo = {"titulo": bool(p.title.strip()), "descricao": bool(p.meta.get("description", "").strip()), "h1": p.h1,
           "canonical": bool(p.canonical), "noindex": "noindex" in p.meta.get("robots", "").lower(),
           "open_graph": any(k.startswith("og:") for k in p.meta), "imagens_sem_alt": p.imgs_no_alt}
    out["checks"]["seo"] = seo
    if not seo["titulo"]:
        _issue(issues, "sem_titulo", "media", "página sem <title>")
    if not seo["descricao"]:
        _issue(issues, "sem_meta_descricao", "baixa", "sem meta description (resumo exibido no Google)")
    if seo["h1"] == 0:
        _issue(issues, "sem_h1", "baixa", "sem título principal (h1)")
    if seo["noindex"]:
        _issue(issues, "noindex", "alta", "a página pede para não ser indexada (robots noindex)")
    if not seo["open_graph"]:
        _issue(issues, "sem_open_graph", "baixa", "sem metadados Open Graph (prévia ao compartilhar no WhatsApp/redes)")

    # contatos
    links = [urljoin(res.final_url, h) for h in p.links]
    tel = sorted({h for h in p.links if h.lower().startswith("tel:")})
    mail = sorted({h for h in p.links if h.lower().startswith("mailto:")})
    phones_txt = {"".join(m.groups()) for m in PHONE.finditer(text)}
    emails_txt = set(EMAIL.findall(text))
    contato = {"links_telefone": tel[:5], "links_email": mail[:5], "telefones_texto": sorted(phones_txt)[:5],
               "emails_texto": sorted(emails_txt)[:5], "formulario": p.has_form}
    for name, rx in SOCIAL.items():
        found = []
        for h in links + [html[:200000]]:
            for m in rx.finditer(h):
                ident = m.group(1).strip("/").split("/")[0].split("?")[0]
                if ident and ident.lower() not in SOCIAL_IGNORE:
                    full = m.group(0).split("?")[0] if name != "whatsapp" else m.group(0)
                    if full not in found:
                        found.append(full)
        if found:
            out["sociais"][name] = found[:3]
    contato["whatsapp"] = bool(out["sociais"].get("whatsapp"))
    out["checks"]["contato"] = contato
    if not (tel or mail or phones_txt or emails_txt or contato["whatsapp"] or p.has_form):
        _issue(issues, "sem_contato", "alta", "nenhum telefone, e-mail, WhatsApp ou formulário de contato na página inicial")

    # Recursos comerciais observados na página/linkagem, sem inferir inexistência no restante do site.
    business_patterns = {
        'catalogo': re.compile(r'cat[aá]logo|portfolio|portf[oó]lio', re.I),
        'loja': re.compile(r'/loja|/shop|/cart|/carrinho|/checkout|/produtos', re.I),
        'agendamento': re.compile(r'agenda|appointment|booking|calendly|cal\.com', re.I),
        'institucional': re.compile(r'sobre|quem-somos|about|institucional', re.I),
        'servicos': re.compile(r'servi[cç]os|services', re.I),
    }
    out['checks']['recursos_comerciais'] = {
        code: {'observado': bool(found := [u for u in links if pattern.search(u)]), 'evidencias': found[:8],
               'escopo': 'links publicados na página analisada; não prova ausência no site inteiro'}
        for code, pattern in business_patterns.items()
    }
    out['checks']['acessibilidade_basica'] = {'imagens': p.imgs, 'imagens_sem_alt': p.imgs_no_alt,
        'limitacao': 'Somente atributos alt da página; não equivale a auditoria WCAG completa.'}

    # desatualizado (rodapé com ano antigo)
    years = [int(y) for y in YEAR.findall(html[-60000:] or "")]
    if years:
        last = max(years)
        out["checks"]["ano_rodape"] = last
        if last <= today.year - 3:
            _issue(issues, "desatualizado", "media", f"rodapé com © {last}: indício de site sem atualização")

    # links quebrados (internos, amostra)
    internos = []
    base_host = urlsplit(res.final_url).hostname
    for u in links:
        sp = urlsplit(u)
        if sp.scheme in ("http", "https") and sp.hostname == base_host and u.split("#")[0] != res.final_url:
            clean = u.split("#")[0]
            if clean not in internos:
                internos.append(clean)
    quebrados = []
    for u in internos[:check_links]:
        try:
            r2 = fetcher.get(u, method="HEAD", read_body=False)
            if r2.status in (405, 501):
                r2 = fetcher.get(u, read_body=False)
            if r2.status in (404, 410) or r2.status >= 500:
                quebrados.append({"url": u, "status": r2.status})
        except (httpx.HTTPError, BlockedURL):
            quebrados.append({"url": u, "status": None})
    out["checks"]["links_testados"] = min(len(internos), check_links)
    out["checks"]["links_quebrados"] = quebrados
    if quebrados:
        _issue(issues, "links_quebrados", "media", f"{len(quebrados)} de {min(len(internos), check_links)} links internos testados não abrem")

    peso = {"alta": 20, "media": 10, "baixa": 4}
    out["nota"] = max(0, 100 - sum(peso[i["gravidade"]] for i in issues))
    return out
