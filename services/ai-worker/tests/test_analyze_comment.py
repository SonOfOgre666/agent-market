from lib.llm.gemini import _gemini_uses_thinking_budget
from lib.llm.router import _normalize_analyze_comment, _validate_analyze_comment


def test_gemini_thinking_budget_detection():
    assert _gemini_uses_thinking_budget('gemini-2.5-flash')
    assert _gemini_uses_thinking_budget('gemini-3.5-flash')
    assert not _gemini_uses_thinking_budget('gemini-2.0-flash')


def test_normalize_analyze_comment_aliases_and_objects():
    out = _normalize_analyze_comment(
        {
            'sentiment': 'negative',
            'summary': 'Disengaged commenter',
            'topics': ['apathy'],
            'urgency': 'low',
            'suggested_replies': [
                {'text': 'Thanks for sharing your thoughts!'},
                'We appreciate the honesty.',
            ],
        },
        {},
    )
    assert out['proposed_replies'] == [
        'Thanks for sharing your thoughts!',
        'We appreciate the honesty.',
    ]
    _validate_analyze_comment(out)
