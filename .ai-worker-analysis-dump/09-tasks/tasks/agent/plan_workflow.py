"""Celery: planner agent — generates validated workflow graphs."""

from __future__ import annotations

import json
import logging
from typing import Any

from billiard.exceptions import SoftTimeLimitExceeded

from celery_app import celery_app
from db import get_redis
from agents.planner import plan_workflow
from lib import worker_api
from lib.runtime.cancel import is_workflow_cancelled

logger = logging.getLogger(__name__)


# One planner LLM call per enqueue — never auto-retry (would re-bill the API).
_PLAN_TASK_OPTS = dict(max_retries=0, acks_late=False)


@celery_app.task(
    name='tasks.agent.plan_workflow',
    soft_time_limit=180,
    time_limit=210,
    **_PLAN_TASK_OPTS,
)
def plan_workflow_task(
    workspace_id: str,
    workflow_id: str,
    user_message: str,
    conversation_history: list[dict[str, str]] | None,
    attached_media: list[dict[str, Any]] | None,
    reply_key: str,
) -> None:
    r = get_redis()

    def write(ok: bool, data: Any = None, error: str | None = None, status: int = 502) -> None:
        body = json.dumps({'ok': ok, 'data': data, 'error': error, 'status': status}, default=str)
        r.set(reply_key, body, ex=600)

    try:
        if is_workflow_cancelled(workflow_id):
            if worker_api.configured():
                worker_api.patch_agent_workflow(workflow_id, {
                    'status': 'cancelled',
                    'execution_errors': ['Stopped by user.'],
                })
                wf_doc = worker_api.get_agent_workflow(workflow_id)
                worker_api.emit_event('workflow.cancelled', {
                    'workflow_id': wf_doc.get('workflow_id') or workflow_id,
                    'workflow_mongo_id': workflow_id,
                    'workspace_id': workspace_id,
                })
            write(False, None, 'Stopped by user.', 499)
            return

        graph = plan_workflow(
            workspace_id=workspace_id,
            user_message=user_message,
            conversation_history=conversation_history,
            attached_media=attached_media or [],
        )

        if is_workflow_cancelled(workflow_id):
            if worker_api.configured():
                worker_api.patch_agent_workflow(workflow_id, {
                    'status': 'cancelled',
                    'execution_errors': ['Stopped by user.'],
                })
                wf_doc = worker_api.get_agent_workflow(workflow_id)
                worker_api.emit_event('workflow.cancelled', {
                    'workflow_id': wf_doc.get('workflow_id') or workflow_id,
                    'workflow_mongo_id': workflow_id,
                    'workspace_id': workspace_id,
                })
            write(False, None, 'Stopped by user.', 499)
            return

        if worker_api.configured():
            wf_snap = worker_api.get_agent_workflow(workflow_id)
            if (wf_snap.get('status') or '').lower() == 'cancelled':
                write(False, None, 'Stopped by user.', 499)
                return
            from lib.planner.chat_only import is_chat_only_graph

            chat_only = is_chat_only_graph(graph)
            wf_status = (
                'completed'
                if chat_only
                else ('planned' if not graph.get('requires_approval') else 'awaiting_approval')
            )
            worker_api.patch_agent_workflow(
                workflow_id,
                {
                    'status': wf_status,
                    'intent': graph.get('intent'),
                    'summary': graph.get('summary'),
                    'graph': graph,
                    'approval_gates': graph.get('approval_gates') or [],
                },
            )
            wf_doc = worker_api.get_agent_workflow(workflow_id)
            if chat_only:
                worker_api.emit_event('workflow.completed', {
                    'workflow_id': wf_doc.get('workflow_id') or workflow_id,
                    'workflow_mongo_id': workflow_id,
                    'workspace_id': workspace_id,
                    'chat_only': True,
                })
            else:
                worker_api.emit_event('workflow.planned', {
                    'workflow_id': wf_doc.get('workflow_id') or workflow_id,
                    'workflow_mongo_id': workflow_id,
                    'workspace_id': workspace_id,
                    'requires_approval': graph.get('requires_approval'),
                })

        if graph.get('meta_setup_phase') == 'discovery' and not graph.get('requires_approval'):
            from tasks.agent.execute_workflow import execute_workflow_task

            logger.info('Auto-running Meta setup discovery workflow_id=%s', workflow_id)
            try:
                execute_workflow_task(workspace_id, workflow_id, reply_key=None, approved=True)
                if worker_api.configured():
                    wf_done = worker_api.get_agent_workflow(workflow_id)
                    clarification = (wf_done.get('summary') or '').strip()
                    if clarification:
                        graph['assistant_message'] = clarification
                        graph['summary'] = clarification
            except Exception as exc:
                logger.exception('Meta setup discovery auto-run failed workflow_id=%s', workflow_id)
                graph['assistant_message'] = (
                    (graph.get('assistant_message') or '').strip()
                    + f'\n\nPage discovery failed: {exc}. Retry or connect a Facebook Page in Meta Business Settings.'
                ).strip()

        write(True, {
            'workflow_id': workflow_id,
            'graph': graph,
            'assistant_message': graph.get('assistant_message'),
            'requires_approval': graph.get('requires_approval'),
        }, None, 200)
    except ValueError as ve:
        logger.info('plan_workflow validation: %s', ve)
        if worker_api.configured():
            worker_api.patch_agent_workflow(workflow_id, {
                'status': 'failed',
                'execution_errors': [str(ve)],
            })
        write(False, None, str(ve), 422)
    except SoftTimeLimitExceeded:
        msg = (
            'Planner timed out before finishing. Try a shorter request, use the Ads campaign wizard, '
            'or ask to create one campaign step at a time.'
        )
        logger.warning('plan_workflow soft timeout workflow_id=%s', workflow_id)
        if worker_api.configured():
            worker_api.patch_agent_workflow(workflow_id, {
                'status': 'failed',
                'execution_errors': [msg],
            })
        write(False, None, msg, 504)
    except Exception as exc:
        logger.exception('plan_workflow failed workflow_id=%s', workflow_id)
        if worker_api.configured():
            worker_api.patch_agent_workflow(workflow_id, {
                'status': 'failed',
                'execution_errors': [str(exc)],
            })
        write(False, None, str(exc), 502)
