"""Celery: workflow runtime execution."""

from __future__ import annotations

import json
import logging
from typing import Any

from billiard.exceptions import SoftTimeLimitExceeded
from celery_app import celery_app
from db import get_redis
from lib.runtime.cancel import is_workflow_cancelled
from lib.runtime.executor import execute_workflow_steps, finalize_interrupted_steps

logger = logging.getLogger(__name__)

# Never auto-requeue a half-finished workflow (would re-bill image/video steps).
_WORKFLOW_TASK_OPTS = dict(max_retries=0, acks_late=False)


@celery_app.task(
    name='tasks.agent.execute_workflow',
    soft_time_limit=1800,
    time_limit=1980,
    **_WORKFLOW_TASK_OPTS,
)
def execute_workflow_task(
    workspace_id: str,
    workflow_id: str,
    approved: bool = True,
    reply_key: str | None = None,
) -> None:
    r = get_redis()

    def write(ok: bool, data: Any = None, error: str | None = None, status: int = 502) -> None:
        if not reply_key:
            return
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status}, default=str)
        r.set(reply_key, body, ex=600)

    try:
        from lib import worker_api

        if not worker_api.configured():
            raise RuntimeError('Worker API not configured')

        wf = worker_api.get_agent_workflow(workflow_id)
        graph = wf.get('graph') or {}
        if not graph.get('steps') and graph.get('meta_compiled'):
            from lib.planner.meta_campaign_spec import materialize_meta_compiled_graph

            account_id = str(
                graph.get('meta_account_id')
                or wf.get('account_id')
                or ''
            ).strip()
            graph = materialize_meta_compiled_graph(
                graph,
                account_id=account_id,
                workspace_id=workspace_id,
            )
            worker_api.patch_agent_workflow(workflow_id, {
                'graph': graph,
                'intent': graph.get('intent'),
                'summary': graph.get('summary'),
                'approval_gates': graph.get('approval_gates') or [],
            })

        if not graph.get('steps') and graph.get('google_compiled'):
            from lib.planner.google_campaign_spec import materialize_google_compiled_graph

            account_id = str(
                graph.get('google_account_id')
                or wf.get('account_id')
                or ''
            ).strip()
            graph = materialize_google_compiled_graph(
                graph,
                account_id=account_id,
                workspace_id=workspace_id,
            )
            worker_api.patch_agent_workflow(workflow_id, {
                'graph': graph,
                'intent': graph.get('intent'),
                'summary': graph.get('summary'),
                'approval_gates': graph.get('approval_gates') or [],
            })

        if not graph.get('steps'):
            write(False, None, 'Workflow has no executable steps', 400)
            return

        if is_workflow_cancelled(workflow_id):
            worker_api.patch_agent_workflow(workflow_id, {
                'status': 'cancelled',
                'step_results': finalize_interrupted_steps(
                    wf.get('step_results') or {},
                    error='Stopped by user.',
                ),
                'execution_errors': ['Stopped by user.'],
            })
            worker_api.emit_event('workflow.cancelled', {
                'workflow_id': wf.get('workflow_id') or workflow_id,
                'workflow_mongo_id': workflow_id,
                'workspace_id': workspace_id,
            })
            write(True, {
                'workflow_id': workflow_id,
                'status': 'cancelled',
                'step_results': wf.get('step_results'),
                'errors': ['Stopped by user.'],
            }, None, 200)
            return

        worker_api.patch_agent_workflow(workflow_id, {'status': 'running'})
        worker_api.emit_event('workflow.running', {
            'workflow_id': wf.get('workflow_id') or workflow_id,
            'workflow_mongo_id': workflow_id,
            'workspace_id': workspace_id,
        })

        wf_public_id = wf.get('workflow_id') or workflow_id

        def _workflow_stopped() -> bool:
            if is_workflow_cancelled(workflow_id):
                return True
            snap = worker_api.get_agent_workflow(workflow_id)
            return (snap.get('status') or '').lower() == 'cancelled'

        def on_step_event(step_id: str, event: str, payload: dict) -> None:
            if _workflow_stopped():
                return
            step_results = payload.pop('step_results', None)
            worker_api.emit_event(event, {
                'workflow_id': wf_public_id,
                'workflow_mongo_id': workflow_id,
                'workspace_id': workspace_id,
                'step_id': step_id,
                **payload,
            })
            if step_results is not None and not _workflow_stopped():
                worker_api.patch_agent_workflow(workflow_id, {
                    'status': 'running',
                    'step_results': step_results,
                })

        outcome = execute_workflow_steps(
            graph,
            approved=approved,
            workspace_id=workspace_id,
            workflow_mongo_id=workflow_id,
            on_step_event=on_step_event,
            initial_step_results=wf.get('step_results'),
        )

        final_status = outcome['status']
        if final_status == 'completed':
            wf_status = 'completed'
        elif final_status == 'cancelled':
            wf_status = 'cancelled'
        elif final_status == 'awaiting_approval':
            wf_status = 'awaiting_approval'
        else:
            wf_status = 'failed'

        final_step_results = outcome.get('step_results') or {}
        if wf_status == 'failed':
            final_step_results = finalize_interrupted_steps(final_step_results)
        elif wf_status == 'cancelled':
            final_step_results = finalize_interrupted_steps(
                final_step_results,
                error='Stopped by user.',
            )

        wf_snap = worker_api.get_agent_workflow(workflow_id)
        if (wf_snap.get('status') or '').lower() == 'cancelled' and wf_status != 'cancelled':
            wf_status = 'cancelled'
            final_step_results = finalize_interrupted_steps(
                wf_snap.get('step_results') or final_step_results,
                error='Stopped by user.',
            )

        worker_api.patch_agent_workflow(workflow_id, {
            'status': wf_status,
            'step_results': final_step_results,
            'execution_errors': outcome.get('errors') or [],
        })

        if wf_status == 'completed':
            graph_for_persist = (worker_api.get_agent_workflow(workflow_id).get('graph') or graph)
            from lib.ads_agent_persist import persist_agent_campaign_from_workflow

            persist_agent_campaign_from_workflow(
                workspace_id=workspace_id,
                graph=graph_for_persist,
                step_results=final_step_results,
                account_id=str(
                    graph_for_persist.get('google_account_id')
                    or graph_for_persist.get('meta_account_id')
                    or wf.get('account_id')
                    or ''
                ) or None,
            )

        graph = wf.get('graph') or {}
        if graph.get('meta_setup_phase') == 'discovery' and wf_status == 'completed':
            from lib.planner.ads_fallback import meta_content_missing_lines
            from lib.planner.meta_page_selection import (
                build_meta_setup_clarification_message,
                usable_pages,
            )

            pages_output = (final_step_results.get('step_2') or {}).get('output') or {}
            pages = usable_pages(pages_output)
            user_msg = str(wf.get('user_message') or '')
            merged_msg = user_msg
            clarification = build_meta_setup_clarification_message(
                missing_lines=meta_content_missing_lines(
                    {'attached_media': wf.get('attached_media') or []},
                    merged_msg,
                ),
                pages=pages,
                has_image=bool((wf.get('attached_media') or [])),
            )
            worker_api.patch_agent_workflow(workflow_id, {
                'summary': clarification,
            })

        event = 'workflow.completed' if wf_status == 'completed' else (
            'workflow.cancelled' if wf_status == 'cancelled' else (
                'workflow.failed' if wf_status == 'failed' else 'approval.required'
            )
        )
        worker_api.emit_event(event, {
            'workflow_id': wf.get('workflow_id') or workflow_id,
            'workflow_mongo_id': workflow_id,
            'workspace_id': workspace_id,
            'status': wf_status,
        })

        write(True, {
            'workflow_id': workflow_id,
            'status': wf_status,
            'step_results': outcome.get('step_results'),
            'errors': outcome.get('errors'),
        }, None, 200)
    except SoftTimeLimitExceeded:
        logger.warning('execute_workflow timed out workflow_id=%s', workflow_id)
        try:
            from lib import worker_api
            if worker_api.configured():
                wf_snap = worker_api.get_agent_workflow(workflow_id)
                worker_api.patch_agent_workflow(workflow_id, {
                    'status': 'failed',
                    'step_results': finalize_interrupted_steps(wf_snap.get('step_results') or {}),
                })
                wf_fail = worker_api.get_agent_workflow(workflow_id)
                worker_api.emit_event('workflow.failed', {
                    'workflow_id': wf_fail.get('workflow_id') or workflow_id,
                    'workflow_mongo_id': workflow_id,
                    'workspace_id': workspace_id,
                    'error': 'Workflow timed out',
                })
        except Exception:
            pass
        write(False, None, 'Workflow timed out', 504)
        raise
    except Exception as exc:
        logger.exception('execute_workflow failed workflow_id=%s', workflow_id)
        try:
            from lib import worker_api
            if worker_api.configured():
                wf_snap = worker_api.get_agent_workflow(workflow_id)
                worker_api.patch_agent_workflow(workflow_id, {
                    'status': 'failed',
                    'step_results': finalize_interrupted_steps(wf_snap.get('step_results') or {}),
                })
                wf_fail = worker_api.get_agent_workflow(workflow_id)
                worker_api.emit_event('workflow.failed', {
                    'workflow_id': wf_fail.get('workflow_id') or workflow_id,
                    'workflow_mongo_id': workflow_id,
                    'workspace_id': workspace_id,
                    'error': str(exc),
                })
        except Exception:
            pass
        write(False, None, str(exc), 502)
