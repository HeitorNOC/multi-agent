from apps.aurora.runtime.pilot_corpus import PilotCorpus, terms
from apps.aurora.runtime.pilot_retrieval import HybridRetriever
from test_pilot import make_manifest


def test_hybrid_indexes_only_approved_current_passages(tmp_path):
    corpus = PilotCorpus(make_manifest(tmp_path))
    indexed = []

    def embed(texts):
        indexed.extend(texts)
        return [(1, 0) for _ in texts]

    HybridRetriever(corpus.passages, embed)
    assert any("15 dias" in passage for passage in indexed)
    assert all(
        "30 dias" not in passage and "90 dias" not in passage for passage in indexed
    )


def test_vocabulary_is_scoped_to_exact_question():
    goal = "Como assumir uma conversa?"
    unrelated = "Quanto pesa um elefante?"
    facet = "control_passed confirma a passagem"
    messages = {
        "handoff": "A aplicação pode assumir o atendimento.",
        "event": "control_passed registra a transferência.",
    }
    vectors = {
        messages["handoff"]: (1, 0, 0),
        messages["event"]: (0, 1, 0),
        goal: (1, 0, 0),
        unrelated: (0, 0, 1),
        facet: (0, 1, 0),
    }
    passages = [
        ({"id": id, "quote": quote}, terms(quote)) for id, quote in messages.items()
    ]

    def embed(texts):
        return [vectors[text] for text in texts]

    plain = HybridRetriever(passages, embed)
    configured = HybridRetriever(
        passages,
        embed,
        (goal, [{"query": facet, "anchors": ["control_passed"]}]),
    )
    assert [p["id"] for p in plain.retrieve(goal)] == ["handoff"]
    assert [p["id"] for p in configured.retrieve(goal)] == ["event", "handoff"]
    assert configured.retrieve(unrelated) == []
