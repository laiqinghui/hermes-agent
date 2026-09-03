def _doc(rev=1):
    return {"canvasVersion": 1, "rev": rev, "layout": {"type": "grid", "cols": 12}, "components": [{"id": "a", "type": "note"}]}


def test_declines_on_the_no_canvas_marker(plugin):
    v, reason = plugin.judge.verdict_from("NO CANVAS: this was a debugging session.", _doc())
    assert v == "declined"
    assert reason == "this was a debugging session."


def test_marker_is_start_anchored(plugin):
    # A transcript that merely quotes the phrase must not flip the verdict.
    v, _ = plugin.judge.verdict_from('The user wrote "NO CANVAS: x" earlier, but here is the map.', _doc())
    assert v == "rendered"


def test_declines_when_no_doc_was_authored(plugin):
    # The agent claimed success but produced nothing — that is a decline, not a
    # rendered canvas, or the client would show an empty canvas.
    v, reason = plugin.judge.verdict_from("I have laid out the tracks.", None)
    assert v == "declined"
    assert "no canvas" in reason.lower()


def test_renders_when_an_answer_and_a_doc_exist(plugin):
    v, reason = plugin.judge.verdict_from("I have laid out the tracks.", _doc())
    assert v == "rendered"
    assert reason == ""


def test_declines_when_the_turn_produced_no_answer_at_all(plugin):
    v, reason = plugin.judge.verdict_from("", None)
    assert v == "declined"
    assert reason


def test_an_authored_doc_outranks_a_missing_answer(plugin):
    # Some models author the canvas and say nothing. A doc on disk is the
    # stronger signal — do not throw the work away over an empty answer.
    v, _ = plugin.judge.verdict_from("", _doc())
    assert v == "rendered"
