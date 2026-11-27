"""Inteligência digital: SSRF, validação de homônimos, auditoria de site e fila."""
import socket

import httpx
import pytest

from lead_hunter.intel import audit as au
from lead_hunter.intel.engine import IntelEngine
from lead_hunter.intel.match import Company, name_similarity, score_match
from lead_hunter.intel.netguard import BlockedURL, SafeFetcher, is_public_ip
from lead_hunter.intel.providers import Candidate, ProviderUnavailable, SearchOutcome, TemporaryError

from .fake_rf import FakeRF, build_competence
from .test_pipeline import make_worker, q, run_import

# ---------------------------------------------------------------------------- SSRF


def test_ip_publico():
    for ip in ("127.0.0.1", "10.0.0.5", "172.16.1.1", "192.168.0.1", "169.254.169.254", "::1", "fc00::1",
               "0.0.0.0", "100.64.0.1", "::ffff:127.0.0.1", "224.0.0.1"):
        assert not is_public_ip(ip), ip
    assert is_public_ip("8.8.8.8") and is_public_ip("2001:4860:4860::8888")


def test_bloqueia_urls_perigosas():
    f = SafeFetcher(resolver=lambda h, p: ["10.0.0.1"] if h == "interno.exemplo.com" else ["93.184.216.34"])
    for url in ("file:///etc/passwd", "ftp://exemplo.com/", "http://localhost/", "http://user:pw@exemplo.com/",
                "http://exemplo.com:8080/", "http://interno.exemplo.com/", "http://metadata.google.internal/"):
        with pytest.raises(BlockedURL):
            f.check_url(url)
    f.check_url("https://exemplo.com/")


def test_redirecionamento_para_rede_interna_bloqueado():
    def handler(req):
        if req.url.host == "publico.com.br":
            return httpx.Response(302, headers={"location": "http://interno.local/admin"})
        return httpx.Response(200, html="segredo")

    resolver = lambda h, p: ["93.184.216.34"]  # noqa: E731
    f = SafeFetcher(httpx.Client(transport=httpx.MockTransport(handler)), resolver=resolver)
    with pytest.raises(BlockedURL):
        f.get("https://publico.com.br/")


def test_limite_de_tamanho():
    big = b"<html>" + b"a" * 3_000_000
    f = SafeFetcher(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=big))),
                    resolver=lambda h, p: ["93.184.216.34"], max_bytes=100_000)
    r = f.get("https://grande.com.br/")
    assert r.truncated and len(r.body) == 100_000


# ---------------------------------------------------------------------------- homônimos

PADARIA = Company(cnpj_basico="11222333", cnpj="11222333000181", razao_social="PADARIA SAO JOAO LTDA",
                  nome_fantasia="PADARIA SÃO JOÃO", municipio="CAMPINAS", uf="SP", logradouro="RUA DAS FLORES",
                  cep="13010000", ddd1="19", telefone1="912345678", email="contato@padariasaojoao.com.br", cnae="1091101")


def test_nome_semelhante():
    assert name_similarity("PADARIA SÃO JOÃO LTDA", "Padaria São João") > 0.85
    assert name_similarity("PADARIA SÃO JOÃO", "Auto Peças Brasil") < 0.4


def test_homonimo_em_outra_cidade_nao_e_associado():
    m = score_match(PADARIA, name="Padaria São João", address="Av. Brasil, 100 - Recife - PE")
    assert m.confidence < 40, m.evidence
    assert any(e.tipo == "municipio_divergente" for e in m.evidence)


def test_cnpj_na_pagina_verifica():
    m = score_match(PADARIA, text="Padaria São João — CNPJ 11.222.333/0001-81 — Campinas/SP")
    assert m.confidence >= 70


def test_mesma_cidade_e_telefone_verifica():
    m = score_match(PADARIA, name="Padaria São João", address="R. das Flores, 10 - Campinas - SP", phone="(19) 91234-5678")
    assert m.confidence >= 70


# ---------------------------------------------------------------------------- auditoria

GOOD = """<html><head><title>Padaria São João | Campinas</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Pães artesanais">
<meta property="og:title" content="Padaria"></head><body><h1>Padaria São João</h1>
<p>Pães, bolos e cafés feitos todos os dias em Campinas. Venha conhecer nossa loja na Rua das Flores.
Encomendas para festas e eventos, entrega na região. CNPJ 11.222.333/0001-81.</p>
<a href="tel:+5519912345678">Ligue</a> <a href="https://wa.me/5519912345678">WhatsApp</a>
<a href="https://www.instagram.com/padariasaojoao/">Instagram</a> <a href="/cardapio">Cardápio</a>
<a href="/quebrado">Promoções</a><footer>© 2026 Padaria São João</footer></body></html>"""

BAD = """<html><head><title></title></head><body><p>Bem-vindo</p><footer>Copyright 2019</footer></body></html>"""


def _site_fetcher(pages: dict):
    def handler(req):
        key = (req.url.host, req.url.path)
        if req.url.scheme == "https" and req.url.host.startswith("semhttps"):
            raise httpx.ConnectError("tls")
        if key in pages:
            status, body = pages[key]
            if status in (301, 302):
                return httpx.Response(status, headers={"location": body})
            return httpx.Response(status, html=body if req.method != "HEAD" else "")
        return httpx.Response(404, html="não encontrado")
    return SafeFetcher(httpx.Client(transport=httpx.MockTransport(handler)), resolver=lambda h, p: ["93.184.216.34"])


def test_auditoria_site_bom():
    f = _site_fetcher({("padariasaojoao.com.br", "/"): (200, GOOD), ("padariasaojoao.com.br", "/cardapio"): (200, "ok")})
    a = au.audit_site(f, "https://padariasaojoao.com.br/")
    assert a["disponivel"] and a["checks"]["https"] and a["checks"]["responsivo"]
    assert a["sociais"]["instagram"][0].startswith("https://www.instagram.com/padariasaojoao")
    assert a["sociais"]["whatsapp"]
    codes = {i["codigo"] for i in a["problemas"]}
    assert "links_quebrados" in codes and "sem_https" not in codes and "nao_responsivo" not in codes


def test_recursos_comerciais_observados_sem_ausencia_inventada():
    body = GOOD.replace('</body>', '<a href="/catalogo">Catálogo</a><a href="/agendamento">Agenda</a><footer>Hospedado na Hostgator e GoDaddy</footer></body>')
    f = _site_fetcher({('padariasaojoao.com.br', '/'): (200, body)})
    result = au.audit_site(f, 'https://padariasaojoao.com.br/', check_links=0)
    assert result['checks']['recursos_comerciais']['catalogo']['observado']
    assert result['checks']['recursos_comerciais']['agendamento']['observado']
    assert not result['checks']['recursos_comerciais']['loja']['observado']
    assert not result['checks']['estacionado']
    assert 'página' in result['checks']['recursos_comerciais']['loja']['escopo']


def test_auditoria_site_com_problemas():
    f = _site_fetcher({("semhttps.com.br", "/"): (200, BAD)})
    a = au.audit_site(f, "https://semhttps.com.br/")
    codes = {i["codigo"] for i in a["problemas"]}
    assert {"sem_https", "nao_responsivo", "sem_titulo", "sem_contato", "desatualizado", "pagina_vazia_ou_estacionada"} <= codes
    assert all(i["evidencia"] for i in a["problemas"]) and a["nota"] < 50


def test_bloqueio_do_site_e_inconclusivo():
    f = _site_fetcher({("bloqueia.com.br", "/"): (403, "forbidden")})
    a = au.audit_site(f, "https://bloqueia.com.br/")
    assert not a["disponivel"] and a["inconclusivo"]


# ---------------------------------------------------------------------------- motor + fila

class FakePlaces:
    enabled = True

    def __init__(self, results=None, fail=None):
        self.results = results or {}
        self.fail = fail
        self.calls = 0

    def search(self, c, budget, cache):
        self.calls += 1
        if self.fail:
            raise self.fail
        budget.reserve("google_places")
        return SearchOutcome("google_places", self.results.get(c.cnpj_basico, []), True, ("google_business",))


class FakeBrave(FakePlaces):
    def search(self, c, budget, cache):
        self.calls += 1
        if self.fail:
            raise self.fail
        budget.reserve("brave")
        return SearchOutcome("brave", self.results.get(c.cnpj_basico, []), True, ("site", "instagram", "facebook", "linkedin"))


class Off:
    enabled = False


def _db(fresh_db, tmp_path):
    root = tmp_path / "rf"
    build_competence(root, "2026-10")
    with FakeRF(root) as rf:
        assert run_import(make_worker(fresh_db, rf.url, tmp_path))["status"] == "concluido"
    # CNPJ e telefone da padaria na página do domínio do e-mail cadastral (padaria.com.br)
    return fresh_db


def _channels(db, base):
    return {r["platform"]: r for r in q(db, "select * from digital_channels where cnpj_basico = %s", base)}


def test_motor_sem_provedores_nao_afirma_ausencia(fresh_db, tmp_path):
    db = _db(fresh_db, tmp_path)
    page = GOOD.replace("11.222.333/0001-81", "11.222.333/0001-81")
    fetcher = _site_fetcher({("padaria.com.br", "/"): (200, page), ("alfa.com", "/"): (403, "x")})
    eng = IntelEngine(db, places=Off(), brave=Off(), fetcher=fetcher, dns_missing=lambda d: False)
    stats = eng.run()
    assert stats["processados"] == 5
    pad = _channels(db, "11222333")
    assert pad["site"]["status"] == "verificado" and pad["site"]["confidence"] >= 70
    assert pad["instagram"]["status"] == "verificado" and pad["instagram"]["source"] == "site_oficial"
    assert pad["whatsapp"]["status"] == "verificado"
    alfa = _channels(db, "12ABC345")
    assert alfa["site"]["status"] == "inconclusivo"          # 403 não prova ausência
    assert alfa["instagram"]["status"] == "pendente"          # sem pesquisa: nunca "não localizado"
    assert alfa["google_business"]["status"] == "pendente"
    # sem e-mail de domínio próprio e sem provedor: pendente
    outro = _channels(db, "66777888")
    assert outro["site"]["status"] == "pendente"
    assert not q(db, "select 1 from digital_channels where status = 'nao_localizado'")
    run = q(db, "select * from enrichment_runs order by started_at desc limit 1")[0]
    assert run["status"] == "concluido" and run["processed"] == 5
    # repetir não refaz pesquisas recentes
    assert eng.run()["processados"] == 0


def test_motor_com_provedores_homonimo_e_custos(fresh_db, tmp_path):
    db = _db(fresh_db, tmp_path)
    homonimo = Candidate("google_business", "https://maps.google.com/?cid=1", "google_places", name="Padaria São João",
                         address="Av. Boa Viagem, 1 - Recife - PE", phone="(81) 3333-4444", extra={"site": "https://outra.com.br"})
    places = FakePlaces({"11222333": [homonimo]})
    brave = FakeBrave({"11222333": [Candidate("instagram", "https://www.instagram.com/padariasaojoaorecife/", "brave",
                                              name="Padaria São João (@padariasaojoaorecife) Recife",
                                              snippet="Recife - PE. A melhor padaria de Boa Viagem")]})
    fetcher = _site_fetcher({("outra.com.br", "/"): (200, GOOD.replace("11.222.333/0001-81", "99.888.777/0001-00")
                                                      .replace("Campinas", "Recife").replace("19912345678", "81999990000"))})
    eng = IntelEngine(db, places=places, brave=brave, fetcher=fetcher, dns_missing=lambda d: True)
    eng.run()
    pad = _channels(db, "11222333")
    # o perfil e o site do homônimo de Recife não foram associados
    assert pad["google_business"]["status"] == "nao_localizado"
    assert pad["site"]["url"] is None or "outra.com.br" not in (pad["site"]["url"] or "")
    assert pad["instagram"]["status"] != "verificado"
    assert pad["google_business"]["candidates"]
    # pesquisa conclusiva + domínio do e-mail inexistente: ausência de site comprovada
    assert pad["site"]["status"] == "nao_localizado"
    uso = {r["provider"]: r for r in q(db, "select * from provider_usage")}
    assert uso["google_places"]["calls"] == 5 and float(uso["google_places"]["cost_usd"]) > 0


def test_limite_diario_deixa_pendente(fresh_db, tmp_path):
    db = _db(fresh_db, tmp_path)
    q(db, """update app_settings set value = value || '{"limites_diarios": {"google_places": 2}}' where key = 'inteligencia' returning 1""")
    eng = IntelEngine(db, places=FakePlaces(), brave=Off(), fetcher=_site_fetcher({}), dns_missing=lambda d: False)
    eng.run()
    st = [r["status"] for r in q(db, "select status from digital_channels where platform = 'google_business'")]
    assert st.count("nao_localizado") == 2 and st.count("pendente") == 3


def test_erro_temporario_tem_backoff(fresh_db, tmp_path):
    db = _db(fresh_db, tmp_path)
    eng = IntelEngine(db, places=FakePlaces(fail=TemporaryError("google_places: HTTP 503")), brave=Off(),
                      fetcher=_site_fetcher({}), dns_missing=lambda d: False)
    eng.run()
    rows = q(db, "select status, attempts, next_attempt_at > now() as depois from enrichment_queue")
    assert all(r["status"] == "erro" and r["attempts"] == 1 and r["depois"] for r in rows)
    assert {r["status"] for r in q(db, "select status from digital_channels where platform = 'google_business'")} == {"erro_temporario"}
    assert eng.run()["processados"] == 0  # espera o backoff


def test_pausa_e_confirmacao_manual(fresh_db, tmp_path):
    db = _db(fresh_db, tmp_path)
    q(db, """update app_settings set value = value || '{"pausado": true}' where key = 'inteligencia' returning 1""")
    eng = IntelEngine(db, places=Off(), brave=Off(), fetcher=_site_fetcher({}), dns_missing=lambda d: False)
    assert eng.run()["situacao"] == "pausado"
    assert not q(db, "select 1 from enrichment_runs")
    q(db, """update app_settings set value = value || '{"pausado": false}' where key = 'inteligencia' returning 1""")
    lead = q(db, "select id from leads where cnpj_basico = '12ABC345'")[0]["id"]
    q(db, """insert into digital_channels (cnpj_basico, lead_id, platform, url, status, manual, confidence)
             values ('12ABC345', %s, 'site', 'https://alfa.com/', 'verificado', true, 100) returning 1""", lead)
    eng.run()
    site = _channels(db, "12ABC345")["site"]
    assert site["manual"] and site["status"] == "verificado" and site["url"] == "https://alfa.com/"


def test_provedor_indisponivel_nao_gera_ausencia(fresh_db, tmp_path):
    db = _db(fresh_db, tmp_path)
    eng = IntelEngine(db, places=FakePlaces(fail=ProviderUnavailable("sem chave")), brave=FakeBrave(fail=ProviderUnavailable("x")),
                      fetcher=_site_fetcher({}), dns_missing=lambda d: True)
    eng.run()
    assert not q(db, "select 1 from digital_channels where status = 'nao_localizado'")


def test_dns_rebinding_bloqueado(monkeypatch):
    class Stream:
        def get_extra_info(self, k):
            return ("10.0.0.7", 443) if k == "server_addr" else None

    def handler(req):
        return httpx.Response(200, html="x", extensions={"network_stream": Stream()})

    f = SafeFetcher(httpx.Client(transport=httpx.MockTransport(handler)), resolver=lambda h, p: ["93.184.216.34"])
    with pytest.raises(BlockedURL):
        f.get("https://rebind.com.br/")


def test_resolver_real_rejeita_localhost():
    with pytest.raises(BlockedURL):
        SafeFetcher().check_url("http://127.0.0.1/")
    assert socket.getaddrinfo  # resolver padrão existe
