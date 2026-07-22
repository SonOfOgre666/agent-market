"""Budget currency parsing and conversion."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from lib.ads_currency import (
    FxQuote,
    convert_amount,
    extract_budget_mention,
    normalize_currency_code,
    resolve_budget_for_account,
)
from tools.ads._budget_currency import convert_payload_budget


class ParseBudgetCurrencyTest(unittest.TestCase):
    def test_dollar_per_day(self):
        m = extract_budget_mention('$3/day targeting Morocco')
        self.assertIsNotNone(m)
        assert m is not None
        self.assertEqual(m.amount, 3.0)
        self.assertEqual(m.currency, 'USD')

    def test_mad_explicit(self):
        m = extract_budget_mention('budget 3 MAD/day')
        self.assertIsNotNone(m)
        assert m is not None
        self.assertEqual(m.amount, 3.0)
        self.assertEqual(m.currency, 'MAD')

    def test_no_currency(self):
        m = extract_budget_mention('Set the daily budget to 3/day')
        self.assertIsNotNone(m)
        assert m is not None
        self.assertEqual(m.amount, 3.0)
        self.assertIsNone(m.currency)

    def test_normalize_symbols(self):
        self.assertEqual(normalize_currency_code('$'), 'USD')
        self.assertEqual(normalize_currency_code('dirhams'), 'MAD')
        self.assertEqual(normalize_currency_code('eur'), 'EUR')


class ResolveBudgetRulesTest(unittest.TestCase):
    def test_no_source_uses_account_as_is(self):
        out = resolve_budget_for_account(3, source_currency=None, account_currency='MAD')
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out.amount, 3.0)
        self.assertFalse(out.converted)
        self.assertEqual(out.account_currency, 'MAD')

    def test_same_currency_no_convert(self):
        out = resolve_budget_for_account(3, source_currency='MAD', account_currency='MAD')
        self.assertIsNotNone(out)
        assert out is not None
        self.assertEqual(out.amount, 3.0)
        self.assertFalse(out.converted)

    @patch(
        'lib.ads_currency.fetch_fx_quote',
        return_value=FxQuote(
            rate=10.0, date='2026-07-22', source='frankfurter', base='USD', quote='MAD',
        ),
    )
    def test_converts_when_currency_differs(self, _mock_quote):
        out = convert_amount(3, 'USD', 'MAD')
        self.assertTrue(out.converted)
        self.assertEqual(out.amount, 30.0)
        self.assertEqual(out.account_currency, 'MAD')
        self.assertEqual(out.source_currency, 'USD')
        self.assertEqual(out.rate_date, '2026-07-22')
        self.assertEqual(out.rate_source, 'frankfurter')


class ConvertPayloadBudgetTest(unittest.TestCase):
    @patch('tools.ads._budget_currency._resolve_google_account_currency', return_value='MAD')
    @patch(
        'lib.ads_currency.fetch_fx_quote',
        return_value=FxQuote(
            rate=10.0, date='2026-07-22', source='frankfurter', base='USD', quote='MAD',
        ),
    )
    def test_google_payload_converts_usd(self, _fx, _acc):
        body, result = convert_payload_budget(
            {
                'daily_budget': 3,
                'budget_currency': 'USD',
                'name': 'Test Budget',
            },
            platform='google',
        )
        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result.converted)
        self.assertEqual(body['daily_budget'], 30.0)
        self.assertEqual(body['account_currency'], 'MAD')
        self.assertEqual(body['budget_conversion']['rate_source'], 'frankfurter')

    @patch('tools.ads._budget_currency._resolve_meta_account_currency', return_value='MAD')
    def test_meta_no_currency_unchanged(self, _acc):
        body, result = convert_payload_budget(
            {'budget': {'amount': 3, 'type': 'daily'}},
            platform='meta',
        )
        self.assertIsNotNone(result)
        assert result is not None
        self.assertFalse(result.converted)
        self.assertEqual(body['budget']['amount'], 3)


if __name__ == '__main__':
    unittest.main()
