"""Read-only optimization suggestions from campaign performance (no mutations)."""

from __future__ import annotations

from typing import Any, Dict, List

from tools.ads.reporting._google import run_google_operation


def run(payload: Dict[str, Any]) -> Dict[str, Any]:
    body = dict(payload or {})
    body.setdefault('date_range', body.get('date_range') or 'LAST_30_DAYS')
    perf = run_google_operation('performance', body)
    items = perf.get('payload') if perf.get('response_type') == 'items' else []
    if not isinstance(items, list):
        items = []

    min_spend = float(body.get('min_spend') or 50.0)
    max_cpa = float(body.get('max_cpa') or 100.0)
    min_ctr = float(body.get('min_ctr') or 0.01)

    hints: List[Dict[str, Any]] = []
    for row in items:
        spend = float(row.get('cost') or 0)
        conversions = float(row.get('conversions') or 0)
        ctr = float(row.get('ctr') or 0)
        cpa = spend / conversions if conversions > 0 else None
        name = row.get('campaign_name') or row.get('name') or row.get('campaign_id')
        cid = row.get('campaign_id') or row.get('id')

        if spend >= min_spend and conversions == 0:
            hints.append(
                {
                    'campaign_id': cid,
                    'campaign_name': name,
                    'action': 'review_pause',
                    'reason': f'Spent ${spend:.2f} with zero conversions in {body["date_range"]}',
                    'metrics': {'spend': spend, 'conversions': conversions, 'ctr': ctr},
                },
            )
        elif cpa is not None and cpa > max_cpa and spend >= min_spend:
            hints.append(
                {
                    'campaign_id': cid,
                    'campaign_name': name,
                    'action': 'reduce_budget',
                    'reason': f'CPA ${cpa:.2f} exceeds target ${max_cpa:.2f}',
                    'metrics': {'spend': spend, 'conversions': conversions, 'cpa': cpa},
                },
            )
        elif ctr < min_ctr and spend >= min_spend / 2:
            hints.append(
                {
                    'campaign_id': cid,
                    'campaign_name': name,
                    'action': 'improve_creative',
                    'reason': f'CTR {ctr:.2%} below {min_ctr:.2%} threshold',
                    'metrics': {'spend': spend, 'ctr': ctr},
                },
            )

    return {
        'ok': True,
        'response_type': 'object',
        'payload': {
            'date_range': body['date_range'],
            'campaigns_analyzed': len(items),
            'hints': hints,
        },
    }
