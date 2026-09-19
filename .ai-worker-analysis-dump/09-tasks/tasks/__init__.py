# Import side effects: register Celery tasks on the shared Celery app.
# Legacy implementations keep stable Celery task names (tasks.*) for beat/API compatibility.
# Domain packages (social/, ads/, imports/, analytics/) are scaffolding for migrated Node jobs.
from . import agent  # noqa: F401
from . import ai  # noqa: F401
from . import scheduler_ads_sync  # noqa: F401
from . import scheduler_beat  # noqa: F401
from . import analytics  # noqa: F401
from . import bridge  # noqa: F401
from . import imports  # noqa: F401
from . import social  # noqa: F401
from . import ads  # noqa: F401
from . import seo  # noqa: F401
